import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStoreBackup, restoreStoreBackup } from './backup.ts';
import { DEFAULT_USER_ID, type DatabaseState } from './database.ts';
import { PersistentHaloXStore } from './store.ts';

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'halox-backup-'));
  return { directory, source: path.join(directory, 'source.sqlite'), target: path.join(directory, 'target.sqlite'), backup: path.join(directory, 'snapshot.halox-backup.json') };
}

test('backup and restore preserve the exact public and private state with private file permissions', async () => {
  const f = await fixture(), source = new PersistentHaloXStore(f.source);
  await source.write(db => {
    db.insertTable('workspaces', { name: '백업 검증 워크스페이스' }, DEFAULT_USER_ID);
    db.setServerRecords('account_credentials', [{ owner_id: DEFAULT_USER_ID, marker: 'private-state' }]);
  });
  const expected = await source.read(db => db.exportState());
  const created = await createStoreBackup(f.source, f.backup, { now: new Date('2026-10-24T00:00:00.000Z') });
  assert.equal(created.created_at, '2026-10-24T00:00:00.000Z');
  assert.equal((await stat(f.backup)).mode & 0o777, 0o600);
  await restoreStoreBackup(f.backup, f.target);
  assert.deepEqual(await new PersistentHaloXStore(f.target).read(db => db.exportState()), expected);
});

test('tampered and invalid backups are rejected without changing the destination', async () => {
  const f = await fixture(), source = new PersistentHaloXStore(f.source), target = new PersistentHaloXStore(f.target);
  await source.write(db => db.insertTable('workspaces', { name: '원본' }, DEFAULT_USER_ID));
  await target.write(db => db.insertTable('workspaces', { name: '보존 대상' }, DEFAULT_USER_ID));
  const before = await target.read(db => db.exportState());
  await createStoreBackup(f.source, f.backup);
  const envelope = JSON.parse(await readFile(f.backup, 'utf8')) as { payload_base64: string };
  envelope.payload_base64 = Buffer.from(JSON.stringify({ version: 1, tables: { unknown_table: [] } } satisfies DatabaseState)).toString('base64');
  await chmod(f.backup, 0o600); await writeFile(f.backup, JSON.stringify(envelope), { mode: 0o600 });
  await assert.rejects(restoreStoreBackup(f.backup, f.target), /무결성/);
  assert.deepEqual(await target.read(db => db.exportState()), before);
});

test('backup creation refuses to replace an existing file unless explicitly requested', async () => {
  const f = await fixture();
  await new PersistentHaloXStore(f.source).read(db => db.exportState());
  await createStoreBackup(f.source, f.backup);
  await assert.rejects(createStoreBackup(f.source, f.backup), /이미 존재/);
  await createStoreBackup(f.source, f.backup, { overwrite: true });
});
