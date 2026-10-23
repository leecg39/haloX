import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyBillingWebhook, billingCommand, billingView, processBillingTick } from './billing-service.ts';
import { createNicePayClient, type NicePayClient, type NicePayPayment } from './nicepay.ts';
import { PersistentHaloXStore } from './store.ts';
import { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, OTHER_USER_ID, type Row } from './database.ts';
import { ExternalServiceError } from './public-json.ts';
import { assertRestWrite } from './rest-policy.ts';

const directories: string[] = [], originalSecret = process.env.HALOX_SESSION_SECRET;
before(() => { process.env.HALOX_SESSION_SECRET = 'billing-test-secret-that-is-long-enough'; });
after(() => { if (originalSecret === undefined) delete process.env.HALOX_SESSION_SECRET; else process.env.HALOX_SESSION_SECRET = originalSecret; directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })); });
const payment = (orderId: string, amount: number, status = 'paid'): NicePayPayment => ({ resultCode: '0000', resultMsg: 'ok', tid: `tid-${orderId}`.slice(0, 30), orderId, ediDate: new Date().toISOString(), status, amount, balanceAmt: status === 'cancelled' ? 0 : amount, receiptUrl: 'https://example.test/receipt', signature: 'fixture', cardName: '테스트카드', cardNum: '123456******7890' });
function fixture(overrides: Partial<NicePayClient> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-billing-')); directories.push(directory); const file = path.join(directory, 'state.sqlite'), store = new PersistentHaloXStore(file);
  const calls = { register: 0, charge: 0, expire: 0, cancel: 0, find: 0 };
  const client: NicePayClient = { configured: () => true,
    register: async orderId => { calls.register++; return { resultCode: '0000', resultMsg: 'ok', tid: 'register-tid', orderId, bid: 'private-billing-key', authDate: new Date().toISOString(), cardCode: '06', cardName: '신한' }; },
    charge: async (_bid, orderId, amount) => { calls.charge++; return payment(orderId, amount); },
    expire: async () => { calls.expire++; return { resultCode: '0000' }; },
    cancel: async (_tid, orderId, amount) => { calls.cancel++; return payment(orderId, amount, 'cancelled'); },
    find: async orderId => { calls.find++; const row = await store.read(db => db.queryTable('orders', { filters: { order_no: `eq.${orderId}` } }, DEFAULT_USER_ID).data[0]); return payment(orderId, Number(row.amount_krw)); },
    verifyWebhook: payload => payload as unknown as NicePayPayment, ...overrides,
  };
  const command = (action: string, fields: Row = {}, now = Date.now) => billingCommand(store, DEFAULT_USER_ID, { workspace_id: DEFAULT_WORKSPACE_ID, action, ...fields }, client, now);
  const view = () => store.read(db => billingView(db, DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID, client));
  const register = (key: string = crypto.randomUUID()) => command('payment-method-register', { idempotency_key: key, card_no: '1234567812345678', exp_year: '29', exp_month: '12', id_no: '800101', card_pw: '12', confirm: true });
  const start = async (key: string = crypto.randomUUID(), methodId?: unknown, now = Date.now) => { const method = methodId || (await view()).methods[0].id; return command('subscription-start', { idempotency_key: key, plan_key: 'pro', billing_cycle: 'monthly', payment_method_id: method, confirm: true }, now); };
  return { store, file, calls, client, command, view, register, start };
}

