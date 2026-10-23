import crypto from 'node:crypto';
import { STRATEGY_TABLES, type ClusterStats, type StrategyData, type StrategyEdge, type StrategyPreview } from '../api/strategy.ts';
import type { HaloXDatabase, Row } from './database.ts';

export const strategyWhere = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id ? { id: `eq.${String(id)}` } : {}) });
export const activeKeyword = (row: Row) => !row.deleted_at && row.is_active !== false && !row.is_paused;
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const latest = (rows: Row[], key: (row: Row) => string, time: (row: Row) => string) => {
  const result = new Map<string, Row>();
  for (const row of [...rows].sort((a, b) => time(b).localeCompare(time(a)) || String(b.id).localeCompare(String(a.id)))) if (!result.has(key(row))) result.set(key(row), row);
  return [...result.values()];
};

/** Live aggregation never trusts the old stored demo stats_json or embedded keyword copies. */
export function clusterStats(data: Record<string, Row[]>, clusterId: string): ClusterStats {
  const ids = new Set(data.keyword_cluster_members.filter(row => row.cluster_id === clusterId).map(row => String(row.keyword_id)));
  const keywords = data.keywords.filter(row => ids.has(String(row.id)) && !row.deleted_at);
  const keywordIds = new Set(keywords.map(row => String(row.id)));
  const linked = new Set(data.keyword_prompt_links.filter(row => keywordIds.has(String(row.keyword_id))).map(row => String(row.prompt_id)));
  const prompts = data.geo_prompts.filter(row => linked.has(String(row.id)) && !row.deleted_at), promptIds = new Set(prompts.map(row => String(row.id)));
  // Ignore runs for a previous question. Count only the latest completed run per question/engine.
  const runs = latest(data.geo_prompt_runs.filter(row => {
    const prompt = prompts.find(prompt => prompt.id === row.prompt_id);
    return row.status === 'completed' && prompt && row.prompt_text === prompt.prompt_text && row.language_code === prompt.language_code && row.location_code === prompt.location_code;
  }), row => `${row.prompt_id}:${row.engine}`, row => String(row.finished_at || row.created_at || ''));
  const metrics = runs.flatMap(run => data.geo_run_metrics.filter(row => row.run_id === run.id).slice(0, 1)).filter(row => typeof row.is_cited === 'boolean');
  const volumes = keywords.filter(row => finite(row.search_volume)), difficulty = keywords.filter(row => finite(row.keyword_difficulty) && Number(row.keyword_difficulty) <= 100);
  return { keyword_ids: [...keywordIds].sort(), prompt_ids: [...promptIds].sort(), keyword_count: keywords.length, active_count: keywords.filter(activeKeyword).length,
    volume_count: volumes.length, volume_sum: volumes.length ? volumes.reduce((sum, row) => sum + Number(row.search_volume), 0) : null,
    difficulty_count: difficulty.length, avg_difficulty: difficulty.length ? Math.round(difficulty.reduce((sum, row) => sum + Number(row.keyword_difficulty), 0) / difficulty.length * 10) / 10 : null,
    measured_prompt_engines: metrics.length, cited_prompt_engines: metrics.filter(row => row.is_cited).length, citation_percent: metrics.length ? Math.round(metrics.filter(row => row.is_cited).length / metrics.length * 100) : null };
}

export function strategyPreview(data: Record<string, Row[]>): StrategyPreview {
  const keywords = data.keywords.filter(activeKeyword), grouped = new Map<string, { key: string; label: string; keyword_ids: string[]; cluster_id: string | null }>();
  for (const keyword of keywords) {
    const normalized = String(keyword.keyword).normalize('NFKC').toLocaleLowerCase(), token = normalized.match(/[\p{L}\p{N}]+/u)?.[0] || normalized;
    const key = JSON.stringify([keyword.language || 'ko', keyword.country || 'KR', token]);
    if (!grouped.has(key)) grouped.set(key, { key, label: `${token.slice(0, 55)} · ${keyword.language || 'ko'}/${keyword.country || 'KR'}`, keyword_ids: [], cluster_id: String(data.keyword_clusters.find(row => row.origin === 'lexical' && row.group_key === key)?.id || '') || null });
    grouped.get(key)!.keyword_ids.push(String(keyword.id));
  }
  const groups = [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key)); groups.forEach(group => group.keyword_ids.sort());
  return { algorithm: 'first-term-v1', keyword_count: keywords.length, groups, removed_ids: data.keyword_clusters.filter(row => row.origin === 'lexical' && !grouped.has(String(row.group_key))).map(row => String(row.id)) };
}

export function readStrategyData(db: HaloXDatabase, workspace: string, actor: string): StrategyData {
  db.assertWorkspaceMember(workspace, actor);
  const raw = Object.fromEntries(STRATEGY_TABLES.map(table => [table, db.queryTable(table, { filters: strategyWhere(workspace), order: 'created_at.desc' }, actor).data]));
  const source = STRATEGY_TABLES.filter(table => !['cluster_stats_history', 'cluster_batch_runs'].includes(table)).map(table => [table, [...raw[table]].sort((a, b) => String(a.id).localeCompare(String(b.id)))]);
  const clusters = raw.keyword_clusters.map(cluster => ({ ...cluster, id: String(cluster.id), stats: clusterStats(raw, String(cluster.id)) }));
  const edges: StrategyEdge[] = [];
  for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
    const a = clusters[i], b = clusters[j], keywordCount = a.stats.keyword_ids.filter(id => b.stats.keyword_ids.includes(id)).length, promptCount = a.stats.prompt_ids.filter(id => b.stats.prompt_ids.includes(id)).length;
    const manual = raw.keyword_cluster_links.filter(row => row.source_id === a.id && row.target_id === b.id || row.source_id === b.id && row.target_id === a.id);
    if (keywordCount || promptCount || manual.length) edges.push({ source: String(a.id), target: String(b.id), keyword_count: keywordCount, prompt_count: promptCount, manual_ids: manual.map(row => String(row.id)) });
  }
  return { ...raw, keyword_clusters: clusters, source_revision: crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex'), preview: strategyPreview(raw), edges } as StrategyData;
}
