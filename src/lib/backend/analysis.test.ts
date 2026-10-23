import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, ISOLATED_WORKSPACE_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { analysisFilters, analysisKind, readAnalysisData } from './analysis-model.ts';
import { AnalysisConflictError } from './analysis-service.ts';
import { assertRestWrite } from './rest-policy.ts';
import type { AnalysisKind } from '../api/analyses.ts';

const directories: string[] = [], period = { start: '2026-10-01', end: '2026-10-10' };
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-analyses-')); directories.push(directory); const filename = path.join(directory, 'db.sqlite'), store = new PersistentHaloXStore(filename);
  const ws = await store.write(db => db.insertTable('workspaces', { name: '분석 검증', default_brand_filter: 'brand.test' }, ACTOR)[0]), workspace = String(ws.id);
  const insert = (table: string, values: Row) => store.write(db => db.insertTable(table, { ...values, workspace_id: workspace }, ACTOR)[0]);
  const invoke = (name: string, values: Row = {}, actor = ACTOR) => store.write(db => db.invokeEdgeFunction(name, { ...values, workspace_id: workspace }, actor));
  const data = (kind: AnalysisKind = 'seo', filters: Row = {}) => store.read(db => readAnalysisData(db, workspace, ACTOR, kind, { ...period, ...filters }));
  const keyword = (word: string, extra: Row = {}) => insert('keywords', { keyword: word, ...extra });
  const snapshot = (kw: Row, at: string, position: number | null = 3, extra: Row = {}) => insert('serp_snapshots', { keyword_id: kw.id, keyword_text: kw.keyword, language: kw.language, country: kw.country, captured_at: at, engine: 'google', provider: 'test', search_volume: 100, keyword_difficulty: 30, top_results_json: position === null ? [] : [{ url: 'https://sub.brand.test/guide', rank: position }], ...extra });
  const prompt = (word: string, extra: Row = {}) => insert('geo_prompts', { prompt_text: word, ...extra });
  const run = async (prompt: Row, at: string, mentioned: boolean | null, cited: boolean | null, extra: Row = {}) => {
    const result = await insert('geo_prompt_runs', { prompt_id: prompt.id, prompt_text: prompt.prompt_text, language_code: prompt.language_code, location_code: prompt.location_code, brand_domain: 'brand.test', engine: 'openai', status: 'completed', finished_at: at, answer_text: '검증 답변', ...extra });
    if (mentioned !== null || cited !== null) await insert('geo_run_metrics', { run_id: result.id, brand_mentioned: mentioned, is_cited: cited }); return result;
  };
  return { filename, store, workspace, insert, invoke, data, keyword, snapshot, prompt, run };
}

