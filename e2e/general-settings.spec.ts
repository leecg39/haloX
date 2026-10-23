import crypto from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';
test.use({ storageState: { cookies: [], origins: [] } });
const root = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
const password = 'general-settings-test-password';
async function fixture(page: Page) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), hash = await hashPassword(password);
  const owner = await store.write(db => db.createAccount({ email: `general-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '설정 담당자', passwordHash: hash }));
  const response = await page.request.post('/api/v1/auth', { data: { email: owner.email, password } }); expect(response.status()).toBe(200); const workspace = (await response.json()).workspaces[0];
  await page.goto('/app/settings'); await expect(root(page).getByRole('button', { name: '수집 기본값 수정', exact: true })).toBeVisible();
  const data = async () => (await page.request.get(`/api/v1/general-settings?workspace_id=${workspace.id}`)).json();
  return { store, owner, workspace, data };
}
async function change(page: Page, language: string, country: string, auto: boolean) {
  await root(page).getByRole('button', { name: '수집 기본값 수정', exact: true }).click(); await modal(page).getByLabel('분석 언어').selectOption(language); await modal(page).getByLabel('대상 국가').selectOption(country); await modal(page).getByLabel('키워드 추가 시 프롬프트 자동 생성').setChecked(auto); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page)).not.toBeVisible();
}
test('collection settings persist across login and populate keyword, set, idea and prompt defaults without affecting another workspace', async ({ page, browser, baseURL }) => {
  const f = await fixture(page); await change(page, 'en', 'US', false); await page.reload(); await expect(root(page)).toContainText('영어 (en)'); await expect(root(page)).toContainText('꺼짐');
  const other = await browser.newContext({ baseURL }); try { expect((await other.request.post('/api/v1/auth', { data: { email: f.owner.email, password } })).status()).toBe(200); const second = await other.newPage(); await second.goto('/app/settings'); await expect(root(second)).toContainText('미국 (US)'); } finally { await other.close(); }
  await page.goto('/app/keywords'); await root(page).getByRole('button', { name: '키워드 추가', exact: true }).click(); await expect(modal(page).getByLabel('언어', { exact: true })).toHaveValue('en'); await expect(modal(page).getByLabel('국가', { exact: true })).toHaveValue('US'); await modal(page).locator('[name="keyword"]').fill('Default locale keyword'); await modal(page).getByRole('button', { name: '키워드 추가', exact: true }).click(); await expect(modal(page)).not.toBeVisible();
  const keywords = await (await page.request.get(`/api/v1/keywords?workspace_id=${f.workspace.id}`)).json(); expect(keywords.keywords[0].language).toBe('en'); expect(keywords.geo_prompts).toHaveLength(0);
  await root(page).getByRole('button', { name: '세트', exact: true }).click(); await root(page).getByRole('button', { name: '세트 추가', exact: true }).click(); await expect(modal(page).getByLabel('언어', { exact: true })).toHaveValue('en'); await modal(page).getByRole('button', { name: '취소', exact: true }).click();
  await root(page).getByRole('button', { name: '아이디어', exact: true }).click(); await root(page).getByRole('button', { name: '아이디어 추가', exact: true }).click(); await expect(modal(page).getByLabel('국가', { exact: true })).toHaveValue('US'); await modal(page).getByRole('button', { name: '취소', exact: true }).click();
  await page.goto('/app/geo/prompts'); await root(page).getByRole('button', { name: '프롬프트 추가', exact: true }).click(); await expect(modal(page).getByLabel('언어', { exact: true })).toHaveValue('en'); await expect(modal(page).getByLabel('국가', { exact: true })).toHaveValue('US'); await modal(page).getByRole('button', { name: '취소', exact: true }).click();
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: '독립 기본값 공간' } }), [workspace] = await response.json(); await page.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, workspace); await page.goto('/app/settings'); await expect(root(page)).toContainText('한국어 (ko)'); expect((await f.data()).defaults.language).toBe('en');
});
test('automatic prompt registration uses chosen language, persists links and quota, remains unexecuted and respects off/reset', async ({ page }) => {
  const f = await fixture(page); await expect(page.locator('[data-live-quota]')).toHaveAttribute('aria-label', 'AI 프롬프트 0 / 20 · 사용량 보기'); await change(page, 'ja', 'JP', true);
  await page.goto('/app/keywords'); await root(page).getByRole('button', { name: '키워드 추가', exact: true }).click(); await expect(modal(page)).toContainText('프롬프트 생성 한도'); await expect(modal(page).getByLabel('언어', { exact: true })).toHaveValue('ja'); await modal(page).locator('[name="keyword"]').fill('検索の意図'); await modal(page).getByRole('button', { name: '키워드 추가', exact: true }).click(); await expect(modal(page)).not.toBeVisible();
  await expect(page.locator('[data-live-quota]')).toHaveAttribute('aria-label', 'AI 프롬프트 1 / 20 · 사용량 보기');
  let data = await (await page.request.get(`/api/v1/prompts?workspace_id=${f.workspace.id}`)).json(); expect(data.geo_prompts).toHaveLength(1); expect(data.geo_prompts[0].language_code).toBe('ja'); expect(data.geo_prompts[0].location_code).toBe('JP'); expect(data.geo_prompt_runs).toHaveLength(0); expect(data.keyword_prompt_links).toHaveLength(1);
  await page.goto('/app/geo/prompts'); await expect(root(page)).toContainText('検索の意図について教えてください。'); await expect(root(page)).toContainText('키워드에서 자동 생성'); await expect(root(page)).toContainText('미실행'); await page.reload(); await expect(root(page)).toContainText('検索の意図について教えてください。');
  await page.goto('/app/settings'); await change(page, 'ko', 'KR', false); expect((await page.request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: f.workspace.id, keywords: ['자동 생성 끄기'], idempotency_key: crypto.randomUUID() } })).status()).toBe(200); data = await (await page.request.get(`/api/v1/prompts?workspace_id=${f.workspace.id}`)).json(); expect(data.geo_prompts).toHaveLength(1);
  await root(page).getByRole('button', { name: '수집 기본값 초기화', exact: true }).click(); await modal(page).getByRole('button', { name: '초기화', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); expect((await f.data()).defaults).toEqual({ language: 'ko', country: 'KR', auto_generate_prompts: true });
  expect(await f.store.read(db => db.queryTable('usage_reservations', { filters: { workspace_id: `eq.${f.workspace.id}`, unit_key: 'eq.prompt_create' } }, String(f.owner.id)).count)).toBe(1);
});
test('save failures and revision conflicts retain edits, manager permissions are enforced, and settings fit mobile', async ({ page }) => {
  const f = await fixture(page); await root(page).getByRole('button', { name: '수집 기본값 수정', exact: true }).click(); await modal(page).getByLabel('분석 언어').selectOption('zh');
  await page.route('**/api/v1/general-settings', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: '설정 저장 일시 중단' } }) : route.continue()); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 중단'); await expect(modal(page).getByLabel('분석 언어')).toHaveValue('zh'); await page.unroute('**/api/v1/general-settings');
  const state = await f.data(); expect((await page.request.post('/api/v1/general-settings', { data: { workspace_id: f.workspace.id, expected_revision: state.revision, action: 'reset' } })).status()).toBe(200); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('변경'); await expect(modal(page).getByLabel('분석 언어')).toHaveValue('zh'); await modal(page).getByRole('button', { name: '취소', exact: true }).click();
  const guest = await f.store.write(async db => { const user = db.createAccount({ email: `general-viewer-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '설정 조회자', passwordHash: await hashPassword(password) }); db.insertTable('workspace_members', { workspace_id: f.workspace.id, user_id: user.id, role: 'viewer', allowed_sections: ['other'] }, String(f.owner.id)); return user; });
  expect((await page.request.post('/api/v1/auth', { data: { email: guest.email, password } })).status()).toBe(200); await page.evaluate(ws => localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })), f.workspace); await page.reload(); await expect(root(page)).toContainText('기본값 변경은 워크스페이스 소유자·관리자'); await expect(root(page).getByRole('button', { name: '수집 기본값 수정', exact: true })).toHaveCount(0);
  expect((await page.request.post('/api/v1/general-settings', { data: { workspace_id: f.workspace.id, expected_revision: (await f.data()).revision, action: 'reset' } })).status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 600 }); await page.reload(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390); await page.mouse.move(280, 450); await page.mouse.wheel(0, 600); await expect.poll(() => root(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
});
test('header and usage tab display the selected workspace and report unknown on failed quota reads', async ({ page }) => {
  const f = await fixture(page); await expect(page.locator('[data-live-quota]')).toHaveAttribute('aria-label', 'AI 프롬프트 0 / 20 · 사용량 보기');
  expect((await page.request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: f.workspace.id, keywords: ['사용량 격리'], idempotency_key: crypto.randomUUID() } })).status()).toBe(200);
  await page.reload(); await expect(page.locator('[data-live-quota]')).toHaveAttribute('aria-label', 'AI 프롬프트 1 / 20 · 사용량 보기'); await page.locator('[data-live-quota]').click(); await expect(page).toHaveURL(/tab=plan/);
  const section = page.locator('text=실시간 사용량').locator('xpath=ancestor::div[.//span[normalize-space()="키워드"]][1]');
  await expect(section.locator('span:text-is("AI 프롬프트") + span').first()).toHaveText('1 / 20');
  await page.route('**/api/v1/rpc/get_workspace_quota_summary', route => route.fulfill({ status: 503, json: { error: '일시 중단' } })); await page.reload(); await expect(page.locator('[data-live-quota]')).toHaveAttribute('aria-label', 'AI 프롬프트 사용량 미확인'); await expect(section.locator('span:text-is("AI 프롬프트") + span').first()).toHaveText('미확인');
  await page.unroute('**/api/v1/rpc/get_workspace_quota_summary'); await page.reload(); await expect(section.locator('span:text-is("AI 프롬프트") + span').first()).toHaveText('1 / 20');
});

