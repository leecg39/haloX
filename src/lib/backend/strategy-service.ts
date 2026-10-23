import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { ContentConflictError, contentText } from './content-model.ts';
import { CLUSTER_PRIORITY, CLUSTER_RELATION } from '../api/strategy.ts';
import { clusterStats, readStrategyData, strategyWhere } from './strategy-model.ts';

export const STRATEGY_COMMANDS = ['cluster-create', 'cluster-update', 'cluster-delete', 'cluster-members-set', 'cluster-refresh', 'cluster-link-create', 'cluster-link-update', 'cluster-link-delete', 'cluster-history-update', 'cluster-history-delete', 'strategy-run-update', 'strategy-run-delete', 'strategy-map-orchestrator', 'strategy-map-cluster', 'strategy-map-preview', 'strategy-map-link-prompts'];
export class StrategyConflictError extends ContentConflictError {
  constructor() { super(); this.message = '전략맵 또는 원본 자료가 변경되었습니다. 입력을 유지했으니 최신 자료를 불러온 뒤 다시 확인해 주세요.'; }
}
const revision = (row: Row, expected: unknown) => { if (!Number.isSafeInteger(expected) || Number(row.revision || 0) !== expected) throw new StrategyConflictError(); };
function item(db: HaloXDatabase, table: string, workspace: string, id: unknown, actor: string) {
  if (typeof id !== 'string' || !id) throw new Error('전략맵 항목을 선택해 주세요.');
  const row = db.queryTable(table, { filters: strategyWhere(workspace, id) }, actor).data[0]; if (!row) throw new Error('현재 워크스페이스에서 전략맵 항목을 찾을 수 없습니다.'); return row;
}
function fields(db: HaloXDatabase, payload: Row, workspace: string, actor: string, id?: unknown) {
  const label = contentText(payload.label, '클러스터 이름', 100, true);
  if (!Object.hasOwn(CLUSTER_PRIORITY, String(payload.priority))) throw new Error('우선순위를 선택해 주세요.');
  if (db.queryTable('keyword_clusters', { filters: strategyWhere(workspace) }, actor).data.some(row => row.id !== id && String(row.label).normalize('NFKC').toLocaleLowerCase() === label.normalize('NFKC').toLocaleLowerCase())) throw new Error('같은 이름의 클러스터가 있습니다.');
  return { label, priority: payload.priority, notes: contentText(payload.notes, '클러스터 메모', 5000) };
}
function members(db: HaloXDatabase, workspace: string, value: unknown, actor: string): string[] {
  if (!Array.isArray(value) || value.length > 1000 || new Set(value).size !== value.length || value.some(id => typeof id !== 'string')) throw new Error('중복 없이 최대 1,000개의 키워드를 선택해 주세요.');
  for (const id of value) { const row = item(db, 'keywords', workspace, id, actor); if (row.deleted_at) throw new Error('삭제한 키워드는 연결할 수 없습니다.'); }
  return value;
}
function setMembers(db: HaloXDatabase, cluster: Row, ids: string[], workspace: string, actor: string) {
  db.deleteTable('keyword_cluster_members', { ...strategyWhere(workspace), cluster_id: `eq.${cluster.id}` }, actor);
  if (ids.length) db.insertTable('keyword_cluster_members', ids.map(keyword_id => ({ workspace_id: workspace, cluster_id: cluster.id, keyword_id })), actor);
}
function snapshot(db: HaloXDatabase, cluster: Row, workspace: string, actor: string, reason: string) {
  const data = Object.fromEntries(['keyword_cluster_members', 'keywords', 'keyword_prompt_links', 'geo_prompts', 'geo_prompt_runs', 'geo_run_metrics'].map(table => [table, db.queryTable(table, { filters: strategyWhere(workspace) }, actor).data]));
  const stats = clusterStats(data, String(cluster.id));
  const [history] = db.insertTable('cluster_stats_history', { workspace_id: workspace, cluster_id: cluster.id, cluster_label: cluster.label, captured_at: new Date().toISOString(), reason, stats_json: stats, keyword_snapshot: data.keywords.filter(row => stats.keyword_ids.includes(String(row.id))).map(row => ({ id: row.id, keyword: row.keyword, language: row.language, country: row.country })), notes: '', revision: 1 }, actor);
  return history;
}
const update = (db: HaloXDatabase, table: string, row: Row, values: Row, workspace: string, actor: string) => db.updateTable(table, { ...values, revision: Number(row.revision || 0) + 1 }, strategyWhere(workspace, row.id), actor)[0];