describe('billing service', () => {
  it('stores only an encrypted billing key, charges server price once, and protects every ledger table', async () => {
    const f = fixture(), key = crypto.randomUUID(); const registered = await f.register(key); assert.equal(f.calls.register, 1); await f.register(key); assert.equal(f.calls.register, 1);
    const serialized = JSON.stringify(await f.store.read(db => db.exportState())); assert.ok(!serialized.includes('1234567812345678')); assert.ok(!serialized.includes('800101')); assert.ok(!serialized.includes('private-billing-key'));
    const started = await f.start('same-charge', (registered.method as Row).id); assert.equal(f.calls.charge, 1); await f.start('same-charge', (registered.method as Row).id); assert.equal(f.calls.charge, 1); assert.equal((started.order as Row).amount_krw, 600000);
    const view = await f.view(); assert.equal(view.workspace_plan.plan, 'pro'); assert.equal(view.workspace_plan.keyword_limit, 100); assert.equal(view.subscription.status, 'active'); assert.equal(view.orders[0].status, 'paid'); assert.ok((await f.store.read(db => db.accountDeletionView(DEFAULT_USER_ID))).unresolved_operations > 0);
    await f.store.read(db => { for (const table of ['orders', 'subscriptions', 'billing_payment_methods', 'workspace_plans']) assert.throws(() => assertRestWrite(db, table, 'POST', DEFAULT_USER_ID, { workspace_id: DEFAULT_WORKSPACE_ID })); });
    await assert.rejects(billingCommand(f.store, OTHER_USER_ID, { workspace_id: DEFAULT_WORKSPACE_ID, action: 'subscription-cancel' }, f.client));
  });

  it('marks uncertain charges unknown and reconciles the original order without charging twice', async () => {
    let uncertain = true; const f = fixture({ charge: async (_bid, orderId, amount) => { f.calls.charge++; if (uncertain) throw new ExternalServiceError('unknown', 'NICEPAY_UNKNOWN', 502, true); return payment(orderId, amount); } });
    const method = (await f.register()).method as Row, at = Date.now() - 120_000; await assert.rejects(f.start('uncertain-charge', method.id, () => at), /unknown/); let view = await f.view(); assert.equal(view.orders[0].status, 'unknown');
    uncertain = false; await f.command('order-reconcile', { order_id: view.orders[0].id, expected_revision: view.orders[0].revision }); view = await f.view(); assert.equal(view.orders[0].status, 'paid'); assert.equal(view.subscription.status, 'active'); assert.equal(f.calls.charge, 1); assert.equal(f.calls.find, 1);
  });

  it('supports period-end cancellation, reversal, full cancellation, and provider card deletion', async () => {
    const f = fixture(); const method = (await f.register()).method as Row; await f.start('start', method.id); let view = await f.view();
    await f.command('subscription-cancel', { expected_revision: view.subscription.revision, confirm: true }); view = await f.view(); assert.equal(view.subscription.cancel_at_period_end, true);
    await f.command('subscription-resume', { expected_revision: view.subscription.revision }); view = await f.view(); assert.equal(view.subscription.cancel_at_period_end, false);
    await f.command('order-cancel', { order_id: view.orders[0].id, expected_revision: view.orders[0].revision, reason: '테스트 취소', confirm: true }); view = await f.view(); assert.equal(view.orders[0].status, 'cancelled'); assert.equal(view.workspace_plan.plan, 'trial'); assert.equal(f.calls.cancel, 1);
    await applyBillingWebhook(f.store, payment(String(view.orders[0].order_no), Number(view.orders[0].amount_krw)) as unknown as Row, f.client); assert.equal((await f.view()).subscription.status, 'cancelled'); assert.equal((await f.view()).workspace_plan.plan, 'trial');
    await f.command('payment-method-delete', { method_id: method.id, expected_revision: view.methods[0].revision }); assert.equal(f.calls.expire, 1); assert.equal((await f.view()).methods[0].status, 'deleted');
  });

  it('renews one due period once across stores and ends a scheduled cancellation without a charge', async () => {
    const f = fixture(); const method = (await f.register()).method as Row; await f.start('start', method.id); let view = await f.view(), due = Date.now() - 1000;
    await f.store.write(db => db.updateTable('subscriptions', { current_period_end: new Date(due).toISOString() }, { id: `eq.${view.subscription.id}` }, DEFAULT_USER_ID)); f.calls.charge = 0;
    await Promise.all([processBillingTick(f.store, f.client, Date.now()), processBillingTick(new PersistentHaloXStore(f.file), f.client, Date.now())]); assert.equal(f.calls.charge, 1); view = await f.view(); assert.equal(view.orders.filter(row => row.kind === 'renewal').length, 1); assert.ok(Date.parse(String(view.subscription.current_period_end)) > Date.now());
    await f.store.write(db => db.updateTable('subscriptions', { cancel_at_period_end: true, current_period_end: new Date(Date.now() - 1).toISOString() }, { id: `eq.${view.subscription.id}` }, DEFAULT_USER_ID)); f.calls.charge = 0;
    assert.equal(await processBillingTick(f.store, f.client, Date.now()), true); assert.equal(f.calls.charge, 0); assert.equal((await f.view()).workspace_plan.plan, 'trial');
  });

  it('accepts only matching signed webhook data and applies each provider event idempotently', async () => {
    const f = fixture({ charge: async () => { throw new ExternalServiceError('unknown', 'NICEPAY_UNKNOWN', 502, true); } }); const method = (await f.register()).method as Row; await assert.rejects(f.start('webhook', method.id, () => Date.now() - 120_000));
    const row = (await f.view()).orders[0], notice = payment(String(row.order_no), Number(row.amount_krw)); await applyBillingWebhook(f.store, notice as unknown as Row, f.client); await applyBillingWebhook(f.store, notice as unknown as Row, f.client);
    assert.equal((await f.view()).orders[0].status, 'paid'); const wrong = { ...notice, amount: 1 }; await assert.rejects(applyBillingWebhook(f.store, wrong as unknown as Row, f.client), /일치/);
  });
});

