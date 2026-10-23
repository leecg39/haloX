import type { ContentRow } from './content';

export const STRATEGY_TABLES = ['keyword_clusters', 'keyword_cluster_members', 'keyword_cluster_links', 'cluster_stats_history', 'cluster_batch_runs', 'keywords', 'keyword_prompt_links', 'geo_prompts', 'geo_prompt_runs', 'geo_run_metrics', 'serp_snapshots'] as const;
export const CLUSTER_PRIORITY = { high: '높음', normal: '보통', low: '낮음' } as const;
export const CLUSTER_RELATION = { related: '관련 주제', supports: '콘텐츠 지원' } as const;
export type ClusterStats = {
  keyword_ids: string[]; prompt_ids: string[]; keyword_count: number; active_count: number;
  volume_count: number; volume_sum: number | null; difficulty_count: number; avg_difficulty: number | null;
  measured_prompt_engines: number; cited_prompt_engines: number; citation_percent: number | null;
};
export type StrategyCluster = ContentRow & { stats: ClusterStats };
export type StrategyEdge = { source: string; target: string; keyword_count: number; prompt_count: number; manual_ids: string[] };
export type StrategyPreview = { algorithm: string; keyword_count: number; groups: { key: string; label: string; keyword_ids: string[]; cluster_id: string | null }[]; removed_ids: string[] };
export type StrategyData = Omit<Record<typeof STRATEGY_TABLES[number], ContentRow[]>, 'keyword_clusters'> & {
  keyword_clusters: StrategyCluster[]; source_revision: string; preview: StrategyPreview; edges: StrategyEdge[];
};