describe('saved analyses and measured period aggregation', () => {
  it('validates UTC calendar dates, bounded periods, kind-specific engines and domain filters', () => {
    assert.equal(analysisKind('seo'), 'seo'); assert.throws(() => analysisKind('gap'));
    const value = analysisFilters({ ...period, domain: 'Brand.Test', query: '  guide  ' }, 'seo'); assert.equal(value.domain, 'brand.test'); assert.equal(value.query, 'guide');
    for (const filters of [null, [], { start: '2026-02-30' }, { start: '2024-01-01', end: '2026-01-01' }, { start: '2026-10-11', end: '2026-10-10' }, { engine: 'openai' }, { country: 'kr' }, { domain: 'https://brand.test' }, { status: 'hidden' }, { source_revision: 'unknown' }, { query: 4 }]) assert.throws(() => analysisFilters(filters === null || Array.isArray(filters) ? filters : { ...period, ...filters }, 'seo'));
    assert.throws(() => analysisFilters({ ...period, engine: 'google' }, 'geo'));
    assert.throws(() => analysisFilters({ ...period, domain: 'brand.test' }, 'geo'));
    assert.equal(analysisFilters({ start: '2024-01-01', end: '2024-12-31' }, 'seo').end, '2024-12-31');
  });

  it('uses latest keyword/engine samples for SEO and compares equal preceding UTC periods without duplicating results', async () => {
    const f = await fixture(), kw = await f.keyword('검색 기준');
    await f.snapshot(kw, '2026-09-21T00:00:00Z', 20); await f.snapshot(kw, '2026-09-20T23:59:59Z', 99);
    await f.snapshot(kw, '2026-10-01T00:00:00Z', 10); await f.snapshot(kw, '2026-10-10T23:59:59Z', 4, { top_results_json: [{ url: 'https://sub.brand.test/guide', rank: 4 }, { url: 'https://sub.brand.test/guide', rank: 5 }, { url: 'https://brand.test.evil.test/', rank: 1 }, { url: 'javascript:alert(1)', rank: 1 }] });
    await f.snapshot(kw, '2026-10-11T00:00:00Z', 1);
    await f.snapshot(kw, '2026-10-02T00:00:00Z', null, { engine: 'naver' });
    const data = await f.data(); assert.equal(data.samples.length, 3); assert.equal(data.latest.length, 2); assert.equal(data.summary.samples, 2); assert.equal(data.summary.top10_percent, 50); assert.equal(data.summary.average_rank, 4); assert.equal(data.previous.average_rank, 20); assert.deepEqual(data.previous_range, { start: '2026-09-21', end: '2026-09-30' });
    assert.equal(data.domains.find(row => row.domain === 'sub.brand.test')?.occurrences, 1); assert.equal(data.domains.find(row => row.domain === 'brand.test.evil.test')?.ours, 0); assert.equal(data.domains.length, 2); assert.equal(data.trend.length, 3);
    const overridden = await f.data('seo', { domain: 'evil.test' }); assert.equal(overridden.summary.average_rank, 1);
  });

  it('keeps unknown ranks, historical volumes and AIO citation data distinct from measured zero', async () => {
    const f = await fixture(), a = await f.keyword('자료 없음'), b = await f.keyword('인용 자료 있음');
    await f.snapshot(a, '2026-10-01T00:00:00Z', null, { search_volume: null, keyword_difficulty: 130, top_results_json: undefined, ai_overview_detected: true });
    await f.snapshot(b, '2026-10-01T00:00:00Z', null, { search_volume: 0, keyword_difficulty: 0, ai_overview_detected: true, ai_overview_json: { cited_domains: ['brand.test'] } });
    const data = await f.data(); assert.equal(data.summary.rank_measured, 1); assert.equal(data.summary.average_rank, null); assert.equal(data.summary.top10_percent, 0); assert.equal(data.summary.aio_detected, 2); assert.equal(data.summary.aio_measured, 1); assert.equal(data.summary.aio_percent, 100);
    assert.equal(data.latest.find(row => row.entity_id === a.id)?.volume, null); assert.equal(data.latest.find(row => row.entity_id === a.id)?.difficulty, null); assert.equal(data.latest.find(row => row.entity_id === b.id)?.volume, 0);
    await f.store.write(db => db.updateTable('workspaces', { default_brand_filter: '' }, { id: `eq.${f.workspace}` }, ACTOR)); const noDomain = await f.data(); assert.equal(noDomain.summary.top10_percent, null); assert.equal(noDomain.summary.aio_percent, null);
  });

  it('applies set, tag, locale, query and tracking filters and excludes renamed or deleted keyword evidence', async () => {
    const f = await fixture(), set = await f.insert('keyword_sets', { name: '집중 세트' }), tag = await f.insert('workspace_tags', { name: '관찰' });
    const a = await f.keyword('분석 대상', { keyword_set_id: set.id }), b = await f.keyword('다른 언어', { language: 'en', country: 'US', is_paused: true });
    await f.insert('keyword_tag_assignments', { keyword_id: a.id, tag_id: tag.id }); await f.snapshot(a, '2026-10-02T00:00:00Z'); await f.snapshot(b, '2026-10-02T00:00:00Z');
    assert.equal((await f.data('seo', { set_id: set.id, tag_id: tag.id, language: 'ko', country: 'KR', query: '대상', status: 'active' })).summary.samples, 1);
    assert.equal((await f.data('seo', { status: 'paused' })).latest[0].entity_id, b.id);
    await assert.rejects(f.data('seo', { set_id: 'foreign' }), /세트가 삭제/);
    await f.store.write(db => db.updateTable('keywords', { keyword: '변경한 문구' }, { id: `eq.${a.id}` }, ACTOR)); const renamed = await f.data(); assert.equal(renamed.summary.samples, 1); assert.equal(renamed.excluded_records, 1);
    await f.store.write(db => db.deleteTable('keywords', { id: `eq.${b.id}` }, ACTOR)); assert.equal((await f.data()).summary.samples, 0);
  });

  it('compares all completed GEO samples with explicit denominators and deduplicates source URLs per run', async () => {
    const f = await fixture(), p = await f.prompt('도구 비교 질문');
    await f.run(p, '2026-09-30T23:59:59Z', false, false);
    const first = await f.run(p, '2026-10-01T00:00:00Z', true, true); await f.run(p, '2026-10-02T00:00:00Z', false, false); await f.run(p, '2026-10-03T00:00:00Z', true, true, { engine: 'gemini' });
    for (let i = 0; i < 2; i++) await f.insert('geo_citations', { run_id: first.id, cited_url: 'https://brand.test/source', position_index: 1, is_ours: true });
    await f.insert('geo_citations', { run_id: first.id, cited_url: 'https://rival.test/source', position_index: 2, is_competitor: true });
    await f.insert('geo_citations', { run_id: first.id, cited_url: 'data:text/html,invalid', position_index: 1 });
    const data = await f.data('geo'); assert.equal(data.summary.samples, 3); assert.equal(data.summary.mention_percent, 66.7); assert.equal(data.summary.citation_percent, 66.7); assert.equal(data.previous.citation_percent, 0); assert.equal(data.latest.length, 2); assert.equal(data.domains.length, 2); assert.equal(data.domains[0].occurrences, 1); assert.equal(data.domains.find(row => row.domain === 'rival.test')?.competitor, 1);
    const openai = await f.data('geo', { engine: 'openai' }); assert.equal(openai.summary.citation_percent, 50); assert.equal(openai.engines.length, 1);
  });

  it('does not invent GEO measurements from failed runs, old locale/text, absent metrics or absent brand setup', async () => {
    const f = await fixture(), p = await f.prompt('현재 질문');
    await f.run(p, '2026-10-02T00:00:00Z', true, true, { status: 'failed' }); await f.run(p, '2026-10-02T00:00:00Z', true, true, { language_code: 'en' }); await f.run(p, '2026-10-02T00:00:00Z', true, true, { prompt_text: '예전 문구' });
    await f.run(p, '2026-10-02T00:00:00Z', null, null); await f.run(p, '2026-10-02T00:00:00Z', false, false, { brand_domain: '' });
    const data = await f.data('geo'); assert.equal(data.excluded_records, 3); assert.equal(data.summary.samples, 2); assert.equal(data.summary.mention_percent, null); assert.equal(data.summary.citation_percent, null);
    await f.store.write(db => db.updateTable('geo_prompts', { location_code: 'US' }, { id: `eq.${p.id}` }, ACTOR)); assert.equal((await f.data('geo')).summary.samples, 0);
  });

  it('persists saved conditions across restart, edits with revisions and recomputes from changed source data', async () => {
    const f = await fixture(), kw = await f.keyword('저장 분석'); await f.snapshot(kw, '2026-10-02T00:00:00Z', 12);
    const result = await f.invoke('analysis-create', { kind: 'seo', name: '월간 분석', notes: '메모', filters: period }), saved = result.analysis as Row;
    await assert.rejects(f.invoke('analysis-create', { kind: 'seo', name: ' 월간 분석 ', filters: period }), /같은 이름/);
    await f.invoke('analysis-create', { kind: 'geo', name: '월간 분석', filters: period });
    await f.invoke('analysis-update', { analysis_id: saved.id, expected_revision: 1, kind: 'seo', name: '검색 검토', notes: '편집된 메모', filters: { ...period, engine: 'google' } });
    await assert.rejects(f.invoke('analysis-delete', { analysis_id: saved.id, expected_revision: 1 }), AnalysisConflictError);
    const restart = new PersistentHaloXStore(f.filename); const data = await restart.read(db => readAnalysisData(db, f.workspace, ACTOR, 'seo', period)); assert.equal(data.saved[0].name, '검색 검토'); assert.equal(data.saved[0].notes, '편집된 메모'); assert.equal(data.summary.average_rank, 12);
    await f.snapshot(kw, '2026-10-03T00:00:00Z', 2); assert.equal((await f.data()).summary.average_rank, 2);
    await f.invoke('analysis-delete', { analysis_id: saved.id, expected_revision: 2 }); const after = await f.data(); assert.equal(after.saved.length, 0); assert.equal(after.samples.length, 2);
  });

  it('blocks tenant and REST write bypasses, validates saved references, and cascades only workspace-owned analyses', async () => {
    const f = await fixture(), result = await f.invoke('analysis-create', { kind: 'seo', name: '보호 분석', filters: period }), saved = result.analysis as Row;
    await assert.rejects(f.invoke('analysis-delete', { analysis_id: saved.id, expected_revision: 1 }, OTHER_USER_ID), /not authorized/i);
    await assert.rejects(f.store.read(db => readAnalysisData(db, ISOLATED_WORKSPACE_ID, ACTOR, 'seo', period)), /not authorized/i);
    await assert.rejects(f.invoke('analysis-create', { kind: 'seo', name: '다른 세트', filters: { ...period, set_id: 'unknown' } }), /세트가 삭제/);
    await assert.rejects(f.invoke('analysis-update', { analysis_id: saved.id, expected_revision: 1, kind: 'geo', name: '종류 변경', filters: period }), /종류는 변경/);
    await assert.rejects(f.invoke('analysis-create', { kind: 'seo', name: '긴 메모', notes: 'x'.repeat(5001), filters: period }));
    await f.store.read(db => { for (const method of ['POST', 'PATCH', 'DELETE'] as const) assert.throws(() => assertRestWrite(db, 'saved_analyses', method, ACTOR, { workspace_id: f.workspace }, { id: `eq.${saved.id}` }), /전용 서버/); });
    await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${f.workspace}` }, ACTOR)); assert.equal((await f.store.read(db => db.queryTable('saved_analyses', {}, ACTOR))).count, 0);
  });

  it('retains deleted filter references for explicit correction instead of silently widening a saved analysis', async () => {
    const f = await fixture(), set = await f.insert('keyword_sets', { name: '삭제될 세트' }); await f.invoke('analysis-create', { kind: 'seo', name: '선택 조건', filters: { ...period, set_id: set.id } });
    await f.store.write(db => db.deleteTable('keyword_sets', { id: `eq.${set.id}` }, ACTOR)); const data = await f.data(); assert.equal((data.saved[0].filters as Row).set_id, set.id); await assert.rejects(f.data('seo', data.saved[0].filters as Row), /다시 선택/);
  });

  it('records historical SEO numeric measurements and GEO brand context in new provider runs', async () => {
    const f = await fixture(), collected = await f.invoke('keywords-collect', { keywords: ['새 수집'] }); const snapshot = (collected.snapshots as Row[])[0]; assert.equal(typeof snapshot.search_volume, 'number'); assert.equal(typeof snapshot.keyword_difficulty, 'number');
    const result = await f.invoke('geo-run', { prompt_text: '새 질문 수집', engines: ['openai'] }); assert.equal((result.run as Row).brand_domain, 'brand.test');
  });
});
