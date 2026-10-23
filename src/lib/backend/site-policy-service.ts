import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { contentText } from './content-model.ts';
import { checkContentRevision } from './content-service.ts';
import { createPolicyState, policyUrls } from './site-policy.ts';
import { validateAuditTarget } from './site-audit-model.ts';
import { AUDIT_ACTIVE } from '../api/site-audit.ts';

export type PolicyPrivateCollection = 'site_policy_work' | 'site_policy_requests';
export function policyCommand(db: HaloXDatabase, workspace: string, actor: string, input: Row): Row {
  db.assertWorkspaceAccess(workspace, actor, 'strategy', 'write');
  const where = { workspace_id: `eq.${workspace}` }, ws = db.queryTable('workspaces', { filters: { id: `eq.${workspace}` } }, actor).data[0];
  if (input.action === 'policy-update' || input.action === 'policy-reset') {
    checkContentRevision(ws, input.expected_revision);
    return { ok: true, workspace: db.updateTable('workspaces', policyUrls(input.action === 'policy-reset' ? {} : input), { id: `eq.${workspace}` }, actor)[0] };
  }
  const jobs = db.queryTable('site_policy_jobs', { filters: where }, actor).data;
  if (input.action === 'sitemap-backfill-start') {
    const request = contentText(input.request_id, '요청 키', 100, true), requests = db.getServerRecords('site_policy_requests'), previous = requests.find(row => row.workspace_id === workspace && row.actor === actor && row.request_id === request);
    if (previous) return { ok: true, reused: true, job: jobs.find(row => row.id === previous.job_id) || null };
    checkContentRevision(ws, input.expected_revision);
    if (jobs.some(row => AUDIT_ACTIVE.includes(String(row.status)))) throw new Error('진행 중인 사이트맵 보완을 먼저 마치거나 취소해 주세요.');
    const scans = db.queryTable('site_audit_scans', { filters: where, order: 'created_at.desc' }, actor).data.filter(row => !AUDIT_ACTIVE.includes(String(row.status)));
    if (!scans.length) throw new Error('완료되거나 종료된 진단이 없습니다.');
    if (scans.length > 100) throw new Error('한 번에 최대 100개 진단을 보완합니다. 오래된 진단 이력을 정리해 주세요.');
    if (jobs.length >= 100) throw new Error('보완 이력은 최대 100개입니다. 종료된 이력을 정리해 주세요.');
    const targets = scans.map(scan => ({ scan_id: scan.id, target: validateAuditTarget(scan.target_snapshot as Row || { name: String(scan.name || '기존 진단'), target_url: scan.target_url, max_pages: 1, max_depth: 0, scope_rules: { include_paths: [], exclude_paths: [] } }) }));
    const id = crypto.randomUUID(), urls = policyUrls(ws);
    const [job] = db.insertTable('site_policy_jobs', { id, workspace_id: workspace, name: '기존 진단 사이트맵 보완', notes: '', status: 'queued', revision: 1, total: targets.length, processed: 0, failed: 0, results: [], policy_snapshot: urls, created_by: actor }, actor);
    db.setServerRecords('site_policy_work', [...db.getServerRecords('site_policy_work'), { job_id: id, workspace_id: workspace, actor_id: ws.owner_id, targets, cursor: 0, state: createPolicyState(targets[0].target, urls, 'backfill'), lease_until: 0, next_at: 0, attempts: 0 }]);
    db.setServerRecords('site_policy_requests', [...requests, { workspace_id: workspace, actor, request_id: request, job_id: id }]);
    return { ok: true, job };
  }
  const job = jobs.find(row => row.id === input.job_id); if (!job) throw new Error('보완 이력을 찾을 수 없습니다.');
  const drop = () => db.setServerRecords('site_policy_work', db.getServerRecords('site_policy_work').filter(row => row.job_id !== job.id));
  if (input.action === 'sitemap-backfill-cancel') {
    if (!AUDIT_ACTIVE.includes(String(job.status))) return { ok: true, job };
    drop(); return { ok: true, job: db.updateTable('site_policy_jobs', { status: 'cancelled', completed_at: new Date().toISOString(), revision: Number(job.revision) + 1 }, { ...where, id: `eq.${job.id}` }, actor)[0] };
  }
  checkContentRevision(job, input.expected_revision);
  if (AUDIT_ACTIVE.includes(String(job.status))) throw new Error('진행 중인 보완은 먼저 취소해 주세요.');
  if (input.action === 'sitemap-backfill-delete') { drop(); db.deleteTable('site_policy_jobs', { ...where, id: `eq.${job.id}` }, actor); return { ok: true }; }
  if (input.action === 'sitemap-backfill-update') return { ok: true, job: db.updateTable('site_policy_jobs', { name: contentText(input.name, '보완 이름', 100, true), notes: contentText(input.notes, '메모', 5000), revision: Number(job.revision) + 1 }, { ...where, id: `eq.${job.id}` }, actor)[0] };
  throw new Error('지원하지 않는 정책 작업입니다.');
}
