import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';
test.use({ storageState: { cookies: [], origins: [] } });
const root = (page: Page) => page.locator('[data-live-root]'), modal = (page: Page) => page.getByRole('dialog');
const password = 'api-settings-fixture-only';
async function fixture(page: Page) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), hash = await hashPassword(password);
  const owner = await store.write(db => db.createAccount({ email: `api-keys-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: 'API 담당자', passwordHash: hash }));
  const login = await page.request.post('/api/v1/auth', { data: { email: owner.email, password } }); expect(login.status()).toBe(200); const ws = (await login.json()).workspaces[0];
  const keyword = await store.write(db => db.insertTable('keywords', { workspace_id: ws.id, keyword: '내 API 키워드' }, owner.id)[0]);
  const get = async () => (await page.request.get(`/api/v1/api-settings?workspace_id=${ws.id}`)).json();
  const command = async (action: string, values: Record<string, unknown> = {}) => page.request.post('/api/v1/api-settings', { data: { workspace_id: ws.id, action, ...values } });
  const external = (secret: string, tool: string, values: Record<string, unknown> = {}) => page.request.post(`/api/v1/public/${tool}`, { headers: { Authorization: `Bearer ${secret}` }, data: values });
  return { store, owner, ws, keyword, get, command, external };
}
async function close(page: Page) { await modal(page).getByRole('button', { name: '닫기', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
async function save(page: Page, name = '저장') { await modal(page).getByRole('button', { name, exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
const card = (page: Page, name: string) => root(page).getByRole('article', { name, exact: true });

test('API keys issue a one-time secret, support persisted scope/name/limit changes, and revoke immediately', async ({ page, browser, baseURL }) => {
  const f = await fixture(page); await page.goto('/app/settings?tab=api'); await root(page).getByRole('button', { name: '키 발급', exact: true }).click();
  await modal(page).getByLabel('키 이름', { exact: true }).fill('로컬 자동화');
  await page.route('**/api/v1/api-settings', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: '일시 저장 실패' } }) : route.continue());
  await modal(page).getByRole('button', { name: '발급', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('일시 저장 실패'); await expect(modal(page).getByLabel('키 이름', { exact: true })).toHaveValue('로컬 자동화');
  await page.unroute('**/api/v1/api-settings'); await modal(page).getByRole('button', { name: '발급', exact: true }).click(); await expect(modal(page).getByLabel('발급된 API 키')).toBeVisible(); const secret = await modal(page).getByLabel('발급된 API 키').inputValue(); expect(secret).toMatch(/^hx_live_/); await close(page);
  await expect(card(page, '로컬 자동화')).toBeVisible(); expect(await page.content()).not.toContain(secret); expect(JSON.stringify(await f.get())).not.toContain(secret);
  expect((await f.external(secret, 'list_keywords')).status()).toBe(200); expect((await (await f.external(secret, 'list_keywords')).json()).data[0].keyword).toBe('내 API 키워드');
  await card(page, '로컬 자동화').getByRole('button', { name: '키 수정', exact: true }).click(); await modal(page).getByLabel('키 이름', { exact: true }).fill('이름 변경'); await modal(page).getByLabel('SEO 키워드 읽기', { exact: true }).uncheck(); await modal(page).getByLabel('일일 요청 한도', { exact: true }).fill('250'); await save(page);
  expect((await f.external(secret, 'list_keywords')).status()).toBe(403); expect((await f.external(secret, 'list_prompts')).status()).toBe(200);
  await page.reload(); await expect(card(page, '이름 변경')).toContainText('일일 250회'); expect(await page.content()).not.toContain(secret);
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try { const tab = await context.newPage(); await tab.request.post('/api/v1/auth', { data: { email: f.owner.email, password } }); await tab.goto('/app/settings?tab=api'); await expect(card(tab, '이름 변경')).toBeVisible(); expect(await tab.content()).not.toContain(secret); } finally { await context.close(); }
  await card(page, '이름 변경').getByRole('button', { name: '키 폐기', exact: true }).click(); await save(page, '폐기'); expect((await f.external(secret, 'list_prompts')).status()).toBe(401);
  await card(page, '이름 변경').getByRole('button', { name: '기록 삭제', exact: true }).click(); await save(page, '삭제'); await expect(card(page, '이름 변경')).toHaveCount(0);
  await root(page).getByRole('button', { name: 'API 사용량', exact: true }).click(); await expect(root(page)).toContainText('로컬 자동화');
});

test('MCP initialization, scoped writes, durable usage and workspace limits govern real HTTP requests', async ({ page }) => {
  const f = await fixture(page), created = await f.command('key-create', { name: 'HTTP 검증', scopes: ['seo:read', 'knowledge:read', 'knowledge:write'], request_id: crypto.randomUUID(), requests_per_minute: 20, requests_per_day: 50 }); expect(created.status()).toBe(200); const { secret, key } = await created.json();
  const headers = { Authorization: `Bearer ${secret}`, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' };
  const request = (data: Record<string, unknown>) => page.request.post('/api/v1/mcp', { headers, data });
  const init = await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'playwright', version: '1' } } }); expect(init.status()).toBe(200); expect((await init.json()).result.serverInfo.name).toBe('halox');
  expect((await request({ jsonrpc: '2.0', method: 'notifications/initialized' })).status()).toBe(202);
  const listed = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); const tools = (await listed.json()).result.tools; expect(tools.some((item: { name: string }) => item.name === 'create_knowledge')).toBeTruthy(); expect(tools.some((item: { name: string }) => item.name === 'delete_keyword')).toBeFalsy();
  expect((await page.request.post('/api/v1/mcp', { headers: { ...headers, Origin: 'https://foreign.example' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status()).toBe(403);
  expect((await page.request.get('/api/v1/mcp', { headers })).status()).toBe(405); expect((await page.request.get('/api/v1/mcp', { headers: { ...headers, Origin: 'https://foreign.example' } })).status()).toBe(403); expect((await f.external(key.key_prefix, 'list_keywords')).status()).toBe(401);
  const args = { name: 'HTTP 저장 자료', body: '실제 보존 본문', request_id: crypto.randomUUID() }, first = await f.external(secret, 'create_knowledge', args), second = await f.external(secret, 'create_knowledge', args);
  expect(first.status()).toBe(200); expect((await first.json()).id).toBe((await second.json()).id);
  const settings = await f.get(); expect(settings.usage[0].success).toBeGreaterThanOrEqual(5); expect(settings.keys[0].last_used_at).toBeTruthy();
  await page.goto('/app/knowledgehub'); await expect(root(page)).toContainText('HTTP 저장 자료'); await page.goto('/app/settings?tab=api'); await root(page).getByRole('button', { name: 'API 한도', exact: true }).click(); await root(page).getByRole('button', { name: '공유 한도 수정', exact: true }).click();
  await modal(page).getByLabel('일일 요청 한도', { exact: true }).fill('1'); await save(page); const limited = await f.external(secret, 'list_keywords'); expect(limited.status()).toBe(429); expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0);
  await root(page).getByRole('button', { name: '공유 한도 초기화', exact: true }).click(); await save(page, '초기화'); expect((await f.external(secret, 'list_keywords')).status()).toBe(200);
  await root(page).getByRole('button', { name: 'API 사용량', exact: true }).click(); await root(page).getByRole('button', { name: '새로고침', exact: true }).click(); await expect(root(page)).toContainText('한도 초과 1회');
});

test('API settings retain conflicting input, enforce live roles and isolate selected workspaces on mobile', async ({ page, browser, baseURL }) => {
  const f = await fixture(page), issued = await f.command('key-create', { name: '권한 검증', request_id: crypto.randomUUID() }); const { key, secret } = await issued.json();
  await page.goto('/app/settings?tab=api'); await card(page, '권한 검증').getByRole('button', { name: '키 수정', exact: true }).click(); await modal(page).getByLabel('키 이름', { exact: true }).fill('보존할 입력');
  expect((await f.command('key-update', { id: key.id, expected_revision: 1, name: '다른 창 변경' })).status()).toBe(200); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('다른 곳'); await expect(modal(page).getByLabel('키 이름', { exact: true })).toHaveValue('보존할 입력'); await modal(page).getByRole('button', { name: '취소', exact: true }).click();
  expect((await page.request.patch(`/api/v1/rest/workspace_api_keys?id=eq.${key.id}`, { data: { revoked_at: null } })).status()).toBe(403);
  const guest = await f.store.write(async db => { const user = db.createAccount({ email: `api-viewer-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: '조회 멤버', passwordHash: await hashPassword(password) }); const membership = db.insertTable('workspace_members', { workspace_id: f.ws.id, user_id: user.id, role: 'viewer', allowed_sections: ['other'] }, f.owner.id)[0]; return { user, membership }; });
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try { const tab = await context.newPage(); await tab.request.post('/api/v1/auth', { data: { email: guest.user.email, password } }); expect((await tab.request.post('/api/v1/api-settings', { data: { workspace_id: f.ws.id, action: 'key-create', name: '우회', request_id: 'no' } })).status()).toBe(403);
    await tab.goto('/app/settings?tab=api'); await tab.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, f.ws); await expect(card(tab, '다른 창 변경')).toBeVisible(); await expect(root(tab).getByRole('button', { name: '키 발급', exact: true })).toHaveCount(0);
    await f.store.write(db => db.deleteTable('workspace_members', { id: `eq.${guest.membership.id}` }, f.owner.id)); expect((await tab.request.get(`/api/v1/api-settings?workspace_id=${f.ws.id}`)).status()).toBe(403);
  } finally { await context.close(); }
  await root(page).getByRole('button', { name: '새로고침', exact: true }).click(); await page.setViewportSize({ width: 390, height: 600 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); await page.mouse.move(280, 480); await page.mouse.wheel(0, 700); await expect.poll(() => root(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const created = await page.request.post('/api/v1/rest/workspaces', { data: { name: '다른 API 공간' } }), [second] = await created.json(); await page.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, second);
  await expect(root(page)).toContainText('다른 API 공간'); await expect(card(page, '다른 창 변경')).toHaveCount(0); expect((await f.external(secret, 'list_keywords')).status()).toBe(200);
});
