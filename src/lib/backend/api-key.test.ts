import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HaloXDatabase, DEFAULT_USER_ID as OWNER, ADMIN_USER_ID as ADMIN, OTHER_USER_ID as OTHER, DEFAULT_WORKSPACE_ID as WS, RlsAccessDeniedError, type Row } from './database.ts';
import { API_SCOPES, API_READ_SCOPES, API_DEFAULT_LIMITS, ApiKeyError, apiKeyFields, apiScopes } from './api-key-model.ts';
import { readApiSettings, runApiKeyCommand } from './api-key-service.ts';
import { API_TOOLS } from './api-tools.ts';
import { runMcpRequest } from './mcp-service.ts';
import { PersistentHaloXStore } from './store.ts';
import { assertRestWrite } from './rest-policy.ts';
const keyRows = (db: HaloXDatabase, workspace = WS) => db.queryTable('workspace_api_keys', { filters: { workspace_id: `eq.${workspace}` } }, OWNER).data;
function issue(db: HaloXDatabase, values: Row = {}, actor = OWNER, workspace = WS) { return runApiKeyCommand(db, actor, { action: 'key-create', workspace_id: workspace, name: '분석 키', request_id: crypto.randomUUID(), ...values }); }
const call = (db: HaloXDatabase, secret: unknown, name: string, args: Row = {}, now?: number) => runMcpRequest(db, String(secret), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, now);
const data = (result: Awaited<ReturnType<typeof call>>) => (result.body?.result as Row)?.data as Row;
const change = (db: HaloXDatabase, key: Row, values: Row = {}, workspace = WS) => runApiKeyCommand(db, OWNER, { action: 'key-update', workspace_id: workspace, id: key.id, expected_revision: keyRows(db, workspace).find(row => row.id === key.id)?.revision, ...values });

