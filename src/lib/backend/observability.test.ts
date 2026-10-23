import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { observationDate, readDashboard, readObservationSnapshot } from './observation-model.ts';
import { runMonitorCommand, readMonitoring } from './monitor-service.ts';
import { runReportCommand, reportPeriod, nextReportSchedule, readReports, reportDownload } from './report-service.ts';
import { assertRestWrite } from './rest-policy.ts';

const NOW = Date.parse('2026-10-23T12:00:00Z'), directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-observation-')); directories.push(directory); const filename = path.join(directory, 'db.sqlite'), store = new PersistentHaloXStore(filename);
  const ws = await store.write(db => db.insertTable('workspaces', { name: '관측 검증', default_brand_filter: 'brand.test' }, ACTOR)[0]), workspace = String(ws.id);
  const insert = (table: string, values: Row) => store.write(db => db.insertTable(table, { ...values, workspace_id: workspace }, ACTOR)[0]);
  const monitor = (name: string, values: Row, actor = ACTOR, now = NOW) => store.write(db => runMonitorCommand(db, name, values, workspace, actor, now));
  const report = (name: string, values: Row, actor = ACTOR, now = NOW) => store.write(db => runReportCommand(db, name, values, workspace, actor, now));
  const read = (table: string, actor = ACTOR) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${workspace}` } }, actor).data);
  const measured = async (rank: number | null, at = '2026-10-23T11:00:00Z') => {
    const kw = await insert('keywords', { keyword: `검색 확인 ${at}` });
    await insert('serp_snapshots', { keyword_id: kw.id, keyword_text: kw.keyword, engine: 'google', captured_at: at, provider: 'fixture', language: kw.language, country: kw.country, our_domain: 'brand.test', our_rank: rank, top_results_json: rank === null ? [] : [{ url: 'https://brand.test/page', rank }], ai_overview_json: { cited_domains: ['brand.test'] }, ai_overview_detected: true }); return kw;
  };
  return { store, filename, workspace, insert, monitor, report, read, measured };
}
const rule = { name: '검색 감시', notes: '', metric: 'seo_top10', operator: 'lt', threshold: 80, window_days: 7, interval_minutes: 5, min_samples: 1, enabled: true };
const makeReport = { period_type: 'week', date: '2026-10-23', idempotency_key: 'manual-1' };
const rowOf = (result: Row, key: string) => result[key] as Row;

describe('관측·리포트 영속 CRUD', () => {
  it('uses strict real dates, ISO week years, calendar months and future schedules', () => {
    assert.throws(() => observationDate('2026-02-30'));
    assert.deepEqual(reportPeriod('week', '2021-01-01'), { period_type: 'week', period_key: '2020-W53', start_date: '2020-12-28', end_date: '2021-01-03' });
    assert.equal(reportPeriod('week', '2024-12-30').period_key, '2025-W01'); assert.equal(reportPeriod('month', '2024-02-29').end_date, '2024-02-29');
    assert.equal(nextReportSchedule('week', 0, Date.parse('2026-10-26T00:00:00Z')), '2026-11-02T00:00:00.000Z');
    assert.equal(nextReportSchedule('month', 9, Date.parse('2026-12-31')), '2027-01-01T09:00:00.000Z');
  });
  it('shows empty metrics as unmeasured and recalculates after entity deletion', async () => {
    const f = await fixture(); const dashboard = () => f.store.read(db => readDashboard(db, f.workspace, ACTOR, NOW));
    assert.equal((await dashboard()).snapshot.scores.avi, null); const kw = await f.measured(3);
    const result = (await dashboard()).snapshot; assert.equal(result.seo.summary.top10_percent, 100); assert.equal(result.counts.keywords, 1); assert.equal(result.geo.summary.citation_percent, null);
    assert.ok(Object.values(result.counts).every(value => Number.isSafeInteger(value) && value >= 0));
    assert.ok(Object.values(result.scores).every(value => value === null || value >= 0 && value <= 100));
    await f.store.write(db => db.deleteTable('keywords', { id: `eq.${kw.id}` }, ACTOR)); const empty = (await dashboard()).snapshot; assert.equal(empty.seo.summary.samples, 0); assert.equal(empty.counts.keywords, 0);
  });
  it('excludes future observations and keeps previous period separate', async () => {
    const f = await fixture(); await f.measured(5, '2026-10-23T13:00:00Z'); await f.measured(20, '2026-10-12T00:00:00Z');
    const snapshot = await f.store.read(db => readObservationSnapshot(db, f.workspace, ACTOR, '2026-10-19', '2026-10-25', NOW));
    assert.equal(snapshot.seo.summary.samples, 0); assert.equal(snapshot.seo.previous.average_rank, 20);
  });
  it('saves user-specific dashboard settings, rejects stale revision and resets', async () => {
    const f = await fixture(); await f.insert('workspace_members', { user_id: OTHER_USER_ID, role: 'member' });
    const payload = { expected_revision: 0, period_days: 7, panels: ['geo', 'seo'], sort: 'recent' };
    await f.monitor('dashboard-preferences-save', payload); assert.equal((await f.read('dashboard_preferences', OTHER_USER_ID)).length, 0);
    await assert.rejects(f.monitor('dashboard-preferences-save', payload), /변경/);
    await assert.rejects(f.monitor('dashboard-preferences-save', { ...payload, expected_revision: 1, panels: ['seo', 'seo'] }), /확인/);
    await f.monitor('dashboard-preferences-reset', { expected_revision: 1 }); assert.equal((await f.read('dashboard_preferences')).length, 0);
  });
  it('creates one incident across worker retries/restarts and resolves only with measured recovery', async () => {
    const f = await fixture(); const kw = await f.measured(20); const saved = rowOf(await f.monitor('monitor-rule-create', rule), 'rule');
    const second = new PersistentHaloXStore(f.filename);
    await Promise.all([f.store.write(db => db.runDueObservability(NOW)), second.write(db => db.runDueObservability(NOW))]);
    assert.equal((await f.read('geo_alerts')).length, 1); assert.equal((await f.read('monitor_rules'))[0].last_state, 'alert');
    await f.store.write(db => db.deleteTable('keywords', { id: `eq.${kw.id}` }, ACTOR));
    await f.monitor('monitor-rule-check', { rule_id: saved.id, expected_revision: 1 }); assert.equal((await f.read('monitor_rules'))[0].last_state, 'insufficient'); assert.equal((await f.read('geo_alerts'))[0].status, 'open');
    await f.measured(2); await f.monitor('monitor-rule-check', { rule_id: saved.id, expected_revision: 1 }); assert.equal((await f.read('geo_alerts'))[0].status, 'resolved');
  });
  it('validates thresholds, permissions and stale edits; deleting a rule cascades its alerts/events', async () => {
    const f = await fixture(); await f.insert('workspace_members', { user_id: OTHER_USER_ID, role: 'member' }); await f.measured(30);
    await assert.rejects(f.monitor('monitor-rule-create', { ...rule, threshold: 101 }), /範囲|범위/); await assert.rejects(f.monitor('monitor-rule-create', rule, OTHER_USER_ID), /관리자/);
    const saved = rowOf(await f.monitor('monitor-rule-create', rule), 'rule'); await f.monitor('monitor-rule-check', { rule_id: saved.id, expected_revision: 1 });
    await assert.rejects(f.monitor('monitor-rule-update', { ...rule, rule_id: saved.id, expected_revision: 0 }), /변경/);
    await f.monitor('monitor-rule-update', { ...rule, rule_id: saved.id, expected_revision: 1, enabled: false }); assert.equal((await f.read('geo_alerts'))[0].resolution_reason, 'rule_changed');
    await f.monitor('monitor-rule-delete', { rule_id: saved.id, expected_revision: 2 }); assert.equal((await f.read('geo_alerts')).length, 0); assert.equal((await f.read('workspace_events')).length, 0);
  });
  it('lets members acknowledge and annotate but only delete resolved incidents', async () => {
    const f = await fixture(); await f.measured(30); const saved = rowOf(await f.monitor('monitor-rule-create', rule), 'rule'); await f.monitor('monitor-rule-check', { rule_id: saved.id, expected_revision: 1 });
    const alert = (await f.read('geo_alerts'))[0]; await assert.rejects(f.monitor('monitor-alert-delete', { alert_id: alert.id, expected_revision: 1 }), /열린/);
    await f.monitor('monitor-alert-update', { alert_id: alert.id, expected_revision: 1, acknowledged: true, notes: '원인 확인' }); assert.equal((await f.read('geo_alerts'))[0].acknowledged_by, ACTOR);
    await f.monitor('monitor-rule-update', { ...rule, rule_id: saved.id, expected_revision: 1, enabled: false });
    await f.monitor('monitor-alert-delete', { alert_id: alert.id, expected_revision: 3 }); assert.equal((await f.read('geo_alerts')).length, 0);
  });
  it('preserves immutable report evidence after edits/deletion of source and deduplicates requests', async () => {
    const f = await fixture(); const kw = await f.measured(2), report = rowOf(await f.report('report-create', makeReport), 'report');
    assert.equal(report.partial, true); assert.equal((await f.report('report-create', makeReport)).replayed, true);
    await assert.rejects(f.report('report-create', { ...makeReport, title: '다른 요청' }), /변경/);
    await f.store.write(db => db.deleteTable('keywords', { id: `eq.${kw.id}` }, ACTOR)); await f.report('report-update', { report_id: report.id, title: '검토 완료', notes: '보존', expected_revision: 1 });
    const data = await f.store.read(db => readReports(db, f.workspace, ACTOR, String(report.id))); assert.equal((data.report!.snapshot as { counts: { keywords: number } }).counts.keywords, 1);
    assert.equal(data.reports[0].snapshot, undefined); assert.equal(data.summaries.length, 1);
    const second = rowOf(await f.report('report-create', { ...makeReport, idempotency_key: 'manual-2' }), 'report'); assert.equal(second.sequence, 2);
  });
  it('keeps summaries and action revisions scoped to a report and cascades on delete', async () => {
    const f = await fixture(), report = rowOf(await f.report('report-create', makeReport), 'report');
    await f.report('report-summary-save', { report_id: report.id, expected_revision: 1, content: '수정한 요약' }); await assert.rejects(f.report('report-summary-delete', { report_id: report.id, expected_revision: 1 }), /변경/);
    await f.report('report-summary-delete', { report_id: report.id, expected_revision: 2 }); await f.report('report-summary-save', { report_id: report.id, expected_revision: 0, content: '새 요약' });
    const values = { report_id: report.id, title: '수집 점검', notes: '', priority: 'high', status: 'open', due_date: '2026-10-24' };
    await assert.rejects(f.report('report-action-create', { ...values, due_date: '2026-02-30' }), /날짜/);
    const action = rowOf(await f.report('report-action-create', values), 'action'); await f.report('report-action-update', { ...values, action_id: action.id, expected_revision: 1, status: 'done' });
    assert.equal((await f.read('report_action_items'))[0].status, 'done');
    await f.report('report-delete', { report_id: report.id, expected_revision: 1 }); assert.equal((await f.read('report_action_items')).length, 0); assert.equal((await f.read('report_summaries')).length, 0);
    await assert.rejects(f.report('report-create', makeReport), /삭제한 요청/);
  });
  it('generates latest closed period once across restart and does not resurrect deleted scheduled reports', async () => {
    const f = await fixture(); const pref = rowOf(await f.report('report-preferences-save', { expected_revision: 0, enabled: true, frequency: 'week', hour_utc: 0 }), 'preferences');
    const monday = Date.parse('2026-10-26T00:00:01Z'); await f.store.write(db => db.runDueObservability(monday));
    const report = (await f.read('report_snapshots'))[0]; assert.equal(report.period_key, '2026-W43'); assert.equal(report.partial, false); assert.equal(report.origin, 'scheduled');
    await f.report('report-delete', { report_id: report.id, expected_revision: 1 });
    await f.store.write(db => db.updateTable('report_preferences', { next_run_at: new Date(monday - 1000).toISOString() }, { id: `eq.${pref.id}` }, ACTOR));
    await new PersistentHaloXStore(f.filename).write(db => db.runDueObservability(monday)); assert.equal((await f.read('report_snapshots')).length, 0);
    assert.equal((await f.read('report_preferences'))[0].last_period, '2026-W43');
  });
  it('exports stored JSON and escaped Markdown, denies cross-tenant reads and direct REST writes', async () => {
    const f = await fixture(), report = rowOf(await f.report('report-create', { ...makeReport, title: '<script>test</script>' }), 'report');
    const json = await f.store.read(db => reportDownload(db, String(report.id), ACTOR, 'json')); assert.equal(JSON.parse(json!.body).report.id, report.id);
    assert.match((await f.store.read(db => reportDownload(db, String(report.id), ACTOR, 'md')))!.body, /\\<script/);
    assert.equal(await f.store.read(db => reportDownload(db, String(report.id), OTHER_USER_ID, 'json')), null);
    await assert.rejects(f.store.read(db => readMonitoring(db, f.workspace, OTHER_USER_ID)), /not authorized/);
    for (const table of ['dashboard_preferences', 'monitor_rules', 'geo_alerts', 'workspace_events', 'report_snapshots', 'report_summaries', 'report_action_items', 'report_preferences']) await assert.rejects(f.store.write(db => assertRestWrite(db, table, 'POST', ACTOR, { workspace_id: f.workspace })), /서버 작업/);
  });
  it('uses all completed GEO runs and requires separate rank scores for the composite', async () => {
    const f = await fixture(), prompt = await f.insert('geo_prompts', { prompt_text: '브랜드 질문' });
    for (const [index, cited] of [true, false].entries()) {
      const run = await f.insert('geo_prompt_runs', { prompt_id: prompt.id, prompt_text: prompt.prompt_text, language_code: prompt.language_code, location_code: prompt.location_code, brand_domain: 'brand.test', engine: 'openai', provider: 'fixture', status: 'completed', finished_at: `2026-10-23T10:0${index}:00Z`, answer_text: '본문은 스냅샷에서 제외' });
      await f.insert('geo_run_metrics', { run_id: run.id, brand_mentioned: true, is_cited: cited });
    }
    const snapshot = () => f.store.read(db => readObservationSnapshot(db, f.workspace, ACTOR, '2026-10-19', '2026-10-25', NOW));
    assert.equal((await snapshot()).geo.summary.citation_percent, 50); assert.equal((await snapshot()).geo.evidence.length, 2); assert.equal((await snapshot()).geo.latest.length, 1); assert.equal((await snapshot()).scores.geo, null); assert.equal('answer' in (await snapshot()).geo.evidence[0], false);
    await f.store.write(db => db.updateTable('geo_run_metrics', { citation_rank_score: 80, mention_rank_score: 60 }, { workspace_id: `eq.${f.workspace}` }, ACTOR)); assert.equal((await snapshot()).scores.geo, 73);
  });
  it('uses latest measured HTML audit per target and excludes demo, failed and future scans', async () => {
    const f = await fixture();
    for (const values of [{ target_id: 'a', site_health_score: 20, completed_at: '2026-10-20T12:00:00Z' }, { target_id: 'a', site_health_score: 80 }, { target_id: 'b', site_health_score: 60 }, { target_id: 'c', site_health_score: 100, provider: 'demo' }, { target_id: 'd', site_health_score: 100, status: 'failed' }, { target_id: 'e', site_health_score: 100, completed_at: '2026-10-24T00:00:00Z' }]) await f.insert('site_audit_scans', { provider: 'html', status: 'completed', completed_at: '2026-10-23T10:00:00Z', ...values });
    const snapshot = await f.store.read(db => readObservationSnapshot(db, f.workspace, ACTOR, '2026-10-19', '2026-10-25', NOW)); assert.equal(snapshot.scores.web_health, 70); assert.equal(snapshot.audits.length, 2); assert.deepEqual(snapshot.providers, ['html']);
  });
  it('records an item failure without partial writes and continues to another due item', async () => {
    const f = await fixture(); await f.insert('report_preferences', { enabled: true, frequency: 'invalid', hour_utc: 0, next_run_at: '2026-10-22T00:00:00Z' });
    await f.insert('report_preferences', { enabled: true, frequency: 'month', hour_utc: 0, next_run_at: '2026-10-22T00:00:01Z' });
    await f.store.write(db => db.runDueObservability(NOW)); const pref = (await f.read('report_preferences')).find(row => row.frequency === 'invalid')!; assert.match(String(pref.last_error), /주간/); assert.equal((await f.read('report_snapshots')).length, 1); assert.equal(Date.parse(String(pref.next_run_at)), NOW + 3600000);
  });
});
