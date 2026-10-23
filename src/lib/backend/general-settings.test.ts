import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_USER_ID as OWNER, OTHER_USER_ID as OTHER, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { readGeneralSettings, updateGeneralSettings } from './general-settings-service.ts';
import { autoPromptText } from './general-settings-model.ts';
import { ContentConflictError } from './content-model.ts';
import { assertRestWrite } from './rest-policy.ts';
import { runApiKeyCommand } from './api-key-service.ts';
import { runMcpRequest } from './mcp-service.ts';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'halox-general-')); directories.push(dir); const file = path.join(dir, 'state.sqlite'), store = new PersistentHaloXStore(file);
  const workspace = String((await store.write(db => db.insertTable('workspaces', { name: '수집 기본값' }, OWNER)[0])).id);
  const read = (actor = OWNER) => store.read(db => readGeneralSettings(db, workspace, actor));
  const change = async (values: Row = {}) => store.write(db => updateGeneralSettings(db, OWNER, { action: 'update', workspace_id: workspace, expected_revision: readGeneralSettings(db, workspace, OWNER).revision, language: 'en', country: 'US', auto_generate_prompts: true, ...values }));
  const rows = (table: string) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${workspace}` } }, OWNER).data);
  const collect = (values: Row = {}) => store.write(db => db.invokeEdgeFunction('keywords-collect', { workspace_id: workspace, keywords: ['Search intent'], idempotency_key: crypto.randomUUID(), ...values }, OWNER));
  return { workspace, file, store, read, change, rows, collect };
}
describe('general collection settings', () => {
  it('persists settings, detects stale edits and resets only collection fields in the selected workspace', async () => {
    const f = await fixture(), initial = await f.read(); assert.deepEqual(initial.defaults, { language: 'ko', country: 'KR', auto_generate_prompts: true });
    await f.store.write(db => db.updateTable('workspaces', { settings: { retained: true }, brand_name: '보존 브랜드' }, { id: `eq.${f.workspace}` }, OWNER));
    await assert.rejects(f.store.write(db => updateGeneralSettings(db, OWNER, { action: 'reset', workspace_id: f.workspace, expected_revision: initial.revision })), ContentConflictError);
    await f.change({ auto_generate_prompts: false });
    const reopened = new PersistentHaloXStore(f.file); assert.deepEqual((await reopened.read(db => readGeneralSettings(db, f.workspace, OWNER))).defaults, { language: 'en', country: 'US', auto_generate_prompts: false });
    await f.change({ action: 'reset' }); assert.deepEqual((await f.read()).defaults, initial.defaults);
    const row = await f.store.read(db => db.queryTable('workspaces', { filters: { id: `eq.${f.workspace}` } }, OWNER).data[0]); assert.deepEqual(row.settings, { retained: true }); assert.equal(row.brand_name, '보존 브랜드');
    const second = await f.store.write(db => db.insertTable('workspaces', { name: '다른 공간' }, OWNER)[0]); assert.deepEqual(await f.store.read(db => readGeneralSettings(db, String(second.id), OWNER).defaults), initial.defaults);
    for (const values of [{ language: 'xx' }, { country: 'UK' }, { auto_generate_prompts: 'false' }]) await assert.rejects(f.change(values));
  });
  it('requires current manager/menu permission and blocks generic REST changes', async () => {
    const f = await fixture(); await assert.rejects(f.read(OTHER));
    const member = await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: OTHER, role: 'member', allowed_sections: ['other'] }, OWNER)[0]); assert.equal((await f.read(OTHER)).editable, false);
    const update = () => f.store.write(db => updateGeneralSettings(db, OTHER, { action: 'reset', workspace_id: f.workspace, expected_revision: 1 })); await assert.rejects(update());
    await f.store.write(db => db.updateTable('workspace_members', { role: 'admin' }, { id: `eq.${member.id}` }, OWNER)); await update();
    await f.store.write(db => db.updateTable('workspace_members', { allowed_sections: ['analysis'] }, { id: `eq.${member.id}` }, OWNER)); await assert.rejects(f.read(OTHER));
    await f.store.read(db => { for (const fields of [{ auto_generate_prompts: false }, { default_analysis_language: 'en' }, { default_analysis_country: 'US' }, { settings: {} }]) assert.throws(() => assertRestWrite(db, 'workspaces', 'PATCH', OWNER, fields, { id: `eq.${f.workspace}` })); });
  });
  it('applies defaults to every new entity while explicit choices and existing records remain unchanged', async () => {
    const f = await fixture(); await f.change({ auto_generate_prompts: false });
    const set = await f.store.write(db => db.insertTable('keyword_sets', { workspace_id: f.workspace, name: '영문 세트' }, OWNER)[0]); assert.equal(set.language, 'en'); assert.equal(set.country, 'US');
    const idea = await f.store.write(db => db.insertTable('keyword_ideas', { workspace_id: f.workspace, keyword: 'Idea' }, OWNER)[0]); assert.equal(idea.language, 'en');
    const keyword = (await f.collect()).keywords as Row[]; assert.equal(keyword[0].language, 'en'); assert.equal(keyword[0].country, 'US'); assert.equal((await f.rows('geo_prompts')).length, 0);
    const geo = await f.store.write(db => db.invokeEdgeFunction('geo-run', { workspace_id: f.workspace, prompt_text: 'Question', idempotency_key: crypto.randomUUID() }, OWNER)); const prompt = (await f.rows('geo_prompts')).find(row => row.id === geo.prompt_id)!; assert.equal(prompt.language_code, 'en'); assert.equal(prompt.location_code, 'US');
    await f.change({ language: 'ja', country: 'JP', auto_generate_prompts: false });
    await f.store.write(db => db.updateTable('keywords', { is_paused: true }, { id: `eq.${keyword[0].id}` }, OWNER)); assert.equal((await f.rows('keywords'))[0].language, 'en');
    const override = (await f.collect({ keywords: ['명시적 한국어'], language: 'ko', country: 'KR' })).keywords as Row[]; assert.equal(override[0].language, 'ko');
    assert.equal((await f.rows('geo_prompts'))[0].language_code, 'en');
  });
  it('registers and links one unexecuted automatic prompt atomically, charges once and never recreates on refresh/replay', async () => {
    const f = await fixture(); await f.change();
    const request = { keywords: ['Search intent'], idempotency_key: 'once' }, result = await f.collect(request), keyword = (result.keywords as Row[])[0];
    const [prompt] = await f.rows('geo_prompts'); assert.equal(prompt.prompt_text, 'What should I know about Search intent?'); assert.equal(prompt.prompt_set_id, null); assert.equal(prompt.origin, 'keyword-template'); assert.equal((await f.rows('keyword_prompt_links'))[0].prompt_id, prompt.id); assert.equal((await f.rows('geo_prompt_runs')).length, 0); assert.equal((await f.rows('geo_prompt_sets')).length, 0);
    assert.deepEqual((await f.rows('usage_reservations')).map(row => [row.unit_key, row.status]).sort(), [['keyword_create', 'committed'], ['prompt_create', 'committed']]);
    await f.store.write(db => db.deleteTable('geo_prompts', { id: `eq.${prompt.id}` }, OWNER));
    await f.store.write(db => db.invokeEdgeFunction('keywords-refresh', { workspace_id: f.workspace, keyword_id: keyword.id }, OWNER)); assert.equal((await f.rows('geo_prompts')).length, 0);
    await f.store.write(db => db.deleteTable('keywords', { id: `eq.${keyword.id}` }, OWNER)); await assert.rejects(f.collect(request), /이미 사용/); assert.equal((await f.rows('keywords')).length, 0); assert.equal((await f.rows('usage_reservations')).length, 2);
  });
  it('reuses matching questions without another prompt charge and rolls back the full batch when prompt quota is exhausted', async () => {
    const f = await fixture(); await f.change();
    const existing = await f.store.write(db => db.insertTable('geo_prompts', { workspace_id: f.workspace, prompt_text: autoPromptText('Search intent', 'en'), language_code: 'en', location_code: 'US' }, OWNER)[0]);
    const result = await f.collect(); assert.equal((result.generated_prompts as Row[])[0].id, existing.id); assert.equal((await f.rows('usage_reservations')).length, 1);
    await f.store.write(db => db.updateTable('workspace_plans', { prompt_limit: 1 }, { workspace_id: `eq.${f.workspace}` }, OWNER));
    const before = await f.store.read(db => db.exportState()); await assert.rejects(f.collect({ keywords: ['First new', 'Second new'] }), /QUOTA_EXCEEDED/); assert.deepEqual(await f.store.read(db => db.exportState()), before);
  });
  it('preserves editable automatic questions after source deletion while clearing references and retaining usage', async () => {
    const f = await fixture(); await f.change(); const result = await f.collect(), keyword = (result.keywords as Row[])[0], prompt = (result.generated_prompts as Row[])[0];
    await f.store.write(db => db.deleteTable('keywords', { id: `eq.${keyword.id}` }, OWNER)); assert.equal((await f.rows('geo_prompts'))[0].source_keyword_id, null); assert.equal((await f.rows('keyword_prompt_links')).length, 0);
    await f.store.write(db => db.updateTable('geo_prompts', { prompt_text: 'Reviewed question', is_paused: true }, { id: `eq.${prompt.id}` }, OWNER));
    const restarted = new PersistentHaloXStore(f.file); assert.equal(await restarted.read(db => db.queryTable('geo_prompts', { filters: { id: `eq.${prompt.id}` } }, OWNER).data[0].prompt_text), 'Reviewed question');
    await f.store.write(db => db.deleteTable('geo_prompts', { id: `eq.${prompt.id}` }, OWNER)); assert.equal((await f.rows('geo_prompts')).length, 0); assert.equal((await f.rows('usage_reservations')).length, 2);
  });
  it('requires prompt-write scope for automatic registration and retained results while API prompt creation uses defaults', async () => {
    const f = await fixture(); await f.change();
    const issued = await f.store.write(db => runApiKeyCommand(db, OWNER, { action: 'key-create', workspace_id: f.workspace, name: '범위 검증', request_id: 'issue', scopes: ['seo:write'] }));
    const key = issued.key as Row;
    const call = (name: string, args: Row) => f.store.write(db => runMcpRequest(db, String(issued.secret), { method: 'tools/call', id: 1, params: { name, arguments: args } }));
    assert.equal((await call('collect_keywords', { keywords: ['Scoped keyword'], request_id: 'create' })).status, 403); assert.equal((await f.rows('keywords')).length, 0);
    const grant = (scopes: string[]) => f.store.write(db => { const row = db.queryTable('workspace_api_keys', { filters: { id: `eq.${key.id}` } }, OWNER).data[0]; return runApiKeyCommand(db, OWNER, { action: 'key-update', workspace_id: f.workspace, id: key.id, expected_revision: row.revision, scopes }); });
    await grant(['seo:write', 'prompts:write']); assert.equal((await call('collect_keywords', { keywords: ['Scoped keyword'], request_id: 'create' })).status, 200);
    assert.equal((await call('create_prompt', { prompt_text: 'API default language', request_id: 'prompt' })).status, 200); assert.equal((await f.rows('geo_prompts')).find(row => row.prompt_text === 'API default language')?.language_code, 'en');
    await f.change({ auto_generate_prompts: false }); await grant(['seo:write']);
    assert.equal((await call('collect_keywords', { keywords: ['Scoped keyword'], request_id: 'create' })).status, 403);
    assert.equal((await call('collect_keywords', { keywords: ['No automatic prompt'], request_id: 'next' })).status, 200); assert.equal((await f.rows('geo_prompts')).length, 2);
  });
});
