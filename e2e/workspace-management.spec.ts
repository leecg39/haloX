import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';

test.use({ storageState: { cookies: [], origins: [] } });
const root = (page: Page) => page.locator('[data-live-root]');
const password = 'workspace-private-test-password';
async function fixture(page: Page) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), hash = await hashPassword(password);
  const create = (label: string) => store.write(db => db.createAccount({ email: `workspace-${crypto.randomUUID()}@example.test`, phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, fullName: label, passwordHash: hash }));
  const owner = await create('설정 소유자'), guest = await create('초대 회원');
  const login = await page.request.post('/api/v1/auth', { data: { email: owner.email, password } }); expect(login.status()).toBe(200);
  const workspace = (await login.json()).workspaces[0];
  return { store, owner, guest, workspace };
}
async function save(page: Page, name = '저장') { const modal = page.getByRole('dialog'); await modal.getByRole('button', { name, exact: true }).click(); await expect(modal).not.toBeVisible(); }
const post = (page: Page, data: Record<string, unknown>) => page.request.post('/api/v1/workspace-management', { data });

test('workspace settings persist in the workspace list, share audit targets, and retain failed input', async ({ page }) => {
  const f = await fixture(page); await page.goto('/app/settings?tab=workspace');
  await root(page).getByRole('button', { name: '프로필 수정', exact: true }).click();
  const modal = page.getByRole('dialog'); await modal.getByLabel('워크스페이스 이름', { exact: true }).fill('브랜드 작업팀'); await modal.getByLabel('브랜드 이름', { exact: true }).fill('우리 브랜드'); await modal.getByLabel('기본 도메인').fill('example.com'); await modal.getByLabel('설명').fill('설정에서 저장한 안내');
  await page.route('**/api/v1/workspace-management', async route => { if (route.request().method() === 'POST') return route.fulfill({ status: 503, json: { error: '설정 저장 일시 중단' } }); return route.continue(); });
  await modal.getByRole('button', { name: '저장', exact: true }).click(); await expect(modal.getByRole('alert')).toContainText('일시 중단'); await expect(modal.getByLabel('워크스페이스 이름', { exact: true })).toHaveValue('브랜드 작업팀');
  await page.unroute('**/api/v1/workspace-management'); await save(page); await page.reload(); await expect(root(page)).toContainText('우리 브랜드');
  await page.goto('/app/workspaces'); await expect(page.getByRole('heading', { name: '브랜드 작업팀', exact: true })).toBeVisible(); await page.goto('/app/settings?tab=workspace');
  await root(page).getByRole('button', { name: '진단 대상 추가', exact: true }).click(); await page.getByRole('dialog').getByLabel('대상 이름').fill('팀 사이트'); await page.getByRole('dialog').getByLabel('시작 URL').fill('https://example.com/'); await save(page);
  await page.goto('/app/site-audit'); await root(page).getByRole('button', { name: '대상·수집 범위', exact: true }).click(); await expect(root(page)).toContainText('팀 사이트');
  await page.goto('/app/settings?tab=workspace'); await root(page).getByRole('button', { name: '대상·범위 수정', exact: true }).click(); await page.getByRole('dialog').getByLabel('최대 페이지').fill('12'); await save(page); await expect(root(page)).toContainText('최대 12페이지');
  await page.setViewportSize({ width: 390, height: 600 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); await page.mouse.move(280, 480); await page.mouse.wheel(0, 600); await expect.poll(() => root(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await root(page).getByRole('button', { name: '대상 삭제', exact: true }).click(); await save(page, '삭제'); await expect(root(page)).toContainText('등록한 진단 대상이 없습니다.');
  expect((await (await page.request.get(`/api/v1/site-audit?workspace_id=${f.workspace.id}`)).json()).site_audit_targets).toHaveLength(0);
});

test('invitation acceptance joins the correct account, role changes apply and removal revokes workspace access', async ({ page, browser, baseURL }) => {
  const f = await fixture(page), guestContext = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } }), guestPage = await guestContext.newPage();
  try {
    expect((await guestPage.request.post('/api/v1/auth', { data: { email: f.guest.email, password } })).status()).toBe(200);
    await page.goto('/app/settings?tab=members'); await root(page).getByRole('button', { name: '멤버 초대', exact: true }).click(); await page.getByRole('dialog').getByLabel('이메일').fill(f.guest.email); await save(page);
    const link = await root(page).getByLabel('발급한 초대 링크').inputValue(), token = new URLSearchParams(new URL(link).hash.slice(1)).get('token');
    expect((await post(page, { action: 'invite-preview', token })).status()).toBe(403);
    await guestPage.goto(link); await guestPage.getByRole('button', { name: '초대 확인', exact: true }).click(); await expect(guestPage.getByRole('heading', { name: f.workspace.name, exact: true })).toBeVisible(); await guestPage.getByRole('button', { name: '초대 수락하고 참여' }).click(); await expect(guestPage).toHaveURL(/\/app$/);
    await guestPage.goto('/app/settings?tab=members'); await expect(root(guestPage)).toContainText('멤버 (2)'); await expect(root(guestPage).getByRole('button', { name: '멤버 초대', exact: true })).toHaveCount(0);
    await page.reload(); const member = root(page).locator('section').filter({ has: page.getByRole('heading', { name: '멤버 (2)', exact: true }) }).locator('article').filter({ hasText: f.guest.email });
    await member.getByRole('button', { name: '역할 변경', exact: true }).click(); await page.getByRole('dialog').getByLabel('역할').selectOption('admin'); await save(page);
    await guestPage.reload(); await expect(root(guestPage).getByRole('button', { name: '멤버 초대', exact: true })).toBeVisible();
    const data = await (await page.request.get(`/api/v1/workspace-management?workspace_id=${f.workspace.id}`)).json(), owner = data.members.find((row: Record<string, unknown>) => row.role === 'owner');
    expect((await post(guestPage, { action: 'member-delete', workspace_id: f.workspace.id, member_id: owner.id, expected_revision: owner.revision || 0 })).status()).toBe(403);
    await member.getByRole('button', { name: '멤버 제거', exact: true }).click(); await save(page, '확인');
    expect((await guestPage.request.get(`/api/v1/workspace-management?workspace_id=${f.workspace.id}`)).status()).toBe(403);
    expect((await guestPage.request.get(`/api/v1/keywords?workspace_id=${f.workspace.id}`)).status()).toBe(403);
    expect((await post(guestPage, { action: 'invite-accept', token })).status()).toBe(400);
    await root(page).getByRole('button', { name: '초대 기록 삭제', exact: true }).click(); await save(page, '확인'); await expect(root(page)).toContainText('초대 내역이 없습니다.');
  } finally { await guestContext.close(); }
});

