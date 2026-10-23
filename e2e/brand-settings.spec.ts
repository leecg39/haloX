import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';
test.use({ storageState: { cookies: [], origins: [] } });
const root = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
const brand = (page: Page, name = 'Apple') => root(page).getByRole('article', { name, exact: true });
const password = 'brand-settings-local-fixture';
async function fixture(page: Page) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), hash = await hashPassword(password);
  const owner = await store.write(db => db.createAccount({ email: `brands-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '브랜드 담당자', passwordHash: hash }));
  const auth = await page.request.post('/api/v1/auth', { data: { email: owner.email, password } }); expect(auth.status()).toBe(200); const workspace = (await auth.json()).workspaces[0];
  const entities = await store.write(db => {
    const keyword = db.insertTable('keywords', { workspace_id: workspace.id, keyword: '브랜드 비교' }, owner.id)[0], prompt = db.insertTable('geo_prompts', { workspace_id: workspace.id, prompt_text: '추천 도구는?' }, owner.id)[0], at = new Date(Date.now() - 1000).toISOString();
    const snapshot = db.insertTable('serp_snapshots', { workspace_id: workspace.id, keyword_id: keyword.id, keyword_text: keyword.keyword, captured_at: at, engine: 'google', language: 'ko', country: 'KR', top_results_json: [{ url: 'https://shop.apple.co.kr/atlas', rank: 3, title: 'Atlas' }] }, owner.id)[0];
    const run = db.insertTable('geo_prompt_runs', { workspace_id: workspace.id, prompt_id: prompt.id, prompt_text: prompt.prompt_text, engine: 'openai', language_code: 'ko', location_code: 'KR', status: 'completed', finished_at: at, requested_at: at, answer_text: 'Apple Atlas와 애플을 추천합니다.', brand_domain: '' }, owner.id)[0];
    db.insertTable('geo_run_metrics', { workspace_id: workspace.id, run_id: run.id, brand_mentioned: false, is_cited: false }, owner.id);
    db.insertTable('geo_citations', { workspace_id: workspace.id, run_id: run.id, cited_url: 'https://old-apple.test/atlas', is_ours: false, is_competitor: false, position_index: 1 }, owner.id);
    return { keyword, prompt, snapshot, run };
  });
  const get = async () => (await page.request.get(`/api/v1/brand-settings?workspace_id=${workspace.id}`)).json();
  const command = async (action: string, values: Record<string, unknown> = {}) => page.request.post('/api/v1/brand-settings', { data: { workspace_id: workspace.id, action, expected_revision: (await get()).config.revision, ...values } });
  return { store, owner, workspace, get, command, ...entities };
}
async function save(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }

test('brand cards, products, aliases and domain policies reclassify persisted analyses without changing source responses', async ({ page, browser, baseURL }) => {
  const f = await fixture(page); await page.goto('/app/settings?tab=brand-tracking');
  await root(page).getByRole('button', { name: '자사 브랜드 추가', exact: true }).click(); await modal(page).getByLabel('대표 이름', { exact: true }).fill('Apple'); await modal(page).getByLabel('멘션 (한 줄에 하나)', { exact: true }).fill('애플'); await modal(page).getByLabel('도메인 (한 줄에 하나)').fill('apple.co.kr');
  await page.route('**/api/v1/brand-settings', async route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: '브랜드 저장 일시 중단' } }) : route.continue());
  await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 중단'); await expect(modal(page).getByLabel('대표 이름', { exact: true })).toHaveValue('Apple');
  await page.unroute('**/api/v1/brand-settings'); await save(page); await expect(brand(page)).toContainText('최근 28일 GEO 멘션 응답 1건');
  await brand(page).getByRole('button', { name: '상품 추가', exact: true }).click(); await modal(page).getByLabel('제품 이름', { exact: true }).fill('Atlas'); await modal(page).getByLabel('카테고리', { exact: true }).fill('분석 도구'); await modal(page).getByLabel('제품 소개').fill('우리 제품 소개'); await save(page);
  await expect(brand(page)).toContainText('Atlas · 1건'); await expect(brand(page, 'Atlas')).toContainText('우리 제품 소개');
  await root(page).getByRole('button', { name: '별칭 추가', exact: true }).click(); await modal(page).getByLabel('이전 도메인').fill('old-apple.test'); await modal(page).getByLabel('대표 도메인').fill('apple.co.kr'); await save(page);
  const seo = await (await page.request.get(`/api/v1/analyses?workspace_id=${f.workspace.id}&kind=seo`)).json(), geo = await (await page.request.get(`/api/v1/analyses?workspace_id=${f.workspace.id}&kind=geo`)).json();
  expect(seo.summary.average_rank).toBe(3); expect(geo.summary.mention_percent).toBe(100); expect(geo.summary.citation_percent).toBe(100);
  const source = await f.store.read(db => db.queryTable('geo_prompt_runs', { filters: { id: `eq.${f.run.id}` } }, f.owner.id).data[0]); expect(source.answer_text).toBe(f.run.answer_text); expect(source.brand_domain).toBe('');
  await page.reload(); await expect(brand(page)).toContainText('Atlas · 1건');
  const session = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try { const tab = await session.newPage(); await tab.request.post('/api/v1/auth', { data: { email: f.owner.email, password } }); await tab.goto('/app/settings?tab=brand-tracking'); await expect(brand(tab)).toContainText('Atlas · 1건'); } finally { await session.close(); }
  await root(page).getByRole('button', { name: '매칭 정책 변경', exact: true }).click(); await modal(page).getByLabel('매칭 방식').selectOption('full'); await save(page);
  expect((await (await page.request.get(`/api/v1/analyses?workspace_id=${f.workspace.id}&kind=seo`)).json()).summary.average_rank).toBeNull();
  await brand(page).getByRole('button', { name: '브랜드 수정', exact: true }).click(); await modal(page).getByLabel('도메인 (한 줄에 하나)').fill('apple.co.kr\nshop.apple.co.kr'); await save(page);
  await page.goto(`/app/keywords/${f.keyword.id}`); await expect(root(page)).toContainText('브랜드 비교');
  expect((await (await page.request.get(`/api/v1/analyses?workspace_id=${f.workspace.id}&kind=seo`)).json()).summary.average_rank).toBe(3);
});

test('brand and product editing, merging, aliases, manual history CRUD and deletion remain consistent', async ({ page }) => {
  const f = await fixture(page); expect((await f.command('brand-create', { brand_name: 'Apple', role: 'self', domains: ['apple.co.kr'] })).ok()).toBeTruthy();
  await f.command('brand-create', { brand_name: 'Second', role: 'self', domains: ['second.test'], mentions: ['두 번째'] }); const second = (await f.get()).config.brands.find((item: Record<string, unknown>) => item.brand_name === 'Second');
  await f.command('product-create', { brand_id: second.id, name: 'Lineup', category: '도구' });
  await page.goto('/app/settings?tab=brand-tracking'); await brand(page, 'Second').getByRole('button', { name: '브랜드 병합', exact: true }).click(); await modal(page).getByLabel('병합 대상').selectOption({ label: 'Apple' }); await save(page, '병합');
  await expect(brand(page, 'Second')).toHaveCount(0); await expect(brand(page)).toContainText('Lineup');
  await brand(page, 'Lineup').getByRole('button', { name: '제품 수정', exact: true }).click(); await modal(page).getByLabel('제품 이름', { exact: true }).fill('Atlas'); await modal(page).getByLabel('제품 URL').fill('https://apple.co.kr/atlas'); await save(page); await expect(brand(page, 'Atlas')).toContainText('최근 28일 GEO 응답 1건');
  await root(page).getByRole('button', { name: '별칭 추가', exact: true }).click(); await modal(page).getByLabel('이전 도메인').fill('old.test'); await modal(page).getByLabel('대표 도메인').fill('apple.co.kr'); await save(page);
  await root(page).getByRole('button', { name: '별칭 수정', exact: true }).click(); await modal(page).getByLabel('이전 도메인').fill('old-apple.test'); await save(page); await root(page).getByRole('button', { name: '별칭 삭제', exact: true }).click(); await save(page, '삭제');
  await root(page).getByRole('button', { name: '전체 기간 재계산', exact: true }).click(); await save(page, '재계산');
  const history = root(page).locator('.live-history article').first(); await history.getByRole('button', { name: '재계산 메모', exact: true }).click(); await modal(page).getByLabel('메모', { exact: true }).fill('검토했습니다'); await save(page); await expect(history).toContainText('검토했습니다');
  const before = (await f.get()).jobs.length; await history.getByRole('button', { name: '이력 삭제', exact: true }).click(); await save(page, '삭제'); expect((await f.get()).jobs).toHaveLength(before - 1);
  await brand(page, 'Atlas').getByRole('button', { name: '제품 삭제', exact: true }).click(); await save(page, '삭제'); await expect(brand(page, 'Atlas')).toHaveCount(0);
  await brand(page).getByRole('button', { name: '브랜드 삭제', exact: true }).click(); await save(page, '삭제'); const data = await f.get(); expect(data.config.brands).toHaveLength(0); expect(data.config.products).toHaveLength(0);
  expect((await (await page.request.get(`/api/v1/analyses?workspace_id=${f.workspace.id}&kind=geo`)).json()).summary.mention_percent).toBeNull();
});

test('brand settings preserve conflicting input, reject invalid aliases and enforce menu/role isolation on mobile', async ({ page, browser, baseURL }) => {
  const f = await fixture(page); await f.command('brand-create', { brand_name: 'Apple', role: 'self', domains: ['apple.co.kr'] }); const own = (await f.get()).config.brands[0]; await f.command('product-create', { brand_id: own.id, name: '조회 제품' });
  await page.goto('/app/settings?tab=brand-tracking'); await brand(page).getByRole('button', { name: '브랜드 수정', exact: true }).click(); await modal(page).getByLabel('대표 이름', { exact: true }).fill('보존할 입력');
  await f.command('brand-update', { id: own.id, brand_name: '다른 창' }); const response = page.waitForResponse(item => item.url().endsWith('/api/v1/brand-settings') && item.request().method() === 'POST'); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); expect((await response).status()).toBe(409); await expect(modal(page).getByLabel('대표 이름', { exact: true })).toHaveValue('보존할 입력');
  await modal(page).getByRole('button', { name: '취소', exact: true }).click(); await root(page).getByRole('button', { name: '새로고침', exact: true }).click();
  const before = await f.get(); expect((await f.command('alias-create', { source: 'shop.apple.co.kr', target: 'apple.co.kr' })).status()).toBe(400); expect((await f.get()).config.revision).toBe(before.config.revision);
  expect((await page.request.patch(`/api/v1/rest/brands?id=eq.${own.id}`, { data: { brand_name: '우회' } })).status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 600 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); await page.mouse.move(280, 470); await page.mouse.wheel(0, 800); await expect.poll(() => root(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const guest = await f.store.write(async db => { const user = db.createAccount({ email: `brand-viewer-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '조회 멤버', passwordHash: await hashPassword(password) }); const member = db.insertTable('workspace_members', { workspace_id: f.workspace.id, user_id: user.id, role: 'viewer', allowed_sections: ['other', 'analysis'] }, f.owner.id)[0]; return { user, member }; });
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try { const tab = await context.newPage(); await tab.request.post('/api/v1/auth', { data: { email: guest.user.email, password } });
    expect((await tab.request.post('/api/v1/brand-settings', { data: { workspace_id: f.workspace.id, action: 'policy-update', mode: 'full', expected_revision: before.config.revision } })).status()).toBe(403);
    await tab.goto('/app/settings?tab=brand-tracking'); await tab.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, f.workspace); await expect(brand(tab, '다른 창')).toBeVisible(); await expect(root(tab).getByRole('button', { name: '자사 브랜드 추가', exact: true })).toHaveCount(0);
    await brand(tab, '다른 창').getByRole('button', { name: '조회 제품 · 0건', exact: true }).click(); await expect(modal(tab)).toContainText('조회 제품'); await modal(tab).getByRole('button', { name: '닫기', exact: true }).click(); await expect(modal(tab)).not.toBeVisible();
    await f.store.write(db => db.updateTable('workspace_members', { role: 'admin', allowed_sections: ['other'] }, { id: `eq.${guest.member.id}` }, f.owner.id)); expect((await tab.request.get(`/api/v1/brand-settings?workspace_id=${f.workspace.id}`)).status()).toBe(403);
    await f.store.write(db => db.deleteTable('workspace_members', { id: `eq.${guest.member.id}` }, f.owner.id)); expect((await tab.request.get(`/api/v1/brand-settings?workspace_id=${f.workspace.id}`)).status()).toBe(403);
  } finally { await context.close(); }
  const created = await page.request.post('/api/v1/rest/workspaces', { data: { name: '다른 브랜드 공간' } }), [second] = await created.json(); await page.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, second);
  await expect(root(page)).toContainText('다른 브랜드 공간'); await expect(brand(page, '다른 창')).toHaveCount(0); expect((await f.get()).config.brands).toHaveLength(1);
});
