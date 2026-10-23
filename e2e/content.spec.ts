import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => { expect((await page.request.post('/api/v1/auth', { data: { email: 'admin@halox.local', password: process.env.HALOX_DEMO_PASSWORD } })).status()).toBe(200); });
const live = (page: Page) => page.locator('[data-live-root]');
const dialog = (page: Page) => page.getByRole('dialog');
async function submit(page: Page, name = '저장') { await dialog(page).getByRole('button', { name, exact: true }).click(); await expect(dialog(page)).not.toBeVisible(); }
async function workspace(page: Page) {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `콘텐츠 검증 ${Date.now()}` } }); expect(response.status()).toBe(201);
  const [item] = await response.json(); await page.goto('/app/factory'); await expect(live(page).getByRole('button', { name: '새로고침', exact: true })).toBeEnabled();
  await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${item.name} (trial)` }).click(); await expect(live(page)).toContainText(item.name);
  return item;
}
async function create(page: Page) {
  await live(page).getByRole('button', { name: '새 콘텐츠 만들기', exact: true }).click();
  await dialog(page).getByLabel('주제', { exact: true }).fill('버전 관리'); await dialog(page).getByLabel('제목', { exact: true }).fill('콘텐츠 원본'); await dialog(page).getByLabel('본문 (Markdown)', { exact: true }).fill('# 원본\n\n## 첫 근거\n검증한 본문'); await submit(page, '만들기');
  await expect(page).toHaveURL(/\/app\/factory\/[\w-]+$/); await expect(live(page).getByRole('heading', { name: '본문 편집', exact: true })).toBeVisible();
  return page.url().split('/').at(-1)!;
}
async function snapshot(page: Page, id: string) { const response = await page.request.get(`/api/v1/content?workspace_id=${id}`); expect(response.status()).toBe(200); return response.json(); }

test('content editor persists body/meta/settings, selects/restores versions and cascades deletion', async ({ page }) => {
  const ws = await workspace(page);
  try {
    const id = await create(page);
    await live(page).getByLabel('제목', { exact: true }).fill('수정한 콘텐츠'); await live(page).getByLabel('본문 (Markdown)', { exact: true }).fill('## 수정 근거\n두 번째 본문'); await live(page).getByLabel('검색 제목', { exact: true }).fill('검색용 수정 제목'); await live(page).getByLabel('검색 설명', { exact: true }).fill('검색용 설명'); await live(page).getByRole('button', { name: '새 버전 저장', exact: true }).click(); await expect(live(page).getByRole('button', { name: '미리보기 v2', exact: true })).toBeVisible();
    await live(page).getByRole('button', { name: '작업 설정', exact: true }).click(); await dialog(page).getByLabel('작업 상태', { exact: true }).selectOption('ready'); await dialog(page).getByLabel('작업 메모', { exact: true }).fill('검토 완료 메모'); await submit(page); await page.reload();
    await expect(live(page).getByLabel('검색 제목', { exact: true })).toHaveValue('검색용 수정 제목'); await expect(live(page)).toContainText('검토 완료 메모');
    await live(page).getByRole('button', { name: '선택 v1', exact: true }).click(); await submit(page, '적용'); await expect(live(page).getByLabel('제목', { exact: true })).toHaveValue('콘텐츠 원본');
    await live(page).getByRole('button', { name: '복원 v2', exact: true }).click(); await submit(page, '적용'); await expect(live(page).getByRole('button', { name: '삭제 v3', exact: true })).toBeDisabled(); await expect(live(page).getByLabel('제목', { exact: true })).toHaveValue('수정한 콘텐츠');
    await live(page).getByRole('button', { name: '삭제 v2', exact: true }).click(); await submit(page, '삭제'); await expect(live(page).getByRole('button', { name: '미리보기 v2', exact: true })).not.toBeVisible();
    const data = await snapshot(page, ws.id); expect(data.content_drafts.map((row: { version: number }) => row.version).sort()).toEqual([1, 3]); expect(data.content_jobs[0].status).toBe('ready'); expect(data.content_compositions.some((row: { heading: string }) => row.heading === '수정 근거')).toBe(true);
    await live(page).getByRole('link', { name: '← 콘텐츠 목록' }).click(); await live(page).getByLabel('작업 상태 필터').selectOption('in_review'); await expect(live(page)).toContainText('검색 결과가 없습니다'); await live(page).getByLabel('작업 상태 필터').selectOption('ready'); await live(page).getByRole('link', { name: '수정한 콘텐츠', exact: true }).click();
    await live(page).getByRole('button', { name: '콘텐츠 삭제', exact: true }).click(); await submit(page, '삭제'); await expect(page).toHaveURL(/\/app\/factory$/);
    const after = await snapshot(page, ws.id); for (const table of ['content_jobs', 'content_drafts', 'content_compositions']) expect(after[table]).toEqual([]);
    await page.goto(`/app/factory/${id}`); await expect(live(page)).toContainText('콘텐츠를 찾을 수 없습니다');
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('failed and conflicting content writes preserve input; latest load and workspace switching remain safe on mobile', async ({ page }) => {
  const ws = await workspace(page);
  try {
    const id = await create(page); const bodyInput = live(page).getByLabel('본문 (Markdown)', { exact: true }); await bodyInput.fill('저장 실패에도 남을 본문');
    await page.route('**/api/v1/functions/content-save', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '저장소 일시 중단' }) })); await live(page).getByRole('button', { name: '새 버전 저장', exact: true }).click(); await expect(live(page).getByRole('alert')).toContainText('저장소 일시 중단'); await expect(bodyInput).toHaveValue('저장 실패에도 남을 본문'); await page.unroute('**/api/v1/functions/content-save');
    expect((await page.request.post('/api/v1/functions/content-save', { data: { workspace_id: ws.id, job_id: id, expected_revision: 1, title: '다른 세션 제목', content_md: '서버 최신 본문' } })).status()).toBe(200);
    const conflict = page.waitForResponse(response => response.url().endsWith('/content-save')); await live(page).getByRole('button', { name: '새 버전 저장', exact: true }).click(); expect((await conflict).status()).toBe(409); await expect(bodyInput).toHaveValue('저장 실패에도 남을 본문'); await expect(live(page).getByRole('alert')).toContainText('다른 곳에서 콘텐츠가 변경');
    await live(page).getByRole('button', { name: '최신 버전 불러오기', exact: true }).click(); await submit(page, '불러오기'); await expect(bodyInput).toHaveValue('서버 최신 본문'); await bodyInput.fill('최신 버전 확인 후 저장'); await live(page).getByRole('button', { name: '새 버전 저장', exact: true }).click(); await expect(live(page).getByRole('button', { name: '미리보기 v3', exact: true })).toBeVisible();
    expect((await page.request.patch(`/api/v1/rest/content_drafts?id=eq.${(await snapshot(page, ws.id)).content_drafts[0].id}`, { data: { content_md: '우회 수정' } })).status()).toBe(403);
    expect((await page.request.get('/api/v1/content?workspace_id=22222222-2222-4000-8000-222222222222')).status()).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expect(bodyInput).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: '브리찌 (trial)' }).click(); await expect(live(page)).toContainText('콘텐츠를 찾을 수 없습니다'); await expect(live(page).getByLabel('본문 (Markdown)', { exact: true })).not.toBeVisible();
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('demo generation and regeneration retain one job with separate reference snapshots', async ({ page }) => {
  const ws = await workspace(page);
  try {
    const response = await page.request.post('/api/v1/rest/writing_style_profiles', { data: { workspace_id: ws.id, name: '제품 설명 문체', tone: '간단하고 명확하게', is_default: true } }); expect(response.status()).toBe(201); const [persona] = await response.json();
    await page.reload(); await live(page).getByRole('button', { name: '새 콘텐츠 만들기', exact: true }).click(); await dialog(page).getByLabel('작성 방법').selectOption('generated'); await dialog(page).getByLabel('주제', { exact: true }).fill('제품 사용법'); await submit(page, '초안 생성'); await expect(live(page)).toContainText('데모 생성');
    const first = await snapshot(page, ws.id); expect(first.content_jobs).toHaveLength(1); expect(first.content_drafts[0].generation_context.persona.name).toBe('제품 설명 문체');
    expect((await page.request.patch(`/api/v1/rest/writing_style_profiles?id=eq.${persona.id}`, { data: { name: '갱신한 문체' } })).status()).toBe(200); await page.reload();
    await live(page).getByRole('button', { name: '새 데모 버전 생성', exact: true }).click(); await submit(page, '생성'); await expect(live(page).getByRole('button', { name: '미리보기 v2', exact: true })).toBeVisible();
    const second = await snapshot(page, ws.id); expect(second.content_jobs).toHaveLength(1); expect(second.content_drafts).toHaveLength(2); expect(second.content_drafts.find((row: { version: number }) => row.version === 1).generation_context.persona.name).toBe('제품 설명 문체'); expect(second.content_drafts.find((row: { version: number }) => row.version === 2).generation_context.persona.name).toBe('갱신한 문체');
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
