import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: path.join(__dirname, '.auth', 'export-state.json') });
const live = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
async function save(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
async function setup(page: Page, route = '/app/seo/insights') {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `분석 검증 ${Date.now()}`, default_brand_filter: 'brizzi.kr' } }); expect(response.status()).toBe(201); const [ws] = await response.json();
  expect((await page.request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: ws.id, keywords: ['검색 분석 검증', '다른 주제'] } })).status()).toBe(200);
  await page.goto(route); await expect(live(page).getByRole('button', { name: '현재 분석 저장', exact: true })).toBeEnabled(); await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${ws.name} (trial)` }).click(); await expect(live(page)).toContainText(ws.name); await expect(live(page).getByRole('button', { name: '현재 분석 저장', exact: true })).toBeEnabled(); return ws;
}

test('SEO saved conditions support create, edit, reload, apply and delete while evidence stays tied to real samples', async ({ page }) => {
  const ws = await setup(page);
  try {
    await live(page).getByLabel('분석 검색어').fill('검색 분석'); await live(page).getByRole('button', { name: '조건 적용', exact: true }).click(); await expect(live(page).getByRole('button', { name: '현재 분석 저장', exact: true })).toBeEnabled();
    await live(page).getByRole('button', { name: '성과', exact: true }).click(); await expect(live(page).getByRole('link', { name: '검색 분석 검증', exact: true })).toBeVisible(); await expect(live(page).getByRole('link', { name: '다른 주제', exact: true })).toHaveCount(0); await expect(live(page)).toContainText('1위');
    await live(page).getByRole('button', { name: '수집 근거', exact: true }).click(); await expect(live(page).locator('.analysis-evidence')).toContainText('dataforseo-mock'); await expect(live(page).locator('.analysis-evidence a')).toHaveCount(2);
    const download = page.waitForEvent('download'); await live(page).getByRole('button', { name: '분석 CSV' }).click(); expect((await download).suggestedFilename()).toBe('analysis-samples.csv');
    await live(page).getByRole('button', { name: '현재 분석 저장' }).click(); await modal(page).getByLabel('분석 이름', { exact: true }).fill('검색 분석 기준'); await modal(page).getByLabel('분석 메모').fill('첫 검토'); await save(page);
    await live(page).getByRole('button', { name: '저장 분석', exact: true }).click(); await live(page).getByRole('button', { name: '분석 편집' }).click(); await modal(page).getByLabel('분석 이름').fill('검색 분석 수정'); await modal(page).getByLabel('분석 메모').fill('수정한 분석 메모'); await modal(page).getByLabel('분석 엔진').selectOption('google'); await save(page); await page.reload(); await live(page).getByRole('button', { name: '저장 분석', exact: true }).click(); await expect(live(page)).toContainText('수정한 분석 메모');
    await live(page).getByRole('button', { name: '불러오기', exact: true }).click(); await expect(live(page).getByLabel('분석 검색어')).toHaveValue('검색 분석'); await expect(live(page).getByLabel('분석 엔진')).toHaveValue('google'); await expect(live(page)).toContainText('Top 10 비율');
    await live(page).getByRole('button', { name: '기회', exact: true }).click(); await expect(live(page)).toContainText('선택한 조건의 수집 자료가 없습니다'); await live(page).getByRole('button', { name: 'AIO', exact: true }).click(); await expect(live(page)).toContainText('인용 여부는 미측정');
    await live(page).getByRole('button', { name: '저장 분석', exact: true }).click(); await live(page).getByRole('button', { name: '분석 삭제' }).click(); await save(page, '삭제'); await expect(live(page)).toContainText('저장한 분석이 없습니다');
    expect((await (await page.request.get(`/api/v1/rest/keywords?workspace_id=eq.${ws.id}`)).json()).length).toBe(2);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('GEO analysis filters engines, exposes raw answers and sources, and persists independently saved conditions', async ({ page }) => {
  const ws = await setup(page, '/app/geo/analysis');
  try {
    expect((await page.request.post('/api/v1/functions/geo-run', { data: { workspace_id: ws.id, prompt_text: '분석할 질문은 무엇인가요?', engines: ['openai', 'gemini'] } })).status()).toBe(200);
    await live(page).getByRole('button', { name: '새로고침', exact: true }).click(); await expect(live(page).getByRole('button', { name: '현재 분석 저장' })).toBeEnabled(); await live(page).getByLabel('분석 엔진').selectOption('gemini'); await live(page).getByRole('button', { name: '조건 적용', exact: true }).click(); await live(page).getByRole('button', { name: '프롬프트', exact: true }).click(); await expect(live(page)).toContainText('1개 표본');
    await live(page).getByRole('button', { name: '수집 근거', exact: true }).click(); await expect(live(page).locator('.live-answer')).toContainText('[GEMINI 데모 응답]');
    await live(page).getByRole('button', { name: '인용 소스', exact: true }).click(); await expect(live(page).getByRole('heading', { name: '수집 출처' })).toBeVisible(); await live(page).getByRole('button', { name: '인용 매트릭스', exact: true }).click(); await expect(live(page).locator('thead')).toContainText('Gemini'); await expect(live(page).locator('thead')).not.toContainText('ChatGPT');
    await live(page).getByRole('button', { name: '현재 분석 저장' }).click(); await modal(page).getByLabel('분석 이름').fill('Gemini 조건'); await save(page); await page.reload(); await live(page).getByRole('button', { name: '저장 분석', exact: true }).click(); await live(page).getByRole('button', { name: '불러오기', exact: true }).click(); await expect(live(page).getByLabel('분석 엔진')).toHaveValue('gemini');
    await live(page).getByRole('button', { name: '플랫폼', exact: true }).click(); await expect(live(page).locator('tbody tr')).toHaveCount(1);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('analysis failures retain input, revision and tenant checks hold, and mobile filters and charts remain usable', async ({ page }) => {
  const ws = await setup(page);
  try {
    await page.route('**/api/v1/functions/analysis-create', route => route.fulfill({ status: 503, json: { error: '분석 저장 일시 중단' } }));
    await live(page).getByRole('button', { name: '현재 분석 저장' }).click(); await modal(page).getByLabel('분석 이름').fill('유지할 분석'); await modal(page).getByLabel('분석 메모').fill('실패해도 유지'); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 중단'); await expect(modal(page).getByLabel('분석 메모')).toHaveValue('실패해도 유지'); await page.unroute('**/api/v1/functions/analysis-create'); await save(page);
    const data = await (await page.request.get(`/api/v1/analyses?workspace_id=${ws.id}&kind=seo`)).json(), saved = data.saved[0];
    expect((await page.request.post('/api/v1/functions/analysis-delete', { data: { workspace_id: ws.id, analysis_id: saved.id, expected_revision: 0 } })).status()).toBe(409);
    expect((await page.request.patch(`/api/v1/rest/saved_analyses?id=eq.${saved.id}`, { data: { name: '직접 덮어쓰기' } })).status()).toBe(403);
    const outsider = await page.context().browser()!.newContext({ storageState: path.join(__dirname, '.auth', 'state.json') }); try { expect((await outsider.request.get(`/api/v1/analyses?workspace_id=${ws.id}&kind=seo`)).status()).toBe(403); } finally { await outsider.close(); }
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await live(page).getByLabel('분석 도메인').fill('unlisted.example'); await live(page).getByRole('button', { name: '조건 적용', exact: true }).click(); await expect(live(page).getByRole('button', { name: '현재 분석 저장' })).toBeEnabled();
    await live(page).getByRole('button', { name: '기회', exact: true }).click(); await expect(live(page).getByRole('link', { name: '검색 분석 검증', exact: true })).toBeVisible();
    await page.mouse.move(195, 400); await page.mouse.wheel(0, 900); await expect.poll(() => live(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await live(page).getByLabel('분석 검색어').fill('없는 자료'); await live(page).getByRole('button', { name: '조건 적용', exact: true }).click(); await expect(live(page)).toContainText('선택한 조건의 수집 자료가 없습니다');
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
