import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, ISOLATED_WORKSPACE_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { readStrategyData } from './strategy-model.ts';
import { StrategyConflictError } from './strategy-service.ts';
import { assertRestWrite } from './rest-policy.ts';

type R = Row & { id: string; revision: number };
type Result = { cluster: R; history: R; link: R; run: R; reused: boolean; source_revision: string };
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-strategy-')); directories.push(directory); const filename = path.join(directory, 'db.sqlite'), store = new PersistentHaloXStore(filename);
  const ws = await store.write(db => db.insertTable('workspaces', { name: '전략 검증' }, ACTOR)[0]); const workspace = String(ws.id);
  const invoke = (name: string, values: Row = {}, actor = ACTOR) => store.write(db => db.invokeEdgeFunction(name, { workspace_id: workspace, ...values }, actor)) as Promise<Result>;
  const insert = (table: string, values: Row) => store.write(db => db.insertTable(table, { ...values, workspace_id: workspace }, ACTOR)[0]) as Promise<R>;
  const data = () => store.read(db => readStrategyData(db, workspace, ACTOR));
  const keyword = (name: string, values: Row = {}) => insert('keywords', { keyword: name, search_volume: 100, keyword_difficulty: 20, ...values });
  const create = (label: string, ids: string[] = []) => invoke('cluster-create', { label, priority: 'normal', notes: '', keyword_ids: ids });
  const run = async (key = 'run-once') => { const source = (await data()).source_revision, payload = { expected_source_revision: source, confirm: true, idempotency_key: key }; return { result: await invoke('strategy-map-orchestrator', payload), payload }; };
  return { filename, store, workspace, invoke, insert, data, keyword, create, run };
}

