import { expect, test, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';

const WS = '11111111-1111-4000-8000-111111111111';
const live = (page: Page) => page.locator('[data-live-root]');
const modal = (page: Page) => page.getByRole('dialog');
async function save(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }

test('prompt set, question, shared tags and raw run history persist through edit and deletion', async ({ page, request }) => {
  const suffix = Date.now(), set = `질문 세트 ${suffix}`, question = `통합 검색 도구 ${suffix}`, renamed = `${question} 수정`, tag = `질문 태그 ${suffix}`;
  await page.goto('/app/geo/prompts');
  await live(page).getByRole('button', { name: '세트', exact: true }).click();
  await live(page).getByRole('button', { name: '세트 추가', exact: true }).click();
  await modal(page).getByLabel('이름', { exact: true }).fill(set);
  await modal(page).getByLabel('브랜드 도메인').fill('example.com'); await save(page);
  await live(page).getByRole('button', { name: '태그', exact: true }).click();
  await live(page).getByRole('button', { name: '태그 추가', exact: true }).click();
  await modal(page).getByLabel('이름', { exact: true }).fill(tag); await save(page);
  await live(page).getByRole('button', { name: '프롬프트 추가', exact: true }).click();
  await modal(page).getByLabel('질문', { exact: true }).fill(question);
  await modal(page).getByLabel('세트', { exact: true }).selectOption({ label: set });
  await modal(page).getByLabel('Claude', { exact: true }).check(); await save(page, '추가하고 실행');
  await live(page).getByRole('button', { name: '리스트', exact: true }).click();
  const row = live(page).getByRole('row').filter({ hasText: question });
  await row.getByRole('button', { name: '편집', exact: true }).click();
  await modal(page).getByLabel('질문', { exact: true }).fill(renamed); await modal(page).getByLabel(tag, { exact: true }).check(); await save(page);
  await row.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(row.getByRole('button', { name: '재개', exact: true })).toBeVisible();
  await row.getByRole('link', { name: renamed, exact: true }).click(); await expect(live(page).getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  const id = page.url().split('/').at(-1)!;
  await page.reload(); await expect(live(page)).toContainText(tag);
  await live(page).getByRole('button', { name: '선택 엔진 실행', exact: true }).click();
  await expect(live(page).locator('.live-status')).toHaveText('프롬프트 실행을 완료했습니다.');
  await expect(live(page).locator('details')).toHaveCount(4);
  await live(page).locator('details summary').first().click();
  await expect(live(page).locator('details').first().locator('pre')).toContainText(renamed);
  await page.goto('/app/geo'); await expect(live(page).getByRole('heading', { name: 'AI 대화 개요' })).toBeVisible(); await expect(live(page).locator('details')).not.toHaveCount(0);
  await page.goto('/app/geo/prompts'); await live(page).getByRole('button', { name: '세트', exact: true }).click();
  await live(page).locator('section').filter({ has: page.getByRole('heading', { name: set, exact: true }) }).getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제');
  await page.goto(`/app/geo/prompts/${id}`); await expect(live(page)).toContainText('미분류');
  await live(page).locator('.live-prompt-heading').getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제');
  await expect(page).toHaveURL(/\/app\/geo\/prompts$/);
  for (const table of ['geo_prompt_runs', 'geo_answers_raw', 'geo_prompt_tag_assignments']) expect(await (await request.get(`/api/v1/rest/${table}?prompt_id=eq.${id}`)).json()).toEqual([]);
  await page.goto(`/app/geo/prompts/${id}`); await expect(live(page)).toContainText('프롬프트를 찾을 수 없습니다');
  await page.goto('/app/geo/prompts'); await live(page).getByRole('button', { name: '태그', exact: true }).click();
  await live(page).locator('section').filter({ hasText: tag }).getByRole('button', { name: '삭제', exact: true }).click(); await save(page, '삭제');
});

test('failed prompt creation preserves input and selected workspace controls reads and writes', async ({ page, request }) => {
  const response = await request.post('/api/v1/rest/workspaces', { data: { name: `질문 격리 ${Date.now()}` } }); expect(response.status()).toBe(201); const [workspace] = await response.json();
  try {
    await page.goto('/app/geo/prompts'); await expect(live(page).getByRole('button', { name: '프롬프트 추가', exact: true })).toBeEnabled();
    await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${workspace.name} (trial)` }).click();
    await expect(live(page)).toContainText('등록된 프롬프트가 없습니다');
    await live(page).getByRole('button', { name: '프롬프트 추가', exact: true }).click(); await modal(page).getByLabel('질문', { exact: true }).fill('새 공간의 질문');
    await page.route('**/api/v1/functions/geo-run', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '실행 서비스 일시 중단' }) }));
    await modal(page).getByRole('button', { name: '추가하고 실행', exact: true }).click();
    await expect(modal(page).getByRole('alert')).toContainText('실행 서비스 일시 중단'); await expect(modal(page).getByLabel('질문', { exact: true })).toHaveValue('새 공간의 질문');
    await page.unroute('**/api/v1/functions/geo-run'); await save(page, '추가하고 실행');
    const payload = await (await request.get(`/api/v1/prompts?workspace_id=${workspace.id}`)).json(); expect(payload.geo_prompts).toHaveLength(1);
    const prompt = payload.geo_prompts[0]; expect(prompt.workspace_id).toBe(workspace.id);
    expect((await request.patch(`/api/v1/rest/geo_prompts?id=eq.${prompt.id}`, { data: { prompt_set_id: '44444444-4444-4000-8000-444444444444' } })).status()).toBe(400);
    expect((await request.get('/api/v1/prompts?workspace_id=22222222-2222-4000-8000-222222222222')).status()).toBe(403);
    await page.reload(); await expect(live(page).getByRole('link', { name: '새 공간의 질문', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await live(page).getByLabel('프롬프트 검색').fill('없는 질문'); await expect(live(page)).toContainText('조건에 맞는 프롬프트가 없습니다');
  } finally { await request.delete(`/api/v1/rest/workspaces?id=eq.${workspace.id}`); }
});

test('the running server processes a persisted schedule once and disabling it clears the next run', async ({ page, request }) => {
  const response = await request.post('/api/v1/rest/workspaces', { data: { name: `예약 처리 ${Date.now()}` } }); expect(response.status()).toBe(201); const [workspace] = await response.json();
  try {
    const setResponse = await request.post('/api/v1/rest/geo_prompt_sets', { data: { workspace_id: workspace.id, name: '자동 실행 세트', schedule_enabled: true, schedule_hour: 9 } }); expect(setResponse.status()).toBe(201); const [set] = await setResponse.json();
    const created = await request.post('/api/v1/functions/geo-run', { data: { workspace_id: workspace.id, prompt_set_id: set.id, prompt_text: '예약 실행 확인', engines: ['openai'] } }); expect(created.status()).toBe(200); const promptId = (await created.json()).prompt_id;
    const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!);
    await store.write(db => db.updateTable('geo_prompt_sets', { next_run_at: '2026-01-01T00:00:00.000Z' }, { id: `eq.${set.id}` }));
    await expect.poll(async () => (await (await request.get(`/api/v1/rest/geo_prompt_runs?prompt_id=eq.${promptId}`)).json()).length).toBe(2);
    const runs = await (await request.get(`/api/v1/rest/geo_prompt_runs?prompt_id=eq.${promptId}`)).json();
    expect(runs.filter((row: { scheduled_for?: string }) => row.scheduled_for)).toHaveLength(1);
    await page.goto('/app/geo/prompts'); await expect(live(page).getByRole('button', { name: '프롬프트 추가', exact: true })).toBeEnabled();
    await page.locator('[data-sidebar="header"] button[aria-haspopup="menu"]').click(); await page.getByRole('menuitem', { name: `${workspace.name} (trial)` }).click();
    await live(page).getByRole('button', { name: '세트', exact: true }).click();
    await live(page).getByRole('button', { name: '예약 끄기', exact: true }).click(); await expect(live(page).locator('.live-status')).toHaveText('예약을 껐습니다.');
    await page.reload(); await live(page).getByRole('button', { name: '세트', exact: true }).click(); await expect(live(page).getByRole('button', { name: '예약 켜기', exact: true })).toBeVisible();
    const stored = await (await request.get(`/api/v1/rest/geo_prompt_sets?id=eq.${set.id}`)).json(); expect(stored[0].next_run_at).toBeNull();
  } finally { await request.delete(`/api/v1/rest/workspaces?id=eq.${workspace.id}`); }
});
