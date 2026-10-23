import crypto from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';
import { processPolicyTick } from '../src/lib/backend/site-policy-worker';
import { processAuditTick } from '../src/lib/backend/site-audit-worker';
import type { AuditFetcher } from '../src/lib/backend/site-audit-fetch';
test.use({ storageState: { cookies: [], origins: [] } });
const root = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
const target = { name: '정책 사이트', target_url: 'https://policy.example.invalid/', max_pages: 2, max_depth: 1, scope_rules: { include_paths: [], exclude_paths: [] } };
const fetcher: AuditFetcher = async (url, allowed) => {
  expect(allowed(url)).toBe(true); const path = new URL(url).pathname;
  return { url, status: 200, content_type: path.endsWith('.xml') ? 'application/xml' : path.endsWith('.txt') ? 'text/plain' : 'text/html', redirects: [], robots_header: '', body: path.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /private' : path.endsWith('.xml') ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://policy.example.invalid/from-map</loc></url></urlset>' : path.endsWith('llms.txt') ? '# Policy docs' : '<html lang="ko"><head><title>정책 검증</title></head><body><h1>문서</h1></body></html>' };
};
async function setup(page: Page) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), password = 'policy-private-password', hash = await hashPassword(password);
  const owner = await store.write(db => db.createAccount({ email: `policy-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '정책 설정', passwordHash: hash }));
  const response = await page.request.post('/api/v1/auth', { data: { email: owner.email, password } }); expect(response.status()).toBe(200); const workspace = (await response.json()).workspaces[0];
  await page.goto('/app/settings?tab=workspace'); await expect(root(page).getByRole('button', { name: '정책 파일 수정', exact: true })).toBeVisible();
  const data = async () => (await page.request.get(`/api/v1/workspace-management?workspace_id=${workspace.id}`)).json();
  const post = (payload: Record<string, unknown>) => page.request.post('/api/v1/workspace-management', { data: { workspace_id: workspace.id, ...payload } });
  return { store, owner, workspace, data, post, password };
}
async function submit(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }

test('policy settings persist, preserve failed and conflicting input, reset to automatic discovery and guard REST', async ({ page }) => {
  const f = await setup(page); await root(page).getByRole('button', { name: '정책 파일 수정', exact: true }).click(); await modal(page).getByLabel('robots.txt URL', { exact: true }).fill('https://policy.example.invalid/custom/robots.txt'); await modal(page).getByLabel('sitemap.xml URL', { exact: true }).fill('https://policy.example.invalid/maps.xml');
  await page.route('**/api/v1/workspace-management', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: '정책 저장 일시 중단' } }) : route.continue());
  await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 중단'); await expect(modal(page).getByLabel('sitemap.xml URL')).toHaveValue('https://policy.example.invalid/maps.xml'); await page.unroute('**/api/v1/workspace-management'); await submit(page); await page.reload(); await expect(root(page)).toContainText('https://policy.example.invalid/maps.xml');
  await root(page).getByRole('button', { name: '정책 파일 수정', exact: true }).click(); await modal(page).getByLabel('llms.txt URL').fill('http://127.0.0.1/private'); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('내부 네트워크'); await modal(page).getByLabel('llms.txt URL').fill('https://policy.example.invalid/llms.txt');
  const before = await f.data(); expect((await f.post({ action: 'policy-reset', expected_revision: before.workspace.revision })).status()).toBe(200);
  await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('변경'); await expect(modal(page).getByLabel('llms.txt URL')).toHaveValue('https://policy.example.invalid/llms.txt'); await modal(page).getByRole('button', { name: '취소', exact: true }).click();
  expect((await page.request.patch(`/api/v1/rest/workspaces?id=eq.${f.workspace.id}`, { data: { sitemap_url: 'https://policy.example.invalid/forged.xml' } })).status()).toBe(400);
  await page.reload(); await root(page).getByRole('button', { name: '기본 경로로 초기화', exact: true }).click(); await submit(page, '확인'); expect((await f.data()).workspace.sitemap_url).toBeNull();
});

test('new scans use policy snapshots and sitemap discovery; existing scans keep old evidence while backfill history supports CRUD and cancellation', async ({ page }) => {
  const f = await setup(page), old = await f.data(); expect((await f.post({ action: 'policy-update', expected_revision: old.workspace.revision || 0, robots_txt_url: 'https://policy.example.invalid/custom/robots.txt', sitemap_url: 'https://policy.example.invalid/maps.xml', llms_txt_url: 'https://policy.example.invalid/llms.txt' })).status()).toBe(200);
  const added = await page.request.post('/api/v1/functions/audit-target-create', { data: { workspace_id: f.workspace.id, ...target } }); const t = (await added.json()).target;
  const started = await page.request.post('/api/v1/functions/site-audit-start', { data: { workspace_id: f.workspace.id, target_id: t.id, expected_revision: t.revision, idempotency_key: crypto.randomUUID() } }); expect(started.status()).toBe(200); const scan = (await started.json()).scan;
  let now = Date.now(); for (let i = 0; i < 8; i++) { now += 10000; await processAuditTick(f.store, fetcher, () => now); }
  await page.goto(`/app/site-audit/${scan.id}`); await expect(root(page)).toContainText('수집 페이지 (2)'); await expect(root(page)).toContainText('진단 당시 정책 파일');
  const original = await f.store.read(db => db.queryTable('site_audit_scans', { filters: { id: `eq.${scan.id}` } }, String(f.owner.id)).data[0]);
  await page.goto('/app/settings?tab=workspace'); await root(page).getByRole('button', { name: '사이트맵 통계 보완', exact: true }).click(); await submit(page, '보완 시작'); await expect(root(page)).toContainText('대기 중');
  for (let i = 0; i < 5; i++) { now += 10000; await processPolicyTick(f.store, fetcher, () => now); }
  await page.reload(); await expect(root(page)).toContainText('1 / 1개');
  const saved = await f.store.read(db => db.queryTable('site_audit_scans', { filters: { id: `eq.${scan.id}` } }, String(f.owner.id)).data[0]); expect(saved.policy_report).toEqual(original.policy_report); expect(saved.site_health_score).toBe(original.site_health_score);
  await root(page).getByRole('button', { name: '보완 메모 수정', exact: true }).click(); await modal(page).getByLabel('보완 이름').fill('검토한 사이트맵'); await modal(page).getByLabel('보완 메모').fill('현재 파일 확인'); await submit(page); await page.reload(); await expect(root(page)).toContainText('현재 파일 확인');
  await page.goto(`/app/site-audit/${scan.id}`); await expect(root(page)).toContainText('최근 사이트맵 통계 보완'); await expect(root(page)).toContainText('과거 진단 시점의 사이트맵을 복원한 값이 아닙니다');
  await page.goto('/app/settings?tab=workspace'); await root(page).getByRole('button', { name: '보완 이력 삭제', exact: true }).click(); await submit(page, '삭제'); await expect(root(page)).toContainText('사이트맵 보완 이력이 없습니다.');
  await root(page).getByRole('button', { name: '사이트맵 통계 보완', exact: true }).click(); await submit(page, '보완 시작'); await root(page).getByRole('button', { name: '보완 취소', exact: true }).click(); await submit(page, '확인'); await expect(root(page)).toContainText('취소됨');
  expect(await f.store.read(db => db.getServerRecords('site_policy_work').filter(row => row.workspace_id === f.workspace.id))).toHaveLength(0);
});

test('policy settings isolate workspaces, enforce viewer and menu permissions and scroll on mobile', async ({ page }) => {
  const f = await setup(page), before = await f.data(); expect((await f.post({ action: 'policy-update', expected_revision: before.workspace.revision || 0, sitemap_url: 'https://policy.example.invalid/only-first.xml' })).status()).toBe(200);
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: '다른 정책 공간' } }), [other] = await response.json();
  await page.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, other);
  await expect(root(page)).toContainText('다른 정책 공간'); await expect(root(page)).not.toContainText('only-first.xml');
  const hash = await hashPassword(f.password), guest = await f.store.write(db => { const user = db.createAccount({ email: `policy-viewer-${crypto.randomUUID()}@example.test`, fullName: '정책 뷰어', phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, passwordHash: hash }); db.insertTable('workspace_members', { workspace_id: f.workspace.id, user_id: user.id, role: 'viewer' }, String(f.owner.id)); return user; });
  expect((await page.request.post('/api/v1/auth', { data: { email: guest.email, password: f.password } })).status()).toBe(200);
  await page.evaluate(ws => localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })), f.workspace); await page.reload(); await expect(root(page)).toContainText('읽기 전용'); await expect(root(page).getByRole('button', { name: '정책 파일 수정', exact: true })).toHaveCount(0); await expect(root(page)).toContainText('only-first.xml');
  expect((await f.post({ action: 'policy-reset', expected_revision: (await f.data()).workspace.revision })).status()).toBe(403);
  await f.store.write(db => db.updateTable('workspace_members', { role: 'admin', allowed_sections: ['other'] }, { workspace_id: `eq.${f.workspace.id}`, user_id: `eq.${guest.id}` }, String(f.owner.id)));
  expect((await f.post({ action: 'sitemap-backfill-start', expected_revision: 0, request_id: 'forged' })).status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 600 }); await page.reload(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); await page.mouse.move(280, 480); await page.mouse.wheel(0, 650); await expect.poll(() => root(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
});
