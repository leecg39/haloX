import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';
import { processAccountDeletionTick } from '../src/lib/backend/account-deletion-service';
test.use({ storageState: { cookies: [], origins: [] } });
const password = 'deletion-e2e-private-password';
async function fixture(page: Page) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), email = `deletion-${crypto.randomUUID()}@example.test`, hash = await hashPassword(password);
  const user = await store.write(db => db.createAccount({ email, fullName: '탈퇴 검증 회원', phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, passwordHash: hash }));
  const other = await store.write(db => db.createAccount({ email: `remaining-${crypto.randomUUID()}@example.test`, fullName: '공유 자료 소유자', phone: `010${Math.floor(1e7 + Math.random() * 9e7)}`, passwordHash: hash }));
  const login = await page.request.post('/api/v1/auth', { data: { email, password } }); expect(login.status()).toBe(200); const body = await login.json();
  const workspace = body.default_workspace_id as string;
  return { store, email, user, other, workspace, token: body.access_token as string };
}
async function open(page: Page, tab = 'profile') { await page.goto(`/app/settings?tab=${tab}`); await page.getByRole('button', { name: '계정 탈퇴 안내', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); }
async function fill(page: Page, email: string) { const modal = page.getByRole('dialog'); await modal.getByLabel('현재 비밀번호', { exact: true }).fill(password); await modal.getByLabel('계정 이메일 확인', { exact: true }).fill(email); await modal.getByLabel('확인 문구', { exact: true }).fill('계정 탈퇴'); await modal.getByRole('checkbox').check(); }
async function requestViaApi(page: Page, email: string) { const view = await (await page.request.get('/api/v1/account/deletion')).json(); return page.request.post('/api/v1/account/deletion', { data: { current_password: password, confirm_email: email, confirm_text: '계정 탈퇴', acknowledged: true, expected_revision: view.revision, expected_scope: view.scope, request_id: crypto.randomUUID() } }); }

test('withdrawal preserves failed input, revokes copied sessions and restores persisted workspace data only after explicit confirmation', async ({ page, playwright, baseURL }) => {
  const f = await fixture(page), copied = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${f.token}` } });
  try {
    await f.store.write(db => db.insertTable('workspaces', { name: '복원할 두 번째 공간' }, f.user.id));
    await open(page, 'workspace'); await expect(page.getByRole('dialog')).toContainText('소유 워크스페이스 (2)'); await fill(page, f.email);
    await page.route('**/api/v1/account/deletion', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: '탈퇴 저장 일시 중단' } }) : route.continue());
    await page.getByRole('dialog').getByRole('button', { name: '탈퇴 요청', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('일시 중단'); await expect(page.getByLabel('계정 이메일 확인')).toHaveValue(f.email);
    expect((await f.store.read(db => db.accountDeletionView(f.user.id))).status).toBe('active'); await page.unroute('**/api/v1/account/deletion');
    await page.getByLabel('현재 비밀번호', { exact: true }).fill('wrong-password'); await page.getByRole('dialog').getByRole('button', { name: '탈퇴 요청', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('올바르지');
    await page.getByLabel('현재 비밀번호', { exact: true }).fill(password); await page.getByRole('dialog').getByRole('button', { name: '탈퇴 요청', exact: true }).click(); await expect(page).toHaveURL(/\/app\/restore-account$/);
    expect((await copied.get('/api/v1/auth')).status()).toBe(401); expect((await copied.get('/api/v1/rest/workspaces')).status()).toBe(401);
    expect((await page.request.post('/api/v1/auth', { data: { email: f.email, password } })).status()).toBe(403);
    await page.getByLabel('가입 이메일', { exact: true }).fill(f.email); await page.getByLabel('현재 비밀번호', { exact: true }).fill(password); await page.getByRole('button', { name: '복원 가능 여부 확인' }).click(); await expect(page.getByRole('status')).toContainText('복원 가능 기한');
    expect((await new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!).read(db => db.accountDeletionState(f.user.id)))?.status).toBe('pending');
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '탈퇴 취소하고 복원' }).click(); await expect(page.getByRole('status')).toContainText('계정을 복원했습니다'); expect((await copied.get('/api/v1/auth')).status()).toBe(401);
    await page.getByRole('link', { name: '로그인으로 이동' }).click(); await page.locator('input[type=email]').fill(f.email); await page.locator('input[name=password]').fill(password); await page.locator('input[name=password]').press('Enter'); await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/workspaces'); await expect(page.getByText('복원할 두 번째 공간', { exact: true })).toBeVisible();
  } finally { await copied.dispose(); }
});

test('shared ownership blocks deletion and membership changes after review cause a conflict without losing input', async ({ page }) => {
  const f = await fixture(page); expect((await page.request.post('/api/v1/rpc/cancel_account_deletion', { data: {} })).status()).toBe(403); await open(page); await fill(page, f.email);
  await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: f.other.id, role: 'member' }, f.user.id));
  await page.getByRole('dialog').getByRole('button', { name: '탈퇴 요청', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('변경'); await expect(page.getByLabel('계정 이메일 확인')).toHaveValue(f.email);
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click(); await page.getByRole('button', { name: '계정 탈퇴 안내' }).click(); await expect(page.getByRole('dialog')).toContainText('다른 멤버 1명'); await expect(page.getByLabel('현재 비밀번호', { exact: true })).toBeDisabled();
  const forged = await requestViaApi(page, f.other.email); expect(forged.status()).toBe(400); expect((await page.request.get('/api/v1/auth')).status()).toBe(200);
});

test('expired restoration is rejected before the cleanup worker purges the account and private state', async ({ page }) => {
  const f = await fixture(page); expect((await requestViaApi(page, f.email)).status()).toBe(200);
  await f.store.write(db => db.setServerRecords('account_deletions', db.getServerRecords('account_deletions').map(row => row.user_id === f.user.id ? { ...row, delete_after: Date.now() - 1 } : row)));
  await page.goto('/app/login'); await page.locator('input[type=email]').fill(f.email); await page.locator('input[name=password]').fill(password); await page.locator('input[name=password]').press('Enter'); await expect(page).toHaveURL(/\/app\/restore-account$/);
  await page.getByLabel('가입 이메일', { exact: true }).fill(f.email); await page.getByLabel('현재 비밀번호', { exact: true }).fill(password); await page.getByRole('button', { name: '복원 가능 여부 확인' }).click(); await expect(page.locator('main').getByRole('alert')).toContainText('30일 복원 기간');
  await processAccountDeletionTick(f.store); expect(await f.store.read(db => db.findProfileByEmail(f.email))).toBeNull(); expect((await page.request.post('/api/v1/auth', { data: { email: f.email, password } })).status()).toBe(401);
});

test('a read-only member with no owned workspace can withdraw their own account; restoration identity changes clear confirmation on mobile', async ({ page }) => {
  const f = await fixture(page);
  const otherWorkspace = await f.store.read(db => String(db.queryTable('workspaces', {}, f.other.id).data[0].id));
  await f.store.write(db => { db.deleteTable('workspaces', { id: `eq.${f.workspace}` }, f.user.id); db.insertTable('workspace_members', { workspace_id: otherWorkspace, user_id: f.user.id, role: 'viewer' }, f.other.id); });
  await page.setViewportSize({ width: 390, height: 600 }); await open(page, 'workspace'); await expect(page.getByRole('dialog')).toContainText('소유한 워크스페이스가 없습니다'); await fill(page, f.email); await page.getByRole('dialog').getByRole('button', { name: '탈퇴 요청', exact: true }).click(); await expect(page).toHaveURL(/\/app\/restore-account$/);
  await page.getByLabel('가입 이메일', { exact: true }).fill(f.email); await page.getByLabel('현재 비밀번호', { exact: true }).fill(password); await page.getByRole('button', { name: '복원 가능 여부 확인' }).click(); await expect(page.getByRole('checkbox')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.mouse.move(190, 480); await page.mouse.wheel(0, 700); await expect.poll(() => page.locator('main').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await page.getByLabel('가입 이메일', { exact: true }).fill('changed@example.test'); await expect(page.getByRole('checkbox')).toHaveCount(0); await expect(page.getByRole('button', { name: '복원 가능 여부 확인' })).toBeVisible();
  expect(await f.store.read(db => db.queryTable('workspaces', { filters: { id: `eq.${otherWorkspace}` } }, f.other.id).count)).toBe(1);
});
