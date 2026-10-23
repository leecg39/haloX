import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => { expect((await page.request.post('/api/v1/auth', { data: { email: 'admin@halox.local', password: process.env.HALOX_DEMO_PASSWORD } })).status()).toBe(200); });
const live = (page: Page) => page.locator('[data-live-root]');
const dialog = (page: Page) => page.getByRole('dialog');
async function submit(page: Page, name = '저장') { await dialog(page).getByRole('button', { name, exact: true }).click(); await expect(dialog(page)).not.toBeVisible(); }
async function workspace(page: Page) {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `최적화 검증 ${Date.now()}` } }); expect(response.status()).toBe(201);
  const [item] = await response.json(); await page.goto('/app/optimize'); await expect(live(page).getByRole('button', { name: '새로고침', exact: true })).toBeEnabled();
  await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${item.name} (trial)` }).click(); await expect(live(page)).toContainText(item.name);
  return item;
}
async function audit(page: Page) {
  await live(page).getByRole('button', { name: '새 최적화', exact: true }).click(); await dialog(page).getByLabel('대상 주제', { exact: true }).fill('제품 안내'); await dialog(page).getByLabel('제목', { exact: true }).fill('최적화 원문'); await dialog(page).getByLabel('원문 본문', { exact: true }).fill('## 제품 안내\n검증한 제품 안내를 작성했습니다.\n\n## 사용법\n초안 버전을 보관합니다.'); await submit(page, '진단 시작'); await expect(page).toHaveURL(/\/app\/optimize\/[\w-]+$/);
}
async function propose(page: Page) {
  await live(page).getByRole('button', { name: '2단계: 검색 참고 수집', exact: true }).click(); await live(page).getByRole('button', { name: '3단계: 변경 제안 생성', exact: true }).click(); await expect(live(page).getByRole('button', { name: '선택한 2개 제안 적용', exact: true })).toBeVisible();
}
async function snapshot(page: Page, id: string) { const response = await page.request.get(`/api/v1/optimization?workspace_id=${id}`); expect(response.status()).toBe(200); return response.json(); }

test('optimization stages persist, edited and selected proposals change real drafts, restoration and deletion retain source versions', async ({ page }) => {
  const ws = await workspace(page);
  try {
    await audit(page); const id = page.url().split('/').at(-1)!; await propose(page);
    await live(page).getByRole('button', { name: '진단 설정', exact: true }).click(); await dialog(page).getByLabel('진단 이름', { exact: true }).fill('검토한 최적화'); await dialog(page).getByLabel('메모', { exact: true }).fill('검토자 메모'); await submit(page);
    const summary = live(page).locator('article').filter({ has: page.getByRole('heading', { name: '원문 기반 핵심 요약 추가', exact: true }) }); await summary.getByRole('button', { name: '편집', exact: true }).click(); await dialog(page).getByLabel('변경할 내용', { exact: true }).fill('## 편집자가 확인한 요약\n안내 내용을 간단히 정리합니다.'); await submit(page);
    await live(page).getByRole('checkbox', { name: '적용 대상: 검색 설명 정리', exact: true }).uncheck(); await expect(live(page).getByRole('button', { name: '선택한 1개 제안 적용', exact: true })).toBeVisible();
    await live(page).getByRole('button', { name: '제안 추가', exact: true }).click(); await dialog(page).getByLabel('제안 제목', { exact: true }).fill('추가 검토 문구'); await dialog(page).getByLabel('변경할 내용', { exact: true }).fill('검토 중인 추가 문구'); await submit(page);
    const custom = live(page).locator('article').filter({ has: page.getByRole('heading', { name: '추가 검토 문구', exact: true }) }); await custom.getByRole('button', { name: '삭제', exact: true }).click(); await submit(page, '삭제');
    await page.reload(); await expect(live(page)).toContainText('검토자 메모'); await expect(summary).toContainText('편집자가 확인한 요약'); await expect(live(page).getByRole('checkbox', { name: '적용 대상: 검색 설명 정리', exact: true })).not.toBeChecked();
    await live(page).getByRole('button', { name: '선택한 1개 제안 적용', exact: true }).click(); await submit(page, '적용'); await expect(live(page)).toContainText('적용 결과 · v2');
    const applied = await snapshot(page, ws.id); expect(applied.content_drafts).toHaveLength(2); const version2 = applied.content_drafts.find((row: { version: number }) => row.version === 2); expect(version2.content_md).toContain('편집자가 확인한 요약'); expect(version2.meta_description).toBe('');
    await live(page).getByRole('button', { name: '적용 전 원본 복원', exact: true }).click(); await submit(page, '복원'); await expect(live(page)).toContainText('원본 복원 결과 · v3');
    const restored = await snapshot(page, ws.id); expect(restored.content_drafts.find((row: { version: number }) => row.version === 3).content_md).toBe(restored.content_drafts.find((row: { version: number }) => row.version === 1).content_md);
    await live(page).getByRole('link', { name: '← 최적화 목록', exact: true }).click(); await live(page).getByLabel('최적화 상태 필터').selectOption('proposed'); await expect(live(page)).toContainText('검색 결과가 없습니다'); await live(page).getByLabel('최적화 상태 필터').selectOption('reverted'); await live(page).getByRole('link', { name: '검토한 최적화', exact: true }).click();
    await live(page).getByRole('button', { name: '최적화 삭제', exact: true }).click(); await submit(page, '삭제'); await expect(page).toHaveURL(/\/app\/optimize$/); const after = await snapshot(page, ws.id); expect(after.content_review_runs).toEqual([]); expect(after.content_change_items).toEqual([]); expect(after.content_drafts).toHaveLength(3);
    await page.goto(`/app/optimize/${id}`); await expect(live(page)).toContainText('최적화 작업을 찾을 수 없습니다');
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('public URL errors and failed stages preserve input, existing-content conflicts block overwrite, and tenant/mobile checks hold', async ({ page }) => {
  const ws = await workspace(page);
  try {
    await live(page).getByRole('button', { name: '새 최적화', exact: true }).click(); await dialog(page).getByLabel('원문 선택').selectOption('url'); await dialog(page).getByLabel('대상 주제', { exact: true }).fill('주소 검증'); await dialog(page).getByLabel('공개 URL', { exact: true }).fill('http://127.0.0.1/private'); await dialog(page).getByRole('button', { name: '진단 시작', exact: true }).click(); await expect(dialog(page).getByRole('alert')).toContainText('내부 네트워크'); await expect(dialog(page).getByLabel('공개 URL', { exact: true })).toHaveValue('http://127.0.0.1/private'); await dialog(page).getByRole('button', { name: '취소', exact: true }).click(); expect((await snapshot(page, ws.id)).content_jobs).toEqual([]);
    const result = await page.request.post('/api/v1/functions/content-create', { data: { workspace_id: ws.id, title: '기존 제작소 본문', target_keyword: '사용법', content_md: '검토할 원문입니다.' } }); expect(result.status()).toBe(200); const content = await result.json();
    await page.goto(`/app/factory/${content.job.id}`); await live(page).getByRole('link', { name: '최적화 시작', exact: true }).click(); await expect(dialog(page).getByLabel('콘텐츠', { exact: true })).toHaveValue(content.job.id); await submit(page, '진단 시작');
    await page.route('**/api/v1/functions/optimize-serp-fetch', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '검색 수집 일시 중단' }) })); await live(page).getByRole('button', { name: '2단계: 검색 참고 수집', exact: true }).click(); await expect(live(page).getByRole('alert')).toContainText('검색 수집 일시 중단'); await page.unroute('**/api/v1/functions/optimize-serp-fetch'); await propose(page);
    await page.route('**/api/v1/functions/optimize-change-update', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '제안 상태 저장 실패' }) })); await live(page).getByRole('checkbox', { name: '적용 대상: 검색 설명 정리', exact: true }).click(); await expect(live(page).getByRole('alert')).toContainText('제안 상태 저장 실패'); await expect(live(page).getByRole('checkbox', { name: '적용 대상: 검색 설명 정리', exact: true })).toBeChecked(); await page.unroute('**/api/v1/functions/optimize-change-update');
    expect((await page.request.post('/api/v1/functions/content-save', { data: { workspace_id: ws.id, job_id: content.job.id, expected_revision: content.job.revision, title: '다른 세션 변경', content_md: '별도 편집한 본문' } })).status()).toBe(200);
    await live(page).getByRole('button', { name: '선택한 2개 제안 적용', exact: true }).click(); const conflict = page.waitForResponse(response => response.url().endsWith('/optimize-rewrite-content')); await dialog(page).getByRole('button', { name: '적용', exact: true }).click(); expect((await conflict).status()).toBe(409); await expect(dialog(page).getByRole('alert')).toContainText('다른 곳에서 콘텐츠가 변경'); await dialog(page).getByRole('button', { name: '취소', exact: true }).click(); await page.reload(); await expect(live(page).getByRole('button', { name: '선택한 2개 제안 적용', exact: true })).toBeDisabled();
    const data = await snapshot(page, ws.id); expect(data.content_drafts).toHaveLength(2); expect(data.content_review_runs[0].status).toBe('proposed');
    expect((await page.request.patch(`/api/v1/rest/content_change_items?id=eq.${data.content_change_items[0].id}`, { data: { status: 'applied' } })).status()).toBe(403); expect((await page.request.get('/api/v1/optimization?workspace_id=22222222-2222-4000-8000-222222222222')).status()).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expect(live(page).getByRole('heading', { name: '변경 제안', exact: true })).toBeVisible();
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
