import type { HaloXDatabase, Row } from './database.ts';
import { observationAdmin, observationDate, observationRows } from './observation-model.ts';
import { defaultRawFilters, RAW_KINDS, type RawKind, type RawFilters, type RawRecord, type RawData, type RawDetail } from '../api/raw-data.ts';
import { rawCsv, rawZip } from './raw-archive.ts';
export const RAW_PARENTS: Record<RawKind, string[]> = { seo: ['serp_snapshots'], geo: ['geo_prompt_runs'], audit: ['site_audit_scans'], monitoring: ['gsc_daily_totals', 'gsc_daily_keywords', 'gsc_daily_pages', 'ga4_page_stats'] };
export function rawKind(value: unknown): RawKind { if (typeof value !== 'string' || !Object.hasOwn(RAW_KINDS, value)) throw new Error('원본 자료 종류를 선택해 주세요.'); return value as RawKind; }
export function rawFilters(input: unknown): RawFilters {
  const defaults = defaultRawFilters(); if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(defaults, key))) throw new Error('필터를 확인해 주세요.');
  const result = { ...defaults, ...input } as RawFilters;
  if (Object.entries(result).some(([key, value]) => key === 'latest' ? typeof value !== 'boolean' : typeof value !== 'string')) throw new Error('필터 값이 올바르지 않습니다.');
  observationDate(result.start); observationDate(result.end); const days = (Date.parse(result.end) - Date.parse(result.start)) / 86400000 + 1;
  if (days < 1 || days > 90 || result.query.length > 200 || result.batch_id.length > 100 || result.engine.length > 30 || result.language.length > 20 || result.country.length > 10 || !['all', 'collected', 'imported'].includes(result.origin)) throw new Error('기간은 1~90일이며 필터 길이와 출처 조건을 확인해 주세요.');
  return result;
}
function sourceRows(db: HaloXDatabase, workspace: string, actor: string, kind: RawKind) {
  const rows = (table: string) => observationRows(db, workspace, actor, table), entities = rows(kind === 'seo' ? 'keywords' : kind === 'geo' ? 'geo_prompts' : 'site_audit_targets');
  return RAW_PARENTS[kind].flatMap(table => rows(table).map(row => {
    const entityId = String(row.keyword_id || row.prompt_id || row.target_id || ''), entity = entities.find(item => item.id === entityId);
    const at = row.captured_at || row.finished_at || row.completed_at || row.date || row.created_at;
    const metadata: RawRecord = { id: String(row.id), title: String(row.keyword_text || row.prompt_text || row.name || row.target_url || row.page_path || row.page_url || row.page || row.query || row.keyword || entity?.keyword || entity?.prompt_text || entity?.name || row.id), at: Number.isFinite(Date.parse(String(at))) ? new Date(String(at)).toISOString() : '', engine: String(row.engine || (table.startsWith('gsc_') ? 'gsc' : table === 'ga4_page_stats' ? 'ga4' : '')), language: String(row.language || row.language_code || ''), country: String(row.country || row.location_code || ''), provider: String(row.provider || 'legacy-unverified'), import_batch_id: typeof row.import_batch_id === 'string' ? row.import_batch_id : null, entity_id: entityId, status: String(row.status || 'stored'), table };
    return { row, metadata };
  }));
}
function selectRaw(db: HaloXDatabase, workspace: string, actor: string, kind: RawKind, input: unknown) {
  db.assertWorkspaceMember(workspace, actor); const filters = rawFilters(input), all = sourceRows(db, workspace, actor, kind), start = Date.parse(filters.start), end = Date.parse(filters.end) + 86400000;
  let selected = all.filter(({ metadata: row }) => row.at && Date.parse(row.at) >= start && Date.parse(row.at) < end && (!filters.query || row.title.toLocaleLowerCase().includes(filters.query.toLocaleLowerCase())) && (!filters.engine || row.engine === filters.engine) && (!filters.language || row.language === filters.language) && (!filters.country || row.country === filters.country) && (!filters.batch_id || row.import_batch_id === filters.batch_id) && (filters.origin === 'all' || (filters.origin === 'imported') === !!row.import_batch_id)).sort((a, b) => b.metadata.at.localeCompare(a.metadata.at) || b.metadata.id.localeCompare(a.metadata.id));
  if (filters.latest) { const seen = new Set<string>(); selected = selected.filter(({ row, metadata: m }) => { const key = JSON.stringify([m.table, m.entity_id || row.target_url || row.page_path || row.page_url || row.page || row.query || row.keyword || (kind === 'monitoring' ? workspace : m.id), row.device || '', row.search_type || '', row.session_source || '', row.channel_group || '', row.resource || '', m.engine, m.language, m.country]); if (seen.has(key)) return false; seen.add(key); return true; }); }
  return { selected, filters, excluded_undated: all.filter(row => !row.metadata.at).length };
}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
/** Selection drives every child join; no whole-workspace child table leaks into exports. */
export function rawTables(db: HaloXDatabase, workspace: string, actor: string, kind: RawKind, parents: Row[], selectedTables?: Set<string>): Record<string, Row[]> {
  const rows = (table: string) => observationRows(db, workspace, actor, table), ids = new Set(parents.map(row => row.id));
  if (kind === 'seo') {
    const keywordIds = new Set(parents.map(row => row.keyword_id));
    return { keywords: rows('keywords').filter(row => keywordIds.has(row.id)), serp_snapshots: parents, serp_results: parents.flatMap(row => array(row.top_results_json).map((result, index) => ({ ...(result && typeof result === 'object' ? result as Row : { value: result }), snapshot_id: row.id, ordinal: index + 1 }))), ai_overviews: parents.filter(row => row.ai_overview_json !== undefined || row.ai_overview_detected !== undefined).map(row => ({ snapshot_id: row.id, detected: row.ai_overview_detected, payload: row.ai_overview_json ?? null })), paa_questions: parents.flatMap(row => array(row.paa_questions_json).map((question, index) => ({ snapshot_id: row.id, ordinal: index + 1, question }))), related_searches: parents.flatMap(row => array(row.related_searches_json).map((query, index) => ({ snapshot_id: row.id, ordinal: index + 1, query }))) };
  }
  if (kind === 'geo') { const prompts = new Set(parents.map(row => row.prompt_id)); return { geo_prompts: rows('geo_prompts').filter(row => prompts.has(row.id)), geo_prompt_runs: parents, geo_answers_raw: rows('geo_answers_raw').filter(row => ids.has(row.run_id)), geo_citations: rows('geo_citations').filter(row => ids.has(row.run_id)), geo_run_metrics: rows('geo_run_metrics').filter(row => ids.has(row.run_id)) }; }
  if (kind === 'audit') { const targets = new Set(parents.map(row => row.target_id)); return { site_audit_targets: rows('site_audit_targets').filter(row => targets.has(row.id)), site_audit_scans: parents, site_audit_pages: rows('site_audit_pages').filter(row => ids.has(row.scan_id)), site_audit_issues: rows('site_audit_issues').filter(row => ids.has(row.scan_id)) }; }
  return Object.fromEntries(RAW_PARENTS.monitoring.map(table => [table, rows(table).filter(row => selectedTables?.has(`${table}:${row.id}`))]));
}
export function readRawData(db: HaloXDatabase, workspace: string, actor: string, kind: RawKind, input: unknown): RawData {
  const can_manage = observationAdmin(db, workspace, actor), { selected, filters, excluded_undated } = selectRaw(db, workspace, actor, kind, input), tables = rawTables(db, workspace, actor, kind, selected.map(item => item.row), new Set(selected.map(item => `${item.metadata.table}:${item.metadata.id}`)));
  const table_counts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])), total_rows = Object.values(table_counts).reduce((sum, count) => sum + count, 0);
  const allParents = sourceRows(db, workspace, actor, kind), batches = observationRows(db, workspace, actor, 'raw_import_batches').filter(row => row.kind === kind).map(row => ({ ...row, id: String(row.id), remaining_count: allParents.filter(item => item.metadata.import_batch_id === row.id).length }));
  const targets = kind === 'monitoring' ? [] : observationRows(db, workspace, actor, kind === 'seo' ? 'keywords' : kind === 'geo' ? 'geo_prompts' : 'site_audit_targets').filter(row => !row.deleted_at).map(row => ({ id: String(row.id), title: String(row.keyword || row.prompt_text || row.name), language: String(row.language || row.language_code || ''), country: String(row.country || row.location_code || '') }));
  return { kind, filters, records: selected.map(item => item.metadata), count: selected.length, table_counts, total_rows, download_allowed: total_rows <= 100000 && selected.length > 0, excluded_undated, can_manage, batches: batches as RawData['batches'], targets };
}
export function readRawDetail(db: HaloXDatabase, workspace: string, actor: string, kind: RawKind, id: string, table?: string): RawDetail {
  db.assertWorkspaceMember(workspace, actor); const matches = sourceRows(db, workspace, actor, kind).filter(row => row.metadata.id === id && (!table || row.metadata.table === table)); if (matches.length > 1) throw new Error('원본 테이블을 선택해 주세요.'); const item = matches[0]; if (!item) throw new Error('현재 워크스페이스에서 원본을 찾을 수 없습니다.');
  return { record: item.metadata, tables: rawTables(db, workspace, actor, kind, [item.row], new Set([`${item.metadata.table}:${item.metadata.id}`])) as RawDetail['tables'] };
}
export function downloadRawData(db: HaloXDatabase, workspace: string, actor: string, kind: RawKind, input: unknown) {
  const { selected, filters } = selectRaw(db, workspace, actor, kind, input), tables = rawTables(db, workspace, actor, kind, selected.map(item => item.row), new Set(selected.map(item => `${item.metadata.table}:${item.metadata.id}`))), total = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
  if (!selected.length) throw new Error('조건에 맞는 원본 자료가 없습니다.'); if (total > 100000) throw new Error('다운로드는 최대 100,000행입니다. 필터를 좁혀 주세요.');
  const readme = `HaloX 원본 자료 내보내기\n종류: ${kind}\n생성: ${new Date().toISOString()}\n조건: ${JSON.stringify(filters)}\n표본: ${selected.length}개 / 전체 CSV: ${total}행\n\nUTF-8 BOM CSV이며 중첩 객체/배열은 JSON 셀로 보존합니다. 비어 있는 표는 id 헤더만 있습니다. 수식으로 해석될 수 있는 셀은 작은따옴표로 시작합니다.\n현재 엔티티 정보와 수집 당시 측정값을 구분하세요. 가져온 자료는 provider=import:... 및 import_batch_id로 표시합니다. legacy-unverified 또는 Provider 미기록 자료는 실측으로 확인되지 않았습니다. 데모 수집값은 실제 시장 성과가 아닙니다.\n모니터링의 GSC/GA4 시드 자료는 실제 OAuth 동기화 결과가 아닙니다. 미수집/미측정 필드는 임의로 채우지 않습니다. 가져오기에는 별도 schema_version:1 JSON 양식을 사용하세요.\n`;
  return { filename: `halox-${kind}-${filters.start}-${filters.end}.zip`, bytes: rawZip({ 'README.txt': readme, ...Object.fromEntries(Object.entries(tables).map(([table, rows]) => [`${table}.csv`, rawCsv(rows)])) }) };
}
