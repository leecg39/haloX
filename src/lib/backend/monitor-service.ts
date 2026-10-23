import type { HaloXDatabase, Row } from './database.ts';
import { ContentConflictError, contentText } from './content-model.ts';
import { analysisWhere } from './analysis-model.ts';
import { observationAdmin, observationRange, observationRows, readObservationSnapshot } from './observation-model.ts';
import { DASHBOARD_PANELS, MONITOR_METRICS, MONITOR_OPERATORS, type MonitoringData, type MonitorMetric, type ObservationSnapshot } from '../api/observability.ts';

export const MONITOR_COMMANDS = ['dashboard-preferences-save', 'dashboard-preferences-reset', 'monitor-rule-create', 'monitor-rule-update', 'monitor-rule-delete', 'monitor-rule-check', 'monitor-alert-update', 'monitor-alert-delete'];
export class ObservationConflictError extends ContentConflictError { constructor() { super(); this.message = '항목이 변경되었습니다. 입력을 유지했으니 최신 자료를 확인한 뒤 다시 저장해 주세요.'; } }
export function observationRevision(row: Row | undefined, expected: unknown) { if (!Number.isSafeInteger(expected) || expected !== Number(row?.revision || 0)) throw new ObservationConflictError(); }
export function observationItem(db: HaloXDatabase, workspace: string, actor: string, table: string, id: unknown) {
  if (typeof id !== 'string' || !id) throw new Error('항목을 선택해 주세요.');
  const row = db.queryTable(table, { filters: analysisWhere(workspace, id) }, actor).data[0]; if (!row) throw new Error('현재 워크스페이스에서 항목을 찾을 수 없습니다.'); return row;
}
export function observationInteger(value: unknown, label: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label}: ${min}~${max}의 정수를 입력해 주세요.`); return Number(value);
}
const stamp = (now: number) => new Date(now).toISOString();
const where = analysisWhere;
function ruleFields(payload: Row) {
  if (typeof payload.enabled !== 'boolean' || !Object.hasOwn(MONITOR_METRICS, String(payload.metric)) || !Object.hasOwn(MONITOR_OPERATORS, String(payload.operator))) throw new Error('감시 지표·비교 조건·활성 상태를 선택해 주세요.');
  const max = payload.metric === 'seo_rank' ? 1000 : 100;
  if (typeof payload.threshold !== 'number' || !Number.isFinite(payload.threshold) || payload.threshold < 0 || payload.threshold > max) throw new Error(`임계값은 0~${max} 범위로 입력해 주세요.`);
  return { name: contentText(payload.name, '규칙 이름', 100, true), notes: contentText(payload.notes, '규칙 메모', 5000), metric: String(payload.metric) as MonitorMetric, operator: String(payload.operator), threshold: payload.threshold, enabled: payload.enabled,
    window_days: observationInteger(payload.window_days, '측정 기간', 1, 90), interval_minutes: observationInteger(payload.interval_minutes, '평가 간격(분)', 5, 1440), min_samples: observationInteger(payload.min_samples, '최소 표본 수', 1, 10000) };
}
export function monitorValue(snapshot: ObservationSnapshot, metric: MonitorMetric) {
  const seo = snapshot.seo.summary, geo = snapshot.geo.summary;
  switch (metric) {
    case 'seo_top10': return { value: seo.top10_percent, samples: seo.rank_measured, sources: snapshot.seo.latest.filter(row => row.rank_measured).map(row => row.id) };
    case 'seo_rank': return { value: seo.average_rank, samples: seo.ranked, sources: snapshot.seo.latest.filter(row => row.rank !== null).map(row => row.id) };
    case 'geo_citation': return { value: geo.citation_percent, samples: geo.citation_measured, sources: snapshot.geo.evidence.filter(row => row.cited !== null).map(row => row.id) };
    case 'geo_mention': return { value: geo.mention_percent, samples: geo.mention_measured, sources: snapshot.geo.evidence.filter(row => row.mentioned !== null).map(row => row.id) };
    case 'audit_health': return { value: snapshot.scores.web_health, samples: snapshot.audits.length, sources: snapshot.audits.map(row => row.id) };
  }
}
function event(db: HaloXDatabase, workspace: string, actor: string, rule: Row, type: string, details: Row, now: number) {
  return db.insertTable('workspace_events', { workspace_id: workspace, rule_id: rule.id, event_type: type, origin: 'monitor', title: String(rule.name), metadata: details, created_at: stamp(now) }, actor)[0];
}
function closeAlerts(db: HaloXDatabase, workspace: string, actor: string, rule: Row, reason: string, now: number) {
  const open = observationRows(db, workspace, actor, 'geo_alerts').filter(row => row.rule_id === rule.id && row.status === 'open');
  for (const alert of open) db.updateTable('geo_alerts', { status: 'resolved', resolved_at: stamp(now), resolution_reason: reason, revision: Number(alert.revision) + 1 }, where(workspace, alert.id), actor);
  if (open.length) event(db, workspace, actor, rule, 'monitor.resolved', { reason, alert_ids: open.map(row => row.id) }, now);
}

/** Cursor, transition, and alert receipt are committed together under the writer lock. */
export function evaluateMonitorRule(db: HaloXDatabase, workspace: string, actor: string, rule: Row, now = Date.now()) {
  const range = observationRange(Number(rule.window_days), now), snapshot = readObservationSnapshot(db, workspace, actor, range.start, range.end, now), observed = monitorValue(snapshot, rule.metric as MonitorMetric);
  const compare = { lt: (a: number, b: number) => a < b, lte: (a: number, b: number) => a <= b, gt: (a: number, b: number) => a > b, gte: (a: number, b: number) => a >= b };
  const state = observed.value === null || observed.samples < Number(rule.min_samples) ? 'insufficient' : compare[rule.operator as keyof typeof compare](observed.value, Number(rule.threshold)) ? 'alert' : 'ok';
  const proof = { ...observed, ...range, evaluated_at: stamp(now), providers: snapshot.providers };
  const open = observationRows(db, workspace, actor, 'geo_alerts').find(row => row.rule_id === rule.id && row.status === 'open');
  if (state === 'alert' && !open) {
    const [alert] = db.insertTable('geo_alerts', { workspace_id: workspace, rule_id: rule.id, rule_snapshot: ruleFields(rule), observation: proof, status: 'open', acknowledged_at: null, acknowledged_by: null, notes: '', revision: 1, created_at: stamp(now) }, actor);
    event(db, workspace, actor, rule, 'monitor.triggered', { alert_id: alert.id, ...proof }, now);
  } else if (state === 'ok' && open) closeAlerts(db, workspace, actor, rule, 'normal_range', now);
  // Missing data does not resolve an existing incident or create a false recovery.
  if (state !== rule.last_state && state === 'insufficient') event(db, workspace, actor, rule, 'monitor.insufficient', proof, now);
  return db.updateTable('monitor_rules', { last_state: state, last_observation: proof, last_evaluated_at: stamp(now), last_error: '', next_evaluation_at: rule.enabled ? stamp(now + Number(rule.interval_minutes) * 60000) : null }, where(workspace, rule.id), actor)[0];
}
export function readMonitoring(db: HaloXDatabase, workspace: string, actor: string): MonitoringData {
  const can_manage = observationAdmin(db, workspace, actor), rows = (table: string) => observationRows(db, workspace, actor, table);
  return { can_manage, rules: rows('monitor_rules'), alerts: rows('geo_alerts'), events: rows('workspace_events').filter(row => row.origin === 'monitor') } as MonitoringData;
}
export function runMonitorCommand(db: HaloXDatabase, command: string, payload: Row, workspace: string, actor: string, now = Date.now()): Row {
  db.assertWorkspaceMember(workspace, actor); const rows = (table: string) => observationRows(db, workspace, actor, table);
  if (command.startsWith('dashboard-preferences-')) {
    const row = rows('dashboard_preferences').find(item => item.user_id === actor); observationRevision(row, payload.expected_revision);
    if (command.endsWith('-reset')) { if (row) db.deleteTable('dashboard_preferences', where(workspace, row.id), actor); return { ok: true }; }
    if (![7, 28, 90].includes(Number(payload.period_days)) || typeof payload.period_days !== 'number' || !['rank', 'recent'].includes(String(payload.sort)) || !Array.isArray(payload.panels) || !payload.panels.length || payload.panels.length > 5 || new Set(payload.panels).size !== payload.panels.length || payload.panels.some(key => typeof key !== 'string' || !Object.hasOwn(DASHBOARD_PANELS, key))) throw new Error('기간·패널 순서·정렬을 확인해 주세요.');
    const values = { period_days: payload.period_days, panels: payload.panels, sort: payload.sort, revision: Number(row?.revision || 0) + 1 };
    const preferences = row ? db.updateTable('dashboard_preferences', values, where(workspace, row.id), actor)[0] : db.insertTable('dashboard_preferences', { ...values, user_id: actor, workspace_id: workspace }, actor)[0];
    return { ok: true, preferences };
  }
  if (command.startsWith('monitor-alert-')) {
    const alert = observationItem(db, workspace, actor, 'geo_alerts', payload.alert_id); observationRevision(alert, payload.expected_revision);
    if (command.endsWith('-delete')) { if (alert.status === 'open') throw new Error('열린 알림은 확인 또는 메모로 관리하고, 정상 복구 후 삭제할 수 있습니다.'); db.deleteTable('geo_alerts', where(workspace, alert.id), actor); return { ok: true }; }
    if (typeof payload.acknowledged !== 'boolean') throw new Error('확인 상태를 선택해 주세요.');
    return { ok: true, alert: db.updateTable('geo_alerts', { notes: contentText(payload.notes, '알림 메모', 5000), acknowledged_at: payload.acknowledged ? alert.acknowledged_at || stamp(now) : null, acknowledged_by: payload.acknowledged ? alert.acknowledged_by || actor : null, revision: Number(alert.revision) + 1 }, where(workspace, alert.id), actor)[0] };
  }
  observationAdmin(db, workspace, actor, true);
  const rule = command === 'monitor-rule-create' ? undefined : observationItem(db, workspace, actor, 'monitor_rules', payload.rule_id);
  if (rule) observationRevision(rule, payload.expected_revision);
  if (command === 'monitor-rule-check') return { ok: true, rule: evaluateMonitorRule(db, workspace, actor, rule!, now) };
  if (command === 'monitor-rule-delete') { db.deleteTable('monitor_rules', where(workspace, rule!.id), actor); return { ok: true }; }
  const values = ruleFields(payload), current = rows('monitor_rules');
  if (!rule && current.length >= 100) throw new Error('워크스페이스당 감시 규칙은 100개까지 지원합니다.');
  if (current.some(row => row.id !== rule?.id && String(row.name).normalize('NFKC').toLowerCase() === values.name.normalize('NFKC').toLowerCase())) throw new Error('같은 이름의 감시 규칙이 있습니다.');
  const changed = !rule || ['metric', 'operator', 'threshold', 'window_days', 'min_samples', 'enabled'].some(key => rule[key] !== values[key as keyof typeof values]);
  if (rule && changed) closeAlerts(db, workspace, actor, rule, 'rule_changed', now);
  const fields = { ...values, revision: Number(rule?.revision || 0) + 1, ...(changed ? { last_state: 'unknown', last_observation: null } : {}), next_evaluation_at: values.enabled ? stamp(now) : null, last_error: '' };
  const saved = rule ? db.updateTable('monitor_rules', fields, where(workspace, rule.id), actor)[0] : db.insertTable('monitor_rules', { ...fields, workspace_id: workspace }, actor)[0];
  return { ok: true, rule: saved };
}