describe('API key lifecycle and scoped tools', () => {
  it('returns generated secrets once, persists hashes only and prevents duplicate issuance after a lost response', () => {
    const db = new HaloXDatabase(), payload = { action: 'key-create', workspace_id: WS, name: '일회 표시', request_id: 'same-request' };
    const first = runApiKeyCommand(db, OWNER, payload), key = first.key as Row;
    assert.match(String(first.secret), /^hx_live_[a-zA-Z0-9_-]{43}$/); assert.equal(key.key_hash, undefined); assert.equal(key.raw_key, undefined);
    assert.ok(db.verifyWorkspaceApiKey(String(first.secret))); assert.equal(db.verifyWorkspaceApiKey(String(key.key_prefix)), null);
    const state = JSON.stringify(db.exportState()); assert.ok(!state.includes(String(first.secret)));
    const stored = db.exportState().tables.workspace_api_keys.find(row => row.id === key.id)!; assert.equal(db.verifyWorkspaceApiKey(String(stored.key_hash)), null);
    const replay = runApiKeyCommand(db, OWNER, payload); assert.equal(replay.replayed, true); assert.equal(replay.secret, null); assert.equal(keyRows(db).length, 1);
    assert.throws(() => runApiKeyCommand(db, OWNER, { ...payload, name: '변경' }), ApiKeyError);
    assert.ok(!JSON.stringify(readApiSettings(db, WS, OWNER)).includes(String(first.secret)));
  });
  it('validates scopes, names, expiration and limits; edits conflict and revoked credentials never reactivate', () => {
    const db = new HaloXDatabase(), created = issue(db), key = created.key as Row;
    for (const scopes of [[], ['all'], ['seo:read', 'seo:read'], ['__proto__'], ['audit:write']]) assert.throws(() => apiScopes(scopes));
    for (const values of [{ name: '' }, { name: 'x'.repeat(101) }, { expires_at: 'invalid' }, { expires_at: new Date(Date.now() - 1000).toISOString() }, { requests_per_minute: 0 }, { requests_per_day: 100001 }, { requests_per_minute: 1.2 }]) assert.throws(() => apiKeyFields({ name: 'key', scopes: API_READ_SCOPES, expires_at: null, ...API_DEFAULT_LIMITS, ...values }));
    change(db, key, { name: '다른 이름', scopes: ['seo:read'], requests_per_minute: 2 });
    assert.throws(() => runApiKeyCommand(db, OWNER, { action: 'key-revoke', workspace_id: WS, id: key.id, expected_revision: 1 }), ApiKeyError);
    assert.throws(() => runApiKeyCommand(db, OWNER, { action: 'key-delete', workspace_id: WS, id: key.id, expected_revision: 2 }));
    db.callRpc('revoke_workspace_api_key', { p_workspace_id: WS, p_key_id: key.id });
    assert.equal(keyRows(db)[0].revision, 3); assert.equal(db.verifyWorkspaceApiKey(String(created.secret)), null);
    db.updateTable('workspace_api_keys', { revoked_at: null, raw_key: 'exposed', created_by: OTHER }, { id: `eq.${key.id}` });
    assert.equal(db.verifyWorkspaceApiKey(String(created.secret)), null); assert.ok(!JSON.stringify(keyRows(db)).includes('exposed'));
    assert.throws(() => change(db, key, { expires_at: null }));
    runApiKeyCommand(db, OWNER, { action: 'key-delete', workspace_id: WS, id: key.id, expected_revision: 3 }); assert.equal(keyRows(db).length, 0);
  });
  it('enforces administrator scope, current issuer authority and tenant isolation through all management paths', () => {
    const db = new HaloXDatabase(), member = db.insertTable('workspace_members', { workspace_id: WS, user_id: OTHER, role: 'viewer' })[0];
    assert.equal(readApiSettings(db, WS, OTHER).editable, false); assert.throws(() => issue(db, {}, OTHER), RlsAccessDeniedError);
    const admin = db.queryTable('workspace_members', { filters: { workspace_id: `eq.${WS}`, user_id: `eq.${ADMIN}` } }).data[0], issued = issue(db, {}, ADMIN);
    db.updateTable('workspace_members', { role: 'admin', allowed_sections: ['other'] }, { id: `eq.${admin.id}` });
    assert.equal(db.verifyWorkspaceApiKey(String(issued.secret)), null); assert.throws(() => issue(db, {}, ADMIN), RlsAccessDeniedError);
    assert.throws(() => db.callRpc('revoke_workspace_api_key', { p_key_id: (issued.key as Row).id }, ADMIN), RlsAccessDeniedError);
    for (const table of ['workspace_api_keys', 'workspace_api_limits']) assert.throws(() => assertRestWrite(db, table, 'POST', OWNER, { workspace_id: WS, name: '직접 변경' }), RlsAccessDeniedError);
    db.deleteTable('workspace_members', { id: `eq.${member.id}` }); assert.throws(() => readApiSettings(db, WS, OTHER), RlsAccessDeniedError);
  });
  it('negotiates MCP and filters tools by effective scopes, rejecting prefixes, unauthorized writes and unknown arguments', async () => {
    const db = new HaloXDatabase(), issued = issue(db, { scopes: ['seo:read'] }), key = issued.key as Row;
    const init = await runMcpRequest(db, String(issued.secret), { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } }); assert.equal(init.body?.id, 0); assert.equal((init.body?.result as Row).protocolVersion, '2025-11-25');
    const listed = await runMcpRequest(db, String(issued.secret), { method: 'tools/list' }); assert.deepEqual(((listed.body?.result as Row).tools as Row[]).map(row => row.name), API_TOOLS.filter(tool => tool.scopes.every(scope => scope === 'seo:read')).map(tool => tool.name));
    assert.equal((await call(db, key.key_prefix, 'list_keywords')).status, 401); assert.equal((await call(db, issued.secret, 'create_prompt', { prompt_text: '거절', request_id: 'denied' })).status, 403);
    assert.equal((await call(db, issued.secret, 'list_keywords', { workspace_id: 'foreign' })).status, 400);
    assert.equal((await call(db, issued.secret, 'list_keywords', { limit: 101 })).status, 400);
    assert.equal((await call(db, issued.secret, 'toString')).status, 404);
    change(db, key, { scopes: ['prompts:read'] }); assert.equal((await call(db, issued.secret, 'list_keywords')).status, 403); assert.equal((await call(db, issued.secret, 'list_prompts')).status, 200);
    assert.equal((await runMcpRequest(db, String(issued.secret), { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  });
  it('executes keyword and prompt CRUD against the same records with guarded updates, collection and cascading deletes', async () => {
    const db = new HaloXDatabase(), issued = issue(db, { scopes: API_SCOPES }), secret = issued.secret;
    const result = await call(db, secret, 'collect_keywords', { keywords: ['API 키워드'], request_id: 'create' }); assert.equal(result.status, 200); const keyword = (data(result).keywords as Row[])[0];
    assert.equal((await call(db, secret, 'get_keyword_snapshots', { id: keyword.id })).status, 200);
    const updated = await call(db, secret, 'update_keyword', { id: keyword.id, updated_at: keyword.updated_at, patch: { keyword: '수정 키워드' }, request_id: 'edit' }); assert.equal(updated.status, 200);
    assert.equal((await call(db, secret, 'update_keyword', { id: keyword.id, updated_at: keyword.updated_at, patch: { keyword: '오래된 값' }, request_id: 'stale' })).status, 409);
    const current = db.queryTable('keywords', { filters: { id: `eq.${keyword.id}` } }).data[0];
    assert.equal((await call(db, secret, 'recollect_keyword', { id: current.id, updated_at: current.updated_at, request_id: 'refresh' })).status, 200);
    const latest = db.queryTable('keywords', { filters: { id: `eq.${keyword.id}` } }).data[0];
    assert.equal((await call(db, secret, 'delete_keyword', { id: latest.id, updated_at: latest.updated_at, request_id: 'delete', confirm: true })).status, 200);
    assert.equal(db.queryTable('serp_snapshots', { filters: { keyword_id: `eq.${keyword.id}` } }).data.length, 0);
    const created = await call(db, secret, 'create_prompt', { prompt_text: 'API 질문', request_id: 'prompt-create' }); assert.equal(created.status, 200); const prompt = data(created);
    const run = await call(db, secret, 'run_geo_prompt', { id: prompt.id, engines: ['openai'], request_id: 'run' }); assert.equal(run.status, 200); assert.ok(!JSON.stringify(data(run)).includes('answer_text'));
    assert.equal((await call(db, secret, 'get_prompt_runs', { id: prompt.id })).status, 200);
    const updatedPrompt = await call(db, secret, 'update_prompt', { id: prompt.id, updated_at: prompt.updated_at, patch: { prompt_text: '수정 질문' }, request_id: 'prompt-edit' }); assert.equal(updatedPrompt.status, 200);
    assert.equal((await call(db, secret, 'delete_prompt', { id: prompt.id, updated_at: data(updatedPrompt).updated_at, confirm: true, request_id: 'prompt-delete' })).status, 200);
    assert.equal(db.queryTable('geo_prompt_runs', { filters: { prompt_id: `eq.${prompt.id}` } }).data.length, 0);
  });
  it('supports content versions, knowledge writes, workspace updates and read-only audit tools without cross-workspace access', async () => {
    const db = new HaloXDatabase(), issued = issue(db, { scopes: API_SCOPES }), secret = issued.secret;
    const created = await call(db, secret, 'create_content', { title: '제목', target_keyword: '주제', content_md: '원문', request_id: 'content' }); assert.equal(created.status, 200); const job = data(created).job as Row;
    assert.equal((await call(db, secret, 'save_content', { id: job.id, expected_revision: job.revision, title: '변경', content_md: '변경 원문', request_id: 'version' })).status, 200);
    assert.equal((data(await call(db, secret, 'get_content', { id: job.id })).drafts as Row[]).length, 2);
    const knowledge = data(await call(db, secret, 'create_knowledge', { name: 'API 자료', body: '본문', request_id: 'knowledge' }));
    assert.equal((await call(db, secret, 'update_knowledge', { id: knowledge.id, updated_at: knowledge.updated_at, patch: { body: '새 본문' }, request_id: 'knowledge-edit' })).status, 200);
    assert.equal((await call(db, secret, 'get_knowledge', { id: knowledge.id })).status, 200);
    const audit = db.queryTable('site_audit_scans', { filters: { workspace_id: `eq.${WS}` } }).data[0]; assert.equal((await call(db, secret, 'get_site_audit', { id: audit.id })).status, 200);
    const workspace = db.queryTable('workspaces', { filters: { id: `eq.${WS}` } }).data[0];
    assert.equal((await call(db, secret, 'update_workspace', { name: 'API 이름', expected_revision: Number(workspace.revision || 0), request_id: 'workspace-edit' })).status, 200);
    for (const name of ['get_workspace', 'list_content', 'list_knowledge', 'list_site_audits', 'get_geo_metrics', 'get_gsc_ga4_kpis', 'get_avi_overview']) assert.equal((await call(db, secret, name)).status, 200, name);
    const foreign = db.insertTable('workspaces', { name: '다른 공간' })[0], foreignItem = db.insertTable('knowledge_entities', { workspace_id: foreign.id, name: '외부 자료' })[0];
    assert.equal((await call(db, secret, 'get_knowledge', { id: foreignItem.id })).status, 404);
    assert.equal((await call(db, secret, 'update_knowledge', { id: knowledge.id, updated_at: knowledge.updated_at, patch: { workspace_id: foreign.id }, request_id: 'foreign' })).status >= 400, true);
  });
  it('replays exact writes once, detects request reuse and rolls back partial failures while retaining failed usage', async () => {
    const db = new HaloXDatabase(), issued = issue(db, { scopes: API_SCOPES }), secret = issued.secret;
    const args = { name: '중복 방지 자료', request_id: 'once' }, first = await call(db, secret, 'create_knowledge', args), second = await call(db, secret, 'create_knowledge', args);
    assert.equal(data(first).id, data(second).id); assert.equal((await call(db, secret, 'create_knowledge', { ...args, name: '다른 입력' })).status, 409);
    const before = db.queryTable('usage_reservations').data.length, prompts = db.queryTable('geo_prompts').data.length;
    const failed = await call(db, secret, 'create_prompt', { prompt_text: '', request_id: 'bad-prompt' }); assert.equal(failed.status, 400);
    assert.equal(db.queryTable('geo_prompts').data.length, prompts); assert.equal(db.queryTable('usage_reservations').data.length, before);
    const usage = readApiSettings(db, WS, OWNER).usage[0]; assert.equal(usage.calls, 4); assert.equal(usage.success, 2); assert.equal(usage.failed, 2);
    const raw = JSON.stringify(db.getServerRecords('api_key_usage')); assert.ok(!raw.includes(String(secret))); assert.ok(!raw.includes('중복 방지 자료'));
  });
  it('enforces durable per-key and workspace minute/day limits without resetting used counters on edits', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'halox-api-')), filename = path.join(directory, 'data.sqlite'), store = new PersistentHaloXStore(filename), now = Date.parse(new Date().toISOString().slice(0, 10) + 'T12:00:00Z');
    try {
      const issued = await store.write(db => issue(db, { requests_per_minute: 2, requests_per_day: 3 })); const key = issued.key as Row;
      for (let index = 0; index < 2; index++) assert.equal((await store.write(db => call(db, issued.secret, 'list_keywords', {}, now))).status, 200);
      const reopened = new PersistentHaloXStore(filename); assert.equal((await reopened.write(db => call(db, issued.secret, 'list_keywords', {}, now))).status, 429);
      assert.equal((await reopened.write(db => call(db, issued.secret, 'list_keywords', {}, now + 60000))).status, 200);
      const denied = await reopened.write(db => call(db, issued.secret, 'list_keywords', {}, now + 120000)); assert.equal(denied.status, 429); assert.ok(denied.retryAfter! > 60);
      await reopened.write(db => change(db, key, { requests_per_day: 100, requests_per_minute: 100 }));
      await reopened.write(db => runApiKeyCommand(db, OWNER, { action: 'limits-update', workspace_id: WS, expected_revision: 0, requests_per_minute: 100, requests_per_day: 3 }));
      const other = await reopened.write(db => issue(db, { name: '다른 키' })); assert.equal((await reopened.write(db => call(db, other.secret, 'list_keywords', {}, now))).status, 429);
      const settings = await reopened.read(db => readApiSettings(db, WS, OWNER)); assert.equal(settings.usage.reduce((sum, row) => sum + Number(row.calls), 0), 3); assert.equal(settings.usage.reduce((sum, row) => sum + Number(row.rate_limited || 0), 0), 3);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it('serializes key edits and removes credentials, receipts and usage with workspace deletion', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'halox-api-conflict-')), store = new PersistentHaloXStore(path.join(directory, 'db.sqlite'));
    try {
      const issued = await store.write(db => issue(db, { scopes: API_SCOPES })), key = issued.key as Row;
      const results = await Promise.allSettled(['first', 'second'].map(name => store.write(db => runApiKeyCommand(db, OWNER, { action: 'key-update', workspace_id: WS, id: key.id, expected_revision: 1, name })))); assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
      await store.write(db => call(db, issued.secret, 'create_knowledge', { name: '정리 대상', request_id: 'cleanup' }));
      const ws = await store.read(db => db.queryTable('workspaces', { filters: { id: `eq.${WS}` } }).data[0]);
      const deleted = await store.write(db => call(db, issued.secret, 'delete_workspace', { expected_revision: Number(ws.revision || 0), confirm_name: ws.name, request_id: 'delete-workspace' })); assert.equal(deleted.status, 200);
      await store.read(db => { assert.equal(db.verifyWorkspaceApiKey(String(issued.secret)), null); for (const name of ['api_key_issue_requests', 'api_key_usage', 'api_tool_requests'] as const) assert.ok(db.getServerRecords(name).every(row => row.workspace_id !== WS)); });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});
