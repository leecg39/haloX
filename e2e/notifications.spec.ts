import { test, expect, type Page } from '@playwright/test';
import { PersistentHaloXStore } from '../src/lib/backend/store';
import { runReportCommand } from '../src/lib/backend/report-service';
import { processNotificationTick } from '../src/lib/backend/notification-worker';
import type { NotificationProvider } from '../src/lib/backend/notification-provider';
import { loginIsolatedAccount } from './isolated-account';
const root = (page: Page) => page.locator('.live-settings-page'), modal = (page: Page) => page.getByRole('dialog');
async function fixture(page: Page) {
  const actor = await loginIsolatedAccount(page, 'notifications'), store = new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!);
  const workspace = await store.write(db => db.insertTable('workspaces', { name: '알림 E2E' }, actor)[0]);
  await page.goto('/app'); await page.evaluate(ws => localStorage.setItem('halox-clone:active-workspace', JSON.stringify({ id: ws.id, name: ws.name, plan: '' })), workspace);
  await page.goto('/app/settings?tab=notifications'); await expect(root(page).getByRole('heading', { name: '내 알림 설정', exact: true })).toBeVisible();
  const data = async () => (await page.request.get(`/api/v1/notifications?workspace_id=${workspace.id}`)).json();
  const report = async (key = 'e2e-report') => store.write(db => runReportCommand(db, 'report-create', { period_type: 'week', date: new Date().toISOString().slice(0, 10), idempotency_key: key, title: '실제 주간 보고서' }, String(workspace.id), actor));
  return { actor, store, workspace, data, report };
}
async function subscribe(page: Page, sms = false) { await root(page).getByRole('button', { name: '수신 설정 수정' }).click(); await modal(page).getByLabel('알림함', { exact: true }).check(); await modal(page).getByLabel('보고서 생성', { exact: true }).check(); if (sms) await modal(page).getByLabel('문자 알림', { exact: true }).check(); await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); }
test('notification subscriptions, report inbox read/delete and source dedup survive reload', async ({ page }) => {
  const f = await fixture(page); await subscribe(page); await page.reload(); expect((await f.data()).preferences.inbox).toBe(true);
  await f.report(); await f.report(); await page.reload(); await expect(root(page).getByRole('heading', { name: '내 알림함 · 읽지 않음 1개' })).toBeVisible();
  await root(page).getByRole('button', { name: '읽음으로 표시', exact: true }).click(); await expect(root(page).getByRole('heading', { name: '내 알림함 · 읽지 않음 0개' })).toBeVisible(); await page.reload();
  await root(page).getByRole('button', { name: '알림 삭제', exact: true }).click(); await modal(page).getByRole('button', { name: '삭제', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); await page.reload(); expect((await f.data()).inbox).toHaveLength(0);
  await root(page).getByRole('button', { name: '수신 설정 삭제' }).click(); await modal(page).getByRole('button', { name: '삭제', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); await page.reload(); expect((await f.data()).preferences.saved).toBe(false); await f.report('second'); expect((await f.data()).inbox).toHaveLength(0);
});
test('SMS queue acceptance/delivery, cancellation, history deletion and mobile scrolling', async ({ page }) => {
  const f = await fixture(page); await subscribe(page, true); await f.report(); await page.reload(); await expect(root(page)).toContainText('발송 대기');
  let sent = 0; const provider: NotificationProvider = { configured: () => true, send: async () => { sent++; return 'e2e-solapi-group'; }, status: async () => 'delivered' };
  await processNotificationTick(f.store, provider); await page.reload(); await expect(root(page)).toContainText('제공사 접수'); await processNotificationTick(new PersistentHaloXStore(process.env.HALOX_E2E_DATABASE_PATH!), provider, Date.now() + 31000); await page.reload(); await expect(root(page)).toContainText('전달 확인'); expect(sent).toBe(1);
  await root(page).getByRole('button', { name: '이력 삭제', exact: true }).click(); await modal(page).getByRole('button', { name: '삭제', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); expect((await f.data()).deliveries).toHaveLength(0);
  await f.report('second'); await page.reload(); await root(page).getByRole('button', { name: '발송 취소', exact: true }).click(); await modal(page).getByRole('button', { name: '발송 취소', exact: true }).click(); await expect(modal(page)).not.toBeVisible(); await page.reload(); expect((await f.data()).deliveries[0].status).toBe('cancelled');
  await page.setViewportSize({ width: 390, height: 600 }); await page.reload(); await expect(root(page).getByRole('heading', { name: '외부 발송 이력', exact: true })).toBeVisible(); await expect.poll(() => root(page).evaluate(el => { const main = el.closest('main')!; return main.scrollHeight - main.clientHeight; })).toBeGreaterThan(100); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390); await page.mouse.move(270, 420); await page.mouse.wheel(0, 700); await expect.poll(() => root(page).evaluate(el => el.closest('main')!.scrollTop)).toBeGreaterThan(0);
});
test('missing SMTP configuration, revision conflict preserves fields and viewer can edit only own preferences', async ({ page }) => {
  const f = await fixture(page); await expect(root(page).getByRole('button', { name: '이메일 인증번호 받기' })).toBeDisabled(); expect((await page.request.post('/api/v1/notifications', { data: { workspace_id: f.workspace.id, action: 'email-send' } })).status()).toBe(503);
  await subscribe(page); await root(page).getByRole('button', { name: '수신 설정 수정' }).click(); await modal(page).getByLabel('측정 자료 부족').check();
  await f.store.write(db => db.setServerRecords('notification_preferences', db.getServerRecords('notification_preferences').map(row => row.user_id === f.actor ? { ...row, revision: Number(row.revision) + 1 } : row)));
  await modal(page).getByRole('button', { name: '저장', exact: true }).click(); await expect(modal(page).getByRole('alert')).toContainText('변경'); await expect(modal(page).getByLabel('측정 자료 부족')).toBeChecked(); await modal(page).getByRole('button', { name: '취소', exact: true }).click();
  const actor = await loginIsolatedAccount(page, 'notifications-viewer'); await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace.id, user_id: actor, role: 'viewer', allowed_sections: ['other', 'monitoring'] }, f.actor));
  await page.goto('/app/settings?tab=notifications'); await subscribe(page); expect((await f.data()).preferences.inbox).toBe(true);
  expect((await page.request.get('/api/v1/rest/notification_preferences')).status()).toBe(404); expect((await page.request.post('/api/v1/notifications', { headers: { Origin: 'https://foreign.example' }, data: { workspace_id: f.workspace.id, action: 'preferences-delete', expected_revision: 1 } })).status()).toBe(403);
});
