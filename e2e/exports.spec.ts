import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test.use({ storageState: path.join(__dirname, '.auth', 'export-state.json') });
const live = (page: Page) => page.locator('[data-live-root]');
const dialog = (page: Page) => page.getByRole('dialog');
async function submit(page: Page, name = '저장') { await dialog(page).getByRole('button', { name, exact: true }).click(); await expect(dialog(page)).not.toBeVisible(); }
async function setup(page: Page) {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `내보내기 검증 ${Date.now()}` } }); expect(response.status()).toBe(201); const [ws] = await response.json();
  const content = await page.request.post('/api/v1/functions/content-create', { data: { workspace_id: ws.id, title: '파일 원문', target_keyword: '제품 사용', content_md: '## 사용법\n원문을 보관합니다.  \n' } }); expect(content.status()).toBe(200);
  await page.goto('/app/exports'); await expect(live(page).getByRole('button', { name: '파일 만들기', exact: true })).toBeEnabled();
  await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${ws.name} (trial)` }).click(); await expect(live(page)).toContainText(ws.name);
  return { ws, ...(await content.json()) };
}
async function download(page: Page, row = live(page)) {
  const event = page.waitForEvent('download'); await row.getByRole('button', { name: '다운로드', exact: true }).click(); const result = await event;
  return { filename: result.suggestedFilename(), bytes: await readFile((await result.path())!) };
}

test('file presets, real translations and export history persist; downloaded bytes survive later edits and related deletions', async ({ page }) => {
  const { ws, job } = await setup(page);
  try {
    await page.goto('/app/settings?tab=export'); await live(page).getByRole('button', { name: '파일 설정 추가', exact: true }).click();
    await dialog(page).getByLabel('설정 이름').fill('검토용 설정'); await dialog(page).getByLabel('파일 형식', { exact: true }).selectOption('json'); await dialog(page).getByLabel('파일명 접두어').fill('검토_'); await submit(page);
    await page.reload(); await expect(live(page)).toContainText('검토용 설정'); await live(page).getByRole('button', { name: '설정 수정', exact: true }).click(); await dialog(page).getByLabel('설정 이름').fill('전달용 설정'); await submit(page);
    await live(page).getByRole('button', { name: '번역문 관리', exact: true }).click(); await live(page).getByRole('button', { name: '번역문 등록', exact: true }).click(); await dialog(page).getByLabel('번역 제목').fill('Product guide'); await dialog(page).getByLabel('번역 본문').fill('## Instructions\nRead the guide.\n'); await submit(page);
    await live(page).getByRole('button', { name: '번역문 편집', exact: true }).click(); await dialog(page).getByLabel('검토 상태').selectOption('ready'); await dialog(page).getByLabel('번역 메모').fill('편집자 검토 완료'); await submit(page);
    await page.goto(`/app/factory/${job.id}`); await live(page).getByRole('link', { name: '파일 내보내기', exact: true }).click(); await expect(dialog(page).getByLabel('콘텐츠', { exact: true })).toHaveValue(job.id); await dialog(page).getByLabel('내보낼 자료').selectOption('translation'); await dialog(page).getByLabel('번역문', { exact: true }).selectOption({ label: 'Product guide (en)' }); await dialog(page).getByLabel('파일 설정', { exact: true }).selectOption({ label: '전달용 설정' }); await submit(page, '파일 저장');
    const first = await download(page); expect(first.filename).toBe('검토_Product guide.json'); expect(JSON.parse(first.bytes.toString()).content_md).toBe('## Instructions\nRead the guide.\n');
    await live(page).getByRole('button', { name: '메모 수정', exact: true }).click(); await dialog(page).getByLabel('이력 이름').fill('고객 전달본'); await dialog(page).getByLabel('메모', { exact: true }).fill('보관 완료'); await submit(page);
    await live(page).getByRole('button', { name: '번역문 관리', exact: true }).click(); await live(page).getByRole('button', { name: '번역문 편집', exact: true }).click(); await dialog(page).getByLabel('번역 본문').fill('Later edited translation'); await submit(page); await live(page).getByRole('button', { name: '삭제', exact: true }).click(); await submit(page, '삭제');
    await live(page).getByRole('button', { name: '파일 설정', exact: true }).click(); await live(page).getByRole('button', { name: '삭제', exact: true }).click(); await submit(page, '삭제');
    expect((await page.request.post('/api/v1/functions/content-delete', { data: { workspace_id: ws.id, job_id: job.id, expected_revision: job.revision } })).status()).toBe(200);
    await page.goto('/app/exports'); await expect(live(page)).toContainText('고객 전달본'); await expect(live(page)).toContainText('보관 완료'); await expect(live(page)).toContainText('원문 연결 해제됨'); expect((await download(page)).bytes.equals(first.bytes)).toBe(true);
    await live(page).getByLabel('파일 형식 필터').selectOption('md'); await expect(live(page)).toContainText('검색 결과가 없습니다'); await live(page).getByLabel('파일 형식 필터').selectOption('json');
    await live(page).getByRole('button', { name: '삭제', exact: true }).click(); await submit(page, '삭제'); await expect(live(page)).toContainText('검색 결과가 없습니다');
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('failed saves and downloads show errors, stale source is rejected, tenant isolation and mobile layout hold', async ({ page }) => {
  const { ws, job } = await setup(page);
  try {
    await live(page).getByRole('button', { name: '번역문 관리', exact: true }).click(); await live(page).getByRole('button', { name: '번역문 등록', exact: true }).click(); await dialog(page).getByLabel('번역 제목').fill('Retained input'); await dialog(page).getByLabel('번역 본문').fill('Keep this translated text.');
    await page.route('**/api/v1/functions/translation-create', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '저장소 일시 중단' }) })); await dialog(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('저장소 일시 중단'); await expect(dialog(page).getByLabel('번역 본문')).toHaveValue('Keep this translated text.'); await page.unroute('**/api/v1/functions/translation-create'); await dialog(page).getByRole('button', { name: '취소', exact: true }).click();
    await live(page).getByRole('button', { name: '파일 만들기', exact: true }).click();
    const changed = await page.request.post('/api/v1/functions/content-save', { data: { workspace_id: ws.id, job_id: job.id, expected_revision: job.revision, title: '변경한 원문', content_md: '나중에 바뀐 본문' } }); expect(changed.status()).toBe(200);
    const conflict = page.waitForResponse(response => response.url().endsWith('/export-create')); await dialog(page).getByRole('button', { name: '파일 저장', exact: true }).click(); expect((await conflict).status()).toBe(409); await expect(dialog(page).getByRole('alert')).toContainText('다른 곳에서 콘텐츠가 변경'); await dialog(page).getByRole('button', { name: '취소', exact: true }).click();
    await page.goto('/app/exports'); await live(page).getByRole('button', { name: '파일 만들기', exact: true }).click(); await submit(page, '파일 저장');
    const snapshot = await (await page.request.get(`/api/v1/exports?workspace_id=${ws.id}`)).json(); const record = snapshot.export_history[0];
    await page.route('**/api/v1/exports/files/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '파일 저장소 일시 중단' }) })); await live(page).getByRole('button', { name: '다운로드', exact: true }).click(); await expect(live(page).getByRole('alert')).toContainText('파일 저장소 일시 중단'); await page.unroute('**/api/v1/exports/files/*'); expect((await download(page)).bytes.toString()).toBe('나중에 바뀐 본문');
    expect((await page.request.patch(`/api/v1/rest/export_history?id=eq.${record.id}`, { data: { sha256: 'forged' } })).status()).toBe(403);
    const outsider = await page.context().browser()!.newContext(); try {
      await outsider.request.post('/api/v1/auth', { data: { email: 'demo@halox.local', password: process.env.HALOX_DEMO_PASSWORD } }); expect((await outsider.request.get(`/api/v1/exports?workspace_id=${ws.id}`)).status()).toBe(403); expect((await outsider.request.get(`/api/v1/exports/files/${record.id}`)).status()).toBe(404);
    } finally { await outsider.close(); }
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expect(live(page).getByRole('heading', { name: '콘텐츠 내보내기', exact: true })).toBeVisible();
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
