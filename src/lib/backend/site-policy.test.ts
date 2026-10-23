import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_USER_ID as OWNER, OTHER_USER_ID as OTHER, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { runWorkspaceCommand } from './workspace-management.ts';
import { createPolicyState, parseSitemap, policyReport, policyUrls, stepPolicy } from './site-policy.ts';
import { processPolicyTick } from './site-policy-worker.ts';
import { processAuditTick } from './site-audit-worker.ts';
import { fetchAuditPage, type AuditFetcher } from './site-audit-fetch.ts';
import { assertRestWrite } from './rest-policy.ts';
const target = { name: '정책 검증', target_url: 'https://policy.example/', max_pages: 4, max_depth: 1, scope_rules: { include_paths: [], exclude_paths: ['/excluded'] } };
const urls = { robots_txt_url: 'https://policy.example/custom/robots.txt', sitemap_url: 'https://policy.example/maps/index.xml', llms_txt_url: 'https://policy.example/custom/llms.txt' };
const xml = (urls: string[], kind = 'urlset') => `<${kind} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<${kind === 'urlset' ? 'url' : 'sitemap'}><loc>${url}</loc></${kind === 'urlset' ? 'url' : 'sitemap'}>`).join('')}</${kind}>`;
const fetcher: AuditFetcher = async (url, allowed) => {
  assert.equal(allowed(url), true); const pathname = new URL(url).pathname;
  const body = pathname.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /blocked\nCrawl-delay: 1\nSitemap: https://policy.example/maps/index.xml' : pathname.endsWith('index.xml') ? xml(['https://policy.example/maps/one.xml', 'https://policy.example/maps/one.xml'], 'sitemapindex') : pathname.endsWith('one.xml') ? xml(['https://policy.example/from-sitemap', 'https://policy.example/blocked', 'https://policy.example/excluded', 'https://outside.example/a', 'http://127.0.0.1/private']) : pathname.endsWith('llms.txt') ? '# Product\n## Docs\n[Docs](https://policy.example/docs)' : '<html lang="ko"><head><title>정책</title></head><body><h1>문서</h1></body></html>';
  return { url, status: 200, content_type: pathname.endsWith('.xml') ? 'application/xml' : pathname.endsWith('.txt') ? 'text/plain' : 'text/html', body, robots_header: '', redirects: [] };
};
const dirs: string[] = []; afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
async function fixture() {
  const folder = mkdtempSync(path.join(tmpdir(), 'halox-policy-')); dirs.push(folder);
  const file = path.join(folder, 'db.sqlite'), store = new PersistentHaloXStore(file);
  const workspace = await store.write(db => db.insertTable('workspaces', { name: '정책 작업 공간' }, OWNER)[0]);
  const command = (values: Row, actor = OWNER) => store.write(db => runWorkspaceCommand(db, actor, { workspace_id: workspace.id, ...values }));
  const get = (table: string) => store.read(db => db.queryTable(table, { filters: { workspace_id: `eq.${workspace.id}` } }, OWNER).data);
  const ws = () => store.read(db => db.queryTable('workspaces', { filters: { id: `eq.${workspace.id}` } }, OWNER).data[0]);
  const scan = () => store.write(db => db.insertTable('site_audit_scans', { workspace_id: workspace.id, status: 'completed', provider: 'html', target_url: target.target_url, target_snapshot: target, site_health_score: 73, crawled_urls: 2, policy_report: { historical: true }, revision: 1 }, OWNER)[0]);
  let time = Date.now(); const now = () => time;
  async function drain(fn = processPolicyTick, useFetch = fetcher) { for (let i = 0; i < 40; i++) { time += 10000; if (!await fn(store, useFetch, now)) return; } throw new Error('worker did not drain'); }
  return { store, file, workspace, command, get, ws, scan, drain, now, advance: () => { time += 60000; } };
}
describe('workspace policy files and sitemap backfill', () => {
  it('normalizes public URLs and rejects malformed XML, DTD, missing or ambiguous loc fields', () => {
    assert.deepEqual(policyUrls({}), { robots_txt_url: null, sitemap_url: null, llms_txt_url: null });
    for (const value of ['http://localhost/x', 'http://127.0.0.1/x', 'file:///tmp/x', 'https://u:p@example.com/x', 'https://example.com:8080/x', 'https://example.com/x#part']) assert.throws(() => policyUrls({ sitemap_url: value }));
    for (const body of ['<html/>', '<urlset><url></urlset>', '<!DOCTYPE urlset [<!ENTITY x SYSTEM "file:///tmp/x">]><urlset/>', '<urlset><url/></urlset>', '<urlset><url><loc>x</loc><loc>y</loc></url></urlset>', '<urlset><url><loc><b>x</b></loc></url></urlset>']) assert.throws(() => parseSitemap(body));
    assert.deepEqual(parseSitemap(xml(['https://policy.example/?a=1&amp;b=2'])).urls, ['https://policy.example/?a=1&b=2']);
  });
  it('traverses sitemap indexes, deduplicates, respects scope and robots, and records limited/error evidence honestly', async () => {
    let state = createPolicyState(target, urls); const calls: string[] = [];
    while (state.queue.length) state = await stepPolicy(state, async (...args) => { calls.push(args[0]); return fetcher(...args); });
    const report = policyReport(state); assert.equal(report.sitemap_urls, 4); assert.equal(report.in_scope_urls, 2); assert.equal(report.allowed_urls, 1); assert.equal(report.invalid_urls, 1); assert.equal(report.complete, true);
    assert.equal(calls.filter(url => url.endsWith('one.xml')).length, 1); assert.deepEqual(report.sample_urls, ['https://policy.example/from-sitemap']); assert.equal(report.documents.find(row => row.kind === 'llms')?.heading_count, 2);
    let limited = createPolicyState(target, urls); limited = await stepPolicy(limited, fetcher); limited = await stepPolicy(limited, async url => ({ url, status: 200, body: xml(Array.from({ length: 15 }, (_, i) => `https://policy.example/${i}.xml`), 'sitemapindex'), content_type: 'application/xml', redirects: [], robots_header: '' })); assert.equal(limited.limited, true); assert.ok(limited.queue.length <= 8);
    const fatal = await stepPolicy(createPolicyState(target, {}), async url => ({ url, status: 503, body: '', content_type: 'text/plain', robots_header: '', redirects: [] })); assert.ok(fatal.fatal); assert.equal(fatal.queue.length, 0);
  });
  it('uses saved policy snapshots for new audits and reruns, discovers permitted sitemap pages, and preserves policy checks', async () => {
    const f = await fixture(); await f.command({ action: 'policy-update', ...urls, expected_revision: (await f.ws()).revision || 0 });
    const invoke = (name: string, values: Row) => f.store.write(db => db.invokeEdgeFunction(name, { workspace_id: f.workspace.id, ...values }, OWNER));
    const t = (await invoke('audit-target-create', target)).target as Row;
    const run = (await invoke('site-audit-start', { target_id: t.id, expected_revision: 1, idempotency_key: 'run' })).scan as Row;
    await f.command({ action: 'policy-reset', expected_revision: (await f.ws()).revision });
    await f.drain(processAuditTick); const scan = (await f.get('site_audit_scans')).find(row => row.id === run.id)!;
    assert.equal(scan.status, 'completed'); assert.deepEqual(scan.policy_snapshot, urls); assert.equal((scan.policy_report as Row).allowed_urls, 1);
    assert.deepEqual((await f.get('site_audit_pages')).map(row => row.url), ['https://policy.example/', 'https://policy.example/from-sitemap']);
    const rerun = (await invoke('site-audit-rerun', { scan_id: scan.id, expected_revision: scan.revision, idempotency_key: 'rerun' })).scan as Row; assert.deepEqual(rerun.policy_snapshot, urls);
    await invoke('site-audit-cancel', { scan_id: rerun.id });
  });
  it('falls back to the default sitemap when every robots declaration is unsafe', async () => {
    const state = await stepPolicy(createPolicyState(target, {}, 'backfill'), async url => ({ url, status: 200, content_type: 'text/plain', body: 'User-agent: *\nSitemap: http://127.0.0.1/private\nSitemap: file:///tmp/map.xml', robots_header: '', redirects: [] }));
    assert.equal(state.invalid_urls, 2);
    assert.deepEqual(state.queue.map(row => row.url), ['https://policy.example/sitemap.xml']);
    assert.equal(policyReport(state).complete, false);
  });
  it('persists backfill, keeps original measurements, supports history CRUD and cannot resurrect deleted requests', async () => {
    const f = await fixture(), original = await f.scan(); await f.command({ action: 'policy-update', ...urls, expected_revision: (await f.ws()).revision || 0 });
    const request = { action: 'sitemap-backfill-start', expected_revision: (await f.ws()).revision, request_id: 'once' }, first = await f.command(request);
    assert.equal((await f.command(request)).reused, true);
    await f.drain(); const saved = (await f.get('site_audit_scans'))[0]; assert.equal(saved.site_health_score, 73); assert.equal(saved.crawled_urls, 2); assert.deepEqual(saved.policy_report, original.policy_report); assert.equal((saved.sitemap_backfill_report as Row).sitemap_urls, 4);
    const reopened = new PersistentHaloXStore(f.file); assert.equal((await reopened.read(db => db.queryTable('site_policy_jobs', { filters: { id: `eq.${(first.job as Row).id}` } }).data[0])).status, 'completed');
    let job = (await f.get('site_policy_jobs'))[0]; await f.command({ action: 'sitemap-backfill-update', job_id: job.id, expected_revision: job.revision, name: '검토한 통계', notes: '확인 메모' });
    await assert.rejects(f.command({ action: 'sitemap-backfill-delete', job_id: job.id, expected_revision: job.revision })); job = (await f.get('site_policy_jobs'))[0];
    await f.command({ action: 'sitemap-backfill-delete', job_id: job.id, expected_revision: job.revision }); assert.equal((await f.command(request)).job, null); assert.equal((await f.get('site_policy_jobs')).length, 0); assert.ok((await f.get('site_audit_scans'))[0].sitemap_backfill_report);
  });
  it('checks roles, menu scope, stale settings, REST protection and workspace isolation', async () => {
    const f = await fixture(); await assert.rejects(f.command({ action: 'policy-update', ...urls, expected_revision: 99 }));
    await assert.rejects(f.command({ action: 'policy-update', ...urls, expected_revision: 0 }, OTHER));
    await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace.id, user_id: OTHER, role: 'admin', allowed_sections: ['other'] }, OWNER));
    await assert.rejects(f.command({ action: 'policy-update', ...urls, expected_revision: 0 }, OTHER));
    await f.store.read(db => { assert.throws(() => assertRestWrite(db, 'site_policy_jobs', 'POST', OWNER, { workspace_id: f.workspace.id })); assert.throws(() => assertRestWrite(db, 'workspaces', 'PATCH', OWNER, urls, { id: `eq.${f.workspace.id}` })); });
    await f.scan(); await assert.rejects(f.command({ action: 'sitemap-backfill-start', expected_revision: 0, request_id: 'other' }, OTHER));
  });
  it('shares leases, releases storage during fetch, discards late cancelled results and cleans workspace data', async () => {
    const f = await fixture(); await f.scan(); const job = (await f.command({ action: 'sitemap-backfill-start', expected_revision: (await f.ws()).revision || 0, request_id: 'cancel' })).job as Row;
    let release!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const pending = processPolicyTick(f.store, async (...args) => { entered(); await gate; return fetcher(...args); }, f.now); await started;
    assert.equal(await processPolicyTick(new PersistentHaloXStore(f.file), fetcher, f.now), false);
    await f.command({ action: 'sitemap-backfill-cancel', job_id: job.id }); release(); await pending;
    assert.equal((await f.get('site_policy_jobs'))[0].status, 'cancelled'); assert.equal((await f.get('site_audit_scans'))[0].sitemap_backfill_report, undefined);
    await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${f.workspace.id}` }, OWNER));
    await f.store.read(db => { for (const table of ['site_policy_work', 'site_policy_requests'] as const) assert.ok(db.getServerRecords(table).every(row => row.workspace_id !== f.workspace.id)); });
  });
  it('recovers expired leases, preserves partial failures and refuses internal/redirected network targets', async () => {
    const f = await fixture(); await f.scan(); await f.command({ action: 'sitemap-backfill-start', expected_revision: (await f.ws()).revision || 0, request_id: 'recover' });
    await f.store.write(db => { const rows = db.getServerRecords('site_policy_work'); rows[0].lease_until = f.now() + 45000; rows[0].attempts = 1; db.setServerRecords('site_policy_work', rows); });
    assert.equal(await processPolicyTick(f.store, fetcher, f.now), false); f.advance(); await f.drain(processPolicyTick, async (url, allowed) => url.includes('.xml') ? { url, status: 200, body: '<broken>', content_type: 'application/xml', robots_header: '', redirects: [] } : fetcher(url, allowed));
    assert.equal((await f.get('site_policy_jobs'))[0].status, 'partial'); assert.equal((await f.get('site_policy_jobs'))[0].failed, 1);
    await assert.rejects(fetchAuditPage('https://policy.example/x.xml', () => true, { resolve: async () => [{ address: '127.0.0.1', family: 4 }], request: async () => { assert.fail('must not connect'); } }));
    await assert.rejects(fetchAuditPage('https://policy.example/x.xml', url => new URL(url).origin === 'https://policy.example', { resolve: async () => [{ address: '1.1.1.1', family: 4 }], request: async () => ({ status: 302, type: 'text/plain', body: Buffer.alloc(0), robots: '', location: 'https://outside.example/x' }) }));
  });
});
