import type { ContentRow } from './content';
import type { AnalysisSummary, AnalysisSample } from './analyses';

export const DASHBOARD_PANELS = { scores: '가시성 지표', seo: '검색 현황', geo: 'AI 질문 현황', audit: '사이트 진단', activity: '알림·최근 작업' };
export type DashboardPanel = keyof typeof DASHBOARD_PANELS;
export type DashboardPreferences = { id?: string; revision: number; period_days: number; panels: DashboardPanel[]; sort: 'rank' | 'recent' };
export const defaultDashboardPreferences = (): DashboardPreferences => ({ revision: 0, period_days: 28, panels: Object.keys(DASHBOARD_PANELS) as DashboardPanel[], sort: 'rank' });
export const MONITOR_METRICS = { seo_top10: '검색 Top 10 비율', seo_rank: '검색 평균 순위', geo_citation: 'AI 인용률', geo_mention: 'AI 멘션율', audit_health: 'HTML 건강도' };
export type MonitorMetric = keyof typeof MONITOR_METRICS;
export const MONITOR_OPERATORS = { lt: '미만', lte: '이하', gt: '초과', gte: '이상' };
export const MONITOR_STATES = { unknown: '아직 평가하지 않음', alert: '조건 충족', ok: '정상 범위', insufficient: '측정 자료 부족', error: '평가 오류' };
export type ObservationSeries = { summary: AnalysisSummary; previous: AnalysisSummary; trend: { day: string; summary: AnalysisSummary }[]; latest: Omit<AnalysisSample, 'answer'>[]; evidence: Omit<AnalysisSample, 'answer'>[] };
export type ObservationSnapshot = {
  schema_version: 1; generated_at: string; start: string; end: string; previous_start: string; previous_end: string;
  seo: ObservationSeries; geo: ObservationSeries;
  audits: { id: string; name: string; score: number; at: string; url: string; provider?: string; import_batch_id?: string | null; source_url?: string; source_id?: string }[];
  scores: { seo: number | null; geo: number | null; avi: number | null; web_health: number | null };
  counts: { keywords: number; active_keywords: number; prompts: number; active_prompts: number; content: number; ready_content: number };
  providers: string[];
};
export type DashboardData = { preferences: DashboardPreferences; snapshot: ObservationSnapshot; alerts: ContentRow[]; reports: ContentRow[]; jobs: ContentRow[] };
export type MonitoringData = { rules: ContentRow[]; alerts: ContentRow[]; events: ContentRow[]; can_manage: boolean };
export type ReportData = { reports: ContentRow[]; report?: ContentRow; summaries: ContentRow[]; actions: ContentRow[]; preferences: ContentRow | null; can_manage: boolean };
