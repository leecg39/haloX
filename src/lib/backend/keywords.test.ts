import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HaloXDatabase, DEFAULT_WORKSPACE_ID as WS, DEFAULT_KEYWORD_SET_ID, DEFAULT_USER_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { createDeterministicProviders } from './providers.ts';
import { assertRestWrite } from './rest-policy.ts';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function store(factory = () => new HaloXDatabase()) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-keywords-')); directories.push(directory);
  return new PersistentHaloXStore(path.join(directory, 'test.sqlite'), factory);
}
const find = (db: HaloXDatabase, table: string, id: unknown) => db.queryTable(table, { filters: { id: `eq.${id}` } }).data[0];

describe('keyword lifecycle', () => {
  it('creates and refreshes in a new workspace without a demo set or fabricated rank', async () => {
    const db = new HaloXDatabase();
    const [workspace] = db.insertTable('workspaces', { name: '새 워크스페이스', default_brand_filter: 'new.example.com' });
    const created = await db.invokeEdgeFunction('keywords-collect', { workspace_id: workspace.id, keywords: ['새 키워드'] });
    const keyword = (created.keywords as Row[])[0];
    assert.notEqual(keyword.keyword_set_id, DEFAULT_KEYWORD_SET_ID);
    assert.equal(find(db, 'keyword_sets', keyword.keyword_set_id).workspace_id, workspace.id);
    assert.equal(((created.snapshots as Row[])[0].serp_analysis_json as Row).our_rank, null);
    db.updateTable('keywords', { is_paused: true }, { id: `eq.${keyword.id}` });
    await db.invokeEdgeFunction('keywords-refresh', { workspace_id: workspace.id, keyword_id: keyword.id });
    assert.equal(find(db, 'keywords', keyword.id).is_paused, true);
    assert.equal(db.queryTable('keywords', { filters: { workspace_id: `eq.${workspace.id}` } }).count, 1);
    assert.equal(db.queryTable('serp_snapshots', { filters: { keyword_id: `eq.${keyword.id}` } }).count, 2);
    assert.equal(db.queryTable('usage_reservations', { filters: { workspace_id: `eq.${workspace.id}` } }).count, 2); // keyword + automatic prompt
  });

  it('rejects empty, duplicate and cross-workspace references even when the actor owns both', async () => {
    const db = new HaloXDatabase();
    const [workspace] = db.insertTable('workspaces', { name: '두 번째' });
    const beforeReservations = db.queryTable('usage_reservations').count;
    const [tag] = db.insertTable('workspace_tags', { name: '외부 태그', workspace_id: workspace.id });
    const keyword = db.queryTable('keywords').data[0];
    assert.throws(() => db.insertTable('keyword_tag_assignments', { workspace_id: WS, keyword_id: keyword.id, tag_id: tag.id }), /같은 워크스페이스/);
    await assert.rejects(db.invokeEdgeFunction('keywords-collect', { workspace_id: workspace.id, keyword_set_id: DEFAULT_KEYWORD_SET_ID, keywords: ['외래 참조'] }), /같은 워크스페이스/);
    for (const keywords of [[], [' '], [false], ['중복', ' 중복 ']]) await assert.rejects(db.invokeEdgeFunction('keywords-collect', { workspace_id: WS, keywords }));
    await assert.rejects(db.invokeEdgeFunction('keywords-collect', { workspace_id: WS, keywords: [keyword.keyword] }), /이미/);
    assert.equal(db.queryTable('usage_reservations').count, beforeReservations);
    assert.throws(() => db.updateTable('keywords', { language: 'bogus-language', is_paused: 'false' }, { id: `eq.${keyword.id}` }));
    assert.throws(() => assertRestWrite(db, 'keywords', 'PATCH', DEFAULT_USER_ID, { search_volume: 999999 }, { id: `eq.${keyword.id}` }));
    assert.throws(() => assertRestWrite(db, 'serp_snapshots', 'POST', DEFAULT_USER_ID, { keyword_id: keyword.id }));
    const [canonical] = db.insertTable('keywords', { workspace_id: null, keyword: '기본 공간' });
    assert.equal(canonical.workspace_id, WS);
  });

  it('atomically edits fields and tags, detects stale forms and invalidates measurements after renaming', async () => {
    const runtime = store();
    const keyword = await runtime.read(db => db.queryTable('keywords').data[0]);
    const [tag] = await runtime.write(db => db.insertTable('workspace_tags', { name: '핵심' }));
    await assert.rejects(runtime.write(db => db.invokeEdgeFunction('keywords-save', { workspace_id: WS, keyword_id: keyword.id, updated_at: keyword.updated_at, patch: { keyword: '실패' }, tag_ids: ['missing'] })), /같은 워크스페이스/);
    assert.equal(await runtime.read(db => find(db, 'keywords', keyword.id).keyword), keyword.keyword);
    const saved = await runtime.write(db => db.invokeEdgeFunction('keywords-save', { workspace_id: WS, keyword_id: keyword.id, updated_at: keyword.updated_at, patch: { keyword: '이름 수정' }, tag_ids: [tag.id] }));
    assert.equal((saved.keyword as Row).search_volume, null);
    assert.equal(await runtime.read(db => db.queryTable('keyword_tag_assignments', { filters: { keyword_id: `eq.${keyword.id}` } }).count), 1);
    await assert.rejects(runtime.write(db => db.invokeEdgeFunction('keywords-save', { workspace_id: WS, keyword_id: keyword.id, updated_at: keyword.updated_at, patch: { keyword: '오래된 입력' } })), /다른 곳/);
    assert.equal(await runtime.read(db => find(db, 'keywords', keyword.id).keyword), '이름 수정');
  });

  it('rolls back a provider failure with quota, set and keyword writes', async () => {
    const provider = createDeterministicProviders();
    const runtime = store(() => new HaloXDatabase({ ...provider, collectSerp: async keyword => { if (keyword === '실패') throw new Error('provider unavailable'); return provider.collectSerp(keyword); } }));
    const before = await runtime.read(db => db.exportState());
    await assert.rejects(runtime.write(db => db.invokeEdgeFunction('keywords-collect', { keywords: ['첫 번째', '실패'] })), /provider unavailable/);
    assert.deepEqual(await runtime.read(db => db.exportState()), before);
  });

  it('preserves keywords on set deletion and removes all dependent relations on keyword deletion', async () => {
    const db = new HaloXDatabase();
    const keyword = db.queryTable('keywords').data[0];
    const prompt = db.queryTable('geo_prompts').data[0];
    const [tag] = db.insertTable('workspace_tags', { name: '연결' });
    db.insertTable('keyword_tag_assignments', { keyword_id: keyword.id, tag_id: tag.id });
    db.insertTable('keyword_prompt_links', { keyword_id: keyword.id, prompt_id: prompt.id });
    db.deleteTable('keyword_sets', { id: `eq.${keyword.keyword_set_id}` });
    assert.equal(find(db, 'keywords', keyword.id).keyword_set_id, null);
    db.deleteTable('keywords', { id: `eq.${keyword.id}` });
    for (const table of ['serp_snapshots', 'keyword_tag_assignments', 'keyword_prompt_links', 'keyword_cluster_members']) assert.equal(db.queryTable(table, { filters: { keyword_id: `eq.${keyword.id}` } }).count, 0);
    assert.ok(find(db, 'workspace_tags', tag.id));
    new HaloXDatabase().restoreState(db.exportState());
  });

  it('adopts an idea exactly once and keeps only one default set', async () => {
    const db = new HaloXDatabase();
    const [set] = db.insertTable('keyword_sets', { name: '새 기본', is_default: true });
    assert.equal(db.queryTable('keyword_sets', { filters: { is_default: 'eq.true', workspace_id: `eq.${WS}` } }).count, 1);
    const [idea] = db.insertTable('keyword_ideas', { keyword: '채택할 아이디어', keyword_set_id: set.id, notes: '메모' });
    await db.invokeEdgeFunction('keywords-adopt-idea', { workspace_id: WS, idea_id: idea.id });
    assert.equal(find(db, 'keyword_ideas', idea.id), undefined);
    await assert.rejects(db.invokeEdgeFunction('keywords-adopt-idea', { workspace_id: WS, idea_id: idea.id }), /이미 채택/);
    assert.equal(db.queryTable('keywords', { filters: { keyword: 'eq.채택할 아이디어' } }).count, 1);
  });
});
