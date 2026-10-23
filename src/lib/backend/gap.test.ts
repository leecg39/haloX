import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { HaloXDatabase, DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, ISOLATED_WORKSPACE_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { readGapData } from './gap-model.ts';
import { GapConflictError } from './gap-service.ts';
import { createDeterministicProviders } from './providers.ts';
import { assertRestWrite } from './rest-policy.ts';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
async function fixture(factory = () => new HaloXDatabase()) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-gaps-')); directories.push(directory); const filename = path.join(directory, 'db.sqlite'), store = new PersistentHaloXStore(filename, factory);
  const ws = await store.write(db => db.insertTable('workspaces', { name: '기회 검증', default_brand_filter: 'brand.test' }, ACTOR)[0]), workspace = String(ws.id);
  const invoke = (name: string, values: Row = {}, actor = ACTOR) => store.write(db => db.invokeEdgeFunction(name, { ...values, workspace_id: workspace }, actor));
  const insert = (table: string, values: Row) => store.write(db => db.insertTable(table, { ...values, workspace_id: workspace }, ACTOR)[0]);
  const rows = (table: string) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${workspace}` } }, ACTOR).data);
  const create = async (text: string, extra: Row = {}) => (await invoke('candidate-create', { kind: 'keyword', text, language: 'ko', country: 'KR', notes: '', priority: 'normal', ...extra })).candidate as Row;
  const adopt = (candidate: Row, extra: Row = {}) => invoke('candidate-adopt', { candidate_id: candidate.id, expected_revision: candidate.revision, confirm: true, ...extra });
  return { filename, store, workspace, invoke, insert, rows, create, adopt };
}
describe('gap evidence and opportunity lifecycle', () => {
  it('classifies observed keyword/question pairs without turning missing evidence into weakness', async () => {
    const f = await fixture(), at = '2026-10-05T00:00:00Z';
    for (const [name, rank, cited] of [['both', 2, true], ['search_only', 3, false], ['ai_only', 20, true], ['neither', 30, false], ['unmeasured', 4, null]] as const) {
      const kw = await f.insert('keywords', { keyword: name });
      await f.insert('serp_snapshots', { keyword_id: kw.id, keyword_text: name, language: 'ko', country: 'KR', engine: 'google', captured_at: at, top_results_json: [{ url: 'https://brand.test/page', rank }] });
      if (cited !== null) {
        const prompt = await f.insert('geo_prompts', { prompt_text: `${name} question` }); await f.insert('keyword_prompt_links', { keyword_id: kw.id, prompt_id: prompt.id });
        const run = await f.insert('geo_prompt_runs', { prompt_id: prompt.id, prompt_text: prompt.prompt_text, language_code: 'ko', location_code: 'KR', brand_domain: 'brand.test', status: 'completed', engine: 'openai', finished_at: at }); await f.insert('geo_run_metrics', { run_id: run.id, is_cited: cited });
      }
    }
    const data = await f.store.read(db => readGapData(db, f.workspace, ACTOR, { start: '2026-10-01', end: '2026-10-10' }));
    for (const row of data.matrix) assert.equal(row.state, row.text);
    const narrowed = await f.store.read(db => readGapData(db, f.workspace, ACTOR, { start: '2026-10-01', end: '2026-10-10', query: 'ai_only' })); assert.equal(narrowed.matrix.length, 1); assert.equal(narrowed.matrix[0].cited, 1);
  });

  it('validates candidate identity, priority, locale and revisions while retaining the original evidence', async () => {
    const f = await fixture(), candidate = await f.create('검토 후보'); await assert.rejects(f.create(' 검토 후보 '), /동일한/);
    for (const extra of [{ text: '' }, { text: 'x'.repeat(201) }, { language: 'invalid-lang' }, { country: 'kr' }, { kind: 'url' }, { priority: 'urgent' }, { source_keyword_id: 'missing' }]) await assert.rejects(f.create('잘못된 후보', extra));
    await f.invoke('candidate-update', { candidate_id: candidate.id, expected_revision: 1, kind: 'prompt', text: '검토할 질문은?', language: 'ko', country: 'KR', priority: 'high', notes: '수정 메모' });
    await assert.rejects(f.invoke('candidate-delete', { candidate_id: candidate.id, expected_revision: 1 }), GapConflictError); assert.equal((await f.rows('geo_prompt_candidates'))[0].notes, '수정 메모');
  });

  it('generates bounded candidates from latest matching stored PAA/related evidence, never overwriting existing review', async () => {
    const f = await fixture(), kw = await f.insert('keywords', { keyword: '근거 키워드' });
    await f.insert('serp_snapshots', { keyword_id: kw.id, keyword_text: kw.keyword, language: 'ko', country: 'KR', engine: 'google', captured_at: '2026-10-01', provider: 'test', related_searches_json: ['연관 문구', '연관 문구', 3, ''], paa_questions_json: ['추가 질문?'] });
    await f.insert('serp_snapshots', { keyword_id: kw.id, keyword_text: '예전 문구', language: 'ko', country: 'KR', engine: 'google', captured_at: '2026-10-02', related_searches_json: ['사용하면 안 됨'] });
    const first = await f.invoke('candidate-generate', { keyword_id: kw.id }); assert.equal(first.created_count, 2); const candidate = (first.candidates as Row[])[0];
    await f.invoke('candidate-status', { candidate_id: candidate.id, expected_revision: 1, status: 'dismissed' });
    const second = await f.invoke('candidate-generate', { keyword_id: kw.id }); assert.equal(second.created_count, 0); assert.equal(second.existing_count, 2); assert.equal((await f.rows('geo_prompt_candidates')).find(row => row.id === candidate.id)?.status, 'dismissed');
    await f.store.write(db => db.updateTable('keywords', { keyword: '새 문구' }, { id: `eq.${kw.id}` }, ACTOR)); await assert.rejects(f.invoke('candidate-generate', { keyword_id: kw.id }), /수집 자료가 없습니다/);
  });

  it('records dismiss/reopen transitions and editable decision notes, with protected state and cascades', async () => {
    const f = await fixture(), candidate = await f.create('보류 검토');
    await f.invoke('candidate-status', { candidate_id: candidate.id, expected_revision: 1, status: 'dismissed' });
    await assert.rejects(f.adopt({ ...candidate, revision: 2 }), /검토 대기/);
    await f.invoke('candidate-status', { candidate_id: candidate.id, expected_revision: 2, status: 'pending' });
    const records = await f.rows('opportunity_decisions'); assert.equal(records.length, 2);
    await f.invoke('decision-update', { decision_id: records[0].id, expected_revision: 1, notes: '다음 회의에서 검토' });
    await assert.rejects(f.invoke('decision-delete', { decision_id: records[0].id, expected_revision: 1 }), GapConflictError);
    await f.invoke('decision-delete', { decision_id: records[0].id, expected_revision: 2 }); assert.equal((await f.rows('opportunity_decisions')).length, 1);
    await f.invoke('candidate-delete', { candidate_id: candidate.id, expected_revision: 3 }); assert.equal((await f.rows('opportunity_decisions')).length, 0);
  });

  it('adopts once across concurrent requests and restart, including after the created destination is deleted', async () => {
    const f = await fixture(), candidate = await f.create('채택 키워드'); await assert.rejects(f.adopt(candidate, { confirm: false }), /확인/);
    const results = await Promise.all([f.adopt(candidate), f.adopt(candidate)]); assert.equal(results.filter(row => row.reused).length, 1); assert.equal((await f.rows('keywords')).length, 1); assert.equal((await f.rows('usage_reservations')).length, 2); assert.equal((await f.rows('opportunity_decisions')).length, 1);
    const adopted = (await f.rows('geo_prompt_candidates'))[0], restart = new PersistentHaloXStore(f.filename);
    assert.equal((await restart.write(db => db.invokeEdgeFunction('candidate-adopt', { workspace_id: f.workspace, candidate_id: candidate.id, expected_revision: 1, confirm: true }, ACTOR))).reused, true);
    await f.store.write(db => db.deleteTable('keywords', { id: `eq.${adopted.destination_id}` }, ACTOR)); await f.adopt(candidate); assert.equal((await f.rows('keywords')).length, 0); assert.equal((await f.rows('usage_reservations')).length, 2);
    await assert.rejects(f.invoke('candidate-status', { candidate_id: candidate.id, expected_revision: 2, status: 'pending' }), /상태 변경/);
    await assert.rejects(f.invoke('candidate-update', { ...adopted, candidate_id: candidate.id, expected_revision: 2, text: '다른 문구' }), /변경할 수 없습니다/);
    await f.invoke('candidate-update', { ...adopted, candidate_id: candidate.id, expected_revision: 2, notes: '채택 후 검토', priority: 'high' }); assert.equal((await f.rows('geo_prompt_candidates'))[0].notes, '채택 후 검토');
  });

  it('reuses existing destinations and links adopted questions to source keywords without charging twice', async () => {
    const f = await fixture(), kw = await f.insert('keywords', { keyword: '원본 키워드' }), prompt = await f.insert('geo_prompts', { prompt_text: '이미 등록된 질문' });
    const existing = await f.create('이미 등록된 질문', { kind: 'prompt', source_keyword_id: kw.id }); const result = await f.adopt(existing); assert.equal(result.reused_destination, true); assert.equal((await f.rows('usage_reservations')).length, 0); assert.equal((await f.rows('keyword_prompt_links'))[0].prompt_id, prompt.id);
    const fresh = await f.create('새 질문 후보', { kind: 'prompt', source_keyword_id: kw.id }); await f.adopt(fresh, { engine: 'gemini' }); assert.equal((await f.rows('geo_prompt_runs')).length, 1); assert.equal((await f.rows('geo_prompt_runs'))[0].engine, 'gemini'); assert.equal((await f.rows('keyword_prompt_links')).length, 2);
    await f.invoke('candidate-delete', { candidate_id: fresh.id, expected_revision: 2 }); assert.equal((await f.rows('geo_prompts')).length, 2);
    await f.store.write(db => db.deleteTable('keywords', { id: `eq.${kw.id}` }, ACTOR)); const retained = (await f.rows('geo_prompt_candidates'))[0]; assert.equal(retained.source_keyword_id, null); assert.equal((retained.evidence as Row).keyword, '원본 키워드');
  });

  it('rolls back adoption, default set creation, usage and status if provider or final receipt storage fails', async () => {
    const provider = createDeterministicProviders(), f = await fixture(() => new HaloXDatabase({ ...provider, collectSerp: async () => { throw new Error('provider unavailable'); } })), candidate = await f.create('실패 후보');
    const before = await f.store.read(db => db.exportState()); await assert.rejects(f.adopt(candidate), /provider unavailable/); assert.deepEqual(await f.store.read(db => db.exportState()), before);
    const clean = await fixture(), other = await clean.create('저장 실패 후보'); const state = await clean.store.read(db => db.exportState());
    await assert.rejects(clean.store.write(db => { const insert = db.insertTable.bind(db); db.insertTable = (table, values, actor) => { if (table === 'opportunity_decisions') throw new Error('receipt write failed'); return insert(table, values, actor); }; return db.invokeEdgeFunction('candidate-adopt', { workspace_id: clean.workspace, candidate_id: other.id, expected_revision: 1, confirm: true }, ACTOR); }), /receipt write failed/);
    assert.deepEqual(await clean.store.read(db => db.exportState()), state); await clean.adopt(other); assert.equal((await clean.rows('keywords')).length, 1);
  });

  it('enforces workspace ownership and dedicated command writes, including referenced destination sets', async () => {
    const f = await fixture(), candidate = await f.create('보호 후보');
    await assert.rejects(f.invoke('candidate-adopt', { candidate_id: candidate.id, expected_revision: 1, confirm: true }, OTHER_USER_ID), /not authorized/i);
    await assert.rejects(f.store.read(db => readGapData(db, ISOLATED_WORKSPACE_ID, ACTOR, {})), /not authorized/i);
    await assert.rejects(f.adopt(candidate, { set_id: 'missing' }), /찾을 수 없습니다/); assert.equal((await f.rows('keywords')).length, 0);
    await f.store.read(db => { for (const table of ['geo_prompt_candidates', 'opportunity_decisions']) for (const method of ['POST', 'PATCH', 'DELETE'] as const) assert.throws(() => assertRestWrite(db, table, method, ACTOR, { workspace_id: f.workspace }, { id: `eq.${candidate.id}` }), /전용 서버/); });
    await f.invoke('candidate-status', { candidate_id: candidate.id, expected_revision: 1, status: 'dismissed' }); await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${f.workspace}` }, ACTOR)); assert.equal((await f.rows('geo_prompt_candidates')).length, 0); assert.equal((await f.rows('opportunity_decisions')).length, 0);
  });
});
