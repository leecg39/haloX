import { expect, test } from '@playwright/test';

/**
 * Authentication: the API must trust only signed sessions, never a client-supplied user id.
 * These tests start without the shared session.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const DEMO_USER = '00000000-0000-4000-8000-000000000001';
const OTHER_USER = '00000000-0000-4000-8000-000000000002';
const WORKSPACE = '11111111-1111-4000-8000-111111111111';

test('data API rejects unauthenticated requests', async ({ request }) => {
  expect((await request.get('/api/v1/rest/keywords')).status()).toBe(401);
  expect((await request.post('/api/v1/rpc/get_workspace_quota_summary', { data: { _workspace_id: WORKSPACE } })).status()).toBe(401);
  expect((await request.post('/api/v1/functions/keywords-collect', { data: { workspace_id: WORKSPACE, keywords: ['x'] } })).status()).toBe(401);
  expect((await request.get('/api/v1/auth')).status()).toBe(401);
});

test('a spoofed x-halox-user-id header grants nothing', async ({ request }) => {
  for (const user of [DEMO_USER, OTHER_USER]) {
    const res = await request.get('/api/v1/rest/workspaces', { headers: { 'x-halox-user-id': user } });
    expect(res.status(), `header impersonating ${user}`).toBe(401);
  }
});

test('wrong password and unknown email are rejected without a session', async ({ request }) => {
  const wrong = await request.post('/api/v1/auth', { data: { email: 'demo@halox.local', password: 'not-the-password' } });
  expect(wrong.status()).toBe(401);
  expect(wrong.headers()['set-cookie'] ?? '').not.toContain('halox_session=v1.');
  const unknown = await request.post('/api/v1/auth', { data: { email: 'nobody@halox.local', password: process.env.HALOX_DEMO_PASSWORD } });
  expect(unknown.status()).toBe(401);
  const malformed = await request.post('/api/v1/auth', { data: { email: 'not-an-email', password: 'x' } });
  expect(malformed.status()).toBe(400);
});

test('a forged session token is rejected', async ({ request }) => {
  const forged = `v1.${Buffer.from(JSON.stringify({ sub: DEMO_USER, exp: Date.now() + 3_600_000 })).toString('base64url')}.forged`;
  expect((await request.get('/api/v1/rest/workspaces', { headers: { authorization: `Bearer ${forged}` } })).status()).toBe(401);
  expect((await request.get('/api/v1/rest/workspaces', { headers: { cookie: `halox_session=${forged}` } })).status()).toBe(401);
});

test('each user only sees their own workspace after login', async ({ playwright, baseURL }) => {
  for (const [email, expected, hidden] of [
    ['demo@halox.local', WORKSPACE, '22222222-2222-4000-8000-222222222222'],
    ['other@halox.local', '22222222-2222-4000-8000-222222222222', WORKSPACE],
  ] as const) {
    const ctx = await playwright.request.newContext({ baseURL });
    const login = await ctx.post('/api/v1/auth', { data: { email, password: process.env.HALOX_DEMO_PASSWORD } });
    expect(login.status(), `login ${email}`).toBe(200);
    const ids = ((await (await ctx.get('/api/v1/rest/workspaces')).json()) as Array<{ id: string }>).map(w => w.id);
    expect(ids).toContain(expected);
    expect(ids).not.toContain(hidden);
    await ctx.dispose();
  }
});

test('login form signs in through the UI and logout ends the session', async ({ page }) => {
  await page.goto('/app/keywords');
  await expect(page).toHaveURL(/\/app\/login/);

  await page.locator('input[type=email]').fill('demo@halox.local');
  await page.locator('input[type=password]').fill('wrong-password');
  await page.locator('input[type=password]').press('Enter');
  await expect(page.locator('.clone-toast')).toContainText('이메일 또는 비밀번호가 올바르지 않습니다');
  await expect(page).toHaveURL(/\/app\/login/);

  await page.locator('input[type=password]').fill(process.env.HALOX_DEMO_PASSWORD!);
  await page.locator('input[type=password]').press('Enter');
  await expect(page).toHaveURL(/\/app$/);
  expect((await page.request.get('/api/v1/auth')).status()).toBe(200);

  expect((await page.request.delete('/api/v1/auth')).status()).toBe(200);
  expect((await page.request.get('/api/v1/auth')).status()).toBe(401);
});
