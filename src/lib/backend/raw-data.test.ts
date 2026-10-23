import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { runRawImportCommand, readRawImportFile } from './raw-import-service.ts';
import { rawFilters, readRawData, readRawDetail, downloadRawData } from './raw-data-model.ts';
import { parseRawImport, rawImportTemplate } from './raw-import-format.ts';
import { readAnalysisData } from './analysis-model.ts';
import { readObservationSnapshot } from './observation-model.ts';
import { assertRestWrite } from './rest-policy.ts';
import { crc32, rawCsv, rawZip } from './raw-archive.ts';
import type { RawKind } from '../api/raw-data.ts';
const directories: string[] = [], NOW = Date.parse('2026-10-23T12:00:00Z'), range = { start: '2026-10-17', end: '2026-10-23' };
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-raw-')); directories.push(directory); const filename = path.join(directory, 'db.sqlite'), store = new PersistentHaloXStore(filename);
  const ws = await store.write(db => db.insertTable('workspaces', { name: '원본 검증', default_brand_filter: 'brand.test' }, ACTOR)[0]), workspace = String(ws.id);
  const insert = (table: string, values: Row) => store.write(db => db.insertTable(table, { ...values, workspace_id: workspace }, ACTOR)[0]);
  const keyword = await insert('keywords', { keyword: '가져오기 검색' }), prompt = await insert('geo_prompts', { prompt_text: '가져오기 질문' }), target = await insert('site_audit_targets', { name: '사이트', target_url: 'https://brand.test/', max_pages: 10, max_depth: 1, scope_rules: { include_paths: [], exclude_paths: ['/private'] }, revision: 1 });
  const seo = { source_id: 'seo-1', keyword_id: keyword.id, keyword_text: keyword.keyword, language: keyword.language, country: keyword.country, engine: 'google', captured_at: '2026-10-23T11:00:00Z', top_results: [{ rank: 4, url: 'https://brand.test/page', title: '제목' }], search_volume: 250, keyword_difficulty: 30, ai_overview_detected: true, ai_overview: { text: '요약', cited_domains: ['brand.test'] }, paa_questions: ['연관 질문'], related_searches: ['다음 검색'] };
  const geo = { source_id: 'geo-1', prompt_id: prompt.id, prompt_text: prompt.prompt_text, language_code: prompt.language_code, location_code: prompt.location_code, engine: 'openai', finished_at: '2026-10-23T11:00:00Z', brand_domain: 'brand.test', answer_text: '원문 응답 😀\n두 번째 줄', metrics: { brand_mentioned: true, is_cited: true, citation_rank_score: 80, mention_rank_score: 60 }, citations: [{ url: 'https://brand.test/answer', position: 1, is_ours: true, is_competitor: false }] };
  const audit = { source_id: 'audit-1', target_id: target.id, completed_at: '2026-10-23T11:00:00Z', pages: [{ url: 'https://brand.test/', status_code: 200, title: '홈', html_score: 80, issues: [{ code: 'missing-meta', severity: 'warning', title: '설명 누락', description: 'head 설명 누락', fix_recommendation: '설명 추가' }] }, { url: 'https://brand.test/about', status_code: 200, html_score: 60, issues: [] }] };
  const file = (kind: RawKind, records: unknown[], source = 'test-source') => JSON.stringify({ schema_version: 1, kind, source: { provider: source, url: 'https://source.test/export' }, records }, null, 2);
  const command = (name: string, values: Row, actor = ACTOR) => store.write(db => runRawImportCommand(db, name, values, workspace, actor, NOW));
  const upload = (contents: string, key = 'request-1', extra: Row = {}) => command('raw-import-create', { contents, filename: 'evidence.json', title: '가져온 근거', notes: '', idempotency_key: key, ...extra });
  const read = (table: string, actor = ACTOR) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${workspace}` } }, actor).data);
  const data = (kind: RawKind, filters: Row = {}) => store.read(db => readRawData(db, workspace, ACTOR, kind, { ...range, ...filters }));
  return { directory, filename, store, workspace, keyword, prompt, target, seo, geo, audit, file, command, upload, insert, read, data };
}
const batchOf = (response: Row) => response.batch as Row;
describe('원본 자료와 가져오기', () => {
  it('validates real 1–90 day ranges and typed filters', () => { assert.throws(() => rawFilters({ start: '2026-02-30' }), /날짜/); assert.throws(() => rawFilters({ start: '2026-01-01', end: '2026-04-01' }), /90일/); assert.throws(() => rawFilters({ ...range, latest: 'true' }), /필터/); assert.throws(() => rawFilters({ ...range, surprise: 1 }), /필터/); assert.equal(rawFilters(range).latest, false); });
  it('imports SERP source once, preserves exact UTF-8 source, revisions and linked analysis', async () => {
    const f = await fixture(), contents = '\uFEFF' + f.file('seo', [f.seo]) + '\n', batch = batchOf(await f.upload(contents));
    const snapshot = (await f.read('serp_snapshots'))[0]; assert.equal(snapshot.provider, 'import:test-source'); assert.equal(snapshot.import_batch_id, batch.id);
    const analysis = await f.store.read(db => readAnalysisData(db, f.workspace, ACTOR, 'seo', range)); assert.equal(analysis.summary.average_rank, 4); assert.equal(analysis.summary.top10_percent, 100); assert.equal(analysis.summary.aio_percent, 100); assert.equal(analysis.samples[0].volume, 250);
    assert.equal((await f.store.read(db => readRawImportFile(db, f.workspace, ACTOR, String(batch.id)))).bytes.toString(), contents); assert.equal((await f.upload(contents)).replayed, true);
    await assert.rejects(f.upload(contents, 'request-1', { notes: '변경' }), /변경/); await assert.rejects(f.upload(contents, 'another'), /같은 파일/);
    await f.command('raw-import-update', { batch_id: batch.id, expected_revision: 1, title: '수정된 이름', notes: '출처 메모' }); await assert.rejects(f.command('raw-import-update', { batch_id: batch.id, expected_revision: 1, title: '충돌' }), /변경/);
    const restarted = new PersistentHaloXStore(f.filename); assert.equal((await restarted.read(db => readRawData(db, f.workspace, ACTOR, 'seo', range))).batches[0].title, '수정된 이름');
  });
  it('validates every record before writes and rejects foreign entities, unknown fields, future values and unsafe URLs', async () => {
    const f = await fixture();
    for (const bad of [{ ...f.seo, keyword_id: 'foreign' }, { ...f.seo, source_id: 'seo-2', extra: true }, { ...f.seo, captured_at: '2026-02-30T00:00:00Z' }, { ...f.seo, captured_at: '2026-10-24T00:00:00Z' }, { ...f.seo, top_results: [{ url: 'javascript:alert(1)', rank: 1 }] }, { ...f.seo, search_volume: -1 }]) { await assert.rejects(f.upload(f.file('seo', [f.seo, bad]))); assert.equal((await f.read('raw_import_batches')).length, 0); assert.equal((await f.read('serp_snapshots')).length, 0); }
    await assert.rejects(f.upload(f.file('seo', [f.seo], 'replace-with-source-name')), /출처/); await assert.rejects(f.upload(' '.repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
  });
  it('rejects duplicate source IDs across payloads and batches, even with different filenames/request keys', async () => {
    const f = await fixture(); await assert.rejects(f.upload(f.file('seo', [f.seo, f.seo])), /식별자/); await f.upload(f.file('seo', [f.seo])); await assert.rejects(f.upload(f.file('seo', [{ ...f.seo, search_volume: 999 }]), 'new', { filename: 'other.json' }), /식별자/);
    await f.upload(f.file('seo', [{ ...f.seo, source_id: 'seo-2' }]), 'new-source'); assert.equal((await f.data('seo')).count, 2);
  });
  it('enforces owner/admin import privileges, member read access, REST write restrictions and private source storage', async () => {
    const f = await fixture(), contents = f.file('seo', [f.seo]); await assert.rejects(f.command('raw-import-create', {}, OTHER_USER_ID), /authorized/); await assert.rejects(f.store.read(db => readRawData(db, f.workspace, OTHER_USER_ID, 'seo', range)), /authorized/);
    await f.insert('workspace_members', { user_id: OTHER_USER_ID, role: 'member' }); await assert.rejects(f.command('raw-import-create', {}, OTHER_USER_ID), /관리자/); const batch = batchOf(await f.upload(contents)); assert.equal((await f.read('raw_import_batches', OTHER_USER_ID)).length, 1); await assert.rejects(f.command('raw-import-delete', { batch_id: batch.id, expected_revision: 1 }, OTHER_USER_ID), /관리자/);
    await assert.rejects(f.store.write(db => assertRestWrite(db, 'raw_import_batches', 'POST', ACTOR, { workspace_id: f.workspace })), /서버 작업/); await assert.rejects(f.read('raw_import_files'), /does not exist/);
  });
  it('filters current raw records by date/engine/locale/origin and applies latest per entity/engine', async () => {
    const f = await fixture(); await f.upload(f.file('seo', [f.seo, { ...f.seo, source_id: 'older', captured_at: '2026-10-20T01:00:00Z' }, { ...f.seo, source_id: 'naver', engine: 'naver' }]));
    await f.insert('serp_snapshots', { keyword_id: f.keyword.id, keyword_text: '과거 문구', language: 'en', country: 'US', engine: 'google', captured_at: '2026-10-21T00:00:00Z', provider: 'fixture' });
    assert.equal((await f.data('seo')).count, 4); assert.equal((await f.data('seo', { latest: true })).count, 3); assert.equal((await f.data('seo', { origin: 'collected' })).count, 1); assert.equal((await f.data('seo', { language: 'ko', engine: 'google', query: '가져오기', latest: true })).count, 1); assert.equal((await f.data('seo', { country: 'US' })).records[0].title, '과거 문구');
  });
  it('imports GEO answers/citations/metrics into analysis and cleans only the imported run on batch deletion', async () => {
    const f = await fixture(), batch = batchOf(await f.upload(f.file('geo', [f.geo]))); const run = (await f.read('geo_prompt_runs'))[0];
    assert.equal((await f.read('geo_answers_raw'))[0].answer_text, f.geo.answer_text); assert.equal((await f.read('geo_citations'))[0].run_id, run.id);
    assert.equal((await f.store.read(db => readAnalysisData(db, f.workspace, ACTOR, 'geo', range))).summary.citation_percent, 100);
    await f.command('raw-import-delete', { batch_id: batch.id, expected_revision: 1 }); for (const name of ['geo_prompt_runs', 'geo_answers_raw', 'geo_citations', 'geo_run_metrics']) assert.equal((await f.read(name)).length, 0); assert.equal((await f.read('geo_prompts')).length, 1);
    assert.equal((await f.store.read(db => readAnalysisData(db, f.workspace, ACTOR, 'geo', range))).summary.citation_percent, null); await assert.rejects(f.upload(f.file('geo', [f.geo])), /삭제한 요청/);
  });
  it('imports audit pages/issues, computes measured score with explicit import provider and rejects out-of-scope pages', async () => {
    const f = await fixture(); await assert.rejects(f.upload(f.file('audit', [{ ...f.audit, pages: [{ ...f.audit.pages[0], url: 'https://brand.test/private' }] }])), /범위/);
    const batch = batchOf(await f.upload(f.file('audit', [f.audit]))), scan = (await f.read('site_audit_scans'))[0]; assert.equal(scan.site_health_score, 70); assert.equal(scan.warning_count, 1); assert.equal((await f.read('site_audit_issues'))[0].page_id, (await f.read('site_audit_pages')).find(row => row.url === 'https://brand.test/')?.id);
    const snapshot = await f.store.read(db => readObservationSnapshot(db, f.workspace, ACTOR, range.start, range.end, NOW)); assert.equal(snapshot.scores.web_health, 70); assert.equal(snapshot.audits[0].provider, 'import:test-source'); assert.equal(snapshot.audits[0].import_batch_id, batch.id); assert.deepEqual(snapshot.providers, ['import:test-source']);
    await f.command('raw-import-delete', { batch_id: batch.id, expected_revision: 1 }); assert.equal((await f.read('site_audit_scans')).length, 0); assert.equal((await f.read('site_audit_issues')).length, 0); assert.equal((await f.read('site_audit_targets')).length, 1);
  });
  it('keeps measured zero separate from null and does not fabricate data omitted by a file', async () => {
    const f = await fixture(); await f.upload(f.file('seo', [{ ...f.seo, top_results: null, ai_overview: null, search_volume: 0 }])); const data = await f.store.read(db => readAnalysisData(db, f.workspace, ACTOR, 'seo', range)); assert.equal(data.summary.rank_measured, 0); assert.equal(data.summary.top10_percent, null); assert.equal(data.samples[0].volume, 0);
  });
  it('exports only selected parent/child records in a valid ZIP with actual rows, preserved JSON and formula-safe CSV', async () => {
    const f = await fixture(); await f.upload(f.file('seo', [f.seo, { ...f.seo, source_id: 'other-date', captured_at: '2026-10-01T00:00:00Z' }]));
    const exported = await f.store.read(db => downloadRawData(db, f.workspace, ACTOR, 'seo', range)); const zipPath = path.join(f.directory, 'export.zip'); writeFileSync(zipPath, exported.bytes); execFileSync('unzip', ['-t', zipPath]); execFileSync('unzip', ['-q', zipPath, '-d', path.join(f.directory, 'files')]);
    assert.match(readFileSync(path.join(f.directory, 'files/serp_results.csv'), 'utf8'), /brand\.test/); assert.equal(readFileSync(path.join(f.directory, 'files/serp_results.csv'), 'utf8').split('\r\n').length, 3); assert.match(readFileSync(path.join(f.directory, 'files/README.txt'), 'utf8'), /import_batch_id/);
    const data = await f.data('seo'); assert.equal(data.count, 1); assert.equal(data.table_counts.serp_results, 1); assert.equal(data.total_rows, 6);
    assert.match(rawCsv([{ value: '=SUM(A1)', nested: { a: '"\n' } }]), /'=SUM/); assert.match(rawCsv([{ value: '  @cmd' }]), /'  @cmd/); assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926); assert.throws(() => rawZip({ '../bad': 'x' }), /한도/);
  });
  it('retains batch source after linked entities are removed and exact retries do not recreate deleted measurements', async () => {
    const f = await fixture(), contents = f.file('seo', [f.seo]), batch = batchOf(await f.upload(contents)); await f.store.write(db => db.deleteTable('keywords', { id: `eq.${f.keyword.id}` }, ACTOR));
    assert.equal((await f.data('seo')).batches[0].remaining_count, 0); assert.equal((await f.upload(contents)).replayed, true); assert.equal((await f.store.read(db => readRawImportFile(db, f.workspace, ACTOR, String(batch.id)))).bytes.toString(), contents);
  });
  it('batch deletion leaves collected records and frozen reports intact and workspace deletion clears private files/receipts', async () => {
    const f = await fixture(); const collected = await f.insert('serp_snapshots', { keyword_id: f.keyword.id, keyword_text: f.keyword.keyword, captured_at: '2026-10-20T01:00:00Z', language: 'ko', country: 'KR', engine: 'google', provider: 'fixture', top_results_json: [] }); const batch = batchOf(await f.upload(f.file('seo', [f.seo])));
    const report = await f.store.write(db => db.invokeEdgeFunction('report-create', { workspace_id: f.workspace, period_type: 'month', date: '2026-10-23', idempotency_key: 'snapshot-before-delete' }, ACTOR));
    await f.command('raw-import-delete', { batch_id: batch.id, expected_revision: 1 }); assert.equal((await f.read('serp_snapshots'))[0].id, collected.id); assert.equal(((report.report as Row).snapshot as { seo: { evidence: unknown[] } }).seo.evidence.length, 2);
    await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${f.workspace}` }, ACTOR)); await f.store.read(db => { assert.equal(db.getServerRecords('raw_import_files').length, 0); assert.equal(db.getServerRecords('raw_import_requests').length, 0); });
  });
  it('keeps monitoring tables separate when record IDs overlap', async () => {
    const f = await fixture();
    await f.insert('gsc_daily_totals', { id: 'shared-id', date: '2026-10-23', clicks: 5 });
    await f.insert('ga4_page_stats', { id: 'shared-id', date: '2026-10-23', page_path: '/source', views: 9 });
    const filtered = await f.data('monitoring', { engine: 'gsc' }); assert.equal(filtered.count, 1); assert.equal(filtered.table_counts.ga4_page_stats, 0);
    const detail = await f.store.read(db => readRawDetail(db, f.workspace, ACTOR, 'monitoring', 'shared-id', 'ga4_page_stats')); assert.equal(detail.tables.ga4_page_stats.length, 1); assert.equal(detail.tables.gsc_daily_totals.length, 0);
    await assert.rejects(f.store.read(db => readRawDetail(db, f.workspace, ACTOR, 'monitoring', 'shared-id')), /테이블/);
  });
  it('exposes source details and honest empty monitoring data, and generates a template tied to the selected entity', async () => {
    const f = await fixture(); assert.equal((await f.data('monitoring')).count, 0); const contents = await f.store.read(db => rawImportTemplate(db, f.workspace, ACTOR, 'seo', String(f.keyword.id))); assert.equal(JSON.parse(contents).records[0].keyword_id, f.keyword.id); await assert.rejects(f.upload(contents), /출처/);
    await f.upload(f.file('seo', [f.seo])); const detail = await f.store.read(db => readRawDetail(db, f.workspace, ACTOR, 'seo', String((db.queryTable('serp_snapshots', { filters: { workspace_id: `eq.${f.workspace}` } }, ACTOR).data[0]).id))); assert.equal(detail.tables.serp_results.length, 1); await assert.rejects(f.store.read(db => readRawDetail(db, f.workspace, OTHER_USER_ID, 'seo', detail.record.id)), /authorized/);
    await assert.rejects(f.store.read(db => parseRawImport(db, f.workspace, ACTOR, f.file('monitoring', []), NOW)), /schema_version/);
  });
});
