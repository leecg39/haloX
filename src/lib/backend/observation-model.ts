import { RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { analysisFilters, analysisSummary, analysisWhere, latestAnalysis, readAnalysisData } from './analysis-model.ts';
import { defaultDashboardPreferences, type DashboardData, type ObservationSnapshot, type ObservationSeries } from '../api/observability.ts';
import { aviComposite, geoScore, seoScore } from '../metrics/index.ts';

export const observationRows = (db: HaloXDatabase, workspace: string, actor: string, table: string) => db.queryTable(table, { filters: analysisWhere(workspace), order: 'created_at.desc' }, actor).data;
export function observationAdmin(db: HaloXDatabase, workspace: string, actor: string, required = false) {
  db.assertWorkspaceMember(workspace, actor);
  const member = observationRows(db, workspace, actor, 'workspace_members').find(row => row.user_id === actor);
  const allowed = ['owner', 'admin'].includes(String(member?.role));
  if (required && !allowed) throw new RlsAccessDeniedError('감시 규칙과 자동 리포트 설정은 관리자만 변경할 수 있습니다.');
  return allowed;
}
export function observationDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('올바른 날짜를 입력해 주세요.');
  return value;
}
export function observationRange(days: number, now = Date.now()) {
  const end = new Date(now).toISOString().slice(0, 10), start = new Date(Date.parse(end) - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { start, end };
}
const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
const validScore = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

/** Uses the same denominators as the analysis pages, with no future observations. */
export function readObservationSnapshot(db: HaloXDatabase, workspace: string, actor: string, start: string, end: string, now = Date.now()): ObservationSnapshot {
  db.assertWorkspaceMember(workspace, actor);
  const filters = analysisFilters({ start, end }, 'seo'), rows = (table: string) => observationRows(db, workspace, actor, table);
  const series = (kind: 'seo' | 'geo'): ObservationSeries => {
    const data = readAnalysisData(db, workspace, actor, kind, filters);
    const previousData = readAnalysisData(db, workspace, actor, kind, { ...filters, ...data.previous_range });
    const samples = data.samples.filter(row => Date.parse(row.at) <= now), prior = previousData.samples.filter(row => Date.parse(row.at) <= now);
    const clean = (row: typeof samples[number]) => { const { answer: _answer, ...item } = row; return item; };
    return { summary: analysisSummary(kind === 'seo' ? latestAnalysis(samples) : samples), previous: analysisSummary(kind === 'seo' ? latestAnalysis(prior) : prior),
      latest: latestAnalysis(samples).map(clean), evidence: samples.map(clean),
      trend: [...new Set(samples.map(row => row.at.slice(0, 10)))].sort().map(day => { const items = samples.filter(row => row.at.startsWith(day)); return { day, summary: analysisSummary(kind === 'seo' ? latestAnalysis(items) : items) }; }) };
  };
  const seo = series('seo'), geo = series('geo'), length = Date.parse(end) - Date.parse(start) + 86400000;
  const scans = rows('site_audit_scans').filter(row => (row.provider === 'html' || row.import_batch_id && String(row.provider).startsWith('import:')) && row.status === 'completed' && validScore(row.site_health_score) && Date.parse(String(row.completed_at)) >= Date.parse(start) && Date.parse(String(row.completed_at)) < Date.parse(end) + 86400000 && Date.parse(String(row.completed_at)) <= now).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)) || String(b.id).localeCompare(String(a.id)));
  const seen = new Set<string>(), audits = scans.flatMap(row => { const key = String(row.target_id || row.target_url); if (seen.has(key)) return []; seen.add(key); return [{ id: String(row.id), name: String(row.name || row.target_url), url: String(row.target_url), score: Number(row.site_health_score), at: String(row.completed_at), provider: String(row.provider), import_batch_id: typeof row.import_batch_id === 'string' ? row.import_batch_id : null, source_url: String(row.source_url || ''), source_id: String(row.source_id || '') }]; });
  const health = average(audits.map(row => row.score)), s = seo.summary, g = geo.summary;
  const seoValue = s.rank_measured && s.aio_percent !== null ? seoScore({ avgPosition: s.average_rank, top10Rate: s.top10_percent!, aioCitationRate: s.aio_percent }) : null;
  // Rank scores are a separate provider measurement; source order is not mention rank.
  const metrics = rows('geo_run_metrics').filter(row => geo.evidence.some(run => run.id === row.run_id));
  const rankScores = (field: string) => metrics.length === geo.evidence.length && metrics.length && metrics.every(row => validScore(row[field])) ? average(metrics.map(row => Number(row[field]))) : null;
  const citationRank = rankScores('citation_rank_score'), mentionRank = rankScores('mention_rank_score');
  const geoValue = g.citation_percent !== null && g.mention_percent !== null && citationRank !== null && mentionRank !== null ? geoScore({ citationRate: g.citation_percent, mentionRate: g.mention_percent, citationRankScore: citationRank, mentionRankScore: mentionRank }) : null;
  const keywords = rows('keywords').filter(row => !row.deleted_at), prompts = rows('geo_prompts').filter(row => !row.deleted_at), jobs = rows('content_jobs'), active = (row: Row) => row.is_active !== false && !row.is_paused;
  return { schema_version: 1, generated_at: new Date(now).toISOString(), start, end, previous_start: new Date(Date.parse(start) - length).toISOString().slice(0, 10), previous_end: new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10), seo, geo, audits,
    scores: { seo: seoValue, geo: geoValue, avi: seoValue === null ? null : aviComposite({ seo: seoValue, geo: geoValue, webHealth: health }), web_health: health },
    counts: { keywords: keywords.length, active_keywords: keywords.filter(active).length, prompts: prompts.length, active_prompts: prompts.filter(active).length, content: jobs.length, ready_content: jobs.filter(row => row.status === 'ready').length },
    providers: [...new Set([...seo.evidence.map(row => row.provider), ...geo.evidence.map(row => row.provider), ...audits.map(row => row.provider)])].sort() };
}
export function readDashboard(db: HaloXDatabase, workspace: string, actor: string, now = Date.now()): DashboardData {
  db.assertWorkspaceMember(workspace, actor); const rows = (table: string) => observationRows(db, workspace, actor, table);
  const preferences = rows('dashboard_preferences').find(row => row.user_id === actor) as unknown as DashboardData['preferences'] || defaultDashboardPreferences();
  const range = observationRange(preferences.period_days, now);
  return { preferences, snapshot: readObservationSnapshot(db, workspace, actor, range.start, range.end, now),
    alerts: rows('geo_alerts').filter(row => row.status === 'open').slice(0, 5) as DashboardData['alerts'],
    reports: rows('report_snapshots').filter(row => row.schema_version === 1).slice(0, 5).map(({ snapshot: _snapshot, ...row }) => row) as DashboardData['reports'],
    jobs: rows('content_jobs').slice(0, 5) as DashboardData['jobs'] };
}
