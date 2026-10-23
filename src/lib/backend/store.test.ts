import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { PersistentHaloXStore, StorageUnavailableError } from './store.ts';
import { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, OTHER_USER_ID, ISOLATED_WORKSPACE_ID } from './database.ts';

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-store-'));
  directories.push(directory);
  const filename = path.join(directory, 'store.sqlite');
  return { filename, store: new PersistentHaloXStore(filename) };
}
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

describe('durable store', () => {
  it('persists creation, edits and deletions across Node process restarts', async () => {
    const { filename, store } = fixture();
    const [created] = await store.write(db => db.insertTable('keywords', { keyword: '재시작 테스트' }));
    await store.write(db => db.updateTable('keywords', { keyword: '수정 완료' }, { id: `eq.${created.id}` }));
    const program = `
      const { PersistentHaloXStore } = await import(${JSON.stringify(new URL('./store.ts', import.meta.url).href)});
      const store = new PersistentHaloXStore(process.argv[1]);
      const before = await store.read(db => db.queryTable('keywords', { filters: { id: 'eq.' + process.argv[2] } }));
      await store.write(db => db.deleteTable('keywords', { id: 'eq.' + process.argv[2] }));
      process.stdout.write(JSON.stringify(before.data));
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program, filename, String(created.id)]);
    assert.equal(JSON.parse(stdout)[0].keyword, '수정 완료');
    assert.deepEqual(await store.read(db => db.queryTable('keywords', { filters: { id: `eq.${created.id}` } }).data), []);
    assert.equal(statSync(filename).mode & 0o777, 0o600);
  });

  it('commits quota and asynchronous pipeline results together', async () => {
    const { filename, store } = fixture();
    await store.write(db => db.invokeEdgeFunction('keywords-collect', { workspace_id: DEFAULT_WORKSPACE_ID, keywords: ['영속 수집'] }));
    const reopened = new PersistentHaloXStore(filename);
    assert.equal((await reopened.read(db => db.queryTable('keywords', { filters: { keyword: 'eq.영속 수집' } }).data)).length, 1);
    assert.ok((await reopened.read(db => db.queryTable('usage_reservations').data)).length > 0);
  });

  it('rolls back partial mutations, including async failures', async () => {
    const { store } = fixture();
    const count = await store.read(db => db.queryTable('keywords').count);
    await assert.rejects(store.write(async db => {
      db.insertTable('keywords', { keyword: '저장되면 안 됨' });
      await Promise.resolve();
      throw new Error('provider failed');
    }), /provider failed/);
    assert.equal(await store.read(db => db.queryTable('keywords').count), count);
    await assert.rejects(store.write(db => db.insertTable('keywords', [
      { keyword: '허용 항목', workspace_id: DEFAULT_WORKSPACE_ID },
      { keyword: '권한 없음', workspace_id: ISOLATED_WORKSPACE_ID },
    ])), /not authorized/);
    assert.equal(await store.read(db => db.queryTable('keywords').count), count);
  });

  it('serializes independent writers without blocking an async writer or losing updates', async () => {
    const { filename, store } = fixture();
    await store.read(() => undefined);
    const other = new PersistentHaloXStore(filename);
    await other.read(() => undefined);
    const before = await store.read(db => db.queryTable('keywords').count);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = store.write(async db => {
      db.insertTable('keywords', { keyword: 'writer one' });
      entered();
      await gate;
    });
    await started;
    const second = other.write(db => db.insertTable('keywords', { keyword: 'writer two' }));
    // WAL readers must see committed data, not the first writer's pending data.
    assert.equal(await other.read(db => db.queryTable('keywords').count), before);
    release();
    await Promise.all([first, second]);
    assert.equal(await store.read(db => db.queryTable('keywords').count), before + 2);
  });

  it('retains tenant isolation on reopened storage', async () => {
    const { filename, store } = fixture();
    const [created] = await store.write(db => db.insertTable('keywords', { keyword: 'private' }, DEFAULT_USER_ID));
    const reopened = new PersistentHaloXStore(filename);
    assert.deepEqual(await reopened.read(db => db.queryTable('keywords', { filters: { id: `eq.${created.id}` } }, OTHER_USER_ID).data), []);
    await assert.rejects(reopened.write(db => db.updateTable('keywords', { keyword: 'attack' }, { id: `eq.${created.id}` }, OTHER_USER_ID)), /security/);
  });

  it('retries extended SQLite lock codes before executing a write exactly once', async (t) => {
    const { filename, store } = fixture();
    await store.read(() => undefined);
    const original = DatabaseSync.prototype.exec;
    const pending = [261, 262]; // SQLITE_BUSY_RECOVERY / SQLITE_LOCKED_SHAREDCACHE
    let attempts = 0, executions = 0;
    const mocked = t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      if (sql === 'BEGIN IMMEDIATE') {
        attempts++;
        if (pending.length) throw Object.assign(new Error('database is locked'), { errcode: pending.shift() });
      }
      return original.call(this, sql);
    });
    const [created] = await store.write(db => {
      executions++;
      return db.insertTable('keywords', { keyword: 'recovered writer' });
    });
    mocked.mock.restore();
    assert.equal(attempts, 3);
    assert.equal(executions, 1);
    assert.equal(await new PersistentHaloXStore(filename).read(db => db.queryTable('keywords', { filters: { id: `eq.${created.id}` } }).count), 1);
  });

  it('does not retry non-lock SQLite errors or run the pending mutation', async (t) => {
    const { store } = fixture();
    await store.read(() => undefined);
    const original = DatabaseSync.prototype.exec;
    let attempts = 0;
    t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      if (sql === 'BEGIN IMMEDIATE') {
        attempts++;
        throw Object.assign(new Error('disk I/O error'), { errcode: 266 }); // SQLITE_IOERR_READ
      }
      return original.call(this, sql);
    });
    await assert.rejects(store.write(() => assert.fail('must not execute')), StorageUnavailableError);
    assert.equal(attempts, 1);
  });

  it('does not resurrect deleted seed rows or reset corrupt storage', async () => {
    const { filename, store } = fixture();
    const first = await store.read(db => db.queryTable('keywords').data[0]);
    await store.write(db => db.deleteTable('keywords', { id: `eq.${first.id}` }));
    assert.equal(await new PersistentHaloXStore(filename).read(db => db.queryTable('keywords', { filters: { id: `eq.${first.id}` } }).count), 0);
    const connection = new DatabaseSync(filename);
    connection.prepare('UPDATE runtime_state SET state = ?').run('{invalid');
    connection.close();
    await assert.rejects(new PersistentHaloXStore(filename).read(() => undefined), StorageUnavailableError);
    const check = new DatabaseSync(filename);
    assert.equal(check.prepare('SELECT state FROM runtime_state').get()?.state, '{invalid');
    check.close();
  });
});
