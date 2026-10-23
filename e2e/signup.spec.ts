import { expect, test } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { PhoneVerificationService } from '../src/lib/backend/phone-verification';

test.use({ storageState: { cookies: [], origins: [] } });

test('signup shows an honest send error when SOLAPI is not configured', async ({ page, request }) => {
  const res = await request.post('/api/v1/auth/phone', { data: { action: 'send', phone: '01012345678' } });
  expect(res.status()).toBe(503);
  expect((await res.json()).code).toBe('SMS_NOT_CONFIGURED');
  await page.goto('/app/signup');
  await page.locator('input[type=tel]').fill('010-1234-5678');
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await expect(page.locator('[data-clone-phone-verification] [role="alert"]')).toContainText('문자 인증 서비스가 아직 설정되지 않았습니다');
  await expect(page.getByLabel('휴대폰 인증번호')).toHaveCount(0);
});

test('SMS delivery fixture -> real code verification -> signup -> own password login', async ({ page }) => {
  // Only SMS delivery is stubbed. Verification, registration and login use real
  // HTTP handlers against the same isolated SQLite file as the E2E server.
  const phone = '01012348765';
  let deliveredCode = '';
  const store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!);
  const service = new PhoneVerificationService(store, { async send(_phone, code) { deliveredCode = code; } }, process.env.HALOX_SESSION_SECRET!);
  await page.route('**/api/v1/auth/phone', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'send') { await route.continue(); return; }
    const result = await service.send(body.phone, 'e2e-delivery-fixture');
    await route.fulfill({ json: result });
  });
  await page.goto('/app/signup');
  await page.locator('input[name=name]').fill('신규 회원');
  await page.locator('input[type=tel]').fill(phone);
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  const codeField = page.getByLabel('휴대폰 인증번호');
  await expect(codeField).toBeVisible();
  await expect(page.getByText(/문자 발송을 요청했습니다/)).toBeVisible();
  await codeField.fill(deliveredCode === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: '인증 확인', exact: true }).click();
  await expect(page.locator('[data-clone-phone-verification] [role="alert"]')).toContainText('인증번호가 일치하지 않거나');
  await codeField.fill(deliveredCode);
  await page.getByRole('button', { name: '인증 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '인증 완료', exact: true })).toBeDisabled();
  const email = `signup-${Date.now()}@example.com`;
  const password = 'e2e-personal-password';
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill(password);
  await page.locator('input[name=passwordConfirm]').fill(password);
  const showButtons = page.getByRole('button', { name: '비밀번호 보기', exact: true });
  await expect(showButtons).toHaveCount(2);
  await showButtons.first().click();
  await expect(page.locator('input[name=password]')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '비밀번호 보기', exact: true }).click();
  await expect(page.locator('input[name=passwordConfirm]')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '가입하기', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/login\?registered=1$/);
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill(password);
  await page.locator('input[name=password]').press('Enter');
  await expect(page).toHaveURL(/\/app$/);
  const auth = await page.request.get('/api/v1/auth');
  expect((await auth.json()).user.email).toBe(email);
  await page.goto('/app/workspaces');
  await expect(page.getByRole('heading', { name: '신규 회원의 워크스페이스', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '브리찌', exact: true })).toHaveCount(0);
});

test('phone changes discard verification state and unverified signup is rejected', async ({ page, request }) => {
  await page.route('**/api/v1/auth/phone', route => route.fulfill({ json: { challengeId: 'fixture-only', expiresAt: Date.now() + 300_000, retryAfter: 60 } }));
  await page.goto('/app/signup');
  const phone = page.locator('input[type=tel]');
  await phone.fill('01012345678');
  await page.getByRole('button', { name: '인증번호 발송', exact: true }).click();
  await expect(page.getByLabel('휴대폰 인증번호')).toBeVisible();
  await phone.fill('01087654321');
  await expect(page.getByLabel('휴대폰 인증번호')).toHaveCount(0);
  await expect(page.locator('input[name=phoneVerificationToken]')).toHaveValue('');
  const response = await request.post('/api/v1/auth/signup', { data: { fullName: '미인증', email: 'unverified@example.com', password: 'password123', phone: '01087654321' } });
  expect(response.status()).toBe(400);
  expect((await response.json()).code).toBe('PHONE_VERIFICATION_REQUIRED');
});
