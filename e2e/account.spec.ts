import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { hashPassword } from '../src/lib/backend/accounts';
import { readSessionToken } from '../src/lib/backend/session';
import { PhoneVerificationService } from '../src/lib/backend/phone-verification';
import { runAccountCommand, runRecoveryCommand } from '../src/lib/backend/account-security';

test.use({ storageState: { cookies: [], origins: [] } });
const root = (page: Page) => page.locator('[data-live-root]');
const password = 'account-e2e-private-password';
async function fixture(page: Page) {
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), phone = `010${Math.floor(1e7 + Math.random() * 9e7)}`, email = `security-${crypto.randomUUID()}@example.test`;
  const hash = await hashPassword(password), account = await store.write(db => db.createAccount({ email, phone, fullName: '보안 검증 회원', passwordHash: hash }));
  const login = await page.request.post('/api/v1/auth', { data: { email, password } }); expect(login.status()).toBe(200);
  const token = (await login.json()).access_token as string, claims = readSessionToken(token)!; let code = '';
  const verification = new PhoneVerificationService(store, { async send(_phone, value) { code = value; } }, process.env.HALOX_SESSION_SECRET!);
  return { store, phone, email, account, token, claims, verification, code: () => code };
}
async function save(page: Page, name = '저장') { const modal = page.getByRole('dialog'); await modal.getByRole('button', { name, exact: true }).click(); await expect(modal).not.toBeVisible(); }

test('profile edits persist, errors retain input and current/other sessions can be revoked separately', async ({ page, playwright, baseURL }) => {
  const f = await fixture(page), other = await playwright.request.newContext({ baseURL });
  try {
    expect((await other.post('/api/v1/auth', { data: { email: f.email, password } })).status()).toBe(200);
    await page.goto('/app/settings?tab=profile'); await root(page).getByRole('button', { name: '이름 수정', exact: true }).click();
    await page.route('**/api/v1/account', async route => { if (route.request().method() === 'POST') return route.fulfill({ status: 503, json: { error: '프로필 저장 일시 중단' } }); return route.continue(); });
    await page.getByRole('dialog').getByLabel('이름', { exact: true }).fill('변경된 프로필'); await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('일시 중단'); await expect(page.getByRole('dialog').getByLabel('이름', { exact: true })).toHaveValue('변경된 프로필');
    await page.unroute('**/api/v1/account'); await save(page); await page.reload(); await expect(root(page)).toContainText('변경된 프로필'); await expect(root(page)).toContainText('활성 로그인 세션 (2)');
    await root(page).getByRole('button', { name: '다른 세션 모두 로그아웃', exact: true }).click(); await save(page, '로그아웃'); expect((await other.get('/api/v1/auth')).status()).toBe(401); expect((await page.request.get('/api/v1/auth')).status()).toBe(200);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await root(page).getByRole('button', { name: '현재 세션 로그아웃', exact: true }).click(); await save(page, '로그아웃'); await expect(page).toHaveURL(/\/app\/login$/); expect((await other.get('/api/v1/account', { headers: { authorization: `Bearer ${f.token}` } })).status()).toBe(401);
  } finally { await other.dispose(); }
});

