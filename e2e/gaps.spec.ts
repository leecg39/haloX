import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: path.join(__dirname, '.auth', 'export-state.json') });
const live = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
async function save(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
async function setup(page: Page) {
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: `기회 검증 ${Date.now()}`, default_brand_filter: 'brizzi.kr' } }); expect(response.status()).toBe(201); const [ws] = await response.json();
  const collected = await page.request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: ws.id, keywords: ['기회 원본 키워드'] } }); expect(collected.status()).toBe(200); const { keywords } = await collected.json();
  await page.goto('/app/gap'); await expect(live(page).getByRole('button', { name: '후보 추가', exact: true })).toBeEnabled(); await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${ws.name} (trial)` }).click(); await expect(live(page)).toContainText(ws.name); return { ws, keyword: keywords[0] };
}
const gapData = async (page: Page, ws: string) => (await page.request.get(`/api/v1/gaps?workspace_id=${ws}`)).json();

test('opportunity candidates generate from stored evidence, retain review changes, adopt once and link to their execution pages', async ({ page }) => {
  const { ws, keyword } = await setup(page);
  try {
    await expect(live(page)).toContainText('측정 자료 부족'); await live(page).getByRole('button', { name: '수집 자료에서 후보 생성', exact: true }).click(); await modal(page).getByLabel('원본 키워드', { exact: true }).selectOption(keyword.id); await save(page, '후보 생성'); await expect(live(page)).toContainText('후보 5개를 저장'); await live(page).getByRole('button', { name: '검토 후보', exact: true }).click();
    await live(page).getByLabel('후보 유형 필터').selectOption('prompt'); const card = live(page).locator('article.live-card').first(); const phrase = await card.locator('h3').innerText();
    await card.getByRole('button', { name: '후보 편집' }).click(); await modal(page).getByLabel('후보 메모').fill('회의에서 검토할 질문'); await modal(page).getByLabel('후보 우선순위').selectOption('high'); await save(page);
    await card.getByRole('button', { name: '보류', exact: true }).click(); await save(page, '보류'); await expect(card).toContainText('보류'); await card.getByRole('button', { name: '검토 재개' }).click(); await save(page, '검토 재개');
    await card.getByRole('button', { name: '채택하여 등록' }).click(); await modal(page).getByRole('checkbox').check(); await save(page, '채택하여 등록'); await expect(card).toContainText('채택 완료');
    const data = await gapData(page, ws.id), candidate = data.candidates.find((row: { text: string }) => row.text === phrase); expect(candidate.status).toBe('accepted'); expect(data.prompts).toHaveLength(2); expect(data.prompts.filter((row: { origin?: string }) => row.origin === 'keyword-template')).toHaveLength(1); expect(data.matrix[0].prompt_count).toBe(2);
    expect((await page.request.post('/api/v1/functions/candidate-adopt', { data: { workspace_id: ws.id, candidate_id: candidate.id, expected_revision: 1, confirm: true } })).status()).toBe(200); expect((await gapData(page, ws.id)).prompts).toHaveLength(2);
    await card.getByRole('link', { name: '등록 항목 보기 →' }).click(); await expect(page).toHaveURL(new RegExp(`/app/geo/prompts/${candidate.destination_id}$`)); await expect(live(page)).toContainText(phrase);
    await page.goto('/app/gap'); await live(page).getByRole('button', { name: '검토 후보', exact: true }).click(); await live(page).getByLabel('후보 검색').fill(phrase); await expect(live(page)).toContainText('회의에서 검토할 질문'); await expect(live(page)).toContainText('채택 완료');
    await live(page).getByRole('button', { name: '판단 기록', exact: true }).click(); const history = live(page).locator('article.live-card').first(); await history.getByRole('button', { name: '판단 메모 수정' }).click(); await modal(page).getByLabel('판단 메모').fill('근거 확인 완료'); await save(page); await page.reload(); await live(page).getByRole('button', { name: '판단 기록', exact: true }).click(); await expect(live(page)).toContainText('근거 확인 완료');
    await live(page).getByRole('button', { name: '검토 후보', exact: true }).click(); await live(page).getByLabel('후보 검색').fill(phrase); await live(page).getByRole('button', { name: '후보 삭제', exact: true }).click(); await save(page, '삭제'); expect((await gapData(page, ws.id)).prompts).toHaveLength(2);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});

test('manual candidate failures preserve input and mobile gap data respects workspace and revision boundaries', async ({ page }) => {
  const { ws, keyword } = await setup(page);
  try {
    await page.route('**/api/v1/functions/candidate-create', route => route.fulfill({ status: 503, json: { error: '후보 저장 일시 중단' } }));
    await live(page).getByRole('button', { name: '후보 추가', exact: true }).click(); await modal(page).getByLabel('후보 문구').fill('새 기회 키워드'); await modal(page).getByLabel('후보 원본 키워드').selectOption(keyword.id); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 중단'); await expect(modal(page).getByLabel('후보 문구')).toHaveValue('새 기회 키워드'); await page.unroute('**/api/v1/functions/candidate-create'); await save(page);
    await live(page).getByRole('button', { name: '검토 후보', exact: true }).click(); await expect(live(page)).toContainText('새 기회 키워드'); const data = await gapData(page, ws.id), candidate = data.candidates[0];
    expect((await page.request.post('/api/v1/functions/candidate-delete', { data: { workspace_id: ws.id, candidate_id: candidate.id, expected_revision: 0 } })).status()).toBe(409);
    expect((await page.request.patch(`/api/v1/rest/geo_prompt_candidates?id=eq.${candidate.id}`, { data: { status: 'accepted' } })).status()).toBe(403);
    const outsider = await page.context().browser()!.newContext({ storageState: path.join(__dirname, '.auth', 'state.json') }); try { expect((await outsider.request.get(`/api/v1/gaps?workspace_id=${ws.id}`)).status()).toBe(403); } finally { await outsider.close(); }
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await live(page).getByRole('button', { name: '후보 편집' }).click(); await expect(modal(page).getByLabel('후보 문구')).toHaveValue('새 기회 키워드'); await page.keyboard.press('Escape'); await expect(modal(page)).not.toBeVisible();
    await live(page).getByRole('button', { name: '매트릭스', exact: true }).click(); const download = page.waitForEvent('download'); await live(page).getByRole('button', { name: '갭 CSV' }).click(); expect((await download).suggestedFilename()).toBe('gap-matrix.csv');
    await live(page).getByRole('button', { name: '트렌드', exact: true }).click(); await page.mouse.move(195, 420); await page.mouse.wheel(0, 1100); await expect.poll(() => live(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.request.delete(`/api/v1/rest/workspaces?id=eq.${ws.id}`); }
});
