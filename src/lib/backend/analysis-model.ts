import type { HaloXDatabase, Row } from './database.ts';
import { GEO_ENGINES } from '../api/prompts.ts';
import { defaultAnalysisFilters, type AnalysisKind, type AnalysisFilters, type AnalysisSample, type AnalysisSource, type AnalysisSummary, type AnalysisData } from '../api/analyses.ts';

export const analysisWhere = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id ? { id: `eq.${String(id)}` } : {}) });
export function analysisKind(value: unknown): AnalysisKind { if (value !== 'seo' && value !== 'geo') throw new Error('분석 종류를 확인해 주세요.'); return value; }
export function analysisFilters(input: unknown, kind: AnalysisKind): AnalysisFilters {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('분석 조건을 확인해 주세요.');
  const defaults = defaultAnalysisFilters(), value = input as Row;
  if (Object.keys(value).some(key => !(key in defaults))) throw new Error('지원하지 않는 분석 조건입니다.');
  const f = { ...defaults, ...value } as AnalysisFilters;
  if (Object.values(f).some(item => typeof item !== 'string')) throw new Error('분석 조건은 문자열로 입력해 주세요.');
  for (const key of Object.keys(f) as (keyof AnalysisFilters)[]) f[key] = f[key].trim() as never;
  if ([f.start, f.end].some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('분석 날짜를 확인해 주세요.');
  const days = (Date.parse(f.end) - Date.parse(f.start)) / 86400000 + 1;
  if (days < 1 || days > 366) throw new Error('분석 기간은 시작일부터 최대 366일입니다.');
  if (f.query.length > 200 || f.set_id.length > 100 || f.tag_id.length > 100 || f.language && !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(f.language) || f.country && !/^[A-Z]{2}$/.test(f.country)) throw new Error('검색어·언어·국가 조건을 확인해 주세요.');
  if (!['all', 'active', 'paused'].includes(f.status)) throw new Error('추적 상태를 확인해 주세요.');
  if (f.engine && !(kind === 'seo' ? ['google', 'naver'] : Object.keys(GEO_ENGINES)).includes(f.engine)) throw new Error('지원하지 않는 분석 엔진입니다.');
  f.domain = f.domain.toLowerCase();
  if (f.domain && (kind !== 'seo' || f.domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(f.domain))) throw new Error('SEO 비교 도메인은 example.com 형식으로 입력해 주세요.');
  return f;
}
export function validateAnalysisReferences(db: HaloXDatabase, workspace: string, actor: string, kind: AnalysisKind, f: AnalysisFilters) {
  for (const [id, table, label] of [[f.set_id, kind === 'seo' ? 'keyword_sets' : 'geo_prompt_sets', '세트'], [f.tag_id, 'workspace_tags', '태그']]) if (id && !db.queryTable(table, { filters: analysisWhere(workspace, id) }, actor).count) throw new Error(`${label}가 삭제되었거나 다른 워크스페이스의 항목입니다. 분석 조건에서 다시 선택해 주세요.`);
}
const number = (value: unknown, max = Infinity): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
const rank = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const list = (value: unknown): Row[] => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const host = (value: unknown) => { try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase() : ''; } catch { return ''; } };
export const domainMatches = (source: string, domain: string) => !!domain && (source === domain || source.endsWith(`.${domain}`));
const ratio = (numerator: number, denominator: number) => denominator ? Math.round(1000 * numerator / denominator) / 10 : null;
const average = (values: (number | null)[]) => { const rows = values.filter((value): value is number => value !== null); return rows.length ? Math.round(rows.reduce((sum, value) => sum + value, 0) / rows.length * 10) / 10 : null; };
export function latestAnalysis(samples: AnalysisSample[]) {
  const latest = new Map<string, AnalysisSample>();
  for (const sample of [...samples].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))) { const key = `${sample.entity_id}:${sample.engine}`; if (!latest.has(key)) latest.set(key, sample); }
  return [...latest.values()];
}
export function analysisSummary(samples: AnalysisSample[]): AnalysisSummary {
  const ranks = samples.filter(row => row.rank_measured), top10 = ranks.filter(row => row.rank !== null && row.rank <= 10).length;
  const aio = samples.filter(row => row.aio_detected === true && row.aio_cited !== null), citedAio = aio.filter(row => row.aio_cited).length;
  const mentions = samples.filter(row => row.mentioned !== null), mentioned = mentions.filter(row => row.mentioned).length;
  const citations = samples.filter(row => row.cited !== null), cited = citations.filter(row => row.cited).length;
  return { samples: samples.length, entities: new Set(samples.map(row => row.entity_id)).size, ranked: ranks.filter(row => row.rank !== null).length, rank_measured: ranks.length, average_rank: average(ranks.map(row => row.rank)), top10, top10_percent: ratio(top10, ranks.length), aio_detected: samples.filter(row => row.aio_detected).length, aio_measured: aio.length, aio_cited: citedAio, aio_percent: ratio(citedAio, aio.length), mention_measured: mentions.length, mentioned, mention_percent: ratio(mentioned, mentions.length), citation_measured: citations.length, cited, citation_percent: ratio(cited, citations.length) };
}
function seoSample(snapshot: Row, entity: Row, domain: string, explicitDomain = false): AnalysisSample {
  const classification = !explicitDomain ? snapshot.brand_classification as Row | undefined : undefined;
  if (classification) domain = Array.isArray(classification.domains) ? classification.domains.join(', ') : '';
  const seen = new Set<string>();
  const sources: AnalysisSource[] = list(snapshot.top_results_json).sort((a, b) => (rank(a.rank) ?? Infinity) - (rank(b.rank) ?? Infinity)).flatMap(row => { const domainName = host(row.url), url = String(row.url); if (!domainName || seen.has(url)) return []; seen.add(url); const derived = classification && list(classification.sources).find(item => item.url === row.url); return [{ url, domain: domainName, rank: rank(row.rank), ours: classification ? derived?.is_ours === true : domainMatches(domainName, domain), competitor: derived?.is_competitor === true }]; });
  const ours = sources.filter(row => row.ours && row.rank !== null).map(row => row.rank!);
  const citedDomains = (snapshot.ai_overview_json as Row | undefined)?.cited_domains;
  return { id: String(snapshot.id), entity_id: String(entity.id), text: String(entity.keyword), engine: String(snapshot.engine), at: new Date(String(snapshot.captured_at)).toISOString(), provider: String(snapshot.provider || '미기록'), language: String(entity.language), country: String(entity.country), domain,
    rank: classification ? rank(classification.rank) : ours.length ? Math.min(...ours) : null, rank_measured: classification ? classification.rank_measured === true : !!domain && Array.isArray(snapshot.top_results_json), volume: number(snapshot.search_volume), difficulty: number(snapshot.keyword_difficulty, 100),
    aio_detected: bool(snapshot.ai_overview_detected), aio_cited: classification ? bool(classification.aio_cited) : domain && Array.isArray(citedDomains) ? citedDomains.some(value => typeof value === 'string' && domainMatches(value.toLowerCase(), domain)) : null, mentioned: null, cited: null, sources, answer: '' };
}
function geoSample(run: Row, entity: Row, metrics: Row[], citations: Row[]): AnalysisSample {
  const classification = run.brand_classification as Row | undefined;
  const metric = metrics.find(row => row.run_id === run.id), seen = new Set<string>();
  const sources = citations.filter(row => row.run_id === run.id).flatMap(row => {
    const domain = host(row.cited_url), key = String(row.cited_url); if (!domain || seen.has(key)) return []; seen.add(key);
    return [{ url: key, domain, rank: rank(row.position_index), ours: row.is_ours === true, competitor: row.is_competitor === true }];
  });
  return { id: String(run.id), entity_id: String(entity.id), text: String(entity.prompt_text), engine: String(run.engine), at: new Date(String(run.finished_at)).toISOString(), provider: String(run.provider || '미기록'), language: String(entity.language_code), country: String(entity.location_code), domain: classification && Array.isArray(classification.domains) ? classification.domains.join(', ') : String(run.brand_domain || ''), rank: null, rank_measured: false, volume: null, difficulty: null, aio_detected: null, aio_cited: null, mentioned: classification ? bool(classification.mentioned) : run.brand_domain === '' ? null : bool(metric?.brand_mentioned), cited: classification ? bool(classification.cited) : run.brand_domain === '' ? null : bool(metric?.is_cited), sources, answer: String(run.answer_text || '') };
}
export function readAnalysisData(db: HaloXDatabase, workspace: string, actor: string, kind: AnalysisKind, input: unknown): AnalysisData {
  db.assertWorkspaceMember(workspace, actor); const filters = analysisFilters(input, kind); validateAnalysisReferences(db, workspace, actor, kind, filters);
  const rows = (table: string) => db.queryTable(table, { filters: analysisWhere(workspace), order: 'created_at.desc' }, actor).data;
  const sets = rows(kind === 'seo' ? 'keyword_sets' : 'geo_prompt_sets'), tags = rows('workspace_tags'), assignments = rows(kind === 'seo' ? 'keyword_tag_assignments' : 'geo_prompt_tag_assignments');
  const fields = kind === 'seo' ? { text: 'keyword', set: 'keyword_set_id', language: 'language', country: 'country', ref: 'keyword_id' } : { text: 'prompt_text', set: 'prompt_set_id', language: 'language_code', country: 'location_code', ref: 'prompt_id' };
  const active = (row: Row) => row.is_active !== false && !row.is_paused;
  const entities = rows(kind === 'seo' ? 'keywords' : 'geo_prompts').filter(row => !row.deleted_at && (!filters.query || String(row[fields.text]).toLocaleLowerCase().includes(filters.query.toLocaleLowerCase())) && (!filters.language || row[fields.language] === filters.language) && (!filters.country || row[fields.country] === filters.country) && (!filters.set_id || row[fields.set] === filters.set_id) && (!filters.tag_id || assignments.some(tag => tag[fields.ref] === row.id && tag.tag_id === filters.tag_id)) && (filters.status === 'all' || active(row) === (filters.status === 'active')));
  const index = new Map(entities.map(row => [row.id, row])), start = Date.parse(filters.start), end = Date.parse(filters.end) + 86400000, previousStart = start - (end - start);
  const workspaceRow = db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }, actor).data[0];
  const metrics = kind === 'geo' ? rows('geo_run_metrics') : [], citations = kind === 'geo' ? rows('geo_citations') : [];
  let excluded = 0;
  const all: AnalysisSample[] = [];
  for (const row of rows(kind === 'seo' ? 'serp_snapshots' : 'geo_prompt_runs')) {
    const entity = index.get(row[fields.ref]); if (!entity || filters.engine && filters.engine !== row.engine) continue;
    const at = Date.parse(String(kind === 'seo' ? row.captured_at : row.finished_at));
    if (!Number.isFinite(at)) { excluded++; continue; } if (at < previousStart || at >= end) continue;
    const matching = kind === 'seo' ? (row.keyword_text === undefined || row.keyword_text === entity.keyword) && row.language === entity.language && row.country === entity.country : row.status === 'completed' && row.prompt_text === entity.prompt_text && row.language_code === entity.language_code && row.location_code === entity.location_code;
    if (!matching) { excluded++; continue; }
    const domain = filters.domain || String(sets.find(set => set.id === entity[fields.set])?.target_domain || workspaceRow?.default_brand_filter || '').toLowerCase();
    all.push(kind === 'seo' ? seoSample(row, entity, domain, !!filters.domain) : geoSample(row, entity, metrics, citations));
  }
  const samples = all.filter(row => Date.parse(row.at) >= start).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)), previousSamples = all.filter(row => Date.parse(row.at) < start), latest = latestAnalysis(samples), previousLatest = latestAnalysis(previousSamples);
  const currentRows = kind === 'seo' ? latest : samples, previousRows = kind === 'seo' ? previousLatest : previousSamples;
  const domainMap = new Map<string, { sources: AnalysisSource[]; samples: Set<string> }>();
  for (const sample of currentRows) for (const source of sample.sources) { const item = domainMap.get(source.domain) || { sources: [], samples: new Set<string>() }; item.sources.push(source); item.samples.add(sample.id); domainMap.set(source.domain, item); }
  const days = [...new Set(samples.map(row => row.at.slice(0, 10)))].sort();
  return { kind, filters, previous_range: { start: new Date(previousStart).toISOString().slice(0, 10), end: new Date(start - 86400000).toISOString().slice(0, 10) }, generated_at: new Date().toISOString(),
    saved: rows('saved_analyses').filter(row => row.kind === kind) as AnalysisData['saved'], sets: sets as AnalysisData['sets'], tags: tags as AnalysisData['tags'], entities: entities.map(row => ({ id: String(row.id), text: String(row[fields.text]), language: String(row[fields.language]), country: String(row[fields.country]), active: active(row), set_id: row[fields.set] ? String(row[fields.set]) : null })),
    samples, latest, previous_latest: previousLatest, summary: analysisSummary(currentRows), previous: analysisSummary(previousRows),
    engines: [...new Set([...currentRows, ...previousRows].map(row => row.engine))].sort().map(engine => ({ engine, current: analysisSummary(currentRows.filter(row => row.engine === engine)), previous: analysisSummary(previousRows.filter(row => row.engine === engine)) })),
    trend: days.map(day => { const items = samples.filter(row => row.at.startsWith(day)); return { day, summary: analysisSummary(kind === 'seo' ? latestAnalysis(items) : items) }; }),
    domains: [...domainMap].map(([domain, item]) => ({ domain, occurrences: item.sources.length, samples: item.samples.size, ours: item.sources.filter(row => row.ours).length, competitor: item.sources.filter(row => row.competitor).length, average_rank: average(item.sources.map(row => row.rank)), urls: [...new Set(item.sources.map(row => row.url))] })).sort((a, b) => b.samples - a.samples || a.domain.localeCompare(b.domain)), excluded_records: excluded };
}
