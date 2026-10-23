import crypto from 'node:crypto';
import { haloxStore, type PersistentHaloXStore } from './store.ts';
import { fetchAuditPage, type AuditFetcher } from './site-audit-fetch.ts';
import { createPolicyState, stepPolicy, policyReport, type PolicyState } from './site-policy.ts';
import type { Row } from './database.ts';
import type { AuditTarget } from '../api/site-audit.ts';
type Work = Row & { job_id: string; workspace_id: string; actor_id: string; targets: { scan_id: string; target: AuditTarget }[]; cursor: number; state: PolicyState; lease_until: number; next_at: number; attempts: number; lease_token?: string; lease_origin?: string };
export async function processPolicyTick(store: PersistentHaloXStore = haloxStore, fetcher: AuditFetcher = fetchAuditPage, now = Date.now): Promise<boolean> {
  if (!await store.read(db => db.getServerRecords('site_policy_work').some(row => Number(row.lease_until) <= now() && Number(row.next_at) <= now()))) return false;
  const claimed = await store.write(db => {
    const work = db.getServerRecords('site_policy_work') as Work[], hosts = db.getServerRecords('audit_hosts').filter(row => Number(row.next_at) > now() || Number(row.lease_until) > now());
    const item = work.find(row => row.lease_until <= now() && row.next_at <= now() && !hosts.some(host => host.origin === new URL(row.state.queue[0].url).origin && (Number(host.next_at) > now() || Number(host.lease_until) > now())));
    if (!item) return null;
    const job = db.queryTable('site_policy_jobs', { filters: { id: `eq.${item.job_id}`, workspace_id: `eq.${item.workspace_id}` } }, item.actor_id).data[0];
    if (!job || !['queued', 'running'].includes(String(job.status))) { db.setServerRecords('site_policy_work', work.filter(row => row !== item)); return null; }
    if (item.attempts >= 3) { db.updateTable('site_policy_jobs', { status: 'failed', error: '반복 중단으로 보완을 종료했습니다.', completed_at: new Date(now()).toISOString(), revision: Number(job.revision) + 1 }, { id: `eq.${job.id}` }, item.actor_id); db.setServerRecords('site_policy_work', work.filter(row => row !== item)); return null; }
    item.lease_token = crypto.randomUUID(); item.lease_until = now() + 45000; item.attempts++; item.lease_origin = new URL(item.state.queue[0].url).origin;
    db.setServerRecords('audit_hosts', [...hosts.filter(row => row.origin !== item.lease_origin), { origin: item.lease_origin, lease_token: item.lease_token, lease_until: item.lease_until, next_at: now() }]); db.setServerRecords('site_policy_work', work);
    db.updateTable('site_policy_jobs', { status: 'running', started_at: job.started_at || new Date(now()).toISOString(), revision: Number(job.revision) + 1 }, { id: `eq.${job.id}` }, item.actor_id);
    return item;
  });
  if (!claimed) return false;
  const state = await stepPolicy(claimed.state, fetcher, now());
  await store.write(db => {
    const work = db.getServerRecords('site_policy_work') as Work[], current = work.find(row => row.job_id === claimed.job_id), hosts = db.getServerRecords('audit_hosts'), host = hosts.find(row => row.lease_token === claimed.lease_token);
    if (host) { host.lease_until = 0; host.next_at = now() + state.crawl_delay * 1000; db.setServerRecords('audit_hosts', hosts); }
    if (!current || current.lease_token !== claimed.lease_token) return;
    const job = db.queryTable('site_policy_jobs', { filters: { id: `eq.${claimed.job_id}` } }, claimed.actor_id).data[0]; if (!job) return;
    current.state = state; current.attempts = 0; current.lease_until = 0; current.next_at = now() + state.crawl_delay * 1000;
    if (!state.queue.length) {
      const scanId = current.targets[current.cursor].scan_id, scan = db.queryTable('site_audit_scans', { filters: { id: `eq.${scanId}`, workspace_id: `eq.${claimed.workspace_id}` } }, claimed.actor_id).data[0], report = policyReport(state);
      // Keep historical HTML measurements and original policy evidence unchanged.
      if (scan) db.updateTable('site_audit_scans', { sitemap_backfill_report: { ...report, job_id: job.id }, revision: Number(scan.revision || 0) + 1 }, { id: `eq.${scanId}` }, claimed.actor_id);
      const result = { scan_id: scanId, target_url: state.target.target_url, checked_at: state.checked_at, sitemap_urls: report.sitemap_urls, complete: report.complete && !!scan, error: scan ? report.fatal || (report.complete ? '' : '일부 정책 파일을 확인하지 못했거나 점검 한도에 도달했습니다.') : '진단 이력이 삭제되어 반영하지 않았습니다.' };
      const results = [...job.results as Row[], result]; current.cursor++;
      const done = current.cursor === current.targets.length;
      db.updateTable('site_policy_jobs', { processed: current.cursor, failed: results.filter(row => !row.complete).length, results, revision: Number(job.revision) + 1, ...(done ? { status: results.every(row => row.complete) ? 'completed' : 'partial', completed_at: new Date(now()).toISOString() } : {}) }, { id: `eq.${job.id}` }, claimed.actor_id);
      if (done) { db.setServerRecords('site_policy_work', work.filter(row => row !== current)); return; }
      current.state = createPolicyState(current.targets[current.cursor].target, job.policy_snapshot as Row, 'backfill');
    }
    db.setServerRecords('site_policy_work', work);
  });
  return true;
}