test('invitation failure, rotation, cancellation and cross-workspace isolation remain visible on mobile', async ({ page }) => {
  const f = await fixture(page); await page.goto('/app/settings?tab=members'); await root(page).getByRole('button', { name: '멤버 초대', exact: true }).click(); await page.getByRole('dialog').getByLabel('이메일').fill(f.guest.email);
  await page.route('**/api/v1/workspace-management', async route => { if (route.request().method() === 'POST') return route.fulfill({ status: 503, json: { error: '초대 저장 실패' } }); return route.continue(); });
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('초대 저장 실패'); await expect(page.getByRole('dialog').getByLabel('이메일')).toHaveValue(f.guest.email);
  await page.unroute('**/api/v1/workspace-management'); await save(page); const first = await root(page).getByLabel('발급한 초대 링크').inputValue();
  await root(page).getByRole('button', { name: '링크 재발급', exact: true }).click(); await save(page, '재발급'); expect(await root(page).getByLabel('발급한 초대 링크').inputValue()).not.toBe(first);
  expect((await post(page, { action: 'invite-preview', token: new URLSearchParams(new URL(first).hash.slice(1)).get('token') })).status()).toBe(400);
  await page.setViewportSize({ width: 390, height: 600 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await root(page).getByRole('button', { name: '초대 취소', exact: true }).click(); await save(page, '확인'); await expect(root(page).getByLabel('발급한 초대 링크')).toHaveCount(0); await expect(root(page)).toContainText('취소됨');
  const response = await page.request.post('/api/v1/rest/workspaces', { data: { name: '다른 작업 공간' } }), [second] = await response.json();
  await page.evaluate(ws => { localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })); window.dispatchEvent(new Event('halox:workspace-changed')); }, second);
  await expect(root(page)).toContainText('다른 작업 공간'); await expect(root(page)).toContainText('초대 내역이 없습니다.');
  const original = await (await page.request.get(`/api/v1/workspace-management?workspace_id=${f.workspace.id}`)).json(); expect(original.invitations).toHaveLength(1);
});
