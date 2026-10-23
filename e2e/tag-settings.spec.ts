import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';

test.use({ storageState: { cookies: [], origins: [] } });
const root = (page: Page) => page.locator('[data-live-root]');
const modal = (page: Page) => page.getByRole('dialog');
const tagCard = (page: Page, name = '공용 분류') => root(page).getByRole('article', { name, exact: true });
const password = 'tag-settings-local-fixture';
async function fixture(page: Page) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), hash = await hashPassword(password);
  const owner = await store.write(db => db.createAccount({ email: `tags-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '태그 담당자', passwordHash: hash }));
  const response = await page.request.post('/api/v1/auth', { data: { email: owner.email, password } }); expect(response.status()).toBe(200);
  const workspace = (await response.json()).workspaces[0];
  const entities = await store.write(db => {
    const keyword = db.insertTable('keywords', { workspace_id: workspace.id, keyword: '브랜드 검색어' }, owner.id)[0];
    const second = db.insertTable('keywords', { workspace_id: workspace.id, keyword: '다른 검색어' }, owner.id)[0];
    const prompt = db.insertTable('geo_prompts', { workspace_id: workspace.id, prompt_text: '추천하는 분석 도구는?' }, owner.id)[0];
    return { keyword, second, prompt };
  });
  return { store, owner, workspace, ...entities };
}
async function save(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
const get = async (page: Page, workspace: string) => (await page.request.get(`/api/v1/tag-settings?workspace_id=${workspace}`)).json();

test('tag settings share group/tag CRUD and assignments with keywords and prompts, persist and preserve failed input', async ({ page, browser, baseURL }) => {
  const f = await fixture(page); await page.goto('/app/settings?tab=tags');
  await root(page).getByRole('button', { name: '새 그룹', exact: true }).click(); await modal(page).getByLabel('그룹 이름').fill('캠페인'); await save(page);
  await root(page).getByRole('button', { name: '새 태그', exact: true }).click(); await modal(page).getByLabel('태그 이름').fill('공용 분류'); await modal(page).getByLabel('소속 그룹').selectOption({ label: '캠페인' });
  await page.route('**/api/v1/tag-settings', async route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: '태그 저장 일시 중단' } }) : route.continue());
  await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 중단'); await expect(modal(page).getByLabel('태그 이름')).toHaveValue('공용 분류');
  await page.unroute('**/api/v1/tag-settings'); await save(page);
  await tagCard(page).getByRole('button', { name: '연결 관리', exact: true }).click();
  await modal(page).getByRole('checkbox', { name: /브랜드 검색어/ }).check(); await modal(page).getByLabel('연결 항목 검색').fill('추천'); await modal(page).getByRole('checkbox', { name: /추천하는 분석 도구는/ }).check();
  await save(page); await expect(tagCard(page)).toContainText('키워드 1개 · 프롬프트 1개');
  await page.reload(); await expect(tagCard(page)).toContainText('키워드 1개 · 프롬프트 1개');
  const otherSession = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try { const tab = await otherSession.newPage(); expect((await tab.request.post('/api/v1/auth', { data: { email: f.owner.email, password } })).status()).toBe(200); await tab.goto('/app/settings?tab=tags'); await expect(tagCard(tab)).toContainText('키워드 1개 · 프롬프트 1개'); } finally { await otherSession.close(); }
  await page.goto(`/app/keywords/${f.keyword.id}`); await expect(root(page)).toContainText('공용 분류');
  await page.goto(`/app/geo/prompts/${f.prompt.id}`); await expect(root(page)).toContainText('공용 분류');
  await page.goto('/app/settings?tab=tags'); await tagCard(page).getByRole('button', { name: '태그 수정', exact: true }).click(); await modal(page).getByLabel('태그 이름').fill('통합 분류'); await modal(page).getByLabel('태그 색상').fill('#007766'); await save(page);
  await root(page).getByRole('button', { name: '그룹 수정', exact: true }).click(); await modal(page).getByLabel('그룹 이름').fill('운영'); await save(page);
  await root(page).getByRole('button', { name: '그룹 삭제', exact: true }).click(); await save(page, '삭제');
  await expect(root(page).getByRole('region', { name: '그룹 없음', exact: true })).toContainText('통합 분류');
  expect((await get(page, f.workspace.id)).tags[0].group_id).toBeNull();
  await tagCard(page, '통합 분류').getByRole('button', { name: '태그 삭제', exact: true }).click(); await save(page, '삭제');
  const data = await get(page, f.workspace.id); expect(data.tags).toHaveLength(0); expect(data.keywords).toHaveLength(2); expect(data.prompts).toHaveLength(1);
});

test('tag settings reject stale names and concurrent link changes while preserving the open form', async ({ page }) => {
  const f = await fixture(page), created = await page.request.post('/api/v1/tag-settings', { data: { workspace_id: f.workspace.id, action: 'tag-create', name: '공용 분류' } }), tag = (await created.json()).row;
  await page.goto('/app/settings?tab=tags'); await tagCard(page).getByRole('button', { name: '태그 수정', exact: true }).click(); await modal(page).getByLabel('태그 이름').fill('저장하려던 이름');
  expect((await page.request.patch(`/api/v1/rest/workspace_tags?id=eq.${tag.id}`, { data: { name: '다른 창 변경' } })).ok()).toBeTruthy();
  let response = page.waitForResponse(item => item.url().endsWith('/api/v1/tag-settings') && item.request().method() === 'POST');
  await modal(page).getByRole('button', { name: '저장', exact: true }).click(); expect((await response).status()).toBe(409); await expect(modal(page).getByLabel('태그 이름')).toHaveValue('저장하려던 이름');
  await modal(page).getByRole('button', { name: '취소', exact: true }).click(); await root(page).getByRole('button', { name: '새로고침', exact: true }).click();
  await tagCard(page, '다른 창 변경').getByRole('button', { name: '연결 관리', exact: true }).click(); await modal(page).getByRole('checkbox', { name: /브랜드 검색어/ }).check();
  expect((await page.request.post('/api/v1/rest/keyword_tag_assignments', { data: { workspace_id: f.workspace.id, keyword_id: f.second.id, tag_id: tag.id } })).ok()).toBeTruthy();
  response = page.waitForResponse(item => item.url().endsWith('/api/v1/tag-settings') && item.request().method() === 'POST');
  await modal(page).getByRole('button', { name: '저장', exact: true }).click(); expect((await response).status()).toBe(409); await expect(modal(page).getByRole('checkbox', { name: /브랜드 검색어/ })).toBeChecked();
  expect((await get(page, f.workspace.id)).tags[0].keyword_ids).toEqual([f.second.id]);
});

test('tag settings isolate workspaces, enforce viewer/menu permissions and scroll on mobile', async ({ page, browser, baseURL }) => {
  const f = await fixture(page);
  const account = await f.store.write(async db => {
    const guest = db.createAccount({ email: `tag-viewer-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '조회 회원', passwordHash: await hashPassword(password) });
    const member = db.insertTable('workspace_members', { workspace_id: f.workspace.id, user_id: guest.id, role: 'viewer', allowed_sections: ['other', 'analysis'] }, f.owner.id)[0];
    const tags = db.insertTable('workspace_tags', Array.from({ length: 8 }, (_, index) => ({ workspace_id: f.workspace.id, name: `모바일 태그 ${index}` })), f.owner.id);
    db.insertTable('keyword_tag_assignments', { workspace_id: f.workspace.id, tag_id: tags[0].id, keyword_id: f.keyword.id }, f.owner.id);
    return { guest, member, tag: tags[0] };
  });
  await page.goto('/app/settings?tab=tags'); await page.setViewportSize({ width: 390, height: 600 });
  await expect(root(page).getByRole('heading', { name: '태그 관리', exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.mouse.move(290, 470); await page.mouse.wheel(0, 900); await expect.poll(() => root(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await tagCard(page, '모바일 태그 7').getByRole('button', { name: '태그 수정', exact: true }).click(); await expect(modal(page).getByLabel('태그 이름')).toHaveValue('모바일 태그 7'); await modal(page).getByRole('button', { name: '취소', exact: true }).click();
  const guestContext = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const guest = await guestContext.newPage(); expect((await guest.request.post('/api/v1/auth', { data: { email: account.guest.email, password } })).status()).toBe(200);
    await guest.goto('/app/settings?tab=tags'); await guest.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, f.workspace);
    await expect(root(guest)).toContainText('모바일 태그 0'); await expect(root(guest).getByRole('button', { name: '새 태그', exact: true })).toHaveCount(0);
    expect((await guest.request.post('/api/v1/tag-settings', { data: { action: 'tag-create', workspace_id: f.workspace.id, name: '뷰어 생성' } })).status()).toBe(403);
    await f.store.write(db => db.updateTable('workspace_members', { role: 'member', allowed_sections: ['other'] }, { id: `eq.${account.member.id}` }, f.owner.id));
    const limited = await get(guest, f.workspace.id); expect(limited.tags[0].keyword_count).toBeNull(); expect(limited.keywords).toEqual([]);
    expect((await guest.request.delete(`/api/v1/rest/workspace_tags?id=eq.${account.tag.id}`)).status()).toBe(403);
    await f.store.write(db => db.deleteTable('workspace_members', { id: `eq.${account.member.id}` }, f.owner.id));
    expect((await guest.request.get(`/api/v1/tag-settings?workspace_id=${f.workspace.id}`)).status()).toBe(403);
  } finally { await guestContext.close(); }
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: '태그 없는 공간' } }), [second] = await response.json();
  await page.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, second);
  await expect(root(page)).toContainText('태그 없는 공간'); await expect(root(page)).toContainText('총 0개 그룹 · 0개 태그'); expect((await get(page, f.workspace.id)).tags).toHaveLength(8);
});
