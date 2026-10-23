import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { RlsAccessDeniedError } from './database.ts';
import type { PersistentHaloXStore } from './store.ts';
import { contentText } from './content-model.ts';
import { checkContentRevision } from './content-service.ts';
import { openIntegrationSecret, sealIntegrationSecret } from './integration-secret.ts';
import { createNicePayClient, type NicePayBuyer, type NicePayCard, type NicePayClient, type NicePayPayment } from './nicepay.ts';
import { ExternalServiceError } from './public-json.ts';

export type BillingPrivateCollection = 'billing_credentials' | 'billing_requests';
const activeOrder = (row: Row) => ['processing', 'unknown', 'cancelling'].includes(String(row.status));
const where = (workspace: string, id?: unknown) => ({ workspace_id: `eq.${workspace}`, ...(id ? { id: `eq.${String(id)}` } : {}) });
const fingerprint = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sensitiveFingerprint = (value: unknown) => { const secret = process.env.HALOX_INTEGRATION_SECRET || process.env.HALOX_SESSION_SECRET; if (!secret || secret.length < 32) throw new Error('서버의 연동 암호화 키를 설정해 주세요.'); return crypto.createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex'); };
const stamp = (now = Date.now()) => new Date(now).toISOString();
const requestKey = (value: unknown) => contentText(value, '요청 키', 100, true);
const orderNo = (prefix: string) => `HX-${prefix}-${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 64);

function manager(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceAccess(workspace, actor, 'other', 'write');
  const member = db.queryTable('workspace_members', { filters: { workspace_id: `eq.${workspace}`, user_id: `eq.${actor}` } }, actor).data[0];
  if (!['owner', 'admin'].includes(String(member?.role))) throw new RlsAccessDeniedError('결제 수단과 구독 관리는 워크스페이스 관리자만 할 수 있습니다.');
}
function buyer(db: HaloXDatabase, actor: string): NicePayBuyer {
  const row = db.queryTable('profiles', { filters: { id: `eq.${actor}` } }, actor).data[0];
  if (!row) throw new Error('결제 계정을 찾을 수 없습니다.');
  return { name: contentText(row.full_name, '구매자 이름', 30, true), email: contentText(row.email, '구매자 이메일', 60, true), tel: String(row.phone_number || '').replace(/\D/g, '').slice(0, 20) };
}
function plan(db: HaloXDatabase, key: unknown, cycle: unknown) {
  const planKey = contentText(key, '플랜', 50, true), billingCycle = cycle === 'annual' ? 'annual' : cycle === 'monthly' ? 'monthly' : '';
  const row = db.queryTable('plan_templates', { filters: { plan_key: `eq.${planKey}` } }).data[0];
  if (!row || row.is_active !== true || row.is_archived === true || planKey === 'trial') throw new Error('구매할 수 있는 유료 플랜을 선택해 주세요.');
  if (!billingCycle) throw new Error('월간 또는 연간 결제를 선택해 주세요.');
  const price = Number(billingCycle === 'annual' ? row.annual_price : row.monthly_price);
  if (!Number.isInteger(price) || price < 100) throw new Error('플랜 가격 설정을 확인해 주세요.');
  return { row, key: planKey, cycle: billingCycle, price, goodsName: `HaloX ${String(row.name).slice(0, 20)} ${billingCycle === 'annual' ? '연간' : '월간'}`.slice(0, 40) };
}
function method(db: HaloXDatabase, workspace: string, id: unknown, actor: string) {
  if (typeof id !== 'string' || !id) throw new Error('결제 수단을 선택해 주세요.');
  const row = db.queryTable('billing_payment_methods', { filters: where(workspace, id) }, actor).data[0];
  if (!row) throw new Error('현재 워크스페이스에서 결제 수단을 찾을 수 없습니다.');
  return row;
}
function subscription(db: HaloXDatabase, workspace: string, actor: string) { return db.queryTable('subscriptions', { filters: where(workspace) }, actor).data[0]; }
function order(db: HaloXDatabase, workspace: string, id: unknown, actor: string) {
  if (typeof id !== 'string' || !id) throw new Error('결제 내역을 선택해 주세요.');
  const row = db.queryTable('orders', { filters: where(workspace, id) }, actor).data[0];
  if (!row) throw new Error('현재 워크스페이스에서 결제 내역을 찾을 수 없습니다.');
  return row;
}
function credential(db: HaloXDatabase, workspace: string, methodId: unknown) {
  const row = db.getServerRecords('billing_credentials').find(item => item.workspace_id === workspace && item.method_id === methodId);
  if (!row) throw new Error('결제 수단을 다시 등록해 주세요.');
  return openIntegrationSecret(String(row.bid), `${workspace}:${methodId}`);
}
function update(db: HaloXDatabase, table: string, workspace: string, row: Row, values: Row, actor: string) {
  return db.updateTable(table, { ...values, revision: Number(row.revision || 0) + 1, updated_at: stamp() }, where(workspace, row.id), actor)[0];
}
function cycleEnd(start: number, cycle: string) { const date = new Date(start); if (cycle === 'annual') date.setUTCFullYear(date.getUTCFullYear() + 1); else date.setUTCMonth(date.getUTCMonth() + 1); return date.toISOString(); }
function planLimits(db: HaloXDatabase, key: string) {
  const values = Object.fromEntries(db.queryTable('plan_unit_limits', { filters: { plan_key: `eq.${key}` } }).data.map(row => [row.unit_key, Number(row.monthly_limit)]));
  return { keyword_limit: values.keyword_create ?? 20, prompt_limit: values.prompt_create ?? 20, content_limit: values.content_gen ?? 5 };
}
function setWorkspacePlan(db: HaloXDatabase, workspace: string, key: string, cycle: string, actor: string, expires: string) {
  const row = db.queryTable('workspace_plans', { filters: { workspace_id: `eq.${workspace}` } }, actor).data[0], values = { plan: key, billing_cycle: cycle, ...planLimits(db, key), expires_at: expires, updated_at: stamp() };
  if (row) db.updateTable('workspace_plans', values, { workspace_id: `eq.${workspace}` }, actor); else db.insertTable('workspace_plans', { workspace_id: workspace, ...values }, actor);
}
function activate(db: HaloXDatabase, orderRow: Row, payment: NicePayPayment, actor: string, now = Date.now()) {
  const workspace = String(orderRow.workspace_id), periodEnd = cycleEnd(now, String(orderRow.billing_cycle));
  const paid = update(db, 'orders', workspace, orderRow, { status: 'paid', pg_tid: payment.tid, paid_at: stamp(now), receipt_url: payment.receiptUrl, balance_krw: payment.balanceAmt, error: '' }, actor);
  const existing = subscription(db, workspace, actor), values = { plan_key: orderRow.plan_key, billing_cycle: orderRow.billing_cycle, status: 'active', payment_method_id: orderRow.payment_method_id, last_order_id: orderRow.id, current_period_start: stamp(now), current_period_end: periodEnd, cancel_at_period_end: false, cancelled_at: null, pending_plan_key: null, revision: Number(existing?.revision || 0) + 1, updated_at: stamp(now) };
  const sub = existing ? db.updateTable('subscriptions', values, where(workspace, existing.id), actor)[0] : db.insertTable('subscriptions', { ...values, workspace_id: workspace }, actor)[0];
  setWorkspacePlan(db, workspace, String(orderRow.plan_key), String(orderRow.billing_cycle), actor, periodEnd);
  return { order: paid, subscription: sub };
}
function downgrade(db: HaloXDatabase, workspace: string, actor: string, reason: string, now = Date.now()) {
  const sub = subscription(db, workspace, actor); if (sub) update(db, 'subscriptions', workspace, sub, { status: 'cancelled', cancel_at_period_end: false, cancelled_at: stamp(now), cancellation_reason: reason }, actor);
  setWorkspacePlan(db, workspace, 'trial', 'monthly', actor, stamp(now));
}
function safeError(error: unknown) { return error instanceof ExternalServiceError ? error : new ExternalServiceError('결제 제공사의 처리 결과를 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다.', 'NICEPAY_UNKNOWN', 502, true); }
function saveRequest(db: HaloXDatabase, record: Row) { db.setServerRecords('billing_requests', [...db.getServerRecords('billing_requests'), record]); }
function replaceRequest(db: HaloXDatabase, id: unknown, values: Row) { db.setServerRecords('billing_requests', db.getServerRecords('billing_requests').map(row => row.id === id ? { ...row, ...values } : row)); }

export function billingView(db: HaloXDatabase, workspace: string, actor: string, client: NicePayClient = createNicePayClient()) {
  db.assertWorkspaceAccess(workspace, actor, 'other');
  const member = db.queryTable('workspace_members', { filters: { workspace_id: `eq.${workspace}`, user_id: `eq.${actor}` } }, actor).data[0];
  return {
    configured: client.configured(), mode: process.env.NICEPAY_MODE === 'production' ? 'production' : 'sandbox', can_manage: ['owner', 'admin'].includes(String(member?.role)),
    workspace_plan: db.queryTable('workspace_plans', { filters: { workspace_id: `eq.${workspace}` } }, actor).data[0] || null,
    plans: db.queryTable('plan_templates', { order: 'sort_order.asc' }).data.filter(row => row.is_active === true && row.is_archived !== true),
    subscription: subscription(db, workspace, actor) || null,
    usage: db.callRpc('get_workspace_quota_summary', { _workspace_id: workspace }, actor) as Row[],
    methods: db.queryTable('billing_payment_methods', { filters: where(workspace), order: 'created_at.desc' }, actor).data,
    orders: db.queryTable('orders', { filters: where(workspace), order: 'created_at.desc', limit: 100 }, actor).data,
  };
}

export async function billingCommand(store: PersistentHaloXStore, actor: string, payload: Row, client: NicePayClient = createNicePayClient(), now = Date.now): Promise<Row> {
  const workspace = contentText(payload.workspace_id, '워크스페이스', 100, true), action = String(payload.action || '');
  await store.read(db => manager(db, workspace, actor));
  if (action === 'subscription-cancel' || action === 'subscription-resume') return store.write(db => {
    manager(db, workspace, actor); const row = subscription(db, workspace, actor); if (!row || row.status !== 'active') throw new Error('활성 구독을 찾을 수 없습니다.'); checkContentRevision(row, payload.expected_revision);
    if (action === 'subscription-cancel') { if (payload.confirm !== true) throw new Error('현재 결제 기간 종료 후 해지되는 내용을 확인해 주세요.'); return { ok: true, subscription: update(db, 'subscriptions', workspace, row, { cancel_at_period_end: true, cancellation_requested_at: stamp(now()) }, actor) }; }
    return { ok: true, subscription: update(db, 'subscriptions', workspace, row, { cancel_at_period_end: false, cancellation_requested_at: null }, actor) };
  });
  if (action === 'payment-method-register') {
    if (payload.confirm !== true) throw new Error('카드 정보가 NicePay에 전달되는 내용을 확인해 주세요.');
    const cardNo = String(payload.card_no || '').replace(/\s|-/g, ''), card: NicePayCard = { cardNo, expYear: String(payload.exp_year || ''), expMonth: String(payload.exp_month || '').padStart(2, '0'), idNo: String(payload.id_no || '').replace(/\D/g, ''), cardPw: String(payload.card_pw || '') };
    if (!/^\d{16}$/.test(card.cardNo) || !/^\d{2}$/.test(card.expYear) || !/^(?:0[1-9]|1[0-2])$/.test(card.expMonth) || !/^(?:\d{6}|\d{10})$/.test(card.idNo) || !/^\d{2}$/.test(card.cardPw)) throw new Error('카드번호, 유효기간, 생년월일 또는 사업자번호, 비밀번호 앞 2자리를 확인해 주세요.');
    if (!client.configured()) throw new ExternalServiceError('서버의 NicePay 결제 설정이 필요합니다.', 'NICEPAY_NOT_CONFIGURED', 503, false);
    const expiry = new Date(Date.UTC(2000 + Number(card.expYear), Number(card.expMonth), 0, 23, 59, 59)); if (expiry.getTime() < now()) throw new Error('유효기간이 지난 카드는 등록할 수 없습니다.');
    const key = requestKey(payload.idempotency_key), identity = sensitiveFingerprint(['method', card.cardNo, card.expYear, card.expMonth, card.idNo, card.cardPw]);
    const prepared = await store.write(db => {
      manager(db, workspace, actor); const previous = db.getServerRecords('billing_requests').find(row => row.workspace_id === workspace && row.actor_id === actor && row.key === key);
      if (previous) { if (previous.fingerprint !== identity) throw new Error('같은 요청 키를 다른 카드 등록에 사용할 수 없습니다.'); return { reused: true as const, method: db.queryTable('billing_payment_methods', { filters: where(workspace, previous.entity_id) }, actor).data[0] }; }
      if (db.queryTable('billing_payment_methods', { filters: where(workspace) }, actor).data.some(row => ['active', 'registering', 'unknown', 'expiring'].includes(String(row.status)))) throw new Error('기존 결제 수단을 먼저 확인하거나 삭제해 주세요.');
      const id = crypto.randomUUID(), providerOrderId = orderNo('CARD'); sealIntegrationSecret('configuration-check', `${workspace}:${id}`);
      const row = db.insertTable('billing_payment_methods', { id, workspace_id: workspace, provider: 'nicepay', provider_order_id: providerOrderId, card_last4: cardNo.slice(-4), card_name: '', status: 'registering', revision: 1, created_by: actor, error: '', created_at: stamp(now()) }, actor)[0];
      const request = { id: crypto.randomUUID(), workspace_id: workspace, actor_id: actor, key, fingerprint: identity, action, entity_id: id, provider_order_id: providerOrderId, status: 'sending', created_at: stamp(now()) }; saveRequest(db, request);
      return { reused: false as const, method: row, request, buyer: buyer(db, actor) };
    });
    if (prepared.reused) return { ok: prepared.method?.status === 'active', reused: true, method: prepared.method || null };
    try {
      const result = await client.register(String(prepared.request.provider_order_id), card, prepared.buyer);
      return store.write(db => { manager(db, workspace, actor); const current = method(db, workspace, prepared.method.id, actor); const encrypted = sealIntegrationSecret(result.bid, `${workspace}:${current.id}`); db.setServerRecords('billing_credentials', [...db.getServerRecords('billing_credentials').filter(row => row.method_id !== current.id), { workspace_id: workspace, method_id: current.id, bid: encrypted }]); replaceRequest(db, prepared.request.id, { status: 'succeeded', completed_at: stamp(now()) }); return { ok: true, method: update(db, 'billing_payment_methods', workspace, current, { status: 'active', provider_tid: result.tid, card_code: result.cardCode, card_name: result.cardName, registered_at: result.authDate, error: '' }, actor) }; });
    } catch (cause) { const error = safeError(cause); await store.write(db => { const current = method(db, workspace, prepared.method.id, actor); replaceRequest(db, prepared.request.id, { status: error.uncertain ? 'unknown' : 'failed', completed_at: stamp(now()) }); update(db, 'billing_payment_methods', workspace, current, { status: error.uncertain ? 'unknown' : 'failed', error: error.message }, actor); }); throw error; }
  }
  if (action === 'payment-method-delete') {
    const prepared = await store.write(db => { manager(db, workspace, actor); const row = method(db, workspace, payload.method_id, actor); checkContentRevision(row, payload.expected_revision); if (row.status !== 'active') throw new Error('활성 결제 수단만 삭제할 수 있습니다.'); const sub = subscription(db, workspace, actor); if (sub?.status === 'active') throw new Error('활성 구독을 먼저 해지하고 결제 기간이 끝난 뒤 삭제해 주세요.'); const bid = credential(db, workspace, row.id), providerOrderId = orderNo('EXPIRE'); return { row: update(db, 'billing_payment_methods', workspace, row, { status: 'expiring' }, actor), bid, providerOrderId }; });
    try { await client.expire(prepared.bid, prepared.providerOrderId); return store.write(db => { const current = method(db, workspace, prepared.row.id, actor); db.setServerRecords('billing_credentials', db.getServerRecords('billing_credentials').filter(row => row.method_id !== current.id)); return { ok: true, method: update(db, 'billing_payment_methods', workspace, current, { status: 'deleted', deleted_at: stamp(now()), error: '' }, actor) }; }); }
    catch (cause) { const error = safeError(cause); await store.write(db => { const current = method(db, workspace, prepared.row.id, actor); update(db, 'billing_payment_methods', workspace, current, { status: error.uncertain ? 'unknown' : 'active', error: error.message }, actor); }); throw error; }
  }
  if (action === 'payment-method-dismiss') return store.write(db => {
    manager(db, workspace, actor); const row = method(db, workspace, payload.method_id, actor); checkContentRevision(row, payload.expected_revision);
    if (!['failed', 'unknown', 'registering'].includes(String(row.status)) || now() - Date.parse(String(row.created_at)) < 5 * 60_000) throw new Error('등록 실패 또는 결과 확인이 필요한 카드 기록은 5분 후 정리할 수 있습니다.');
    db.setServerRecords('billing_credentials', db.getServerRecords('billing_credentials').filter(item => item.method_id !== row.id));
    return { ok: true, method: update(db, 'billing_payment_methods', workspace, row, { status: 'deleted', deleted_at: stamp(now()), error: '' }, actor) };
  });
  if (action === 'subscription-start' || action === 'subscription-change') {
    if (payload.confirm !== true) throw new Error('표시된 금액이 즉시 결제되고 정기결제가 시작되는 내용을 확인해 주세요.');
    const key = requestKey(payload.idempotency_key), requested = await store.read(db => plan(db, payload.plan_key, payload.billing_cycle));
    const identity = fingerprint([action, requested.key, requested.cycle, requested.price, payload.payment_method_id]);
    const prepared = await store.write(db => {
      manager(db, workspace, actor); const currentPlan = plan(db, requested.key, requested.cycle); if (currentPlan.price !== requested.price) throw new Error('플랜 가격이 변경되었습니다. 새로고침해 주세요.');
      const previous = db.getServerRecords('billing_requests').find(row => row.workspace_id === workspace && row.actor_id === actor && row.key === key);
      if (previous) { if (previous.fingerprint !== identity) throw new Error('같은 요청 키를 다른 결제에 사용할 수 없습니다.'); return { reused: true as const, order: db.queryTable('orders', { filters: where(workspace, previous.entity_id) }, actor).data[0] }; }
      if (db.queryTable('orders', { filters: where(workspace) }, actor).data.some(activeOrder)) throw new Error('진행 중이거나 결과를 확인해야 하는 결제가 있습니다.');
      const sub = subscription(db, workspace, actor); if (action === 'subscription-start' && sub?.status === 'active') throw new Error('이미 활성 구독이 있습니다. 플랜 변경을 이용해 주세요.'); if (action === 'subscription-change' && sub?.status !== 'active') throw new Error('변경할 활성 구독이 없습니다.');
      const paymentMethod = method(db, workspace, payload.payment_method_id, actor); if (paymentMethod.status !== 'active') throw new Error('사용할 수 있는 결제 수단이 아닙니다.');
      const bid = credential(db, workspace, paymentMethod.id), id = crypto.randomUUID(), providerOrderId = orderNo(action === 'subscription-start' ? 'START' : 'CHANGE');
      const row = db.insertTable('orders', { id, workspace_id: workspace, order_no: providerOrderId, plan_key: currentPlan.key, billing_cycle: currentPlan.cycle, amount_krw: currentPlan.price, balance_krw: 0, status: 'processing', kind: action === 'subscription-start' ? 'initial' : 'change', pg_provider: 'nicepay', pg_tid: null, payment_method_id: paymentMethod.id, receipt_url: '', created_by: actor, revision: 1, error: '', created_at: stamp(now()) }, actor)[0];
      const request = { id: crypto.randomUUID(), workspace_id: workspace, actor_id: actor, key, fingerprint: identity, action, entity_id: id, provider_order_id: providerOrderId, status: 'sending', created_at: stamp(now()) }; saveRequest(db, request);
      return { reused: false as const, order: row, request, bid, buyer: buyer(db, actor), goodsName: currentPlan.goodsName };
    });
    if (prepared.reused) return { ok: prepared.order?.status === 'paid', reused: true, order: prepared.order || null };
    try { const payment = await client.charge(prepared.bid, String(prepared.order.order_no), Number(prepared.order.amount_krw), prepared.goodsName, prepared.buyer); return store.write(db => { manager(db, workspace, actor); const current = order(db, workspace, prepared.order.id, actor); if (current.status !== 'processing') return { ok: current.status === 'paid', order: current }; replaceRequest(db, prepared.request.id, { status: 'succeeded', completed_at: stamp(now()) }); return { ok: true, ...activate(db, current, payment, actor, now()) }; }); }
    catch (cause) { const error = safeError(cause); await store.write(db => { const current = order(db, workspace, prepared.order.id, actor); replaceRequest(db, prepared.request.id, { status: error.uncertain ? 'unknown' : 'failed', completed_at: stamp(now()) }); update(db, 'orders', workspace, current, { status: error.uncertain ? 'unknown' : 'failed', error: error.message }, actor); }); throw error; }
  }
  if (action === 'order-reconcile') {
    const prepared = await store.write(db => { manager(db, workspace, actor); const row = order(db, workspace, payload.order_id, actor); checkContentRevision(row, payload.expected_revision); if (!['unknown', 'processing', 'cancelling'].includes(String(row.status))) throw new Error('결과 확인이 필요한 결제를 선택해 주세요.'); if (now() - Date.parse(String(row.created_at)) < 60_000) throw new Error('제공사 처리 후 1분이 지나면 거래를 확인할 수 있습니다.'); return row; });
    try { const payment = await client.find(String(prepared.order_no)); return store.write(db => { manager(db, workspace, actor); const current = order(db, workspace, prepared.id, actor); if (payment.orderId !== current.order_no || payment.amount !== current.amount_krw) throw new ExternalServiceError('NicePay 거래 정보가 주문과 일치하지 않습니다.', 'NICEPAY_MISMATCH', 502, true); const request = db.getServerRecords('billing_requests').find(row => row.entity_id === current.id); if (request) replaceRequest(db, request.id, { status: 'succeeded', completed_at: stamp(now()) }); if (payment.status === 'paid') return { ok: true, ...activate(db, current, payment, actor, now()) }; update(db, 'orders', workspace, current, { status: payment.status === 'ready' ? 'processing' : payment.status, pg_tid: payment.tid, balance_krw: payment.balanceAmt, error: payment.status === 'failed' || payment.status === 'expired' ? payment.resultMsg : '' }, actor); if (payment.status === 'cancelled') downgrade(db, workspace, actor, 'provider_cancelled', now()); return { ok: true }; }); }
    catch (cause) { const error = safeError(cause); await store.write(db => { const current = order(db, workspace, prepared.id, actor); if (error.uncertain) update(db, 'orders', workspace, current, { status: 'unknown', error: error.message }, actor); }); throw error; }
  }
  if (action === 'order-cancel') {
    if (payload.confirm !== true) throw new Error('결제 취소 후 플랜이 종료되는 내용을 확인해 주세요.');
    const reason = contentText(payload.reason, '취소 사유', 100, true);
    const prepared = await store.write(db => { manager(db, workspace, actor); const row = order(db, workspace, payload.order_id, actor); checkContentRevision(row, payload.expected_revision); if (row.status !== 'paid' || !row.pg_tid || Number(row.balance_krw) !== Number(row.amount_krw)) throw new Error('전액 취소할 수 있는 결제를 선택해 주세요.'); const sub = subscription(db, workspace, actor); if (sub?.last_order_id !== row.id || sub.status !== 'active') throw new Error('현재 구독의 마지막 결제만 전액 취소할 수 있습니다.'); return update(db, 'orders', workspace, row, { status: 'cancelling' }, actor); });
    try { const payment = await client.cancel(String(prepared.pg_tid), String(prepared.order_no), Number(prepared.amount_krw), reason); return store.write(db => { manager(db, workspace, actor); const current = order(db, workspace, prepared.id, actor); const cancelled = update(db, 'orders', workspace, current, { status: 'cancelled', cancelled_at: stamp(now()), balance_krw: payment.balanceAmt, cancel_tid: payment.cancelledTid || payment.tid, error: '' }, actor); downgrade(db, workspace, actor, 'payment_cancelled', now()); return { ok: true, order: cancelled }; }); }
    catch (cause) { const error = safeError(cause); await store.write(db => { const current = order(db, workspace, prepared.id, actor); update(db, 'orders', workspace, current, { status: error.uncertain ? 'unknown' : 'paid', error: error.message }, actor); }); throw error; }
  }
  throw new Error('지원하지 않는 결제 작업입니다.');
}

/** NicePay webhook signature is verified before this function changes local state. */
export async function applyBillingWebhook(store: PersistentHaloXStore, payload: Row, client: NicePayClient = createNicePayClient(), now = Date.now()) {
  const payment = client.verifyWebhook(payload);
  return store.write(db => {
    const request = db.getServerRecords('billing_requests').find(row => row.provider_order_id === payment.orderId), actor = String(request?.actor_id || ''), workspace = String(request?.workspace_id || '');
    if (!request || !actor || !workspace) throw new Error('등록된 결제 주문이 아닙니다.');
    const row = db.queryTable('orders', { filters: { workspace_id: `eq.${workspace}`, order_no: `eq.${payment.orderId}` } }, actor).data[0];
    if (!row || Number(row.amount_krw) !== payment.amount || row.pg_tid && row.pg_tid !== payment.tid) throw new Error('결제 통보가 주문과 일치하지 않습니다.');
    if (payment.status === 'paid') { if (['processing', 'unknown', 'failed'].includes(String(row.status))) activate(db, row, payment, actor, now); }
    else if (['cancelled', 'partialCancelled'].includes(payment.status)) { update(db, 'orders', workspace, row, { status: payment.status, pg_tid: payment.tid, balance_krw: payment.balanceAmt, cancelled_at: stamp(now), error: '' }, actor); if (payment.status === 'cancelled' && subscription(db, workspace, actor)?.last_order_id === row.id) downgrade(db, workspace, actor, 'provider_cancelled', now); }
    else if (['failed', 'expired', 'ready'].includes(payment.status) && ['processing', 'unknown'].includes(String(row.status))) update(db, 'orders', workspace, row, { status: payment.status === 'ready' ? 'processing' : payment.status, pg_tid: payment.tid, balance_krw: payment.balanceAmt, error: payment.status === 'ready' ? '' : payment.resultMsg }, actor);
    replaceRequest(db, request.id, { status: 'succeeded', completed_at: stamp(now) });
    return { ok: true };
  });
}

/** Processes at most one due subscription. A persisted period key prevents duplicate renewals across workers. */
export async function processBillingTick(store: PersistentHaloXStore, client: NicePayClient = createNicePayClient(), now = Date.now()): Promise<boolean> {
  const candidate = await store.read(db => {
    const tables = db.exportState().tables;
    return (tables.subscriptions || []).filter(row => row.status === 'active' && Date.parse(String(row.current_period_end)) <= now).sort((a, b) => String(a.current_period_end).localeCompare(String(b.current_period_end)))[0];
  });
  if (!candidate) return false;
  const workspace = String(candidate.workspace_id), actor = await store.read(db => String(db.exportState().tables.workspaces.find(row => row.id === workspace)?.owner_id || ''));
  if (!actor) return false;
  if (candidate.cancel_at_period_end) {
    await store.write(db => { const current = subscription(db, workspace, actor); if (current?.id === candidate.id && current.status === 'active' && current.cancel_at_period_end && Date.parse(String(current.current_period_end)) <= now) downgrade(db, workspace, actor, 'period_ended', now); });
    return true;
  }
  if (!client.configured()) return false;
  const key = `renewal:${candidate.id}:${candidate.current_period_end}`;
  const prepared = await store.write(db => {
    const current = subscription(db, workspace, actor); if (!current || current.id !== candidate.id || current.status !== 'active' || current.cancel_at_period_end || Date.parse(String(current.current_period_end)) > now) return null;
    const existing = db.getServerRecords('billing_requests').find(row => row.workspace_id === workspace && row.key === key);
    if (existing) return null;
    if (db.queryTable('orders', { filters: where(workspace) }, actor).data.some(activeOrder)) return null;
    const requested = plan(db, current.plan_key, current.billing_cycle), paymentMethod = method(db, workspace, current.payment_method_id, actor);
    if (paymentMethod.status !== 'active') { update(db, 'subscriptions', workspace, current, { status: 'past_due', error: '등록된 결제 수단을 사용할 수 없습니다.' }, actor); return null; }
    const bid = credential(db, workspace, paymentMethod.id), id = crypto.randomUUID(), providerOrderId = orderNo('RENEW');
    const row = db.insertTable('orders', { id, workspace_id: workspace, order_no: providerOrderId, plan_key: requested.key, billing_cycle: requested.cycle, amount_krw: requested.price, balance_krw: 0, status: 'processing', kind: 'renewal', pg_provider: 'nicepay', pg_tid: null, payment_method_id: paymentMethod.id, receipt_url: '', created_by: actor, revision: 1, error: '', created_at: stamp(now) }, actor)[0];
    const request = { id: crypto.randomUUID(), workspace_id: workspace, actor_id: actor, key, fingerprint: fingerprint([current.id, current.current_period_end, requested.price]), action: 'subscription-renew', entity_id: id, provider_order_id: providerOrderId, status: 'sending', created_at: stamp(now) }; saveRequest(db, request);
    return { order: row, request, bid, goodsName: requested.goodsName, buyer: buyer(db, actor) };
  });
  if (!prepared) return false;
  try {
    const payment = await client.charge(prepared.bid, String(prepared.order.order_no), Number(prepared.order.amount_krw), prepared.goodsName, prepared.buyer);
    await store.write(db => { const current = order(db, workspace, prepared.order.id, actor); if (current.status === 'processing') { replaceRequest(db, prepared.request.id, { status: 'succeeded', completed_at: stamp(now) }); activate(db, current, payment, actor, now); } });
  } catch (cause) {
    const error = safeError(cause);
    await store.write(db => { const current = order(db, workspace, prepared.order.id, actor); replaceRequest(db, prepared.request.id, { status: error.uncertain ? 'unknown' : 'failed', completed_at: stamp(now) }); update(db, 'orders', workspace, current, { status: error.uncertain ? 'unknown' : 'failed', error: error.message }, actor); const sub = subscription(db, workspace, actor); if (sub && !error.uncertain) { update(db, 'subscriptions', workspace, sub, { status: 'past_due', error: error.message }, actor); setWorkspacePlan(db, workspace, 'trial', 'monthly', actor, stamp(now)); } });
  }
  return true;
}
