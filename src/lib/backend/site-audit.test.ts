import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_WORKSPACE_ID as WS, DEFAULT_USER_ID as ACTOR, OTHER_USER_ID, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { ContentConflictError } from './content-model.ts';
import { processAuditTick } from './site-audit-worker.ts';
import { fetchAuditPage, type AuditFetcher, type AuditResponse } from './site-audit-fetch.ts';
import { inspectAuditHtml } from './site-audit-html.ts';
import { assertRestWrite } from './rest-policy.ts';

type R = Row & { id: string; revision: number };
type Result = { target: R; scan: R; issue: R; reused: boolean };
const config = { name: '문서 사이트', target_url: 'https://audit.example.com/', max_pages: 10, max_depth: 2, scope_rules: { include_paths: [], exclude_paths: ['/excluded'] } };
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
const html = (content = '', title = '사용 안내') => `<html lang="ko"><head><title>${title}</title><meta name="description" content="제품 설명"><link rel="canonical" href="https://audit.example.com/"></head><body><h1>사용법</h1>${content}</body></html>`;
const documents: Record<string, string> = { '/': html('<a href="/docs">문서</a><a href="/missing">오류</a><a href="/blocked">차단</a><a href="/excluded">제외</a><a href="/nofollow" rel="nofollow">제외</a><a href="https://elsewhere.example/">외부</a><a href="http://127.0.0.1/">내부 IP</a><a href="/search?q=1">검색</a>'), '/docs': '<html><body><h1>문서</h1><img src="x.png"><script type="application/ld+json">invalid</script><a href="/deep">하위 문서</a></body></html>', '/deep': html() };
const fixtureFetch: AuditFetcher = async (url, allowed) => {
  assert.equal(allowed(url), true); const pathname = new URL(url).pathname;
  return { url, status: pathname === '/missing' ? 404 : 200, content_type: pathname === '/robots.txt' ? 'text/plain' : 'text/html', body: pathname === '/robots.txt' ? 'User-agent: *\nDisallow: /blocked\nCrawl-delay: 2' : documents[pathname] || '', robots_header: '', redirects: [] };
};
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-audit-')); directories.push(directory);
  const filename = path.join(directory, 'data.sqlite'), store = new PersistentHaloXStore(filename); let time = Date.now();
  const now = () => time, advance = (ms = 10000) => { time += ms; };
  const invoke = (name: string, values: Row = {}, actor = ACTOR) => store.write(db => db.invokeEdgeFunction(name, { workspace_id: WS, ...values }, actor)) as Promise<Result>;
  const rows = (table: string, scanId?: string) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${WS}`, ...(scanId ? { scan_id: `eq.${scanId}` } : {}) } }, ACTOR).data as R[]);
  async function start(options = config) { await store.write(db => db.updateTable('workspaces', { robots_txt_url: null, sitemap_url: null, llms_txt_url: null }, { id: `eq.${WS}` })); const { target } = await invoke('audit-target-create', options); const values = { target_id: target.id, expected_revision: 1, idempotency_key: 'audit-once' }; const { scan } = await invoke('site-audit-start', values); return { target, scan, values }; }
  async function drain(fetcher = fixtureFetch) { for (let i = 0; i < 20; i++) { advance(); await processAuditTick(store, fetcher, now); if (!(await store.read(db => db.getServerRecords('audit_work'))).length) return; } throw new Error('Did not finish fixture audit'); }
  const scan = async (id: string) => (await rows('site_audit_scans')).find(row => row.id === id)!;
  return { store, filename, invoke, rows, start, drain, now, advance, scan };
}

describe('site audit targets and durable crawler', () => {
  it('validates targets and scope, preserves run snapshots, and protects active targets/workspaces from deletion', async () => {
    const f = fixture();
    for (const patch of [{ target_url: 'http://localhost/' }, { target_url: 'https://x.example/?token=private' }, { max_pages: 101 }, { max_depth: -1 }, { scope_rules: { include_paths: ['/docs'], exclude_paths: [] } }, { scope_rules: { include_paths: [], exclude_paths: ['/*'] } }]) await assert.rejects(f.invoke('audit-target-create', { ...config, ...patch }));
    for (const path of ['/docs%00', '/docs%5Cprivate', '/%2Fhost', '/docs%3Fquery', '/%2A']) await assert.rejects(f.invoke('audit-target-create', { ...config, scope_rules: { include_paths: [], exclude_paths: [path] } }), /경로 인코딩/);
    const { target, scan } = await f.start(); await assert.rejects(f.invoke('audit-target-create', config), /같은 이름/);
    await f.invoke('audit-target-update', { ...config, target_id: target.id, expected_revision: 1, max_pages: 1, name: '수정 대상' });
    assert.equal(((await f.scan(scan.id)).target_snapshot as Row).max_pages, 10);
    await assert.rejects(f.invoke('audit-target-update', { ...config, target_id: target.id, expected_revision: 1 }), ContentConflictError);
    await assert.rejects(f.invoke('audit-target-delete', { target_id: target.id, expected_revision: 2 }), /먼저 취소/);
    await assert.rejects(f.store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` }, ACTOR)), /먼저 취소/);
    await f.invoke('site-audit-cancel', { scan_id: scan.id }); await f.invoke('audit-target-delete', { target_id: target.id, expected_revision: 2 }); assert.equal((await f.scan(scan.id)).target_id, null);
  });

  it('crawls actual fixture HTML within scope/depth/robots, links issues to their page, computes real summaries and persists across restart', async () => {
    const f = fixture(), { scan, values } = await f.start(); const fetched: string[] = [];
    await f.drain(async (...args) => { fetched.push(args[0]); return fixtureFetch(...args); });
    assert.deepEqual(fetched.map(url => new URL(url).pathname), ['/robots.txt', '/sitemap.xml', '/llms.txt', '/', '/docs', '/missing', '/deep']);
    const finished = await f.scan(scan.id); assert.equal(finished.status, 'completed'); assert.equal(finished.crawled_urls, 3); assert.equal(finished.failed_urls, 1); assert.equal(finished.ai_readiness_score, null); assert.ok(Number(finished.site_health_score) < 100);
    const pages = await f.rows('site_audit_pages', scan.id), issues = await f.rows('site_audit_issues', scan.id); assert.equal(pages.length, 4); assert.ok(issues.some(issue => issue.issue_type === 'jsonld_invalid'));
    for (const issue of issues) assert.equal(pages.find(page => page.id === issue.page_id)!.url, issue.page_url);
    assert.equal(pages.some(page => page.lighthouse_data), false);
    const summary = await f.store.read(db => db.callRpc('site_audit_links_summary', { workspace_id: WS, scan_id: scan.id }, ACTOR)) as Row; assert.equal(summary.pages_4xx_count, 1); assert.equal((summary.broken_pages as string[])[0], 'https://audit.example.com/missing'); assert.equal(summary.orphan_detection, 'not_measured');
    const restarted = new PersistentHaloXStore(f.filename); assert.deepEqual(await restarted.read(db => db.queryTable('site_audit_pages', { filters: { scan_id: `eq.${scan.id}` } }, ACTOR).data), pages);
    assert.equal((await f.invoke('site-audit-start', values)).scan.id, scan.id); await assert.rejects(f.invoke('site-audit-start', { ...values, expected_revision: 99 }), /같은 요청 키/);
    const issue = issues[0]; await f.invoke('site-audit-issue-update', { issue_id: issue.id, expected_revision: 1, is_resolved: true, notes: '수정 확인' }); assert.equal((await f.rows('site_audit_issues', scan.id))[0].notes, '수정 확인');
    assert.equal((await f.scan(scan.id)).site_health_score, finished.site_health_score);
    const edited = await f.invoke('site-audit-update', { scan_id: scan.id, expected_revision: finished.revision, name: '검토한 진단', notes: '보관 메모' }); assert.equal(edited.scan.notes, '보관 메모');
    const rerun = await f.invoke('site-audit-rerun', { scan_id: scan.id, expected_revision: edited.scan.revision, idempotency_key: 'rerun-once' }); assert.equal(rerun.scan.rerun_of, scan.id);
    await f.invoke('site-audit-cancel', { scan_id: rerun.scan.id }); await f.invoke('site-audit-delete', { scan_id: scan.id, expected_revision: edited.scan.revision });
    assert.equal((await f.rows('site_audit_pages', scan.id)).length, 0); assert.equal((await f.rows('site_audit_issues', scan.id)).length, 0); assert.equal((await f.scan(rerun.scan.id)).rerun_of, null);
    await assert.rejects(f.invoke('site-audit-start', values), /찾을 수 없습니다/); assert.equal((await f.store.read(db => db.getServerRecords('audit_requests'))).length, 2);
  });

  it('uses max page/depth limits, releases queued cancellation and retains started usage and partial results', async () => {
    const f = fixture(), { scan } = await f.start({ ...config, max_pages: 1, max_depth: 0 }); await f.drain();
    assert.equal((await f.rows('site_audit_pages', scan.id)).length, 1); assert.equal((await f.scan(scan.id)).stop_reason, 'page_limit');
    const queued = await f.invoke('site-audit-rerun', { scan_id: scan.id, expected_revision: (await f.scan(scan.id)).revision, idempotency_key: 'cancel-queued' });
    await f.invoke('site-audit-cancel', { scan_id: queued.scan.id }); assert.equal((await f.scan(queued.scan.id)).quota_status, 'released');
    const running = await f.invoke('site-audit-rerun', { scan_id: scan.id, expected_revision: (await f.scan(scan.id)).revision, idempotency_key: 'cancel-running' });
    f.advance(); await processAuditTick(f.store, fixtureFetch, f.now); assert.equal((await f.scan(running.scan.id)).status, 'running');
    await f.invoke('site-audit-cancel', { scan_id: running.scan.id }); assert.equal((await f.scan(running.scan.id)).quota_status, 'committed');
    assert.equal((await f.store.read(db => db.getServerRecords('audit_work'))).length, 0);
  });

  it('shares worker leases, does not hold a write lock during fetch and discards late results after cancellation', async () => {
    const f = fixture(), { scan } = await f.start(); await processAuditTick(f.store, fixtureFetch, f.now); f.advance();
    let release!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
    const pending = processAuditTick(f.store, async (...args) => { calls++; entered(); await gate; return fixtureFetch(...args); }, f.now); await started;
    try { assert.equal(await processAuditTick(new PersistentHaloXStore(f.filename), fixtureFetch, f.now), false); await f.invoke('site-audit-cancel', { scan_id: scan.id }); } finally { release(); }
    await pending; assert.equal(calls, 1); assert.equal((await f.rows('site_audit_pages', scan.id)).length, 0); assert.equal((await f.scan(scan.id)).status, 'cancelled');
  });

  it('honors crawl delay, recovers expired leases and stops repeatedly interrupted work', async () => {
    const f = fixture(), { scan } = await f.start(); await processAuditTick(f.store, fixtureFetch, f.now); assert.equal(await processAuditTick(f.store, fixtureFetch, f.now), false); f.advance(1999); assert.equal(await processAuditTick(f.store, fixtureFetch, f.now), false); f.advance(1); assert.equal(await processAuditTick(f.store, fixtureFetch, f.now), true);
    await f.store.write(db => { const work = db.getServerRecords('audit_work'); work[0].lease_until = f.now() + 45000; work[0].attempts = 2; db.setServerRecords('audit_work', work); });
    f.advance(45001); assert.equal(await processAuditTick(new PersistentHaloXStore(f.filename), fixtureFetch, f.now), true);
    await f.store.write(db => { const work = db.getServerRecords('audit_work'); work[0].lease_until = 0; work[0].attempts = 3; db.setServerRecords('audit_work', work); });
    f.advance(); await processAuditTick(f.store, fixtureFetch, f.now); assert.equal((await f.scan(scan.id)).status, 'failed'); assert.match(String((await f.scan(scan.id)).error), /반복 중단/);
  });

  it('fails honestly for robots/network errors and never fetches disallowed roots', async () => {
    const blocked = fixture(), first = await blocked.start(); let calls = 0;
    await blocked.drain(async (url) => { calls++; return { url, status: 200, content_type: 'text/plain', robots_header: '', redirects: [], body: 'User-agent: *\nDisallow: /' }; });
    assert.equal(calls, 1); assert.equal((await blocked.scan(first.scan.id)).status, 'failed'); assert.equal((await blocked.scan(first.scan.id)).skipped_urls, 1);
    const broken = fixture(), second = await broken.start(); await broken.drain(async url => ({ url, status: 503, body: '', content_type: 'text/plain', robots_header: '', redirects: [] })); assert.equal((await broken.scan(second.scan.id)).stop_reason, 'robots_error'); assert.equal((await broken.rows('site_audit_pages', second.scan.id)).length, 0);
  });

  it('protects tenant data and result fields from public REST and cleans the workspace private queue/request records', async () => {
    const f = fixture(), { target, scan } = await f.start(); await assert.rejects(f.invoke('audit-target-update', { ...config, target_id: target.id, expected_revision: 1 }, OTHER_USER_ID), /not authorized/i);
    await assert.rejects(f.invoke('site-audit-cancel', { scan_id: scan.id }, OTHER_USER_ID), /not authorized/i);
    await f.store.read(db => { for (const table of ['site_audit_targets', 'site_audit_scans', 'site_audit_pages', 'site_audit_issues']) for (const method of ['POST', 'PATCH', 'DELETE'] as const) assert.throws(() => assertRestWrite(db, table, method, ACTOR, { workspace_id: WS }, { id: `eq.${scan.id}` }), /전용 서버/); });
    await f.invoke('site-audit-cancel', { scan_id: scan.id }); await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` }, ACTOR)); assert.equal((await f.store.read(db => db.getServerRecords('audit_requests'))).length, 0); assert.equal((await f.store.read(db => db.getServerRecords('audit_work'))).length, 0);
  });
});

describe('safe audit transport and HTML evidence', () => {
  it('blocks private/mixed DNS, credentials, scope escapes and redirected private addresses before I/O', async () => {
    const request = async () => ({ status: 200, type: 'text/html', body: Buffer.from(html()), robots: '' });
    for (const url of ['http://localhost', 'http://169.254.169.254/', 'http://user:pass@public.example/']) await assert.rejects(fetchAuditPage(url, () => true, { request }));
    await assert.rejects(fetchAuditPage('https://public.example/', () => true, { resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], request }), /내부 네트워크/);
    let calls = 0; const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
    await assert.rejects(fetchAuditPage('https://public.example/', url => new URL(url).origin === 'https://public.example', { resolve, request: async () => { calls++; return { status: 302, type: 'text/html', location: 'https://elsewhere.example/', body: Buffer.alloc(0), robots: '' }; } }), /수집 범위/); assert.equal(calls, 1);
    await assert.rejects(fetchAuditPage('https://public.example/', () => true, { resolve, request: async () => ({ status: 302, type: 'text/html', location: 'http://127.0.0.1/', body: Buffer.alloc(0), robots: '' }) }), /내부 네트워크/);
    await assert.rejects(fetchAuditPage('https://public.example/', () => true, { timeoutMs: 3, resolve: async () => new Promise(() => {}), request }), /초과/);
    const fetched = await fetchAuditPage('https://public.example/', () => true, { resolve, request }); assert.equal(fetched.status, 200); assert.equal(fetched.body, html());
  });

  it('reports only observed HTML conditions and treats noindex/empty alt/JSON syntax explicitly', () => {
    const response: AuditResponse = { url: 'https://public.example/', status: 200, content_type: 'text/html', body: html('<img alt="" src="decorative"><script type="application/ld+json">{"@type":"Thing"}</script>'), robots_header: 'noindex', redirects: [] };
    const result = inspectAuditHtml(response); assert.equal(result.issues.some(issue => issue.issue_type === 'image_alt_missing'), false); assert.equal(result.issues.some(issue => issue.issue_type === 'jsonld_invalid'), false); assert.equal(result.issues.some(issue => issue.issue_type === 'noindex'), true);
    assert.equal(result.page.html_score, 90); assert.equal(result.page.lighthouse_data, undefined);
    assert.equal(inspectAuditHtml({ ...response, status: 404 }).page.fetch_status, 'failed'); assert.equal(inspectAuditHtml({ ...response, content_type: 'application/pdf' }).page.fetch_status, 'skipped');
  });
});
