import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_USER_ID as OWNER, OTHER_USER_ID as OTHER, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { issueSession } from './account-session.ts';
import { googleCommand, googleView, startGoogleOAuth, finishGoogleOAuth, readGoogleTokens, saveGoogleTokens, googleConnection, googleRange } from './google-service.ts';
import { createGoogleClient, GOOGLE_SCOPES, googleConfig, type GoogleClient, type GoogleTokens } from './google-client.ts';
import { processGoogleTick, scheduleGoogleSync } from './google-worker.ts';
import { assertRestWrite } from './rest-policy.ts';
import { ExternalServiceError } from './public-json.ts';
process.env.HALOX_SESSION_SECRET = 'google-unit-session-secret-at-least-32-characters';
process.env.HALOX_INTEGRATION_SECRET = 'google-unit-encryption-secret-at-least-32-characters';
process.env.GOOGLE_CLIENT_ID = 'unit-google-client'; process.env.GOOGLE_CLIENT_SECRET = 'unit-google-secret'; process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/v1/google/callback';
const config = googleConfig();
const tokens: GoogleTokens = { access_token: 'test-access-do-not-expose', refresh_token: 'test-refresh-do-not-expose', expires_at: Date.now() + 3600000, scope: GOOGLE_SCOPES.join(' ') };
const client: GoogleClient = { exchange: async () => tokens, refresh: async () => tokens, identity: async () => ({ sub: 'google-user', email: 'google@example.test' }), resources: async () => ({ sites: [{ id: 'sc-domain:example.test', name: 'example.test' }], properties: [{ id: 'properties/123', name: 'Test GA4' }] }), report: async (_token, table, _resource, start) => ({ rows: [{ date: start, ...(table === 'ga4_page_stats' ? { page_path: '/', session_source: 'google', channel_group: 'Organic Search', sessions: 8, organic_sessions: 8, ai_sessions: 0, conversions: 1 } : { clicks: 5, impressions: 50, ctr: 10, avg_position: 3, ...(table === 'gsc_daily_keywords' ? { keyword: 'test' } : table === 'gsc_daily_pages' ? { page_url: 'https://example.test/' } : {}) }) }], more: false, metadata: { timezone: table === 'ga4_page_stats' ? 'Asia/Seoul' : 'America/Los_Angeles' } }) };
const dirs: string[] = []; afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'halox-google-')); dirs.push(dir); const file = path.join(dir, 'state.sqlite'), store = new PersistentHaloXStore(file);
  const workspace = String((await store.write(db => db.insertTable('workspaces', { name: 'Google unit' }, OWNER)[0])).id), session = (await store.write(db => issueSession(db, OWNER, 0))).id;
  const view = () => store.read(db => googleView(db, workspace, OWNER));
  const command = async (action: string, values: Row = {}, provider = client) => googleCommand(store, OWNER, { workspace_id: workspace, action, expected_revision: (await view()).connection?.revision, ...values }, provider);
  const start = async () => new URL((await startGoogleOAuth(store, workspace, OWNER, session, config)).url).searchParams.get('state')!;
  const connect = async () => { await finishGoogleOAuth(store, OWNER, session, await start(), 'code', false, client, config); await command('discover'); await command('settings', { name: '실제 연결', gsc_site_url: 'sc-domain:example.test', ga4_property_id: 'properties/123', auto_sync: false }); };
  const enqueue = (request_id = crypto.randomUUID()) => command('sync', { start: '2026-10-01', end: '2026-10-03', request_id });
  const rows = (table: string) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${workspace}` } }, OWNER).data);
  return { store, workspace, session, file, view, command, start, connect, enqueue, rows };
}
test('Google OAuth binds state to account/session, expires and consumes it once; ciphertext is private', async () => {
  const f = await fixture(), state = await f.start(), otherSession = (await f.store.write(db => issueSession(db, OWNER, 0))).id;
  await assert.rejects(() => finishGoogleOAuth(f.store, OWNER, otherSession, state, 'code', false, client, config), /세션/);
  await finishGoogleOAuth(f.store, OWNER, f.session, state, 'code', false, client, config);
  await assert.rejects(() => finishGoogleOAuth(f.store, OWNER, f.session, state, 'code', false, client, config), /만료/);
  const data = await f.view(); assert.equal(data.connection?.status, 'connected'); assert.equal(JSON.stringify(data).includes('test-access'), false);
  const privateRows = await f.store.read(db => db.getServerRecords('google_credentials')); assert.equal(JSON.stringify(privateRows).includes('test-refresh'), false);
  assert.equal((await f.store.read(db => readGoogleTokens(db, data.connection!))).refresh_token, tokens.refresh_token);
  await assert.rejects(() => f.store.read(db => db.queryTable('google_credentials', {}, OWNER)), /does not exist/);
  await f.command('disconnect'); const expired = await f.start(); await f.store.write(db => db.setServerRecords('google_oauth_states', db.getServerRecords('google_oauth_states').map(row => ({ ...row, expires_at: 0 }))));
  await assert.rejects(() => finishGoogleOAuth(f.store, OWNER, f.session, expired, 'code', false, client, config), /만료/);
});
test('Google rejects denied or partial scopes, and cancelled late OAuth cannot resurrect tokens', async () => {
  const f = await fixture(); await assert.rejects(() => f.start().then(state => finishGoogleOAuth(f.store, OWNER, f.session, state, '', true, client, config)), /동의/);
  assert.equal((await f.view()).connection?.status, 'disconnected');
  const partial = { ...client, exchange: async () => ({ ...tokens, scope: 'openid email' }) };
  await assert.rejects(() => f.start().then(state => finishGoogleOAuth(f.store, OWNER, f.session, state, 'code', false, partial, config)), /읽기 권한/);
  const late = { ...client, identity: async () => { await f.command('disconnect'); return client.identity('x'); } };
  await assert.rejects(() => f.start().then(state => finishGoogleOAuth(f.store, OWNER, f.session, state, 'code', false, late, config)), /취소/);
  assert.equal((await f.store.read(db => db.getServerRecords('google_credentials'))).length, 0);
});
test('Google site choices, revisions, permissions and all raw REST mutation bypasses are checked', async () => {
  const f = await fixture(); await f.connect();
  await assert.rejects(() => f.command('settings', { name: 'bad', gsc_site_url: 'http://127.0.0.1', ga4_property_id: '', auto_sync: false }), /접근 가능한/);
  await assert.rejects(() => f.command('disconnect', { expected_revision: 0 }), /변경/);
  await assert.rejects(() => googleCommand(f.store, OTHER, { action: 'disconnect', workspace_id: f.workspace }), /권한|접근|member|RLS/i);
  await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: OTHER, role: 'viewer', allowed_sections: ['other'] }, OWNER));
  assert.deepEqual((await f.store.read(db => googleView(db, f.workspace, OTHER))).connection?.resources, { sites: [], properties: [] });
  assert.equal(JSON.stringify(await f.rows('workspace_google_connections')).includes('Test GA4'), false);
  await assert.rejects(() => f.store.read(db => db.queryTable('google_resources', {}, OWNER)), /does not exist/);
  for (const table of ['workspace_google_connections', 'google_sync_jobs', 'gsc_daily_totals', 'gsc_daily_keywords', 'gsc_daily_pages', 'ga4_page_stats', 'gsc_sync_state']) for (const method of ['POST', 'PATCH', 'DELETE'] as const) await assert.rejects(() => f.store.write(db => assertRestWrite(db, table, method, OWNER, method === 'DELETE' ? undefined : { workspace_id: f.workspace }, { workspace_id: `eq.${f.workspace}` })), /cannot be changed/);
  for (const name of ['sync-ga4-data', 'gsc-sync-enqueue']) await assert.rejects(() => f.store.write(db => db.invokeEdgeFunction(name, { workspace_id: f.workspace, clicks: 123 }, OWNER)), /전용 연동/);
  assert.throws(() => googleRange('2026-02-30', '2026-03-01')); assert.throws(() => googleRange('2026-01-01', '2026-03-01')); assert.throws(() => googleRange('2099-01-01', '2099-01-02'));
});
test('Google stages pages across restarts and atomically publishes once; repeated intervals replace instead of duplicate', async () => {
  const f = await fixture(); await f.connect(); const key = crypto.randomUUID(); await f.enqueue(key); await f.enqueue(key);
  await processGoogleTick(f.store, client); assert.equal((await f.rows('gsc_daily_totals')).length, 0);
  const reopened = new PersistentHaloXStore(f.file); for (let i = 0; i < 3; i++) await processGoogleTick(reopened, client);
  assert.equal((await f.rows('gsc_daily_totals')).length, 1); assert.equal((await f.rows('ga4_page_stats'))[0].provider, 'google');
  const done = (await f.view()).jobs[0]; assert.equal(done.status, 'completed'); assert.equal(done.rows, 4);
  await f.enqueue(); for (let i = 0; i < 4; i++) await processGoogleTick(f.store, client); assert.equal((await f.rows('ga4_page_stats')).length, 1);
  await f.command('job-update', { job_id: done.id, expected_revision: done.revision, notes: '검증 완료' });
  let old = (await f.view()).jobs.find(row => row.id === done.id)!; assert.equal(old.notes, '검증 완료');
  await f.command('job-delete', { job_id: old.id, expected_revision: old.revision }); await f.enqueue(key); assert.equal((await f.view()).jobs.length, 1); assert.equal((await f.rows('gsc_daily_totals')).length, 1);
});
test('failed and cancelled Google sync preserve published data and discard late results', async () => {
  const f = await fixture(); await f.connect(); await f.enqueue(); for (let i = 0; i < 4; i++) await processGoogleTick(f.store, client);
  const original = await f.rows('gsc_daily_totals'); await f.enqueue(); await processGoogleTick(f.store, client);
  await processGoogleTick(f.store, { ...client, report: async () => { throw new ExternalServiceError('접근 불가'); } });
  assert.equal((await f.view()).jobs[0].status, 'failed'); assert.deepEqual(await f.rows('gsc_daily_totals'), original);
  await f.enqueue(); await processGoogleTick(f.store, { ...client, report: async (...args) => { const job = (await f.view()).jobs[0]; await f.command('job-cancel', { job_id: job.id, expected_revision: job.revision }); return client.report(...args); } });
  assert.equal((await f.view()).jobs[0].status, 'cancelled'); assert.deepEqual(await f.rows('gsc_daily_totals'), original); assert.equal((await f.store.read(db => db.getServerRecords('google_sync_work'))).length, 0);
});
test('worker leases prevent parallel page requests; expired work can resume and duplicates fail honestly', async () => {
  const f = await fixture(); await f.connect(); await f.enqueue(); let calls = 0;
  await Promise.all([processGoogleTick(f.store, { ...client, report: async (...args) => { calls++; await new Promise(resolve => setTimeout(resolve, 40)); return client.report(...args); } }), processGoogleTick(f.store, client)]);
  assert.equal((await f.store.read(db => db.getServerRecords('google_sync_work')))[0].cursor, 1); assert.ok(calls <= 1);
  await f.store.write(db => db.setServerRecords('google_sync_work', db.getServerRecords('google_sync_work').map(row => ({ ...row, lease_until: 0, attempts: 1 }))));
  const duplicate = { ...client, report: async (...args: Parameters<GoogleClient['report']>) => ({ ...await client.report(...args), more: true }) };
  await processGoogleTick(f.store, duplicate); await processGoogleTick(f.store, duplicate); assert.equal((await f.view()).jobs[0].status, 'failed'); assert.match(String((await f.view()).jobs[0].error), /중복/);
});
test('a paginated GA4 report resumes at its saved offset and publishes only after the last page', async () => {
  const f = await fixture(); await f.connect(); await f.command('settings', { name: 'GA4 only', gsc_site_url: '', ga4_property_id: 'properties/123', auto_sync: false, confirm_replace: true }); await f.enqueue();
  const offsets: number[] = [], paginated: GoogleClient = { ...client, report: async (_token, _table, _resource, start, _end, offset) => { offsets.push(offset); return { rows: Array.from({ length: offset === 0 ? 1000 : 1 }, (_, index) => ({ date: start, page_path: `/landing/${offset + index}`, session_source: 'google', channel_group: 'Organic Search', sessions: 1, organic_sessions: 1, ai_sessions: 0, conversions: 0 })), more: offset === 0, metadata: { timeZone: 'Asia/Seoul' } }; } };
  await processGoogleTick(f.store, paginated); assert.equal((await f.rows('ga4_page_stats')).length, 0);
  await processGoogleTick(new PersistentHaloXStore(f.file), paginated); assert.deepEqual(offsets, [0, 1000]); assert.equal((await f.rows('ga4_page_stats')).length, 1001); assert.equal((await f.view()).jobs[0].status, 'completed');
});
test('revoked permissions prevent publication and disabling/disconnecting cleans work and credentials', async () => {
  const f = await fixture(); await f.connect(); await f.enqueue();
  await processGoogleTick(f.store, { ...client, report: async (...args) => { await f.command('disconnect'); return client.report(...args); } });
  assert.equal((await f.view()).connection?.status, 'disconnected'); assert.equal((await f.rows('gsc_daily_totals')).length, 0); assert.equal((await f.store.read(db => db.getServerRecords('google_credentials'))).length, 0);
  await f.connect(); await f.enqueue(); await processGoogleTick(f.store, { ...client, report: async () => { throw new ExternalServiceError('인증 철회', 'GOOGLE_REAUTHORIZE', 401); } });
  assert.equal((await f.view()).connection?.status, 'reauthorize'); assert.equal((await f.view()).connection?.auto_sync, false);
});
test('Google refresh token rotation stays encrypted and stale refresh cannot undo disconnect', async () => {
  const f = await fixture(); await f.connect();
  await f.store.write(db => saveGoogleTokens(db, googleConnection(db, f.workspace, OWNER)!, { ...tokens, expires_at: 0 }));
  await f.command('discover', {}, { ...client, refresh: async () => ({ ...tokens, refresh_token: 'rotated-refresh' }) });
  assert.equal(await f.store.read(db => readGoogleTokens(db, googleConnection(db, f.workspace, OWNER)!).refresh_token), 'rotated-refresh');
  await f.store.write(db => saveGoogleTokens(db, googleConnection(db, f.workspace, OWNER)!, { ...tokens, expires_at: 0 }));
  await assert.rejects(() => f.command('discover', {}, { ...client, refresh: async () => { await f.command('disconnect'); return tokens; } }), /변경/);
  assert.equal((await f.store.read(db => db.getServerRecords('google_credentials'))).length, 0);
});
test('automatic sync is opt-in, cursor persists and concurrent schedulers enqueue once', async () => {
  const f = await fixture(); await f.connect(); assert.equal(await scheduleGoogleSync(f.store), 0);
  await f.command('settings', { name: '예약', gsc_site_url: 'sc-domain:example.test', ga4_property_id: 'properties/123', auto_sync: true });
  const results = await Promise.all([scheduleGoogleSync(f.store), scheduleGoogleSync(new PersistentHaloXStore(f.file))]); assert.equal(results.reduce((a, b) => a + b), 1); assert.equal((await f.view()).jobs.length, 1);
  await f.command('settings', { name: '중지', gsc_site_url: 'sc-domain:example.test', ga4_property_id: 'properties/123', auto_sync: false }); assert.equal((await f.view()).jobs[0].status, 'cancelled');
});
test('workspace deletion removes Google private state and cannot be revived by an outstanding OAuth callback', async () => {
  const f = await fixture(); const state = await f.start(); await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${f.workspace}` }, OWNER));
  await assert.rejects(() => finishGoogleOAuth(f.store, OWNER, f.session, state, 'code', false, client, config));
  assert.equal((await f.store.read(db => db.getServerRecords('google_oauth_states'))).length, 0);
});
test('Google transport uses fixed endpoints, encoded resource paths, form tokens and sanitized errors', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const provider = createGoogleClient(async (url, init) => { requests.push({ url: String(url), init }); return Response.json({ rows: [{ keys: ['2026-10-01', 'https://example.test/'], clicks: 4, impressions: 20, ctr: 0.2, position: 2 }] }); });
  const report = await provider.report('access', 'gsc_daily_pages', 'https://example.test/', '2026-10-01', '2026-10-03', 1000); assert.equal(report.rows[0].ctr, 20); assert.match(requests[0].url, /https%3A%2F%2Fexample.test%2F/); assert.equal(requests[0].init?.redirect, 'error'); assert.equal(JSON.parse(String(requests[0].init?.body)).startRow, 1000);
  const bad = createGoogleClient(async () => Response.json({ error: { message: 'PRIVATE_TOKEN_VALUE' } }, { status: 403 })); await assert.rejects(() => bad.identity('access'), error => error instanceof Error && !error.message.includes('PRIVATE_TOKEN_VALUE'));
  const tokenClient = createGoogleClient(async (_url, init) => { assert.match(String(init?.body), /grant_type=authorization_code/); assert.equal((init?.headers as Row)['Content-Type'], 'application/x-www-form-urlencoded'); return Response.json({ ...tokens, expires_in: 3600, token_type: 'Bearer' }); }); assert.equal((await tokenClient.exchange('code', config)).refresh_token, tokens.refresh_token);
});
test('GA4 preserves timezone/threshold metadata, sessions by landing page and exact AI domains', async () => {
  const provider = createGoogleClient(async () => Response.json({ dimensionHeaders: ['date', 'landingPagePlusQueryString', 'sessionSource', 'sessionDefaultChannelGroup'].map(name => ({ name })), metricHeaders: [{ name: 'sessions' }, { name: 'keyEvents' }], rowCount: 2, metadata: { timeZone: 'Asia/Seoul', subjectToThresholding: true }, rows: ['chatgpt.com', 'chatgpt.com.evil.test'].map(source => ({ dimensionValues: ['20261001', '/?id=1', source, 'Referral'].map(value => ({ value })), metricValues: [{ value: '4' }, { value: '2' }] })) }));
  const result = await provider.report('token', 'ga4_page_stats', 'properties/123', '2026-10-01', '2026-10-03', 0); assert.equal(result.rows[0].ai_sessions, 4); assert.equal(result.rows[1].ai_sessions, 0); assert.equal(result.metadata.timeZone, 'Asia/Seoul'); assert.equal(result.more, false);
});
test('Google reporting RPCs aggregate actual rows and keep unmeasured values distinct', async () => {
  const f = await fixture();
  const rpc = (name: string, args: Row = {}) => f.store.read(db => db.callRpc(name, { p_workspace_id: f.workspace, ...args }, OWNER)) as Promise<Row>;
  assert.equal((await rpc('get_gsc_dashboard_kpis')).ctr, null);
  await f.connect(); await f.enqueue(); for (let i = 0; i < 4; i++) await processGoogleTick(f.store, client);
  const metrics = await rpc('get_gsc_dashboard_kpis'); assert.equal(metrics.clicks, 5); assert.equal(metrics.ctr, 10); assert.equal(metrics.prev_clicks, null);
  assert.equal((await rpc('get_gsc_dashboard_kpis', { p_start_date: '2026-10-02' })).clicks, 0);
  const series = await rpc('get_ga4_dashboard_timeseries') as unknown as Row[]; assert.equal(series.length, 1); assert.equal(series[0].organic_sessions, 8);
  const dimensions = await rpc('get_gsc_dashboard_dimensions') as unknown as Row[]; assert.equal(dimensions[0].key, 'test'); assert.equal(dimensions[0].clicks, 5);
});
test('removed manager cannot commit a Google page and account withdrawal removes own Google credentials', async () => {
  const f = await fixture(); await f.connect();
  await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: OTHER, role: 'admin', allowed_sections: ['all'] }, OWNER));
  await googleCommand(f.store, OTHER, { workspace_id: f.workspace, action: 'sync', expected_revision: (await f.view()).connection?.revision, start: '2026-10-01', end: '2026-10-03', request_id: crypto.randomUUID() });
  await processGoogleTick(f.store, { ...client, report: async (...args) => { await f.store.write(db => db.deleteTable('workspace_members', { workspace_id: `eq.${f.workspace}`, user_id: `eq.${OTHER}` }, OWNER)); return client.report(...args); } });
  assert.equal((await f.view()).jobs[0].status, 'failed'); assert.equal((await f.rows('gsc_daily_totals')).length, 0);
  await f.store.write(db => { for (const workspace of db.queryTable('workspaces', {}, OWNER).data.filter(row => row.owner_id === OWNER)) for (const member of db.queryTable('workspace_members', { filters: { workspace_id: `eq.${workspace.id}` } }, OWNER).data) if (member.user_id !== OWNER) db.deleteTable('workspace_members', { id: `eq.${member.id}` }, OWNER); const view = db.accountDeletionView(OWNER); db.scheduleAccountDeletion(OWNER, { expected_revision: view.revision, expected_scope: view.scope, confirm_email: view.email, confirm_text: '계정 탈퇴', acknowledged: true, request_id: crypto.randomUUID() }); });
  assert.equal((await f.store.read(db => db.getServerRecords('google_credentials'))).length, 0);
  assert.equal((await f.store.read(db => db.exportState().tables.workspace_google_connections.find(row => row.workspace_id === f.workspace)))?.status, 'disconnected');
});
