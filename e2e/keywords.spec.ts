import { expect, test, type Page } from '@playwright/test';

const WS = '11111111-1111-4000-8000-111111111111';
const live = (page: Page) => page.locator('[data-live-root]');
const dialog = (page: Page) => page.getByRole('dialog');
async function save(page: Page, name = '저장') {
  await dialog(page).getByRole('button', { name, exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
}

test('keyword, set and tag CRUD persist through navigation and cascade on delete', async ({ page, request }) => {
  const suffix = Date.now();
  const set = `세트 ${suffix}`, keyword = `검색어 ${suffix}`, renamed = `${keyword} 수정`, tag = `태그 ${suffix}`;
  await page.goto('/app/keywords');
  await live(page).getByRole('button', { name: '세트', exact: true }).click();
  await live(page).getByRole('button', { name: '세트 추가', exact: true }).click();
  await dialog(page).getByLabel('이름', { exact: true }).fill(set);
  await dialog(page).getByLabel('자사 도메인').fill('example.com');
  await save(page);
  await expect(live(page).getByRole('heading', { name: set, exact: true })).toBeVisible();
  await live(page).getByRole('button', { name: '태그', exact: true }).click();
  await live(page).getByRole('button', { name: '태그 추가', exact: true }).click();
  await dialog(page).getByLabel('이름', { exact: true }).fill(tag); await save(page);
  await live(page).getByRole('button', { name: '키워드 추가', exact: true }).click();
  await dialog(page).getByLabel('키워드 (한 줄에 하나, 최대 20개)').fill(keyword);
  await dialog(page).getByLabel('세트', { exact: true }).selectOption({ label: set });
  await save(page, '키워드 추가');
  await live(page).getByRole('button', { name: '리스트', exact: true }).click();
  await live(page).getByLabel('키워드 검색').fill(keyword);
  let row = live(page).getByRole('row').filter({ hasText: keyword });
  await row.getByRole('button', { name: '편집', exact: true }).click();
  await dialog(page).getByLabel('키워드', { exact: true }).fill(renamed);
  await dialog(page).getByLabel(tag, { exact: true }).check(); await save(page);
  row = live(page).getByRole('row').filter({ hasText: renamed });
  await expect(row).toContainText(tag);
  await row.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(row.getByRole('button', { name: '재개', exact: true })).toBeVisible();
  await row.getByRole('link', { name: renamed, exact: true }).click();
  await expect(live(page).getByRole('heading', { level: 1 })).toHaveText(renamed);
  const id = page.url().split('/').at(-1)!;
  await page.reload();
  await expect(live(page)).toContainText(tag);
  await live(page).getByRole('button', { name: '다시 수집' }).click();
  await expect(live(page).locator('.live-status')).toHaveText('수집 이력을 갱신했습니다.');
  await page.goto('/app/keywords');
  await live(page).getByRole('button', { name: '세트', exact: true }).click();
  const card = live(page).locator('section').filter({ has: page.getByRole('heading', { name: set, exact: true }) });
  await card.getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제');
  await page.goto(`/app/keywords/${id}`);
  await expect(live(page)).toContainText('미분류');
  await live(page).getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제');
  await expect(page).toHaveURL(/\/app\/keywords$/);
  for (const table of ['serp_snapshots', 'keyword_tag_assignments']) {
    const result = await request.get(`/api/v1/rest/${table}?keyword_id=eq.${id}`); expect(await result.json()).toEqual([]);
  }
  await page.goto(`/app/keywords/${id}`); await expect(live(page)).toContainText('키워드를 찾을 수 없습니다');
  await page.goto('/app/keywords'); await live(page).getByRole('button', { name: '태그', exact: true }).click();
  await live(page).locator('section').filter({ hasText: tag }).getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제');
});

test('failed writes preserve input, and workspace switching changes both reads and writes', async ({ page, request }) => {
  const response = await request.post('/api/v1/rest/workspaces', { data: { name: `키워드 격리 ${Date.now()}`, default_brand_filter: 'example.org' } });
  expect(response.status()).toBe(201); const [workspace] = await response.json();
  try {
    await page.goto('/app/keywords');
    await expect(live(page).getByRole('link', { name: 'AI 검색 최적화', exact: true })).toBeVisible();
    await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: `${workspace.name} (trial)` }).click();
    await expect(live(page)).toContainText('아직 키워드가 없습니다');
    await live(page).getByRole('button', { name: '키워드 추가', exact: true }).click();
    await dialog(page).getByLabel('키워드 (한 줄에 하나, 최대 20개)').fill('새 공간 입력 유지');
    await page.route('**/api/v1/functions/keywords-collect', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '저장 서비스 일시 중단' }) }));
    await dialog(page).getByRole('button', { name: '키워드 추가', exact: true }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('저장 서비스 일시 중단');
    await expect(dialog(page).getByLabel('키워드 (한 줄에 하나, 최대 20개)')).toHaveValue('새 공간 입력 유지');
    await page.unroute('**/api/v1/functions/keywords-collect'); await save(page, '키워드 추가');
    await page.reload(); await expect(live(page).getByRole('link', { name: '새 공간 입력 유지', exact: true })).toBeVisible();
    const stored = await request.get(`/api/v1/rest/keywords?workspace_id=eq.${workspace.id}`); const [keyword] = await stored.json();
    expect(keyword.workspace_id).toBe(workspace.id);
    const crossing = await request.patch(`/api/v1/rest/keywords?id=eq.${keyword.id}`, { data: { keyword_set_id: '33333333-3333-4000-8000-333333333333' } }); expect(crossing.status()).toBe(400);
    const forbidden = await request.get('/api/v1/keywords?workspace_id=22222222-2222-4000-8000-222222222222');
    expect(forbidden.status()).toBe(403);
    await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: '브리찌 (trial)' }).click();
    await expect(live(page).getByRole('link', { name: 'AI 검색 최적화', exact: true })).toBeVisible();
    await expect(live(page).getByRole('link', { name: '새 공간 입력 유지', exact: true })).not.toBeVisible();
  } finally { await request.delete(`/api/v1/rest/workspaces?id=eq.${workspace.id}`); }
});

