import { expect, test, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { loginIsolatedAccount } from './isolated-account';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { billingCommand } from '../src/lib/backend/billing-service';
import type { NicePayClient } from '../src/lib/backend/nicepay';
const root = (page: Page) => page.locator('.live-billing-page'), modal = (page: Page) => page.getByRole('dialog');

test('persisted NicePay subscription renders, local cancellation reverses, ledger writes stay protected, and mobile scrolls', async ({ page }) => {
  const actor = await loginIsolatedAccount(page, 'billing'), store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!);
  const workspace = await store.write(db => db.insertTable('workspaces', { name: '결제 E2E' }, actor)[0]);
  const provider: NicePayClient = { configured: () => true,
    register: async orderId => ({ resultCode: '0000', resultMsg: 'ok', tid: 'billing-register', orderId, bid: 'e2e-private-billing-key', authDate: new Date().toISOString(), cardCode: '06', cardName: '신한' }),
    charge: async (_bid, orderId, amount) => ({ resultCode: '0000', resultMsg: 'ok', tid: 'billing-payment', orderId, ediDate: new Date().toISOString(), status: 'paid', amount, balanceAmt: amount, receiptUrl: 'https://example.test/receipt', signature: 'fixture', cardName: '신한', cardNum: '123456******5678' }),
    expire: async () => ({ resultCode: '0000' }), cancel: async () => { throw new Error('not used'); }, find: async () => { throw new Error('not used'); }, verifyWebhook: payload => payload as never };
  const registered = await billingCommand(store, actor, { workspace_id: workspace.id, action: 'payment-method-register', idempotency_key: crypto.randomUUID(), card_no: '1234567812345678', exp_year: '29', exp_month: '12', id_no: '800101', card_pw: '12', confirm: true }, provider);
  await billingCommand(store, actor, { workspace_id: workspace.id, action: 'subscription-start', idempotency_key: crypto.randomUUID(), plan_key: 'pro', billing_cycle: 'monthly', payment_method_id: (registered.method as { id: string }).id, confirm: true }, provider);
  await page.goto('/app'); await page.evaluate(ws => localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: 'pro' })), workspace);
  await page.goto('/app/settings?tab=billing'); await expect(root(page).getByRole('heading', { name: '구독·결제', exact: true })).toBeVisible(); await expect(root(page)).toContainText('현재 플랜 · pro'); await expect(root(page)).toContainText('신한 · •••• 5678'); await expect(root(page)).toContainText('결제 완료'); await expect(root(page)).toContainText('600,000원'); await expect(root(page)).toContainText('결제 서비스 설정 필요');
  await root(page).getByRole('button', { name: '기간 종료 후 해지', exact: true }).click(); await modal(page).getByRole('checkbox').check(); await modal(page).getByRole('button', { name: '해지 예약', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); await expect(root(page)).toContainText('기간 종료 후 해지 예정');
  await root(page).getByRole('button', { name: '해지 철회', exact: true }).click(); await modal(page).getByRole('button', { name: '구독 유지', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); await expect(root(page).getByRole('button', { name: '기간 종료 후 해지', exact: true })).toBeVisible();
  expect((await page.request.post('/api/v1/rest/orders', { data: { workspace_id: workspace.id, status: 'paid' } })).status()).toBe(403); expect((await page.request.post('/api/v1/billing', { headers: { Origin: 'https://foreign.example' }, data: { workspace_id: workspace.id, action: 'subscription-cancel' } })).status()).toBe(403);
  await page.setViewportSize({ width: 390, height: 600 }); await page.reload(); await expect(root(page).getByRole('heading', { name: '결제 내역', exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390); await expect.poll(() => root(page).evaluate(el => { const main = el.closest('main')!; return main.scrollHeight - main.clientHeight; })).toBeGreaterThan(100); await page.mouse.move(270, 420); await page.mouse.wheel(0, 800); await expect.poll(() => root(page).evaluate(el => el.closest('main')!.scrollTop)).toBeGreaterThan(0);
});
