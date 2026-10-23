import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { HaloXDatabase, DEFAULT_WORKSPACE_ID as WS, DEFAULT_PROMPT_SET_ID, DEFAULT_USER_ID, OTHER_USER_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { nextGeoSchedule } from './geo-model.ts';
import { createDeterministicProviders } from './providers.ts';
import { assertRestWrite } from './rest-policy.ts';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function fixture(factory = () => new HaloXDatabase()) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-geo-')); directories.push(directory);
  const filename = path.join(directory, 'data.sqlite');
  return { store: new PersistentHaloXStore(filename, factory), filename };
}
const find = (db: HaloXDatabase, table: string, id: unknown) => db.queryTable(table, { filters: { id: `eq.${id}` } }).data[0];

describe('GEO prompt lifecycle', () => {
  it('creates in its own workspace, executes selected engines and stores raw answers and citations', async () => {
    const db = new HaloXDatabase();
    const [workspace] = db.insertTable('workspaces', { name: 'GEO 새 공간', default_brand_filter: 'example.com' });
    const result = await db.invokeEdgeFunction('geo-run', { workspace_id: workspace.id, prompt_text: '새 공간의 검색 가시성은?', engines: ['openai', 'claude'] });
    const prompt = find(db, 'geo_prompts', result.prompt_id);
    assert.notEqual(prompt.prompt_set_id, DEFAULT_PROMPT_SET_ID);
    assert.equal(find(db, 'geo_prompt_sets', prompt.prompt_set_id).workspace_id, workspace.id);
    assert.equal((result.results as Row[]).length, 2);
    const before = db.queryTable('usage_reservations').count;
    const again = await db.invokeEdgeFunction('geo-run', { workspace_id: workspace.id, prompt_id: prompt.id, prompt_text: '클라이언트에서 바꾼 가짜 질문', engine: 'gemini' });
    assert.equal((again.run as Row).prompt_text, prompt.prompt_text);
    assert.equal(db.queryTable('usage_reservations').count, before);
    const answer = db.queryTable('geo_answers_raw', { filters: { run_id: `eq.${(again.run as Row).id}` } }).data[0];
    assert.match(String(answer.answer_text), /example.com/);
    assert.equal(db.queryTable('geo_prompt_runs', { filters: { prompt_id: `eq.${prompt.id}` } }).count, 3);
  });

  it('blocks foreign sets, prompt IDs and tags; rejects invalid and duplicate questions before quota charges', async () => {
    const db = new HaloXDatabase();
    const [workspace] = db.insertTable('workspaces', { name: '별도 공간' });
    const prompt = db.queryTable('geo_prompts').data[0];
    await assert.rejects(db.invokeEdgeFunction('geo-run', { workspace_id: workspace.id, prompt_id: prompt.id }), /찾을 수 없습니다/);
    await assert.rejects(db.invokeEdgeFunction('geo-run', { workspace_id: workspace.id, prompt_text: '질문', prompt_set_id: DEFAULT_PROMPT_SET_ID }), /같은 워크스페이스/);
    const before = db.queryTable('usage_reservations').count;
    for (const payload of [{ prompt_text: '' }, { prompt_text: '  ' }, { prompt_text: prompt.prompt_text }, { prompt_text: '엔진 검사', engines: ['unknown'] }, { prompt_text: '빈 엔진', engines: [] }]) await assert.rejects(db.invokeEdgeFunction('geo-run', { workspace_id: WS, ...payload }));
    assert.equal(db.queryTable('usage_reservations').count, before);
    const [tag] = db.insertTable('workspace_tags', { workspace_id: workspace.id, name: '외부' });
    assert.throws(() => db.insertTable('geo_prompt_tag_assignments', { workspace_id: WS, prompt_id: prompt.id, tag_id: tag.id }), /같은 워크스페이스/);
    for (const table of ['geo_prompt_runs', 'geo_citations', 'geo_run_metrics', 'geo_answers_raw']) assert.throws(() => assertRestWrite(db, table, 'POST', DEFAULT_USER_ID, { workspace_id: WS }));
    assert.throws(() => assertRestWrite(db, 'geo_prompt_sets', 'PATCH', DEFAULT_USER_ID, { next_run_at: '2000-01-01' }, { id: `eq.${DEFAULT_PROMPT_SET_ID}` }));
  });

  it('keeps failed existing runs but rolls back new-prompt quota and partial engine results', async () => {
    const provider = createDeterministicProviders();
    const { store } = fixture(() => new HaloXDatabase({ ...provider, runGeoPrompt: async (prompt, engine, domain) => { if (engine === 'claude') throw new Error('secret-provider-payload'); return provider.runGeoPrompt(prompt, engine, domain); } }));
    const before = await store.read(db => db.exportState());
    await assert.rejects(store.write(db => db.invokeEdgeFunction('geo-run', { prompt_text: '실패하면 입력 보존', engines: ['openai', 'claude'] })), /수집에 실패/);
    assert.deepEqual(await store.read(db => db.exportState()), before);
    const prompt = await store.read(db => db.queryTable('geo_prompts').data[0]);
    const failed = await store.write(db => db.invokeEdgeFunction('geo-run', { workspace_id: WS, prompt_id: prompt.id, engine: 'claude' }));
    assert.equal(failed.ok, false);
    assert.equal((failed.run as Row).status, 'failed');
    assert.doesNotMatch(JSON.stringify(failed), /secret-provider/);
    assert.equal(await store.read(db => find(db, 'geo_prompt_runs', (failed.run as Row).id).status), 'failed');
  });

  it('does not reuse a paid reservation to create a second question or recreate a deleted question', async () => {
    const { store } = fixture();
    const payload = { workspace_id: WS, prompt_text: '생성 요청 재사용 검사', idempotency_key: 'geo-create-once' };
    const created = await store.write(db => db.invokeEdgeFunction('geo-run', payload));
    const before = await store.read(db => db.exportState());
    await assert.rejects(store.write(db => db.invokeEdgeFunction('geo-run', { ...payload, prompt_text: '같은 예약으로 다른 질문' })), /이미 사용된/);
    assert.deepEqual(await store.read(db => db.exportState()), before);
    await store.write(db => db.deleteTable('geo_prompts', { id: `eq.${created.prompt_id}` }));
    await assert.rejects(store.write(db => db.invokeEdgeFunction('geo-run', payload)), /이미 사용된/);
  });

  it('updates question and tags atomically, rejects stale edits and preserves historical question text', async () => {
    const { store } = fixture();
    const prompt = await store.read(db => db.queryTable('geo_prompts').data[0]);
    const [tag] = await store.write(db => db.insertTable('workspace_tags', { name: '핵심 질문' }));
    await assert.rejects(store.write(db => db.invokeEdgeFunction('geo-save', { workspace_id: WS, prompt_id: prompt.id, updated_at: prompt.updated_at, patch: { prompt_text: '저장 안 됨' }, tag_ids: ['missing'] })), /같은 워크스페이스/);
    const saved = await store.write(db => db.invokeEdgeFunction('geo-save', { workspace_id: WS, prompt_id: prompt.id, updated_at: prompt.updated_at, patch: { prompt_text: '수정한 질문', engines: ['gemini'] }, tag_ids: [tag.id] }));
    assert.equal((saved.prompt as Row).prompt_text, '수정한 질문');
    assert.equal(await store.read(db => db.queryTable('geo_prompt_runs', { filters: { prompt_id: `eq.${prompt.id}` } }).data[0].prompt_text), prompt.prompt_text);
    await assert.rejects(store.write(db => db.invokeEdgeFunction('geo-save', { workspace_id: WS, prompt_id: prompt.id, updated_at: prompt.updated_at, patch: { prompt_text: '오래된 수정' } })), /다른 곳/);
  });

  it('deletes results and links with a prompt, but preserves prompts when deleting a set', async () => {
    const db = new HaloXDatabase();
    const result = await db.invokeEdgeFunction('geo-run', { prompt_text: '삭제할 질문' });
    const prompt = find(db, 'geo_prompts', result.prompt_id);
    const keyword = db.queryTable('keywords').data[0];
    const [tag] = db.insertTable('workspace_tags', { name: '연결 태그' });
    db.insertTable('geo_prompt_tag_assignments', { prompt_id: prompt.id, tag_id: tag.id });
    db.insertTable('keyword_prompt_links', { prompt_id: prompt.id, keyword_id: keyword.id });
    db.deleteTable('geo_prompt_sets', { id: `eq.${prompt.prompt_set_id}` });
    assert.equal(find(db, 'geo_prompts', prompt.id).prompt_set_id, null);
    db.deleteTable('geo_prompts', { id: `eq.${prompt.id}` });
    for (const table of ['geo_prompt_runs', 'geo_answers_raw', 'geo_prompt_tag_assignments', 'keyword_prompt_links']) assert.equal(db.queryTable(table, { filters: { prompt_id: `eq.${prompt.id}` } }).count, 0);
    for (const table of ['geo_citations', 'geo_run_metrics']) assert.equal(db.queryTable(table, { filters: { run_id: `eq.${(result.run as Row).id}` } }).count, 0);
    new HaloXDatabase().restoreState(db.exportState());
  });

  it('runs due schedules once across two store instances and skips paused, inactive and disabled items', async () => {
    const { store, filename } = fixture();
    const { workspace, set, prompt } = await store.write(db => {
      const [workspace] = db.insertTable('workspaces', { name: '다른 계정 예약' }, OTHER_USER_ID);
      const [set] = db.insertTable('geo_prompt_sets', { workspace_id: workspace.id, name: '매일 질문', schedule_enabled: true, schedule_hour: 9 }, OTHER_USER_ID);
      const [prompt] = db.insertTable('geo_prompts', { workspace_id: workspace.id, prompt_set_id: set.id, prompt_text: '예약 질문', engines: ['openai', 'gemini'] }, OTHER_USER_ID);
      db.insertTable('geo_prompts', { workspace_id: workspace.id, prompt_set_id: set.id, prompt_text: '중단 질문', is_paused: true }, OTHER_USER_ID);
      db.updateTable('geo_prompt_sets', { next_run_at: '2026-01-01T00:00:00.000Z' }, { id: `eq.${set.id}` }, OTHER_USER_ID);
      return { workspace, set, prompt };
    });
    const other = new PersistentHaloXStore(filename);
    const now = Date.parse('2026-10-23T01:00:00Z');
    await Promise.all([store.write(db => db.runDueGeoSchedules(now)), other.write(db => db.runDueGeoSchedules(now))]);
    const runs = await other.read(db => db.queryTable('geo_prompt_runs', { filters: { workspace_id: `eq.${workspace.id}` } }, OTHER_USER_ID).data);
    assert.equal(runs.length, 2); assert.ok(runs.every(run => run.prompt_id === prompt.id && run.scheduled_for));
    assert.equal(await other.read(db => db.hasDueGeoSchedules(now)), false);
    await other.write(db => db.updateTable('geo_prompt_sets', { schedule_enabled: false }, { id: `eq.${set.id}` }, OTHER_USER_ID));
    assert.equal((await other.write(db => db.runDueGeoSchedules(now + 86400000))).length, 0);
    assert.equal(nextGeoSchedule(0, Date.parse('2026-10-23T14:59:00Z')), '2026-10-23T15:00:00.000Z');
    assert.equal(nextGeoSchedule(9, Date.parse('2026-10-23T00:00:00Z')), '2026-10-24T00:00:00.000Z');
  });
});
