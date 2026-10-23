import crypto from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';
import type { Row } from '../src/lib/backend/database';

test.use({ storageState: { cookies: [], origins: [] } });
const password = 'permission-isolated-password';
const root = (page: Page) => page.locator('[data-live-root]');
async function fixture(page: Page, role: string, sections = ['all']) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), hash = await hashPassword(password);
  const create = (name: string) => store.write(db => db.createAccount({ email: `access-${crypto.randomUUID()}@example.test`, fullName: name, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, passwordHash: hash }));
  const owner = await create('권한 소유자'), guest = await create('범위 멤버');
  const workspace = await store.read(db => db.queryTable('workspaces', {}, owner.id).data[0]);
  const member = await store.write(db => db.insertTable('workspace_members', { workspace_id: workspace.id, user_id: guest.id, role, allowed_sections: sections }, owner.id)[0]);
  const keyword = await store.write(async db => (await db.invokeEdgeFunction('keywords-collect', { workspace_id: workspace.id, keywords: ['권한 테스트'] }, owner.id)).keywords as Row[]);
  expect((await page.request.post('/api/v1/auth', { data: { email: guest.email, password } })).status()).toBe(200);
  await page.goto('/app/workspaces');
  await page.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, workspace);
  const change = (nextRole: string, nextSections: string[]) => store.write(db => db.updateTable('workspace_members', { role: nextRole, allowed_sections: nextSections }, { id: `eq.${member.id}` }, owner.id));
  return { store, owner, guest, workspace, member, keyword: keyword[0], change };
}

