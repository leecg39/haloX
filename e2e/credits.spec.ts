import { expect, test, type Page } from '@playwright/test';
import { loginIsolatedAccount } from './isolated-account';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { recordWorkspaceCredit } from '../src/lib/backend/credit-service';

const root = (page: Page) => page.locator('.live-credits-page');

test('server credit and personal reward ledgers render, reject direct writes, isolate tenants, and scroll on mobile', async ({ page }) => {
  const actor = await loginIsolatedAccount(page, 'credits'), store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!);
  const workspace = await store.write(db => db.insertTable('workspaces', { name: '크레딧 E2E' }, actor)[0]);
  await store.write(db => {
    recordWorkspaceCredit(db, { event_id: 'support:e2e-credit', workspace_id: String(workspace.id), unit_key: 'keyword_create', kind: 'grant', amount: 5, source_type: 'support', source_id: 'e2e-ticket', memo: 'E2E 지원 크레딧' });
    db.setServerRecords('referral_rewards', [...db.getServerRecords('referral_rewards'), { id: 'e2e-reward', event_id: 'e2e-reward', owner_id: actor, invite_id: 'e2e-invite', code: 'E2E', kind: 'earned', amount: 10000, currency: 'KRW', created_at: new Date().toISOString() }]);
  });
  await page.goto('/app');
  await page.evaluate(ws => localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: 'trial' })), workspace);
  await page.goto('/app/settings?tab=credits');
  await expect(root(page).getByRole('heading', { name: '크레딧·보상', exact: true })).toBeVisible();
  await expect(root(page)).toContainText('크레딧 E2E');
  await expect(root(page)).toContainText('5 크레딧');
  await expect(root(page)).toContainText('E2E 지원 크레딧');
  await expect(root(page)).toContainText('고객 지원');
  await expect(root(page)).toContainText('₩10,000');
  await expect(root(page).getByRole('link', { name: '추천 프로그램 관리' })).toHaveAttribute('href', '/app/referral');

  expect((await page.request.post('/api/v1/rest/workspace_credit_ledger', { data: { workspace_id: workspace.id, amount: 999 } })).status()).toBe(403);
  expect((await page.request.post('/api/v1/rest/workspace_credit_balances', { data: { workspace_id: workspace.id, balance: 999 } })).status()).toBe(403);
  expect((await page.request.get('/api/v1/credits?workspace_id=11111111-1111-4000-8000-111111111111')).status()).toBe(403);

  await page.setViewportSize({ width: 390, height: 600 });
  await page.reload();
  await expect(root(page).getByRole('heading', { name: '내 추천 보상', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect.poll(() => root(page).evaluate(el => { const main = el.closest('main')!; return main.scrollHeight - main.clientHeight; })).toBeGreaterThan(100);
  await page.mouse.move(270, 420);
  await page.mouse.wheel(0, 800);
  await expect.poll(() => root(page).evaluate(el => el.closest('main')!.scrollTop)).toBeGreaterThan(0);
});
