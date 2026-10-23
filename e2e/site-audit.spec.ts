import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { processAuditTick } from '../src/lib/backend/site-audit-worker';
import { OTHER_USER_ID } from '../src/lib/backend/database';
import type { AuditFetcher } from '../src/lib/backend/site-audit-fetch';

test.use({ storageState: path.join(__dirname, '.auth', 'export-state.json') });
const live = (page: Page) => page.locator('[data-live-root]'), dialog = (page: Page) => page.getByRole('dialog');
async function submit(page: Page, name = '저장') { await dialog(page).getByRole('button', { name, exact: true }).click(); await expect(dialog(page)).not.toBeVisible(); }
async function setup(page: Page) {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `진단 검증 ${Date.now()}` } }); expect(response.status()).toBe(201); const [ws] = await response.json();
  await page.goto('/app/site-audit'); await expect(live(page).getByRole('button', { name: '진단 대상 추가', exact: true })).toBeEnabled();
  await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${ws.name} (trial)` }).click(); await expect(live(page)).toContainText(ws.name); return ws;
}
async function addTarget(page: Page, url = 'https://audit.example.invalid/') {
  await live(page).getByRole('button', { name: '진단 대상 추가', exact: true }).click(); await dialog(page).getByLabel('대상 이름').fill('문서 진단'); await dialog(page).getByLabel('시작 URL').fill(url); await dialog(page).getByLabel('최대 페이지').fill('3'); await dialog(page).getByLabel('탐색 깊이').fill('1'); await submit(page);
}
async function start(page: Page) { await live(page).getByRole('button', { name: '새 진단', exact: true }).click(); await dialog(page).getByLabel('진단 대상').selectOption({ label: '문서 진단' }); await submit(page, '진단 시작'); await expect(page).toHaveURL(/\/app\/site-audit\/[a-f0-9-]+$/); }
const fetcher: AuditFetcher = async (url, allowed) => {
  expect(allowed(url)).toBe(true); const pathname = new URL(url).pathname;
  if (['/sitemap.xml', '/llms.txt'].includes(pathname)) return { url, status: 404, content_type: 'text/plain', robots_header: '', redirects: [], body: '' };
  return { url, status: 200, content_type: pathname === '/robots.txt' ? 'text/plain' : 'text/html', robots_header: '', redirects: [], body: pathname === '/robots.txt' ? 'User-agent: *\nDisallow: /admin' : pathname === '/' ? '<html lang="ko"><head><title>제품 안내</title></head><body><h1>제품 안내</h1><a href="/docs">도움말</a></body></html>' : '<html><body><h1>도움말</h1><img src="guide.png"></body></html>' };
};
async function cleanup(page: Page, workspace: string) {
  const data = await (await page.request.get(`/api/v1/site-audit?workspace_id=${workspace}`)).json();
  for (const scan of data.site_audit_scans || []) if (['queued', 'running'].includes(scan.status)) await page.request.post('/api/v1/functions/site-audit-cancel', { data: { workspace_id: workspace, scan_id: scan.id } });
  await page.request.delete(`/api/v1/rest/workspaces?id=eq.${workspace}`);
}

test('site audit targets and scope persist, invalid or failed writes preserve input, and workspace isolation holds', async ({ page }) => {
  const ws = await setup(page);
  try {
    await addTarget(page); await live(page).getByRole('button', { name: '대상·수집 범위', exact: true }).click(); await expect(live(page)).toContainText('문서 진단');
    await live(page).getByRole('button', { name: '대상·범위 수정', exact: true }).click(); await dialog(page).getByLabel('시작 URL').fill('http://localhost/'); await dialog(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('내부 네트워크'); await expect(dialog(page).getByLabel('대상 이름')).toHaveValue('문서 진단');
    await dialog(page).getByLabel('시작 URL').fill('https://audit.example.invalid/docs'); await dialog(page).getByLabel('포함 경로').fill('/docs'); await dialog(page).getByLabel('제외 경로').fill('/docs/private'); await dialog(page).getByLabel('대상 메모').fill('제품 문서 범위'); await submit(page);
    await page.reload(); await live(page).getByRole('button', { name: '대상·수집 범위', exact: true }).click(); await expect(live(page)).toContainText('제품 문서 범위'); await expect(live(page)).toContainText('/docs/private');
    await page.route('**/api/v1/functions/audit-target-update', route => route.fulfill({ status: 503, json: { error: '검증용 저장 실패' } })); await live(page).getByRole('button', { name: '대상·범위 수정', exact: true }).click(); await dialog(page).getByLabel('대상 메모').fill('보존할 입력'); await dialog(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('검증용 저장 실패'); await expect(dialog(page).getByLabel('대상 메모')).toHaveValue('보존할 입력'); await dialog(page).getByRole('button', { name: '취소', exact: true }).click(); await page.unroute('**/api/v1/functions/audit-target-update');
    const data = await (await page.request.get(`/api/v1/site-audit?workspace_id=${ws.id}`)).json(); const target = data.site_audit_targets[0];
    expect((await page.request.post('/api/v1/functions/audit-target-delete', { data: { workspace_id: ws.id, target_id: target.id, expected_revision: 1 } })).status()).toBe(409);
    const outsider = await page.context().browser()!.newContext({ storageState: path.join(__dirname, '.auth', 'state.json') }); try { expect((await outsider.request.get(`/api/v1/site-audit?workspace_id=${ws.id}`)).status()).toBe(403); } finally { await outsider.close(); }
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await live(page).getByRole('button', { name: '대상 삭제', exact: true }).click(); await submit(page, '삭제'); await expect(live(page)).toContainText('진단 대상과 수집 범위를 추가');
  } finally { await cleanup(page, ws.id); }
});

test('HTML audit queue produces page-specific evidence; notes, resolution, rerun and cascading deletion use persistent records', async ({ page }) => {
  const ws = await setup(page), store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!); let time = Date.now();
  // The queue command is a real HTTP write. Only public website responses are
  // supplied by fixtures to the same durable worker used by the running server.
  await page.route('**/api/v1/functions/site-audit-start', async route => {
    const response = await route.fetch();
    for (let i = 0; i < 8; i++) { time += 10000; await processAuditTick(store, fetcher, () => time); }
    await route.fulfill({ response });
  });
  try {
    await addTarget(page); await start(page); await expect(live(page)).toContainText('완료'); await expect(live(page)).toContainText('수집 페이지 (2)');
    const data = await (await page.request.get(`/api/v1/site-audit?workspace_id=${ws.id}`)).json(), scan = data.site_audit_scans[0]; expect(scan.status).toBe('completed'); expect(scan.crawled_urls).toBe(2);
    await live(page).getByRole('button', { name: '조치·메모 수정', exact: true }).first().click(); await dialog(page).getByRole('checkbox').check(); await dialog(page).getByLabel('조치 메모').fill('문서 담당자 수정 확인'); await submit(page); await page.reload(); await expect(live(page)).toContainText('문서 담당자 수정 확인');
    await live(page).getByRole('button', { name: '진단 메모 수정', exact: true }).click(); await dialog(page).getByLabel('진단 이름').fill('문서 진단 검토본'); await dialog(page).getByLabel('진단 메모').fill('다음 배포 후 확인'); await submit(page); await page.reload(); await expect(live(page)).toContainText('다음 배포 후 확인');
    await live(page).getByRole('button', { name: '수집 페이지 (2)', exact: true }).click(); await live(page).getByText('페이지 상세', { exact: true }).first().click(); await expect(live(page)).toContainText('최종 URL:');
    const downloadPromise = page.waitForEvent('download'); await live(page).getByRole('button', { name: '현재 결과 CSV', exact: true }).click(); const download = await downloadPromise; expect(download.suggestedFilename()).toBe('site-audit-pages.csv');
    expect((await page.request.patch(`/api/v1/rest/site_audit_pages?id=eq.${data.site_audit_pages[0].id}`, { data: { html_score: 100 } })).status()).toBe(403);
    await live(page).getByRole('button', { name: '동일 범위 재실행', exact: true }).click(); await submit(page, '진단 시작'); await expect(live(page)).toContainText('대기 중'); await live(page).getByRole('button', { name: '진단 취소', exact: true }).click(); await submit(page, '진단 취소'); await expect(live(page)).toContainText('취소됨');
    await page.goto(`/app/site-audit/${scan.id}`); await live(page).getByRole('button', { name: '이력 삭제', exact: true }).click(); await submit(page, '삭제'); await expect(page).toHaveURL(/\/app\/site-audit$/);
    const after = await (await page.request.get(`/api/v1/site-audit?workspace_id=${ws.id}`)).json(); expect(after.site_audit_pages).toHaveLength(0); expect(after.site_audit_issues).toHaveLength(0); expect(after.site_audit_targets).toHaveLength(1);
  } finally { await cleanup(page, ws.id); }
});

test('cancelling a partially collected audit preserves real pages and prevents further collection on mobile', async ({ page }) => {
  const ws = await setup(page), store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!); let time = Date.now();
  try {
    // Separate hosts keep this test independent of the previous test's persisted
    // crawl delay (its worker intentionally runs with an advanced test clock).
    await addTarget(page, 'https://partial-audit.example.invalid/'); await start(page);
    // Three policy files precede the first HTML page; cancel before page two.
    for (let i = 0; i < 4; i++) { time += 10000; expect(await processAuditTick(store, fetcher, () => time)).toBe(true); }
    await live(page).getByRole('button', { name: '새로고침', exact: true }).click(); await expect(live(page)).toContainText('수집 페이지 (1)');
    await page.setViewportSize({ width: 390, height: 844 }); await live(page).getByRole('button', { name: '진단 취소', exact: true }).click(); await submit(page, '진단 취소'); await expect(live(page)).toContainText('취소됨'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    time += 10000; expect(await processAuditTick(store, fetcher, () => time)).toBe(false); await page.reload(); await expect(live(page)).toContainText('수집 페이지 (1)');
    const rows = await store.read(db => db.queryTable('site_audit_scans', { filters: { workspace_id: `eq.${ws.id}` } }, OTHER_USER_ID).data); expect(rows[0].quota_status).toBe('committed'); expect(rows[0].status).toBe('cancelled');
  } finally { await cleanup(page, ws.id); }
});