test('account interface language switches the administrator UI, persists across workspace and login, and stays isolated per user', async ({ page, browser, baseURL }) => {
  const f = await fixture(page);
  await root(page).getByRole('button', { name: '인터페이스 언어 변경', exact: true }).click();
  await modal(page).locator('[name="interface_language"]').selectOption('en');
  await modal(page).getByRole('button', { name: '저장', exact: true }).click();
  await expect(modal(page)).not.toBeVisible();
  await expect(root(page).getByRole('heading', { name: 'General Settings', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(root(page).getByRole('heading', { name: 'Default Data Collection Target', exact: true })).toBeVisible();
  await expect(root(page).getByRole('button', { name: 'Edit Collection Defaults', exact: true })).toBeVisible();
  await expect(root(page)).toContainText('설정 담당자의 워크스페이스');
  expect((await f.data()).interface).toEqual({ language: 'en', revision: 1 });

  const secondWorkspace = await f.store.write(db => db.insertTable('workspaces', { name: '한국어 고객 데이터' }, String(f.owner.id))[0]);
  await page.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: 'trial' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, secondWorkspace);
  await page.goto('/app/keywords');
  await expect(root(page).getByRole('heading', { name: 'Keywords', exact: true })).toBeVisible();
  await expect(root(page).getByRole('button', { name: 'Add Keyword', exact: true })).toBeVisible();
  await expect(root(page)).toContainText('Manage search performance and keyword assets.');
  await expect(page.getByText('한국어 고객 데이터', { exact: true }).first()).toBeVisible();

  const anotherLogin = await browser.newContext({ baseURL });
  try {
    expect((await anotherLogin.request.post('/api/v1/auth', { data: { email: f.owner.email, password } })).status()).toBe(200);
    const sameAccount = await anotherLogin.newPage(); await sameAccount.goto('/app/settings');
    await expect(root(sameAccount).getByRole('heading', { name: 'General Settings', exact: true })).toBeVisible();
  } finally { await anotherLogin.close(); }

  const koreanUser = await f.store.write(async db => db.createAccount({ email: `korean-ui-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '한국어 사용자', passwordHash: await hashPassword(password) }));
  const isolated = await browser.newContext({ baseURL });
  try {
    expect((await isolated.request.post('/api/v1/auth', { data: { email: koreanUser.email, password } })).status()).toBe(200);
    const koreanPage = await isolated.newPage(); await koreanPage.goto('/app/settings');
    await expect(root(koreanPage).getByRole('heading', { name: '일반 환경 설정', exact: true })).toBeVisible();
    await expect(koreanPage.locator('html')).toHaveAttribute('lang', 'ko');
  } finally { await isolated.close(); }

  await page.goto('/app/settings');
  await root(page).getByRole('button', { name: 'Change Interface Language', exact: true }).click();
  await modal(page).locator('[name="interface_language"]').selectOption('ko');
  await modal(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(root(page).getByRole('heading', { name: '일반 환경 설정', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
});
