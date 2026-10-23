import type { ContentRow } from './content';

export type AnalysisKind = 'seo' | 'geo';
export type AnalysisFilters = { start: string; end: string; query: string; language: string; country: string; set_id: string; tag_id: string; engine: string; status: 'all' | 'active' | 'paused'; domain: string };
export type AnalysisSource = { url: string; domain: string; rank: number | null; ours: boolean; competitor: boolean };
export type AnalysisSample = {
  id: string; entity_id: string; text: string; engine: string; at: string; provider: string; language: string; country: string; domain: string;
  rank: number | null; rank_measured: boolean; volume: number | null; difficulty: number | null;
  aio_detected: boolean | null; aio_cited: boolean | null; mentioned: boolean | null; cited: boolean | null;
  sources: AnalysisSource[]; answer: string;
};
export type AnalysisSummary = { samples: number; entities: number; ranked: number; rank_measured: number; average_rank: number | null; top10: number; top10_percent: number | null; aio_detected: number; aio_measured: number; aio_cited: number; aio_percent: number | null; mention_measured: number; mentioned: number; mention_percent: number | null; citation_measured: number; cited: number; citation_percent: number | null };
export type AnalysisEntity = { id: string; text: string; language: string; country: string; active: boolean; set_id: string | null };
export type AnalysisDomain = { domain: string; occurrences: number; samples: number; ours: number; competitor: number; average_rank: number | null; urls: string[] };
export type AnalysisData = {
  kind: AnalysisKind; filters: AnalysisFilters; previous_range: { start: string; end: string }; generated_at: string;
  saved: ContentRow[]; sets: ContentRow[]; tags: ContentRow[]; entities: AnalysisEntity[];
  samples: AnalysisSample[]; latest: AnalysisSample[]; previous_latest: AnalysisSample[];
  summary: AnalysisSummary; previous: AnalysisSummary;
  engines: { engine: string; current: AnalysisSummary; previous: AnalysisSummary }[];
  trend: { day: string; summary: AnalysisSummary }[]; domains: AnalysisDomain[];
  excluded_records: number;
};
export function defaultAnalysisFilters(now = new Date()): AnalysisFilters {
  const end = now.toISOString().slice(0, 10), start = new Date(Date.parse(end) - 27 * 86400000).toISOString().slice(0, 10);
  return { start, end, query: '', language: '', country: '', set_id: '', tag_id: '', engine: '', status: 'all', domain: '' };
}