/** All mutations execute atomically inside the persistent store transaction. */
export function runStrategyCommand(db: HaloXDatabase, command: string, payload: Row, workspace: string, actor: string): Row {
  db.assertWorkspaceMember(workspace, actor);
  if (command === 'strategy-map-preview') { const data = readStrategyData(db, workspace, actor); return { ok: true, preview: data.preview, source_revision: data.source_revision }; }
  if (command === 'strategy-map-link-prompts') throw new Error('키워드의 프롬프트 연결 기능에서 실제 연결을 등록해 주세요.');
  if (command === 'strategy-map-orchestrator' || command === 'strategy-map-cluster') {
    const key = contentText(payload.idempotency_key, '요청 키', 100, true), fingerprint = crypto.createHash('sha256').update(JSON.stringify([payload.expected_source_revision, payload.confirm])).digest('hex');
    const requests = db.getServerRecords('strategy_requests'), prior = requests.find(row => row.workspace_id === workspace && row.actor_id === actor && row.key === key);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('같은 요청 키를 다른 재분석에 사용할 수 없습니다.'); return { ok: true, reused: true, run: item(db, 'cluster_batch_runs', workspace, prior.run_id, actor) }; }
    const data = readStrategyData(db, workspace, actor);
    if (payload.expected_source_revision !== data.source_revision) throw new StrategyConflictError();
    if (payload.confirm !== true) throw new Error('미리보기의 자동 그룹 변경을 확인해 주세요.');
    if (data.preview.keyword_count > 1000 || data.preview.groups.length + data.keyword_clusters.filter(row => row.origin !== 'lexical').length > 200) throw new Error('한 번에 키워드 1,000개, 전체 클러스터 200개까지 지원합니다.');
    for (const id of data.preview.removed_ids) db.deleteTable('keyword_clusters', strategyWhere(workspace, id), actor);
    const result: Row[] = [];
    for (const group of data.preview.groups) {
      let cluster = group.cluster_id ? item(db, 'keyword_clusters', workspace, group.cluster_id, actor) : undefined;
      if (cluster) cluster = update(db, 'keyword_clusters', cluster, {}, workspace, actor);
      else {
        let label = group.label, suffix = 1;
        const used = db.queryTable('keyword_clusters', { filters: strategyWhere(workspace) }, actor).data.map(row => String(row.label).normalize('NFKC').toLocaleLowerCase());
        while (used.includes(label.normalize('NFKC').toLocaleLowerCase())) label = `${group.label} (${++suffix})`;
        [cluster] = db.insertTable('keyword_clusters', { workspace_id: workspace, label, priority: 'normal', notes: '', origin: 'lexical', group_key: group.key, revision: 1 }, actor);
      }
      setMembers(db, cluster, group.keyword_ids, workspace, actor); const history = snapshot(db, cluster, workspace, actor, 'recluster'); result.push({ cluster_id: cluster.id, label: cluster.label, keyword_ids: group.keyword_ids, stats_json: history.stats_json });
    }
    const [run] = db.insertTable('cluster_batch_runs', { workspace_id: workspace, status: 'completed', algorithm: data.preview.algorithm, input_revision: data.source_revision, keyword_count: data.preview.keyword_count, cluster_count: result.length, clusters_snapshot: result, removed_cluster_ids: data.preview.removed_ids, notes: '', revision: 1 }, actor);
    db.setServerRecords('strategy_requests', [...requests, { workspace_id: workspace, actor_id: actor, key, fingerprint, run_id: run.id }]);
    return { ok: true, reused: false, run };
  }
  if (command.startsWith('cluster-link-')) {
    const row = command === 'cluster-link-create' ? undefined : item(db, 'keyword_cluster_links', workspace, payload.link_id, actor); if (row) revision(row, payload.expected_revision);
    if (command === 'cluster-link-delete') { db.deleteTable('keyword_cluster_links', strategyWhere(workspace, row!.id), actor); return { ok: true }; }
    item(db, 'keyword_clusters', workspace, payload.source_id, actor); item(db, 'keyword_clusters', workspace, payload.target_id, actor);
    if (payload.source_id === payload.target_id) throw new Error('서로 다른 클러스터를 연결해 주세요.');
    if (!Object.hasOwn(CLUSTER_RELATION, String(payload.relation))) throw new Error('관계 유형을 선택해 주세요.');
    if (db.queryTable('keyword_cluster_links', { filters: strategyWhere(workspace) }, actor).data.some(other => other.id !== row?.id && (other.source_id === payload.source_id && other.target_id === payload.target_id || other.source_id === payload.target_id && other.target_id === payload.source_id))) throw new Error('이미 연결된 클러스터입니다.');
    const values = { source_id: payload.source_id, target_id: payload.target_id, relation: payload.relation, notes: contentText(payload.notes, '관계 메모', 2000) };
    const link = row ? update(db, 'keyword_cluster_links', row, values, workspace, actor) : db.insertTable('keyword_cluster_links', { ...values, workspace_id: workspace, revision: 1 }, actor)[0]; return { ok: true, link };
  }
  if (command.startsWith('cluster-history-') || command.startsWith('strategy-run-')) {
    const table = command.startsWith('cluster-history-') ? 'cluster_stats_history' : 'cluster_batch_runs', row = item(db, table, workspace, payload.history_id, actor); revision(row, payload.expected_revision);
    if (command.endsWith('-delete')) { db.deleteTable(table, strategyWhere(workspace, row.id), actor); return { ok: true }; }
    return { ok: true, history: update(db, table, row, { notes: contentText(payload.notes, '이력 메모', 5000) }, workspace, actor) };
  }
  if (command === 'cluster-create') {
    const values = fields(db, payload, workspace, actor), ids = members(db, workspace, payload.keyword_ids, actor);
    if (db.queryTable('keyword_clusters', { filters: strategyWhere(workspace) }, actor).count >= 200) throw new Error('클러스터는 최대 200개까지 지원합니다.');
    const [cluster] = db.insertTable('keyword_clusters', { ...values, workspace_id: workspace, origin: 'manual', revision: 1 }, actor); setMembers(db, cluster, ids, workspace, actor); snapshot(db, cluster, workspace, actor, 'created'); return { ok: true, cluster };
  }
  const cluster = item(db, 'keyword_clusters', workspace, payload.cluster_id, actor); revision(cluster, payload.expected_revision);
  if (command === 'cluster-delete') { db.deleteTable('keyword_clusters', strategyWhere(workspace, cluster.id), actor); return { ok: true }; }
  if (command === 'cluster-update') return { ok: true, cluster: update(db, 'keyword_clusters', cluster, fields(db, payload, workspace, actor, cluster.id), workspace, actor) };
  if (command === 'cluster-members-set') {
    const ids = members(db, workspace, payload.keyword_ids, actor); setMembers(db, cluster, ids, workspace, actor); const updated = update(db, 'keyword_clusters', cluster, {}, workspace, actor); snapshot(db, updated, workspace, actor, 'members_changed'); return { ok: true, cluster: updated };
  }
  if (command === 'cluster-refresh') { const updated = update(db, 'keyword_clusters', cluster, {}, workspace, actor); return { ok: true, cluster: updated, history: snapshot(db, updated, workspace, actor, 'refreshed') }; }
  throw new Error('지원하지 않는 전략맵 작업입니다.');
}
