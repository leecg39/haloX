import crypto from 'node:crypto';
import { createPolicyState, stepPolicy, policyReport, type PolicyState } from './site-policy.ts';
import { processPolicyTick } from './site-policy-worker.ts';
import robotsParser from 'robots-parser';
import { haloxStore, type PersistentHaloXStore } from './store.ts';
import type { Row } from './database.ts';
import { AUDIT_ACTIVE, type AuditTarget } from '../api/site-audit.ts';
import { auditInScope } from './site-audit-model.ts';
import { AUDIT_AGENT, fetchAuditPage, type AuditFetcher } from './site-audit-fetch.ts';
import { inspectAuditHtml, type AuditLink } from './site-audit-html.ts';
import { auditItem, auditWhere, updateAuditScan } from './site-audit-service.ts';

type Pending = { url: string; depth: number };
type Work = Row & { scan_id: string; workspace_id: string; actor_id: string; origin: string; pending: Pending[]; visited: string[]; lease_until: number; next_at: number; lease_token?: string; lease_origin?: string; policy_state?: PolicyState; policy_done?: boolean; robots_text?: string; crawl_delay?: number; attempts: number };
const LEASE_MS = 45000;

/** One durable page checkpoint per tick. Multiple workers share leases and host pacing. */
export async function processAuditTick(store: PersistentHaloXStore = haloxStore, fetcher: AuditFetcher = fetchAuditPage, now = Date.now): Promise<boolean> {
  if (!await store.read(db => db.getServerRecords('audit_work').some(row => Number(row.lease_until) <= now() && Number(row.next_at) <= now()))) return false;
  const claimed = await store.write(db => {
    const work = db.getServerRecords('audit_work') as Work[], hosts = db.getServerRecords('audit_hosts').filter(row => Number(row.next_at) > now() || Number(row.lease_until) > now());
    const item = work.find(row => row.lease_until <= now() && row.next_at <= now() && !hosts.some(host => host.origin === (row.policy_state?.queue[0] ? new URL(row.policy_state.queue[0].url).origin : row.origin) && (Number(host.lease_until) > now() || Number(host.next_at) > now())));
    if (!item) return null;
    const scan = auditItem(db, 'site_audit_scans', item.workspace_id, item.scan_id, item.actor_id);
    if (!AUDIT_ACTIVE.includes(String(scan.status))) { db.setServerRecords('audit_work', work.filter(row => row.scan_id !== item.scan_id)); return null; }
    // A crashed/abandoned page gets at most three leases, never an endless retry loop.
    if (item.attempts >= 3) {
      updateAuditScan(db, item.workspace_id, scan, { status: 'failed', error: '작업이 반복 중단되어 진단을 종료했습니다. 새 진단으로 다시 실행해 주세요.', completed_at: new Date(now()).toISOString(), stop_reason: 'interrupted' }, item.actor_id);
      db.setServerRecords('audit_work', work.filter(row => row.scan_id !== item.scan_id)); return null;
    }
    item.lease_token = crypto.randomUUID(); item.lease_until = now() + LEASE_MS; item.attempts++;
    item.lease_origin = item.policy_state?.queue[0] ? new URL(item.policy_state.queue[0].url).origin : item.origin;
    const host = { origin: item.lease_origin, lease_token: item.lease_token, lease_until: item.lease_until, next_at: now() };
    db.setServerRecords('audit_hosts', [...hosts.filter(row => row.origin !== item.lease_origin), host]); db.setServerRecords('audit_work', work);
    if (scan.quota_status === 'reserved') db.callRpc('commit_reservation', { p_reservation_id: scan.reservation_id }, item.actor_id);
    const updated = updateAuditScan(db, item.workspace_id, scan, { status: 'running', started_at: scan.started_at || new Date(now()).toISOString(), quota_status: 'committed', last_progress_at: new Date(now()).toISOString() }, item.actor_id);
    return { work: item, scan: updated };
  });
  if (!claimed) return false;
  const { work, scan } = claimed, target = scan.target_snapshot as AuditTarget, pending = work.pending[0];
  if (!work.policy_done) {
    const state = await stepPolicy(work.policy_state || createPolicyState(target, scan.policy_snapshot as Row || {}), fetcher, now());
    await store.write(db => {
      const all = db.getServerRecords('audit_work') as Work[], current = all.find(row => row.scan_id === work.scan_id), hosts = db.getServerRecords('audit_hosts'), host = hosts.find(row => row.lease_token === work.lease_token);
      if (host) { host.lease_until = 0; host.next_at = now() + state.crawl_delay * 1000; db.setServerRecords('audit_hosts', hosts); }
      if (!current || current.lease_token !== work.lease_token) return;
      const row = auditItem(db, 'site_audit_scans', work.workspace_id, work.scan_id, work.actor_id);
      current.policy_state = state; current.lease_until = 0; current.next_at = now() + state.crawl_delay * 1000; current.attempts = 0;
      const report = policyReport(state);
      if (state.fatal) {
        updateAuditScan(db, work.workspace_id, row, { policy_report: report, status: 'failed', error: state.fatal, completed_at: new Date(now()).toISOString(), stop_reason: 'robots_error' }, work.actor_id);
        db.setServerRecords('audit_work', all.filter(item => item !== current)); return;
      }
      if (!state.queue.length) {
        current.policy_done = true; current.robots_text = state.robots_text; current.crawl_delay = state.crawl_delay;
        if (target.max_depth > 0) for (const url of report.sample_urls) {
          if (current.pending.length >= target.max_pages) break;
          if (!current.pending.some(item => item.url === url)) current.pending.push({ url, depth: 1 });
        }
        delete current.policy_state;
      }
      updateAuditScan(db, work.workspace_id, row, { policy_report: report, robots_checked_at: state.documents.find(item => item.kind === 'robots')?.checked_at, crawl_delay: state.crawl_delay, last_progress_at: new Date(now()).toISOString() }, work.actor_id);
      db.setServerRecords('audit_work', all);
    });
    return true;
  }
  let result: ReturnType<typeof inspectAuditHtml> | undefined, finalUrl = pending.url, fatal = '', robotsText = work.robots_text || '', delay = work.crawl_delay || 1;
  try {
    const rules = robotsParser(work.origin + '/robots.txt', robotsText), configuredDelay = rules.getCrawlDelay(AUDIT_AGENT);
    if (configuredDelay !== undefined && (!Number.isFinite(configuredDelay) || configuredDelay > 86400)) throw new Error('robots.txt의 수집 대기 시간이 지원 범위를 초과했습니다.');
    delay = Math.max(1, configuredDelay || 1);
    const allowed = (url: string) => auditInScope(url, target) && rules.isAllowed(url, AUDIT_AGENT) === true;
    if (!allowed(pending.url)) result = { page: { status_code: null, fetch_status: 'skipped', title: '', links: [], error: '수집 범위 또는 robots.txt에서 제외됨' }, issues: [] };
    else {
      try { const response = await fetcher(pending.url, allowed); finalUrl = response.url; result = inspectAuditHtml(response); }
      catch (cause) { result = { page: { status_code: null, fetch_status: 'failed', title: '', links: [], error: cause instanceof Error ? cause.message : '페이지 수집 실패' }, issues: [{ issue_type: 'fetch_failed', category: 'http', severity: 'critical', title: '페이지 수집 실패', description: cause instanceof Error ? cause.message : '연결 실패', fix_recommendation: '공개 URL, 응답 시간, HTTPS 인증서와 수집 범위를 확인하세요.', is_resolved: false, notes: '', revision: 1 }] }; }
    }
  } catch (cause) { fatal = cause instanceof Error ? cause.message : '수집 정책을 확인하지 못했습니다.'; }
  await store.write(db => {
    const allWork = db.getServerRecords('audit_work') as Work[], current = allWork.find(row => row.scan_id === work.scan_id);
    const hosts = db.getServerRecords('audit_hosts'); const host = hosts.find(row => row.origin === work.origin && row.lease_token === work.lease_token);
    if (host) { host.lease_until = 0; host.next_at = now() + delay * 1000; db.setServerRecords('audit_hosts', hosts); }
    if (!current || current.lease_token !== work.lease_token) return; // cancelled or taken over by another process
    const row = auditItem(db, 'site_audit_scans', work.workspace_id, work.scan_id, work.actor_id);
    if (!AUDIT_ACTIVE.includes(String(row.status))) return;
    if (fatal) {
      updateAuditScan(db, work.workspace_id, row, { status: 'failed', error: fatal, completed_at: new Date(now()).toISOString(), stop_reason: 'robots_error' }, work.actor_id);
      db.setServerRecords('audit_work', allWork.filter(item => item.scan_id !== row.id)); return;
    }
    const [page] = db.insertTable('site_audit_pages', { ...result!.page, workspace_id: work.workspace_id, scan_id: row.id, url: pending.url, final_url: finalUrl, depth: pending.depth, fetched_at: new Date(now()).toISOString() }, work.actor_id);
    if (result!.issues.length) db.insertTable('site_audit_issues', result!.issues.map(issue => ({ ...issue, workspace_id: work.workspace_id, scan_id: row.id, page_id: page.id, page_url: pending.url })), work.actor_id);
    current.visited.push(pending.url, finalUrl); current.pending.shift(); current.robots_text = robotsText; current.crawl_delay = delay; current.lease_until = 0; current.next_at = now() + delay * 1000; current.attempts = 0;
    const rules = robotsParser(work.origin + '/robots.txt', robotsText!);
    if (pending.depth < target.max_depth) for (const link of (page.links as AuditLink[] || [])) {
      if (current.pending.length + Number(row.processed_urls) + 1 >= target.max_pages) break;
      if (link.internal && !link.nofollow && auditInScope(link.url, target) && rules.isAllowed(link.url, AUDIT_AGENT) === true && !current.visited.includes(link.url) && !current.pending.some(item => item.url === link.url)) current.pending.push({ url: link.url, depth: pending.depth + 1 });
    }
    current.pending = current.pending.filter(item => !current.visited.includes(item.url));
    const pages = db.queryTable('site_audit_pages', { filters: { ...auditWhere(work.workspace_id), scan_id: `eq.${row.id}` } }, work.actor_id).data, issues = db.queryTable('site_audit_issues', { filters: { ...auditWhere(work.workspace_id), scan_id: `eq.${row.id}` } }, work.actor_id).data;
    const fetched = pages.filter(page => page.fetch_status === 'fetched'), failed = pages.filter(page => page.fetch_status === 'failed'), done = pages.length >= target.max_pages || !current.pending.length;
    updateAuditScan(db, work.workspace_id, row, { processed_urls: pages.length, crawled_urls: fetched.length, failed_urls: failed.length, skipped_urls: pages.length - fetched.length - failed.length, critical_count: issues.filter(issue => issue.severity === 'critical').length, warning_count: issues.filter(issue => issue.severity === 'warning').length, notice_count: issues.filter(issue => issue.severity === 'notice').length, site_health_score: fetched.length ? Math.round(fetched.reduce((sum, page) => sum + Number(page.html_score), 0) / fetched.length) : null, last_progress_at: new Date(now()).toISOString(), ...(done ? { status: fetched.length ? 'completed' : 'failed', completed_at: new Date(now()).toISOString(), stop_reason: pages.length >= target.max_pages ? 'page_limit' : 'scope_exhausted', error: fetched.length ? '' : '진단 가능한 HTML 페이지를 수집하지 못했습니다. 페이지별 오류와 수집 범위를 확인해 주세요.' } : {}) }, work.actor_id);
    db.setServerRecords('audit_work', done ? allWork.filter(item => item.scan_id !== row.id) : allWork);
  });
  return true;
}

export function startAuditWorker(store: PersistentHaloXStore = haloxStore, intervalMs = 1000) {
  let busy = false, stopped = false;
  const tick = async () => { if (busy || stopped) return; busy = true; try { await processAuditTick(store); await processPolicyTick(store); } catch { console.error('HaloX: 사이트 진단 작업을 저장하지 못했습니다. 저장된 작업은 다음 주기에 확인합니다.'); } finally { busy = false; } };
  const timer = setInterval(() => { void tick(); }, Math.max(1000, intervalMs)); timer.unref(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