test('viewer can search but cannot save, execute or download; promotion applies to the existing session', async ({ page }) => {
  const f = await fixture(page, 'viewer'); await page.goto('/app/keywords');
  await expect(root(page)).toContainText('읽기 전용'); await root(page).getByLabel('키워드 검색').fill('권한'); await expect(root(page).getByRole('link', { name: '권한 테스트', exact: true })).toBeVisible();
  await root(page).getByRole('button', { name: '키워드 추가', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('button', { name: '키워드 추가', exact: true })).toBeDisabled(); await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  for (const name of ['keywords-collect', 'geo-run', 'site-audit', 'content-create', 'translate-content-v2', 'wordpress-create', 'report-create', 'raw-import-create']) expect((await page.request.post(`/api/v1/functions/${name}`, { data: { workspace_id: f.workspace.id } })).status(), name).toBe(403);
  expect((await page.request.patch(`/api/v1/rest/keywords?id=eq.${f.keyword.id}`, { data: { is_paused: true } })).status()).toBe(403);
  expect((await page.request.delete(`/api/v1/rest/keywords?id=eq.${f.keyword.id}`)).status()).toBe(403);
  expect((await page.request.get(`/api/v1/raw-data?workspace_id=${f.workspace.id}&kind=seo&mode=download`)).status()).toBe(403);
  expect((await page.request.get('/api/v1/account')).status()).toBe(200);
  await f.change('member', ['analysis']);
  expect((await page.request.patch(`/api/v1/rest/keywords?id=eq.${f.keyword.id}`, { data: { is_paused: true } })).status()).toBe(200);
  await page.reload(); await expect(root(page)).not.toContainText('읽기 전용'); await root(page).getByRole('button', { name: '키워드 추가', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('button', { name: '키워드 추가', exact: true })).toBeEnabled();
});

test('menu restrictions cover navigation, direct URLs, REST counts, RPC/cache and aggregates', async ({ page }) => {
  const f = await fixture(page, 'member', ['analysis']); await page.goto('/app/keywords');
  await expect(root(page).getByRole('heading', { name: '키워드 현황', exact: true })).toBeVisible();
  await expect(page.locator('[data-sidebar] a[href="/app/factory"]')).not.toBeVisible();
  const victim = await f.store.write(db => { const profile = db.createAccount({ email: `hidden-${crypto.randomUUID()}@example.test`, fullName: '숨겨진 멤버', phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, passwordHash: 'fixture-unused-hash' }); return db.insertTable('workspace_members', { workspace_id: f.workspace.id, user_id: profile.id, role: 'member' }, f.owner.id)[0]; });
  expect((await page.request.patch(`/api/v1/rest/workspace_members?id=eq.${victim.id}`, { data: { role: 'admin' } })).status()).toBe(403);
  expect((await page.request.delete(`/api/v1/rest/workspace_members?id=eq.${victim.id}`)).status()).toBe(403);
  await page.goto('/app/factory'); await expect(root(page).getByRole('heading', { name: '접근 권한이 없습니다', exact: true })).toBeVisible();
  for (const endpoint of ['content', 'library', 'exports', 'optimization', 'site-audit', 'gaps', 'strategy-map', 'workspace-management']) expect((await page.request.get(`/api/v1/${endpoint}?workspace_id=${f.workspace.id}`)).status(), endpoint).toBe(403);
  for (const kind of ['dashboard', 'monitoring', 'reports']) expect((await page.request.get(`/api/v1/observability?workspace_id=${f.workspace.id}&kind=${kind}`)).status()).toBe(403);
  expect((await page.request.get(`/api/v1/rest/content_jobs?workspace_id=eq.${f.workspace.id}`)).status()).toBe(403);
  expect((await page.request.head(`/api/v1/rest/content_jobs?workspace_id=eq.${f.workspace.id}`)).status()).toBe(403);
  expect(await (await page.request.get('/api/v1/rest/content_jobs')).json()).toEqual([]);
  expect((await page.request.post('/api/v1/rpc/get_light_dashboard_overview', { data: { p_workspace_id: f.workspace.id } })).status()).toBe(403);
  expect((await page.request.post('/api/v1/functions/rpc-cache', { data: { rpc_name: 'get_light_dashboard_overview', args: { p_workspace_id: f.workspace.id } } })).status()).toBe(403);
  expect((await page.request.post('/api/v1/rest/writing_style_profiles', { data: { workspace_id: f.workspace.id, name: 'forged' } })).status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 600 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto('/app/settings?tab=profile'); await expect(root(page).getByRole('heading', { name: '내 프로필과 보안', exact: true })).toBeVisible();
  await f.change('viewer', ['execution']);
  expect((await page.request.get(`/api/v1/keywords?workspace_id=${f.workspace.id}`)).status()).toBe(403);
  expect((await page.request.get(`/api/v1/content?workspace_id=${f.workspace.id}`)).status()).toBe(200);
});

test('owner can invite a viewer with selected menus and the joined membership keeps that scope', async ({ page }) => {
  const f = await fixture(page, 'member');
  await f.store.write(db => db.deleteTable('workspace_members', { id: `eq.${f.member.id}` }, f.owner.id));
  expect((await page.request.post('/api/v1/auth', { data: { email: f.owner.email, password } })).status()).toBe(200);
  await page.goto('/app/settings?tab=members'); await root(page).getByRole('button', { name: '멤버 초대', exact: true }).click();
  const modal = page.getByRole('dialog'); await modal.getByLabel('이메일', { exact: true }).fill(f.guest.email); await modal.getByLabel('역할', { exact: true }).selectOption('viewer');
  for (const label of ['대시보드', '전략', '실행', '모니터링', '기타']) await modal.getByLabel(label, { exact: true }).uncheck();
  await modal.getByRole('button', { name: '저장', exact: true }).click(); await expect(modal).not.toBeVisible();
  const link = await root(page).getByLabel('발급한 초대 링크').inputValue();
  expect((await page.request.post('/api/v1/auth', { data: { email: f.guest.email, password } })).status()).toBe(200);
  await page.goto(link); await page.getByRole('button', { name: '초대 확인', exact: true }).click(); await expect(page.getByRole('main')).toContainText('뷰어 (읽기 전용) 권한 · 분석');
  await page.getByRole('button', { name: '초대 수락하고 참여' }).click(); await expect(page).toHaveURL(/\/app$/); await expect(root(page)).toContainText('접근 권한이 없습니다');
  await page.goto('/app/keywords'); await expect(root(page)).toContainText('읽기 전용');
  const auth = await (await page.request.get('/api/v1/auth')).json(); expect(auth.permissions[String(f.workspace.id)]).toEqual({ role: 'viewer', allowed_sections: ['analysis'] });
});
