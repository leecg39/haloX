import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_WORKSPACE_ID as WS, DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { runWordPressCommand } from './wordpress-service.ts';
import { createWordPressClient, wordpressSiteUrl } from './wordpress.ts';
import { openIntegrationSecret, sealIntegrationSecret } from './integration-secret.ts';
import { ExternalServiceError, publicJsonRequest } from './public-json.ts';
import { ContentConflictError } from './content-model.ts';
import { assertRestWrite } from './rest-policy.ts';

const oldSecret = process.env.HALOX_INTEGRATION_SECRET; process.env.HALOX_INTEGRATION_SECRET = 'test-only-integration-encryption-key-32-characters';
after(() => { if (oldSecret === undefined) delete process.env.HALOX_INTEGRATION_SECRET; else process.env.HALOX_INTEGRATION_SECRET = oldSecret; });
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
type Result = { destination: Row; publication: Row; ok: boolean; reused?: boolean };
type Content = { job: Row; draft: Row };
const settings = { name: '공식 블로그', site_url: 'https://blog.example.com/site', username: 'editor', password: 'abcdefghijklmnopqrstuvwx' };
const original = { title: '사용 안내', target_keyword: '제품 사용', content_md: '## 시작하기\n<script>bad()</script>\n설명합니다.', meta_description: '검토한 제품 사용법' };
function fixture(client = {
  verify: async () => ({ remote_user_id: 7, can_publish: true }),
  publish: async () => ({ id: 42, url: 'https://blog.example.com/site/?p=42', status: 'draft' }),
  find: async () => ({ id: 42, url: 'https://blog.example.com/site/?p=42', status: 'draft' }),
}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-wordpress-')); directories.push(directory);
  const filename = path.join(directory, 'data.sqlite'), store = new PersistentHaloXStore(filename);
  const call = (command: string, values: Row = {}, actor = ACTOR) => runWordPressCommand(store, command, { workspace_id: WS, ...values }, actor, client) as Promise<Result>;
  const content = (command: string, values: Row = {}) => store.write(db => db.invokeEdgeFunction(command, { workspace_id: WS, ...values }, ACTOR)) as Promise<Content>;
  const rows = (table: string) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${WS}` } }, ACTOR).data);
  async function ready() {
    const target = (await call('wordpress-create', settings)).destination;
    const checked = (await call('wordpress-verify', { destination_id: target.id, expected_revision: target.revision })).destination;
    const { job } = await content('content-create', original);
    return { target: checked, job, request: { destination_id: target.id, expected_destination_revision: target.revision, job_id: job.id, expected_content_revision: job.revision, idempotency_key: 'publish-once', status: 'draft', confirm: true } };
  }
  return { store, filename, call, content, rows, ready };
}

describe('WordPress credentials and durable publication commands', () => {
  it('encrypts secrets with authenticated tenant binding, never returns them, and rotates or retains them explicitly', async () => {
    const { store, call } = fixture(); const row = (await call('wordpress-create', settings)).destination;
    assert.equal(row.has_credentials, true); assert.equal(JSON.stringify(row).includes(settings.password), false);
    const secret = await store.read(db => db.getServerRecords('export_credentials')[0]); assert.equal(JSON.stringify(secret).includes(settings.password), false);
    assert.equal(openIntegrationSecret(String(secret.ciphertext), `${WS}:${row.id}`), settings.password);
    assert.throws(() => openIntegrationSecret(String(secret.ciphertext), `other:${row.id}`));
    assert.throws(() => openIntegrationSecret(String(secret.ciphertext), `${WS}:${row.id}`, { HALOX_INTEGRATION_SECRET: 'different-secret-at-least-32-characters' }));
    assert.notEqual(sealIntegrationSecret(settings.password, 'scope'), sealIntegrationSecret(settings.password, 'scope'));
    await call('wordpress-update', { ...settings, name: '이름 변경', password: '', destination_id: row.id, expected_revision: 1 });
    assert.deepEqual(await store.read(db => db.getServerRecords('export_credentials')[0]), secret);
    await assert.rejects(call('wordpress-update', { ...settings, site_url: 'https://elsewhere.example/', password: '', destination_id: row.id, expected_revision: 2 }), /다시 입력/);
    await call('wordpress-update', { ...settings, password: [...settings.password].reverse().join(''), destination_id: row.id, expected_revision: 2 });
    assert.notEqual((await store.read(db => db.getServerRecords('export_credentials')[0])).ciphertext, secret.ciphertext);
    await call('wordpress-delete', { destination_id: row.id, expected_revision: 3 }); assert.deepEqual(await store.read(db => db.getServerRecords('export_credentials')), []);
  });

  it('prevents member actions and REST/legacy command bypasses, and rejects unsafe URLs before storing credentials', async () => {
    const { store, call, content } = fixture(); const row = (await call('wordpress-create', settings)).destination;
    await store.write(db => db.insertTable('workspace_members', { workspace_id: WS, user_id: OTHER_USER_ID, role: 'member' }, ACTOR));
    await assert.rejects(call('wordpress-verify', { destination_id: row.id, expected_revision: 1 }, OTHER_USER_ID), /관리자 권한/);
    await assert.rejects(content('export-destination-delete', { destination_id: row.id, expected_revision: 1 }), /전용 연결/);
    await store.read(db => { assert.throws(() => assertRestWrite(db, 'export_publications', 'POST', ACTOR, { workspace_id: WS }), /전용 서버/); assert.throws(() => db.queryTable('export_credentials'), /does not exist/); });
    for (const site_url of ['http://example.com', 'https://localhost/', 'https://127.0.0.1', 'https://user:password@example.com/', 'https://example.com:9000/', 'https://example.com/?url=other']) await assert.rejects(call('wordpress-create', { ...settings, name: site_url, site_url }));
  });

  it('verifies remote permissions, invalidates verification after edits and detects a concurrent connection update', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const { call, rows } = fixture({ verify: async () => { await gate; return { remote_user_id: 1, can_publish: false }; }, publish: async () => { throw new Error(); }, find: async () => { throw new Error(); } });
    const row = (await call('wordpress-create', settings)).destination;
    const pending = call('wordpress-verify', { destination_id: row.id, expected_revision: 1 });
    await call('wordpress-update', { ...settings, name: '수정됨', password: '', destination_id: row.id, expected_revision: 1 });
    release(); await assert.rejects(pending, ContentConflictError);
    const checked = await call('wordpress-verify', { destination_id: row.id, expected_revision: 2 }); assert.equal(checked.destination.can_publish, false); assert.equal(checked.destination.verified_revision, 2);
    assert.equal((await rows('export_destinations'))[0].verification_status, 'verified');
  });

  it('persists source snapshots, blocks unreviewed public posts and duplicates, and keeps remote posts when history is deleted', async () => {
    let calls = 0;
    const { call, ready, content, rows, store } = fixture({ verify: async () => ({ remote_user_id: 1, can_publish: true }), publish: async () => { calls++; return { id: 42, url: 'https://blog.example.com/?p=42', status: 'draft' }; }, find: async () => { throw new Error(); } });
    const { request, job } = await ready();
    await assert.rejects(call('wordpress-publish', { ...request, confirm: false }), /미리보기/);
    await assert.rejects(call('wordpress-publish', { ...request, status: 'publish' }), /사용 준비/);
    const saved = await call('wordpress-publish', request); assert.equal(saved.publication.status, 'succeeded'); assert.equal(calls, 1);
    assert.equal((await call('wordpress-publish', request)).publication.id, saved.publication.id); assert.equal(calls, 1);
    await assert.rejects(call('wordpress-publish', { ...request, idempotency_key: 'different-key' }), /이미 있습니다/);
    await assert.rejects(call('wordpress-publish', { ...request, status: 'publish' }), /같은 요청 키/);
    await content('content-delete', { job_id: job.id, expected_revision: job.revision });
    const record = (await rows('export_publications'))[0]; assert.equal(record.content_job_id, null); assert.equal((record.source_snapshot as Row).content_md, original.content_md);
    const edited = await call('wordpress-history-update', { publication_id: record.id, expected_revision: record.revision, notes: '검토 기록' }); assert.equal(edited.publication.notes, '검토 기록');
    await call('wordpress-history-delete', { publication_id: record.id, expected_revision: edited.publication.revision }); assert.equal(calls, 1);
    await assert.rejects(call('wordpress-publish', request), /찾을 수 없습니다/); assert.equal(calls, 1);
    assert.equal((await store.read(db => db.getServerRecords('export_requests'))).length, 1);
  });

  it('reserves before network I/O, releases the writer lock, and deduplicates a concurrent request across store instances', async () => {
    let release!: () => void, entered!: () => void, calls = 0;
    const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const client = { verify: async () => ({ remote_user_id: 1, can_publish: true }), publish: async () => { calls++; entered(); await gate; return { id: 7, url: 'https://blog.example.com/?p=7', status: 'draft' }; }, find: async () => { throw new Error(); } };
    const { ready, call, store, filename } = fixture(client); const { request } = await ready();
    const pending = call('wordpress-publish', request); await started;
    await store.write(db => db.updateTable('workspaces', { description: 'network 중에도 저장' }, { id: `eq.${WS}` }, ACTOR));
    const restart = new PersistentHaloXStore(filename); const duplicate = await runWordPressCommand(restart, 'wordpress-publish', { ...request, workspace_id: WS }, ACTOR, client);
    assert.equal(duplicate.reused, true); assert.equal((duplicate.publication as Row).status, 'sending'); assert.equal(calls, 1);
    release(); assert.equal((await pending).publication.status, 'succeeded');
  });

  it('retains ambiguous outcomes, blocks target/workspace deletion, and reconciles the remote slug without reposting', async () => {
    let calls = 0;
    const { ready, call, store, rows } = fixture({ verify: async () => ({ remote_user_id: 1, can_publish: true }), publish: async () => { calls++; throw new ExternalServiceError('시간 초과'); }, find: async () => ({ id: 9, url: 'https://blog.example.com/?p=9', status: 'publish' }) });
    const { request, target } = await ready(); const result = await call('wordpress-publish', request);
    assert.equal(result.ok, false); assert.equal(result.publication.status, 'unknown');
    await assert.rejects(call('wordpress-delete', { destination_id: target.id, expected_revision: target.revision }), /확인하지 못한 게시/);
    await assert.rejects(store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` }, ACTOR)), /외부 게시/);
    await assert.rejects(call('wordpress-publish', { ...request, idempotency_key: 'retry' }), /이미 있습니다/);
    const checked = await call('wordpress-reconcile', { publication_id: result.publication.id, expected_revision: result.publication.revision }); assert.equal(checked.publication.remote_post_id, 9); assert.equal(calls, 1);
    await call('wordpress-delete', { destination_id: target.id, expected_revision: target.revision }); assert.equal((await rows('export_publications'))[0].destination_id, null);
    await store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` }, ACTOR)); assert.deepEqual(await store.read(db => db.getServerRecords('export_credentials')), []);
  });

  it('records rejected requests and lets an administrator resolve a stale uncertain outcome only with explicit confirmation', async () => {
    const { ready, call, store, rows } = fixture({ verify: async () => ({ remote_user_id: 1, can_publish: true }), publish: async () => { throw new ExternalServiceError('접수 거절', 'WORDPRESS_REJECTED', 502, false); }, find: async () => { throw new Error(); } });
    const { request } = await ready(); const rejected = await call('wordpress-publish', request); assert.equal(rejected.publication.status, 'failed'); assert.equal((await call('wordpress-publish', request)).ok, false);
    await store.write(db => db.updateTable('export_publications', { status: 'sending' }, { id: `eq.${rejected.publication.id}` }, ACTOR));
    await assert.rejects(call('wordpress-resolve', { publication_id: rejected.publication.id, expected_revision: rejected.publication.revision, confirm_absent: true }), /1분/);
    await store.write(db => db.updateTable('export_publications', { created_at: new Date(Date.now() - 120000).toISOString() }, { id: `eq.${rejected.publication.id}` }, ACTOR));
    await assert.rejects(call('wordpress-resolve', { publication_id: rejected.publication.id, expected_revision: rejected.publication.revision }), /확인한 뒤/);
    const result = await call('wordpress-resolve', { publication_id: rejected.publication.id, expected_revision: rejected.publication.revision, confirm_absent: true }); assert.equal(result.publication.status, 'unconfirmed');
    assert.equal((await rows('export_publications')).length, 1);
  });
});

describe('credential-bearing public HTTPS adapters', () => {
  it('blocks every private DNS answer and rejects redirects without sending credentials to another host', async () => {
    let calls = 0;
    await assert.rejects(publicJsonRequest('https://public.example/', { method: 'GET', authorization: 'secret' }, { resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], request: async () => { calls++; return { status: 200, body: {} }; } }), /내부 네트워크/); assert.equal(calls, 0);
    const resolve = async () => [{ address: '8.8.8.8', family: 4 }];
    const client = createWordPressClient((url, request) => publicJsonRequest(url, request, { resolve, request: async (_url, address) => { calls++; assert.equal(address.address, '8.8.8.8'); return { status: 302, body: { location: 'https://different.example' } }; } }));
    await assert.rejects(client.verify({ ...settings, password: 'redacted' }), /HTTP 302/); assert.equal(calls, 1);
    await assert.rejects(publicJsonRequest('https://public.example/', { method: 'GET', authorization: 'secret' }, { timeoutMs: 10, resolve: () => new Promise(() => {}) }), /초과/);
    assert.equal(wordpressSiteUrl('https://example.com/blog'), 'https://example.com/blog/');
  });
  it('uses WordPress application authentication, checks capabilities and sends escaped content with the explicit status', async () => {
    const requests: { url: string; body: unknown }[] = [];
    const client = createWordPressClient(async (url, request) => {
      requests.push({ url, body: request.body }); assert.equal(request.authorization, 'Basic ' + Buffer.from(`editor:${settings.password}`).toString('base64'));
      if (url.includes('users/me')) return { status: 200, body: { id: 3, capabilities: { edit_posts: true, publish_posts: false } } };
      return { status: 201, body: { id: 5, status: 'draft', link: 'https://blog.example.com/?p=5' } };
    });
    const credentials = { site_url: 'https://blog.example.com/blog/', username: 'editor', password: settings.password };
    assert.equal((await client.verify(credentials)).can_publish, false);
    await client.publish(credentials, { ...original, title: '<img src=x>', meta_description: '<script>bad()</script>' }, 'draft', 'halox-uuid');
    assert.ok(requests[1].url.endsWith('/blog/wp-json/wp/v2/posts')); const body = requests[1].body as Row; assert.equal(body.status, 'draft'); assert.equal(body.slug, 'halox-uuid'); assert.match(String(body.content), /&lt;script&gt;/); assert.doesNotMatch(String(body.content), /<script>/); assert.equal(body.title, '&lt;img src=x&gt;'); assert.equal(body.excerpt, '&lt;script&gt;bad()&lt;/script&gt;');
    const invalid = createWordPressClient(async () => ({ status: 200, body: { id: 2, capabilities: {} } })); await assert.rejects(invalid.verify(credentials), /글을 작성/);
    const rejected = createWordPressClient(async () => ({ status: 401, body: { password: 'never surface' } })); await assert.rejects(rejected.publish(credentials, original, 'draft', 'slug'), (error: ExternalServiceError) => error.uncertain === false && !error.message.includes('never surface'));
  });
});
