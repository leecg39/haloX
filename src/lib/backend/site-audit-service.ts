import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { contentText } from './content-model.ts';
import { checkContentRevision } from './content-service.ts';
import { validateAuditTarget } from './site-audit-model.ts';
import { AUDIT_ACTIVE, type AuditTarget } from '../api/site-audit.ts';

export const AUDIT_COMMANDS = ['audit-target-create', 'audit-target-update', 'audit-target-delete', 'site-audit', 'site-audit-start', 'site-audit-rerun', 'site-audit-cancel', 'site-audit-update', 'site-audit-delete', 'site-audit-issue-update'];
export const auditWhere = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id ? { id: `eq.${String(id)}` } : {}) });
export function auditItem(db: HaloXDatabase, table: string, workspace: string, id: unknown, actor: string): Row {
  if (typeof id !== 'string' || !id) throw new Error('진단 항목을 선택해 주세요.');
  const row = db.queryTable(table, { filters: auditWhere(workspace, id) }, actor).data[0];
  if (!row) throw new Error('현재 워크스페이스에서 진단 항목을 찾을 수 없습니다.');
  return row;
}
export const updateAuditScan = (db: HaloXDatabase, workspace: string, row: Row, values: Row, actor: string) => db.updateTable('site_audit_scans', { ...values, revision: Number(row.revision || 0) + 1 }, auditWhere(workspace, row.id), actor)[0];
export function runAuditCommand(db: HaloXDatabase, command: string, payload: Row, workspace: string, actor: string): Row {
  db.assertWorkspaceMember(workspace, actor);
  if (command.startsWith('audit-target-')) {
    const row = command.endsWith('-create') ? undefined : auditItem(db, 'site_audit_targets', workspace, payload.target_id, actor);
    if (row) checkContentRevision(row, payload.expected_revision);
    if (command.endsWith('-delete')) {
      if (db.queryTable('site_audit_scans', { filters: auditWhere(workspace) }, actor).data.some(scan => scan.target_id === row!.id && AUDIT_ACTIVE.includes(String(scan.status)))) throw new Error('진행 중인 진단을 먼저 취소해 주세요.');
      db.deleteTable('site_audit_targets', auditWhere(workspace, row!.id), actor); return { ok: true };
    }
    const values = validateAuditTarget(payload);
    if (db.queryTable('site_audit_targets', { filters: auditWhere(workspace) }, actor).data.some(other => other.id !== row?.id && String(other.name).toLocaleLowerCase() === values.name.toLocaleLowerCase())) throw new Error('같은 이름의 진단 대상이 있습니다.');
    const [target] = row ? db.updateTable('site_audit_targets', { ...values, notes: contentText(payload.notes, '대상 메모', 5000), revision: Number(row.revision) + 1 }, auditWhere(workspace, row.id), actor) : db.insertTable('site_audit_targets', { ...values, workspace_id: workspace, notes: contentText(payload.notes, '대상 메모', 5000), revision: 1 }, actor);
    return { ok: true, target };
  }
  if (command === 'site-audit-issue-update') {
    const row = auditItem(db, 'site_audit_issues', workspace, payload.issue_id, actor); checkContentRevision(row, payload.expected_revision);
    if (typeof payload.is_resolved !== 'boolean') throw new Error('조치 상태를 선택해 주세요.');
    const [issue] = db.updateTable('site_audit_issues', { is_resolved: payload.is_resolved, notes: contentText(payload.notes, '조치 메모', 5000), revision: Number(row.revision || 0) + 1 }, auditWhere(workspace, row.id), actor);
    return { ok: true, issue };
  }
  if (['site-audit-cancel', 'site-audit-update', 'site-audit-delete'].includes(command)) {
    const row = auditItem(db, 'site_audit_scans', workspace, payload.scan_id, actor);
    if (command === 'site-audit-cancel') {
      // Cancellation identifies an immutable run, not a page revision that advances in the worker.
      if (!AUDIT_ACTIVE.includes(String(row.status))) return { ok: true, scan: row };
      if (row.quota_status === 'reserved') db.callRpc('release_reservation', { p_reservation_id: row.reservation_id }, actor);
      db.setServerRecords('audit_work', db.getServerRecords('audit_work').filter(work => work.scan_id !== row.id));
      return { ok: true, scan: updateAuditScan(db, workspace, row, { status: 'cancelled', completed_at: new Date().toISOString(), stop_reason: 'cancelled', quota_status: row.quota_status === 'reserved' ? 'released' : row.quota_status }, actor) };
    }
    checkContentRevision(row, payload.expected_revision);
    if (AUDIT_ACTIVE.includes(String(row.status))) throw new Error('진단이 끝나거나 취소된 뒤 이력을 수정/삭제해 주세요.');
    if (command === 'site-audit-delete') { db.deleteTable('site_audit_scans', auditWhere(workspace, row.id), actor); return { ok: true }; }
    return { ok: true, scan: updateAuditScan(db, workspace, row, { name: contentText(payload.name, '진단 이름', 100, true), notes: contentText(payload.notes, '진단 메모', 5000) }, actor) };
  }
  if (!['site-audit', 'site-audit-start', 'site-audit-rerun'].includes(command)) throw new Error('지원하지 않는 진단 작업입니다.');
  const key = contentText(payload.idempotency_key, '요청 키', 100, true), fingerprint = crypto.createHash('sha256').update(JSON.stringify([command === 'site-audit-rerun' ? 'rerun' : 'start', payload.target_id ?? null, payload.scan_id ?? null, payload.expected_revision ?? null])).digest('hex');
  const previous = db.getServerRecords('audit_requests').find(row => row.workspace_id === workspace && row.actor_id === actor && row.key === key);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error('같은 요청 키를 다른 진단에 사용할 수 없습니다.');
    return { ok: true, reused: true, scan: auditItem(db, 'site_audit_scans', workspace, previous.scan_id, actor) };
  }
  let target: Row | undefined, snapshot: AuditTarget, rerun: Row | undefined;
  if (command === 'site-audit-rerun') {
    rerun = auditItem(db, 'site_audit_scans', workspace, payload.scan_id, actor); checkContentRevision(rerun, payload.expected_revision);
    if (AUDIT_ACTIVE.includes(String(rerun.status)) || !rerun.target_snapshot) throw new Error('종료된 실제 진단만 같은 범위로 다시 실행할 수 있습니다.');
    snapshot = validateAuditTarget(rerun.target_snapshot as Row);
  } else {
    target = auditItem(db, 'site_audit_targets', workspace, payload.target_id, actor); checkContentRevision(target, payload.expected_revision); snapshot = validateAuditTarget(target);
  }
  if (db.queryTable('site_audit_scans', { filters: auditWhere(workspace) }, actor).data.some(scan => scan.target_url === snapshot.target_url && AUDIT_ACTIVE.includes(String(scan.status)))) throw new Error('이 URL의 진단이 이미 진행 중입니다. 실행 이력을 확인해 주세요.');
  const id = crypto.randomUUID(), reservation = db.callRpc('reserve_unit_with_bypass', { p_workspace_id: workspace, p_unit_key: 'site_audit_scan', p_amount: 1, p_idempotency_key: `site-audit:${id}` }, actor) as Row;
  const [scan] = db.insertTable('site_audit_scans', { id, workspace_id: workspace, ...snapshot, name: snapshot.name, target_id: target?.id ?? rerun?.target_id ?? null, target_snapshot: snapshot, rerun_of: rerun?.id ?? null, provider: 'html', status: 'queued', notes: '', revision: 1, created_by: actor, crawled_urls: 0, processed_urls: 0, failed_urls: 0, skipped_urls: 0, critical_count: 0, warning_count: 0, notice_count: 0, site_health_score: null, ai_readiness_score: null, error: '', reservation_id: reservation.reservation_id, quota_status: 'reserved' }, actor);
  const workspaceRow = db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }, actor).data[0];
  // Queued work belongs to the workspace and can finish after its creator leaves.
  db.setServerRecords('audit_work', [...db.getServerRecords('audit_work'), { scan_id: id, workspace_id: workspace, actor_id: workspaceRow.owner_id, origin: new URL(snapshot.target_url).origin, pending: [{ url: snapshot.target_url, depth: 0 }], visited: [], lease_until: 0, next_at: 0, attempts: 0 }]);
  db.setServerRecords('audit_requests', [...db.getServerRecords('audit_requests'), { workspace_id: workspace, actor_id: actor, key, fingerprint, scan_id: id }]);
  return { ok: true, reused: false, scan };
}