describe('NicePay client contract', () => {
  it('uses fixed sandbox endpoints, encrypts raw card fields, and verifies signed payments', async () => {
    const secret = '12345678901234567890123456789012', env = { NICEPAY_CLIENT_KEY: 'client', NICEPAY_SECRET_KEY: secret, NICEPAY_MODE: 'sandbox' }, requests: { url: string; body?: Row }[] = [];
    const fetcher = (async (input, init) => { const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ url, body });
      if (url.endsWith('/subscribe/regist')) return Response.json({ resultCode: '0000', resultMsg: 'ok', tid: 'register-tid', orderId: body.orderId, bid: 'billing-key', authDate: '2026-10-24T00:00:00+0900', cardCode: '06', cardName: '신한' });
      const ediDate = '2026-10-24T00:00:00+0900', tid = 'payment-tid', amount = Number(body.amount), signature = crypto.createHash('sha256').update(tid + amount + ediDate + secret).digest('hex'); return Response.json({ resultCode: '0000', resultMsg: 'ok', tid, orderId: body.orderId, ediDate, signature, status: 'paid', amount, balanceAmt: amount, receiptUrl: '', card: { cardName: '신한', cardNum: '123456******5678' } });
    }) as typeof fetch;
    const client = createNicePayClient(env, fetcher); const card = { cardNo: '1234567812345678', expYear: '29', expMonth: '12', idNo: '800101', cardPw: '12' };
    const registered = await client.register('HX-CARD', card, { name: '구매자', email: 'buyer@example.test', tel: '' }); assert.equal(registered.bid, 'billing-key'); assert.equal(requests[0].url, 'https://sandbox-api.nicepay.co.kr/v1/subscribe/regist'); assert.equal(JSON.stringify(requests[0].body).includes(card.cardNo), false); assert.equal(requests[0].body?.encMode, 'A2');
    const paid = await client.charge('billing-key', 'HX-ORDER', 600000, 'HaloX Pro', { name: '구매자', email: 'buyer@example.test', tel: '' }); assert.equal(paid.status, 'paid'); assert.equal(requests[1].url, 'https://sandbox-api.nicepay.co.kr/v1/subscribe/billing-key/payments');
  });
});