test('idea adoption and keyword-prompt links use persisted records', async ({ page, request }) => {
  const idea = `아이디어 ${Date.now()}`;
  await page.goto('/app/keywords');
  await live(page).getByRole('button', { name: '아이디어', exact: true }).click();
  await live(page).getByRole('button', { name: '아이디어 추가' }).click();
  await dialog(page).getByLabel('키워드', { exact: true }).fill(idea); await save(page);
  let card = live(page).locator('section').filter({ hasText: idea });
  await card.getByRole('button', { name: '편집', exact: true }).click();
  await dialog(page).getByLabel('메모').fill('저장한 메모'); await save(page);
  await card.getByRole('button', { name: '채택', exact: true }).click();
  await expect(card).not.toBeVisible();
  const response = await request.get(`/api/v1/rest/keywords?workspace_id=eq.${WS}&keyword=eq.${encodeURIComponent(idea)}`);
  const [keyword] = await response.json(); expect(keyword).toBeTruthy();
  await live(page).getByRole('button', { name: '네트워크', exact: true }).click();
  await live(page).getByRole('button', { name: '프롬프트 연결', exact: true }).click();
  await dialog(page).getByLabel('키워드', { exact: true }).selectOption({ label: idea });
  await dialog(page).getByLabel('프롬프트', { exact: true }).selectOption({ index: 1 }); await save(page);
  await page.reload(); await live(page).getByRole('button', { name: '네트워크', exact: true }).click();
  const row = live(page).getByRole('row').filter({ hasText: idea }); await expect(row).toBeVisible();
  await row.getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제');
  await expect(row).not.toBeVisible();
  await request.delete(`/api/v1/rest/keywords?id=eq.${keyword.id}`);
});

test('pagination, filtering, bulk deletion and keyboard controls work on mobile', async ({ page, request }) => {
  const response = await request.post('/api/v1/rest/workspaces', { data: { name: `모바일 검증 ${Date.now()}` } });
  expect(response.status()).toBe(201);
  const [workspace] = await response.json();
  const collected = await request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: workspace.id, keywords: Array.from({ length: 13 }, (_, index) => `모바일 검색어 ${index + 1}`) } });
  expect(collected.status()).toBe(200);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/app/keywords');
    await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: `${workspace.name} (trial)` }).click();
    await expect(live(page).locator('tbody tr')).toHaveCount(12);
    await live(page).getByRole('button', { name: '다음', exact: true }).click();
    await expect(live(page).locator('tbody tr')).toHaveCount(1);
    await live(page).getByLabel('키워드 검색').fill('없는 검색어');
    await expect(live(page)).toContainText('조건에 맞는 키워드가 없습니다');
    await live(page).getByLabel('키워드 검색').fill('모바일 검색어 13');
    await expect(live(page).locator('tbody tr')).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await live(page).getByRole('button', { name: '키워드 추가', exact: true }).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog(page)).not.toBeVisible();
    await live(page).getByLabel('현재 페이지 전체 선택').check();
    await live(page).getByRole('button', { name: '선택 삭제', exact: true }).click(); await save(page, '삭제');
    await expect(live(page)).toContainText('조건에 맞는 키워드가 없습니다');
    expect(errors).toEqual([]);
  } finally { await request.delete(`/api/v1/rest/workspaces?id=eq.${workspace.id}`); }
});