describe('strategy map CRUD and live aggregation', () => {
  it('validates manual groups and memberships, rejects stale writes and preserves failed transactions', async () => {
    const f = await fixture(), a = await f.keyword('SEO 시작'), b = await f.keyword('SEO 가이드');
    for (const values of [{ label: '' }, { priority: 'urgent' }, { keyword_ids: [a.id, a.id] }, { keyword_ids: ['31000000-0000-4000-8000-000000000099'] }]) await assert.rejects(f.invoke('cluster-create', { label: '기초', priority: 'normal', keyword_ids: [a.id], ...values }));
    assert.equal((await f.data()).keyword_clusters.length, 0);
    const { cluster } = await f.create('기초', [a.id]); await assert.rejects(f.create(' 기초 '), /같은 이름/);
    await f.invoke('cluster-update', { cluster_id: cluster.id, expected_revision: 1, label: '기초 안내', notes: '편집 메모', priority: 'high' });
    await assert.rejects(f.invoke('cluster-members-set', { cluster_id: cluster.id, expected_revision: 1, keyword_ids: [b.id] }), StrategyConflictError);
    await f.invoke('cluster-members-set', { cluster_id: cluster.id, expected_revision: 2, keyword_ids: [a.id, b.id] });
    const data = await f.data(); assert.equal(data.keyword_clusters[0].stats.keyword_count, 2); assert.equal(data.keyword_clusters[0].stats.volume_sum, 200); assert.equal(data.keyword_clusters[0].notes, '편집 메모'); assert.equal(data.cluster_stats_history.length, 2);
    await f.invoke('cluster-members-set', { cluster_id: cluster.id, expected_revision: 3, keyword_ids: [] }); assert.equal((await f.data()).keyword_clusters[0].stats.volume_sum, null);
  });

  it('recomputes current values and unique latest prompt/engine evidence while historical snapshots remain fixed', async () => {
    const f = await fixture(), a = await f.keyword('검색 안내'), b = await f.keyword('검색 비교', { search_volume: null, keyword_difficulty: null }), { cluster } = await f.create('검색 그룹', [a.id, b.id]);
    const prompt = await f.insert('geo_prompts', { prompt_text: '검색 방법은?', language_code: 'ko', location_code: 'KR', category: 'informational', engines: ['openai'] });
    for (const keyword of [a, b]) await f.insert('keyword_prompt_links', { keyword_id: keyword.id, prompt_id: prompt.id });
    for (const [engine, at, cited, question] of [['openai', '2026-10-21', false, '검색 방법은?'], ['openai', '2026-10-22', true, '검색 방법은?'], ['gemini', '2026-10-22', false, '검색 방법은?'], ['claude', '2026-10-23', true, '이전 질문']] as const) {
      const run = await f.insert('geo_prompt_runs', { prompt_id: prompt.id, prompt_text: question, language_code: 'ko', location_code: 'KR', engine, status: 'completed', finished_at: at }); await f.insert('geo_run_metrics', { run_id: run.id, is_cited: cited });
    }
    let data = await f.data(), stats = data.keyword_clusters[0].stats;
    assert.equal(stats.volume_count, 1); assert.equal(stats.avg_difficulty, 20); assert.equal(stats.measured_prompt_engines, 2); assert.equal(stats.citation_percent, 50); assert.equal(stats.prompt_ids.length, 1);
    const otherLocale = await f.insert('geo_prompt_runs', { prompt_id: prompt.id, prompt_text: '검색 방법은?', language_code: 'en', location_code: 'US', engine: 'claude', status: 'completed', finished_at: '2026-10-23' }); await f.insert('geo_run_metrics', { run_id: otherLocale.id, is_cited: true }); assert.equal((await f.data()).keyword_clusters[0].stats.measured_prompt_engines, 2);
    await f.invoke('cluster-refresh', { cluster_id: cluster.id, expected_revision: 1 });
    await f.store.write(db => db.updateTable('keywords', { keyword: '수정한 키워드' }, { id: `eq.${a.id}` }, ACTOR));
    data = await f.data(); assert.equal(data.keyword_clusters[0].stats.volume_sum, null); assert.equal(data.keyword_clusters[0].stats.avg_difficulty, null);
    assert.ok(data.cluster_stats_history.some(row => (row.stats_json as Row).volume_sum === 100));
    await f.store.write(db => db.updateTable('geo_prompts', { prompt_text: '새 질문' }, { id: `eq.${prompt.id}` }, ACTOR)); assert.equal((await f.data()).keyword_clusters[0].stats.citation_percent, null);
  });

  it('derives graph edges from shared sources and supports validated directional relationship CRUD', async () => {
    const f = await fixture(), keyword = await f.keyword('공유 자료'), a = (await f.create('A', [keyword.id])).cluster, b = (await f.create('B', [keyword.id])).cluster, c = (await f.create('C')).cluster;
    let data = await f.data(); assert.equal(data.edges.length, 1); assert.equal(data.edges[0].keyword_count, 1);
    await assert.rejects(f.invoke('cluster-link-create', { source_id: a.id, target_id: a.id, relation: 'related' }), /서로 다른/);
    await assert.rejects(f.invoke('cluster-link-create', { source_id: a.id, target_id: 'unknown', relation: 'related' }), /찾을 수 없습니다/);
    const { link } = await f.invoke('cluster-link-create', { source_id: a.id, target_id: c.id, relation: 'supports', notes: '전환 지원' });
    await assert.rejects(f.invoke('cluster-link-create', { source_id: c.id, target_id: a.id, relation: 'related' }), /이미 연결/);
    await f.invoke('cluster-link-update', { link_id: link.id, expected_revision: 1, source_id: c.id, target_id: b.id, relation: 'related', notes: '새 연결' });
    await assert.rejects(f.invoke('cluster-link-delete', { link_id: link.id, expected_revision: 1 }), StrategyConflictError);
    data = await f.data(); assert.equal(data.edges.length, 2); assert.equal(data.keyword_cluster_links[0].notes, '새 연결');
    await f.invoke('cluster-link-delete', { link_id: link.id, expected_revision: 2 }); assert.equal((await f.data()).edges.length, 1);
  });

  it('cascades group deletion without deleting source keywords, and keyword deletion updates graph/live counts', async () => {
    const f = await fixture(), keyword = await f.keyword('원본 보존'), a = (await f.create('A', [keyword.id])).cluster, b = (await f.create('B', [keyword.id])).cluster;
    await f.invoke('cluster-link-create', { source_id: a.id, target_id: b.id, relation: 'supports' });
    await f.invoke('cluster-delete', { cluster_id: a.id, expected_revision: 1 }); let data = await f.data();
    assert.equal(data.keywords.length, 1); assert.equal(data.keyword_cluster_links.length, 0); assert.equal(data.cluster_stats_history.length, 1); assert.equal(data.keyword_cluster_members.length, 1);
    await f.store.write(db => db.deleteTable('keywords', { id: `eq.${keyword.id}` }, ACTOR)); data = await f.data(); assert.equal(data.keyword_cluster_members.length, 0); assert.equal(data.keyword_clusters[0].stats.keyword_count, 0); assert.equal(data.edges.length, 0);
    assert.equal((data.cluster_stats_history[0].keyword_snapshot as Row[])[0].keyword, '원본 보존');
  });

  it('reconciles automatic groups, preserves manual groups and renamed stable IDs, and makes repeated requests durable', async () => {
    const f = await fixture(); const a = await f.keyword('SEO 시작'), b = await f.keyword('seo 가이드'), c = await f.keyword('다른 주제'), inactive = await f.keyword('중지 키워드', { is_paused: true });
    const manual = (await f.create('수동 그룹', [a.id, inactive.id])).cluster;
    const preview = (await f.data()).preview; assert.equal(preview.groups.length, 2); assert.equal(preview.keyword_count, 3);
    const first = await f.run(); let data = await f.data(); assert.equal(data.cluster_batch_runs.length, 1); assert.equal(data.keyword_clusters.length, 3);
    const automatic = data.keyword_clusters.find(row => row.origin === 'lexical' && row.stats.keyword_count === 2)!;
    await f.invoke('cluster-update', { cluster_id: automatic.id, expected_revision: automatic.revision, label: '검색 전략', priority: 'high', notes: '이름 보존' });
    await f.store.write(db => db.updateTable('keywords', { keyword: 'seo 새 구성' }, { id: `eq.${c.id}` }, ACTOR)); await f.run('second'); data = await f.data();
    assert.equal(data.keyword_clusters.length, 2); const updated = data.keyword_clusters.find(row => row.id === automatic.id)!; assert.equal(updated.label, '검색 전략'); assert.equal(updated.notes, '이름 보존'); assert.equal(updated.stats.keyword_count, 3); assert.equal(data.keyword_clusters.find(row => row.id === manual.id)!.stats.keyword_count, 2);
    const restarted = new PersistentHaloXStore(f.filename); const reused = await restarted.write(db => db.invokeEdgeFunction('strategy-map-orchestrator', { ...first.payload, workspace_id: f.workspace }, ACTOR)); assert.equal((reused.run as Row).id, first.result.run.id); assert.equal(reused.reused, true);
    await assert.rejects(f.invoke('strategy-map-orchestrator', { ...first.payload, confirm: false }), /같은 요청 키/);
    await f.invoke('strategy-run-update', { history_id: first.result.run.id, expected_revision: 1, notes: '첫 분류 메모' }); await f.invoke('strategy-run-delete', { history_id: first.result.run.id, expected_revision: 2 });
    await assert.rejects(f.invoke('strategy-map-orchestrator', first.payload), /찾을 수 없습니다/); assert.equal((await f.data()).keyword_clusters.length, 2);
    assert.equal(b.keyword, 'seo 가이드');
  });

  it('rejects stale previews, records no partial batch on failure, and applies explicitly confirmed empty grouping', async () => {
    const f = await fixture(), keyword = await f.keyword('실행 키워드'), manual = (await f.create('수동')).cluster;
    const before = (await f.data()).source_revision; await f.create('새 수동'); await assert.rejects(f.invoke('strategy-map-orchestrator', { expected_source_revision: before, confirm: true, idempotency_key: 'stale' }), StrategyConflictError);
    const payload = { expected_source_revision: (await f.data()).source_revision, confirm: true, idempotency_key: 'retry' };
    await assert.rejects(f.store.write(db => { const insert = db.insertTable.bind(db); db.insertTable = (table, values, actor) => { if (table === 'cluster_stats_history') throw new Error('storage simulation'); return insert(table, values, actor); }; return db.invokeEdgeFunction('strategy-map-orchestrator', { ...payload, workspace_id: f.workspace }, ACTOR); }), /storage simulation/);
    assert.equal((await f.data()).keyword_clusters.length, 2); assert.equal((await f.data()).cluster_batch_runs.length, 0);
    await f.invoke('strategy-map-orchestrator', payload); await f.store.write(db => db.updateTable('keywords', { is_active: false }, { id: `eq.${keyword.id}` }, ACTOR));
    assert.equal((await f.data()).preview.removed_ids.length, 1); await f.run('empty'); const data = await f.data(); assert.equal(data.keyword_clusters.length, 2); assert.ok(data.keyword_clusters.find(row => row.id === manual.id)); assert.equal(data.keyword_clusters.some(row => row.origin === 'lexical'), false);
  });

  it('protects workspace data and result writes, reports actual effective state, and clears private request records on workspace deletion', async () => {
    const f = await fixture(), keyword = await f.keyword('보호 자료'), { cluster } = await f.create('보호 그룹', [keyword.id]);
    await assert.rejects(f.invoke('cluster-update', { cluster_id: cluster.id, expected_revision: 1, label: '침입', priority: 'normal' }, OTHER_USER_ID), /not authorized/i);
    await assert.rejects(f.store.read(db => readStrategyData(db, ISOLATED_WORKSPACE_ID, ACTOR)), /not authorized/i);
    await f.store.read(db => { for (const table of ['keyword_clusters', 'keyword_cluster_members', 'keyword_cluster_links', 'cluster_stats_history', 'cluster_batch_runs']) for (const method of ['POST', 'PATCH', 'DELETE'] as const) assert.throws(() => assertRestWrite(db, table, method, ACTOR, { workspace_id: f.workspace }, { id: `eq.${cluster.id}` }), /전용 서버/); });
    const state = await f.store.read(db => db.callRpc('strategy_map_effective_state', { workspace_id: f.workspace }, ACTOR)) as Row; assert.equal(state.linked_keyword_count, 1); assert.equal(state.cluster_count, 1); assert.equal(state.auto_generate_prompts, true);
    await f.run(); assert.equal((await f.store.read(db => db.getServerRecords('strategy_requests'))).length, 1);
    await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${f.workspace}` }, ACTOR)); assert.equal((await f.store.read(db => db.getServerRecords('strategy_requests'))).length, 0); assert.equal((await f.store.read(db => db.queryTable('keyword_clusters', { filters: { workspace_id: `eq.${f.workspace}` } }, ACTOR))).count, 0);
  });

  it('allows snapshot notes and deletion without changing current measurements', async () => {
    const f = await fixture(), keyword = await f.keyword('측정 기록'), { cluster } = await f.create('자료', [keyword.id]), first = (await f.data()).cluster_stats_history[0];
    await f.invoke('cluster-history-update', { history_id: first.id, expected_revision: 1, notes: '검토한 집계' }); assert.equal((await f.data()).cluster_stats_history[0].notes, '검토한 집계');
    await f.invoke('cluster-history-delete', { history_id: first.id, expected_revision: 2 }); assert.equal((await f.data()).cluster_stats_history.length, 0); assert.equal((await f.data()).keyword_clusters[0].stats.volume_sum, 100);
    const refreshed = await f.invoke('cluster-refresh', { cluster_id: cluster.id, expected_revision: 1 }); assert.equal((refreshed.history.stats_json as Row).volume_sum, 100);
  });
});