test('password change checks old credentials and invalidates cookie and Bearer access across data APIs', async ({ page, playwright, baseURL }) => {
  const f = await fixture(page), old = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${f.token}` } });
  try {
    await page.goto('/app/settings?tab=profile'); await root(page).getByRole('button', { name: '비밀번호 변경', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByLabel('현재 비밀번호', { exact: true }).fill('wrong'); await dialog.getByLabel('새 비밀번호', { exact: true }).fill('changed-e2e-password'); await dialog.getByLabel('새 비밀번호 확인', { exact: true }).fill('changed-e2e-password');
    await dialog.getByRole('button', { name: '저장', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('현재 비밀번호'); await dialog.getByLabel('현재 비밀번호', { exact: true }).fill(password); await save(page); await expect(page).toHaveURL(/\/app\/login$/);
    for (const url of ['/api/v1/auth', '/api/v1/account', '/api/v1/portal?kind=referral', '/api/v1/rest/workspaces', '/api/v1/workspaces', '/api/v1/keywords?workspace_id=missing', '/api/v1/raw-data?workspace_id=missing']) expect((await old.get(url)).status(), url).toBe(401);
    expect((await old.post('/api/v1/rpc/get_workspace_quota_summary', { data: {} })).status()).toBe(401); expect((await old.post('/api/v1/functions/feedback-thread-create', { data: {} })).status()).toBe(401);
    expect((await page.request.post('/api/v1/auth', { data: { email: f.email, password } })).status()).toBe(401);
    await page.locator('input[type=email]').fill(f.email); await page.locator('input[name=password]').fill('changed-e2e-password'); await page.locator('input[name=password]').press('Enter'); await expect(page).toHaveURL(/\/app$/);
  } finally { await old.dispose(); }
});

test('verified phone change updates recovery identity and preserves only the current session', async ({ page, playwright, baseURL }) => {
  const f = await fixture(page), other = await playwright.request.newContext({ baseURL });
  try {
    await other.post('/api/v1/auth', { data: { email: f.email, password } }); await page.goto('/app/settings?tab=profile');
    await page.route('**/api/v1/account', async route => {
      if (route.request().method() !== 'POST') return route.continue(); const body = route.request().postDataJSON(); if (body.action !== 'phone-send') return route.continue();
      await route.fulfill({ json: await runAccountCommand(f.store, f.verification, f.account.id, f.claims.sid, body, 'e2e-phone') });
    });
    await root(page).getByRole('button', { name: '휴대폰 번호 변경', exact: true }).click(); await root(page).getByLabel('현재 비밀번호', { exact: true }).fill(password); await root(page).getByLabel('새 휴대폰 번호', { exact: true }).fill('01099887766');
    await root(page).getByRole('button', { name: '인증번호 발송', exact: true }).click(); await expect(root(page).getByLabel('휴대폰 인증번호')).toBeVisible(); await root(page).getByLabel('휴대폰 인증번호').fill(f.code()); await root(page).getByRole('button', { name: '인증 확인', exact: true }).click(); await expect(root(page).getByRole('button', { name: '인증 완료' })).toBeDisabled();
    await root(page).getByRole('button', { name: '인증한 번호로 변경', exact: true }).click(); await expect(root(page)).toContainText('다른 로그인 세션을 종료했습니다'); await page.reload(); await expect(root(page)).toContainText('01099887766'); expect((await other.get('/api/v1/auth')).status()).toBe(401); expect((await page.request.get('/api/v1/account')).status()).toBe(200);
    expect((await page.request.patch(`/api/v1/rest/profiles?id=eq.${f.account.id}`, { data: { phone_number: '01011112222', phone_verified_at: 'forged' } })).status()).toBe(400);
  } finally { await other.dispose(); }
});

test('recovery uses a real purpose-bound verification flow, preserves failed inputs and permits only the new password', async ({ page, playwright, baseURL }) => {
  const f = await fixture(page), copied = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${f.token}` } });
  try {
    await page.goto('/app/forgot-password'); await expect(page).toHaveTitle('비밀번호 재설정 | HaloX');
    await page.route('**/api/v1/auth/recovery', async route => { const body = route.request().postDataJSON(); if (body.action !== 'send') return route.continue(); await route.fulfill({ json: await runRecoveryCommand(f.store, f.verification, body, 'e2e-recovery') }); });
    await page.getByLabel('가입 이메일', { exact: true }).fill(f.email); await page.getByLabel('등록된 휴대폰 번호', { exact: true }).fill(f.phone); await page.getByRole('button', { name: '인증번호 발송', exact: true }).click(); await expect(page.getByLabel('휴대폰 인증번호')).toBeVisible(); await page.getByLabel('휴대폰 인증번호').fill(f.code()); await page.getByRole('button', { name: '인증 확인', exact: true }).click(); await expect(page.getByLabel('새 비밀번호', { exact: true })).toBeVisible();
    await page.getByLabel('새 비밀번호', { exact: true }).fill('recovered-e2e-password'); await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('mismatched-password'); await page.getByRole('button', { name: '비밀번호 재설정', exact: true }).click(); await expect(page.locator('main').getByRole('alert')).toContainText('일치하지'); await expect(page.getByLabel('새 비밀번호', { exact: true })).toHaveValue('recovered-e2e-password');
    await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('recovered-e2e-password'); await page.getByRole('button', { name: '비밀번호 재설정', exact: true }).click(); await expect(page.getByRole('status')).toContainText('기존 로그인 세션이 모두 종료'); expect((await copied.get('/api/v1/auth')).status()).toBe(401);
    await page.getByRole('link', { name: '새 비밀번호로 로그인' }).click(); await page.locator('input[type=email]').fill(f.email); await page.locator('input[name=password]').fill('recovered-e2e-password'); await page.locator('input[name=password]').press('Enter'); await expect(page).toHaveURL(/\/app$/);
  } finally { await copied.dispose(); }
});

test('recovery shows unconfigured SMS honestly and changing identity discards any proof on mobile', async ({ page }) => {
  const f = await fixture(page); await page.goto('/app/reset-password'); await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('가입 이메일', { exact: true }).fill(f.email); await page.getByLabel('등록된 휴대폰 번호', { exact: true }).fill(f.phone); await page.getByRole('button', { name: '인증번호 발송', exact: true }).click(); await expect(page.locator('main').getByRole('alert')).toContainText('문자 인증 서비스가 아직 설정되지 않았습니다');
  await page.route('**/api/v1/auth/recovery', async route => { const body = route.request().postDataJSON(); if (body.action !== 'send') return route.continue(); await route.fulfill({ json: await runRecoveryCommand(f.store, f.verification, body, 'e2e-mobile-recovery') }); });
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click(); await expect(page.getByLabel('휴대폰 인증번호')).toBeVisible(); await page.getByLabel('휴대폰 인증번호').fill(f.code()); await page.getByRole('button', { name: '인증 확인', exact: true }).click(); await expect(page.getByLabel('새 비밀번호', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 600 }); await page.mouse.move(195, 500); await page.mouse.wheel(0, 700); await expect.poll(() => page.locator('main').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await page.getByLabel('가입 이메일', { exact: true }).fill('changed@example.test'); await expect(page.getByLabel('새 비밀번호', { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '비밀번호 재설정', exact: true })).toBeDisabled(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
