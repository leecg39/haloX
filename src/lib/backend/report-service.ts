import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { contentText } from './content-model.ts';
import { analysisWhere } from './analysis-model.ts';
import { observationAdmin, observationDate, observationRows, readObservationSnapshot } from './observation-model.ts';
import { observationInteger, observationItem, observationRevision, ObservationConflictError } from './monitor-service.ts';
import type { ObservationSnapshot, ReportData } from '../api/observability.ts';

export const REPORT_COMMANDS = ['report-create', 'report-update', 'report-delete', 'report-summary-save', 'report-summary-delete', 'report-action-create', 'report-action-update', 'report-action-delete', 'report-preferences-save', 'report-preferences-reset', 'report-snapshot', 'generate-weekly-snapshot'];
const day = (date: Date) => date.toISOString().slice(0, 10);
const stamp = (now: number) => new Date(now).toISOString();
export function reportPeriod(type: unknown, value: unknown) {
  if (type !== 'week' && type !== 'month') throw new Error('주간 또는 월간을 선택해 주세요.');
  const date = new Date(observationDate(value)), start = new Date(date), end = new Date(date);
  let key: string;
  if (type === 'week') {
    start.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); end.setTime(start.getTime() + 6 * 86400000);
    const thursday = new Date(start.getTime() + 3 * 86400000), year = thursday.getUTCFullYear();
    const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
    key = `${year}-W${String(week).padStart(2, '0')}`;
  } else { start.setUTCDate(1); end.setUTCMonth(date.getUTCMonth() + 1, 0); key = day(start).slice(0, 7); }
  return { period_type: type, period_key: key, start_date: day(start), end_date: day(end) };
}
export function nextReportSchedule(frequency: 'week' | 'month', hour: number, now: number) {
  const date = new Date(now); date.setUTCHours(hour, 0, 0, 0);
  if (frequency === 'week') { date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7); if (date.getTime() <= now) date.setUTCDate(date.getUTCDate() + 7); }
  else { date.setUTCDate(1); if (date.getTime() <= now) date.setUTCMonth(date.getUTCMonth() + 1); }
  return date.toISOString();
}
function reportReceipt(db: HaloXDatabase, workspace: string, key: string) { return db.getServerRecords('report_requests').find(row => row.workspace_id === workspace && row.key === key); }
function createReport(db: HaloXDatabase, payload: Row, workspace: string, actor: string, now: number, origin: 'manual' | 'scheduled' = 'manual') {
  const period = reportPeriod(payload.period_type, payload.date), key = contentText(payload.idempotency_key, '생성 요청 키', 200, true), title = contentText(payload.title, '리포트 제목', 200) || `${period.period_key} ${period.period_type === 'week' ? '주간' : '월간'} 리포트`;
  if (Date.parse(period.start_date) > now) throw new Error('미래 기간의 리포트는 생성할 수 없습니다.');
  const signature = JSON.stringify({ ...period, title }), receipt = reportReceipt(db, workspace, key);
  if (receipt) {
    if (receipt.signature !== signature) throw new ObservationConflictError();
    const existing = observationRows(db, workspace, actor, 'report_snapshots').find(row => row.id === receipt.report_id);
    if (!existing) throw new Error('이미 생성 후 삭제한 요청입니다. 새 생성 요청으로 다시 시도해 주세요.');
    return { ok: true, report: existing, replayed: true };
  }
  const reports = observationRows(db, workspace, actor, 'report_snapshots');
  if (reports.length >= 200) throw new Error('워크스페이스당 리포트는 200개까지 보관할 수 있습니다.');
  const snapshot = readObservationSnapshot(db, workspace, actor, period.start_date, period.end_date, now);
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 2 * 1024 * 1024) throw new Error('측정 근거가 리포트 저장 한도(2 MiB)를 초과했습니다. 더 짧은 기간을 선택해 주세요.');
  const sequence = Math.max(0, ...reports.filter(row => row.period_key === period.period_key).map(row => Number(row.sequence) || 0)) + 1;
  const [report] = db.insertTable('report_snapshots', { workspace_id: workspace, ...period, title, sequence, notes: '', snapshot, schema_version: 1, revision: 1, origin, created_by: actor, created_at: stamp(now), partial: now < Date.parse(period.end_date) + 86400000, data_through: stamp(Math.min(now, Date.parse(period.end_date) + 86400000 - 1)) }, actor);
  const display = (value: number | null, unit: string) => value === null ? '미측정' : `${value}${unit}`;
  const summary = `검색 Top 10 비율 ${display(snapshot.seo.summary.top10_percent, '%')} (${snapshot.seo.summary.rank_measured}개 표본), AI 인용률 ${display(snapshot.geo.summary.citation_percent, '%')} (${snapshot.geo.summary.citation_measured}개 표본). HTML 건강도 ${display(snapshot.scores.web_health, '점')}. 저장된 측정값으로 작성한 요약입니다.`;
  db.insertTable('report_summaries', { workspace_id: workspace, report_id: report.id, content: summary, revision: 1, created_at: stamp(now) }, actor);
  db.setServerRecords('report_requests', [...db.getServerRecords('report_requests'), { workspace_id: workspace, key, signature, report_id: report.id, created_at: stamp(now) }]);
  return { ok: true, report, replayed: false };
}
export function readReports(db: HaloXDatabase, workspace: string, actor: string, id?: string): ReportData {
  const can_manage = observationAdmin(db, workspace, actor), rows = (table: string) => observationRows(db, workspace, actor, table);
  const report = id ? observationItem(db, workspace, actor, 'report_snapshots', id) : undefined;
  return { can_manage, reports: rows('report_snapshots').map(({ snapshot: _snapshot, ...row }) => row), report, summaries: id ? rows('report_summaries').filter(row => row.report_id === id) : [], actions: id ? rows('report_action_items').filter(row => row.report_id === id) : [], preferences: rows('report_preferences')[0] || null } as ReportData;
}
export function runReportCommand(db: HaloXDatabase, command: string, payload: Row, workspace: string, actor: string, now = Date.now()): Row {
  db.assertWorkspaceMember(workspace, actor); const where = analysisWhere;
  if (['report-create', 'report-snapshot', 'generate-weekly-snapshot'].includes(command)) return createReport(db, command === 'report-create' ? payload : { ...payload, date: payload.date || day(new Date(now)), period_type: payload.period_type || 'week', idempotency_key: payload.idempotency_key || crypto.randomUUID() }, workspace, actor, now);
  if (command.startsWith('report-preferences-')) {
    observationAdmin(db, workspace, actor, true); const row = observationRows(db, workspace, actor, 'report_preferences')[0]; observationRevision(row, payload.expected_revision);
    if (command.endsWith('-reset')) { if (row) db.deleteTable('report_preferences', where(workspace, row.id), actor); return { ok: true }; }
    if (typeof payload.enabled !== 'boolean' || !['week', 'month'].includes(String(payload.frequency))) throw new Error('리포트 생성 주기를 선택해 주세요.');
    const hour = observationInteger(payload.hour_utc, 'UTC 실행 시각', 0, 23), frequency = payload.frequency as 'week' | 'month';
    const values = { enabled: payload.enabled, frequency, hour_utc: hour, next_run_at: payload.enabled ? nextReportSchedule(frequency, hour, now) : null, revision: Number(row?.revision || 0) + 1, last_error: '' };
    return { ok: true, preferences: row ? db.updateTable('report_preferences', values, where(workspace, row.id), actor)[0] : db.insertTable('report_preferences', { ...values, workspace_id: workspace }, actor)[0] };
  }
  const report = observationItem(db, workspace, actor, 'report_snapshots', payload.report_id);
  if (command === 'report-update' || command === 'report-delete') {
    observationRevision(report, payload.expected_revision);
    if (command === 'report-delete') { db.deleteTable('report_snapshots', where(workspace, report.id), actor); return { ok: true }; }
    return { ok: true, report: db.updateTable('report_snapshots', { title: contentText(payload.title, '리포트 제목', 200, true), notes: contentText(payload.notes, '리포트 메모', 10000), revision: Number(report.revision || 0) + 1 }, where(workspace, report.id), actor)[0] };
  }
  if (report.schema_version !== 1) throw new Error('이전 데모 리포트는 새로 생성한 뒤 편집해 주세요.');
  if (command.startsWith('report-summary-')) {
    const row = observationRows(db, workspace, actor, 'report_summaries').find(item => item.report_id === report.id); observationRevision(row, payload.expected_revision);
    if (command.endsWith('-delete')) { if (row) db.deleteTable('report_summaries', where(workspace, row.id), actor); return { ok: true }; }
    const values = { content: contentText(payload.content, '요약', 10000, true), revision: Number(row?.revision || 0) + 1 };
    return { ok: true, summary: row ? db.updateTable('report_summaries', values, where(workspace, row.id), actor)[0] : db.insertTable('report_summaries', { ...values, workspace_id: workspace, report_id: report.id }, actor)[0] };
  }
  const row = command === 'report-action-create' ? undefined : observationItem(db, workspace, actor, 'report_action_items', payload.action_id);
  if (row) { if (row.report_id !== report.id) throw new Error('리포트에 속한 액션을 선택해 주세요.'); observationRevision(row, payload.expected_revision); }
  if (command === 'report-action-delete') { db.deleteTable('report_action_items', where(workspace, row!.id), actor); return { ok: true }; }
  if (!['high', 'normal', 'low'].includes(String(payload.priority)) || !['open', 'done'].includes(String(payload.status))) throw new Error('액션 우선순위와 상태를 선택해 주세요.');
  if (!row && observationRows(db, workspace, actor, 'report_action_items').filter(item => item.report_id === report.id).length >= 100) throw new Error('리포트당 액션은 100개까지 지원합니다.');
  const values = { title: contentText(payload.title, '액션 제목', 200, true), notes: contentText(payload.notes, '액션 메모', 5000), priority: payload.priority, status: payload.status, due_date: payload.due_date ? observationDate(payload.due_date) : null, revision: Number(row?.revision || 0) + 1 };
  return { ok: true, action: row ? db.updateTable('report_action_items', values, where(workspace, row.id), actor)[0] : db.insertTable('report_action_items', { ...values, workspace_id: workspace, report_id: report.id }, actor)[0] };
}
/** Catch up the latest closed calendar period; historical missed periods require explicit generation. */
export function generateScheduledReport(db: HaloXDatabase, workspace: string, actor: string, preference: Row, now: number) {
  const frequency = preference.frequency as 'week' | 'month', current = reportPeriod(frequency, day(new Date(now))), date = day(new Date(Date.parse(current.start_date) - 86400000)), period = reportPeriod(frequency, date);
  const key = `scheduled:${preference.id}:${period.period_key}`;
  if (!reportReceipt(db, workspace, key)) createReport(db, { period_type: frequency, date, idempotency_key: key }, workspace, actor, now, 'scheduled');
  return db.updateTable('report_preferences', { last_period: period.period_key, last_run_at: stamp(now), last_error: '', next_run_at: nextReportSchedule(frequency, Number(preference.hour_utc), now) }, analysisWhere(workspace, preference.id), actor)[0];
}
export function reportDownload(db: HaloXDatabase, id: string, actor: string, format: string) {
  if (!['json', 'md'].includes(format)) throw new Error('JSON 또는 Markdown을 선택해 주세요.');
  const report = db.queryTable('report_snapshots', { filters: { id: `eq.${id}` } }, actor).data[0]; if (!report) return null;
  const data = readReports(db, String(report.workspace_id), actor, id);
  if (report.schema_version !== 1) throw new Error('이전 데모 리포트는 새 리포트를 생성한 뒤 내려받아 주세요.');
  const snapshot = report.snapshot as ObservationSnapshot;
  const escape = (value: unknown) => String(value ?? '').replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');
  const md = [`# ${escape(report.title)}`, `${report.start_date} ~ ${report.end_date} (UTC) · ${report.partial ? '진행 중 기간' : '종료된 기간'}`, `생성: ${report.created_at}`, `자료 기준: ${report.data_through}`, `수집 Provider: ${snapshot.providers.join(', ') || '없음'}`, '## 측정값', `검색 Top 10: ${snapshot.seo.summary.top10_percent ?? '미측정'} / AI 인용률: ${snapshot.geo.summary.citation_percent ?? '미측정'}`, `HTML 건강도: ${snapshot.scores.web_health ?? '미측정'}`, '## 요약', ...data.summaries.map(row => escape(row.content)), '## 메모', escape(report.notes), '## 액션', ...data.actions.map(row => `- [${row.status === 'done' ? 'x' : ' '}] ${escape(row.title)} · ${escape(row.priority)} · ${escape(row.due_date)}\n  ${escape(row.notes)}`), '측정 근거 전체는 JSON 다운로드에 포함됩니다.'].join('\n\n');
  return { filename: `report-${String(report.period_key).replace(/[^a-z0-9-]/gi, '')}-v${Number(report.sequence)}.${format}`, mime: format === 'json' ? 'application/json' : 'text/markdown; charset=utf-8', body: format === 'json' ? JSON.stringify({ report, summaries: data.summaries, actions: data.actions }, null, 2) : md };
}
