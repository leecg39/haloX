import crypto from 'node:crypto';
import { ExternalServiceError } from './public-json.ts';
import type { Row } from './database.ts';

export type NicePayBuyer = { name: string; email: string; tel: string };
export type NicePayCard = { cardNo: string; expYear: string; expMonth: string; idNo: string; cardPw: string };
export type NicePayPayment = { resultCode: string; resultMsg: string; tid: string; cancelledTid?: string; orderId: string; ediDate: string; status: string; amount: number; balanceAmt: number; receiptUrl: string; signature: string; cardName: string; cardNum: string };
export type NicePayMethod = { resultCode: string; resultMsg: string; tid: string; orderId: string; bid: string; authDate: string; cardCode: string; cardName: string };
export interface NicePayClient {
  configured(): boolean;
  register(orderId: string, card: NicePayCard, buyer: NicePayBuyer): Promise<NicePayMethod>;
  charge(bid: string, orderId: string, amount: number, goodsName: string, buyer: NicePayBuyer): Promise<NicePayPayment>;
  expire(bid: string, orderId: string): Promise<Row>;
  cancel(tid: string, orderId: string, amount: number, reason: string): Promise<NicePayPayment>;
  find(orderId: string): Promise<NicePayPayment>;
  verifyWebhook(payload: Row): NicePayPayment;
}

const value = (row: Row, key: string, legacy?: string) => row[key] ?? (legacy ? row[legacy] : undefined);
const required = (input: unknown, label: string, max = 500) => {
  if (typeof input !== 'string' || !input || input.length > max) throw new ExternalServiceError(`NicePay ${label} 응답을 확인하지 못했습니다.`, 'NICEPAY_INVALID_RESPONSE', 502, true);
  return input;
};
const amount = (input: unknown) => {
  const number = Number(input); if (!Number.isInteger(number) || number < 0) throw new ExternalServiceError('NicePay 금액 응답을 확인하지 못했습니다.', 'NICEPAY_INVALID_RESPONSE', 502, true); return number;
};
const safeMessage = (input: unknown) => typeof input === 'string' && input.length <= 100 ? input : 'NicePay가 요청을 처리하지 못했습니다.';
const sha256 = (input: string) => crypto.createHash('sha256').update(input).digest('hex');
const same = (left: string, right: string) => left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));

function normalizePayment(row: Row): NicePayPayment {
  const card = row.card && typeof row.card === 'object' && !Array.isArray(row.card) ? row.card as Row : {};
  return {
    resultCode: required(value(row, 'resultCode', 'ResultCode'), '결과 코드', 4), resultMsg: safeMessage(value(row, 'resultMsg', 'ResultMsg')),
    tid: required(value(row, 'tid', 'TID'), '거래 번호', 30), ...(value(row, 'cancelledTid', 'CancelledTid') ? { cancelledTid: required(value(row, 'cancelledTid', 'CancelledTid'), '취소 거래 번호', 30) } : {}), orderId: required(value(row, 'orderId', 'OrderId'), '주문 번호', 64),
    ediDate: required(value(row, 'ediDate', 'EdiDate'), '응답 시각', 64), status: required(value(row, 'status', 'Status'), '결제 상태', 20),
    amount: amount(value(row, 'amount', 'Amount')), balanceAmt: amount(value(row, 'balanceAmt', 'BalanceAmt') ?? value(row, 'amount', 'Amount')),
    receiptUrl: typeof row.receiptUrl === 'string' && row.receiptUrl.length <= 500 ? row.receiptUrl : '',
    signature: required(value(row, 'signature', 'Signature'), '서명', 256),
    cardName: typeof card.cardName === 'string' && card.cardName.length <= 40 ? card.cardName : '', cardNum: typeof card.cardNum === 'string' && card.cardNum.length <= 24 ? card.cardNum : '',
  };
}

export function nicePayReady(env: Partial<NodeJS.ProcessEnv> = process.env) {
  return !!(env.NICEPAY_CLIENT_KEY?.trim() && env.NICEPAY_SECRET_KEY?.trim() && Buffer.byteLength(env.NICEPAY_SECRET_KEY.trim()) === 32 && ['sandbox', 'production'].includes(env.NICEPAY_MODE || 'sandbox'));
}

export function createNicePayClient(env: Partial<NodeJS.ProcessEnv> = process.env, fetcher: typeof fetch = fetch): NicePayClient {
  const configured = () => nicePayReady(env);
  const config = () => {
    if (!configured()) throw new ExternalServiceError('서버의 NicePay 결제 설정이 필요합니다.', 'NICEPAY_NOT_CONFIGURED', 503, false);
    const clientKey = env.NICEPAY_CLIENT_KEY!.trim(), secretKey = env.NICEPAY_SECRET_KEY!.trim();
    return { clientKey, secretKey, origin: env.NICEPAY_MODE === 'production' ? 'https://api.nicepay.co.kr' : 'https://sandbox-api.nicepay.co.kr' };
  };
  async function request(path: string, method: 'GET' | 'POST', body?: Row): Promise<Row> {
    const { clientKey, secretKey, origin } = config();
    try {
      const response = await fetcher(origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(35_000), headers: { Authorization: `Basic ${Buffer.from(`${clientKey}:${secretKey}`).toString('base64')}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json;charset=utf-8' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const raw = await response.text(); if (raw.length > 1_000_000) throw new ExternalServiceError('NicePay 응답이 너무 큽니다.', 'NICEPAY_INVALID_RESPONSE', 502, true);
      let json: Row; try { json = JSON.parse(raw); } catch { throw new ExternalServiceError('NicePay 응답을 읽지 못했습니다.', 'NICEPAY_INVALID_RESPONSE', 502, true); }
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new ExternalServiceError('NicePay 응답 형식을 확인하지 못했습니다.', 'NICEPAY_INVALID_RESPONSE', 502, true);
      if (!response.ok) throw new ExternalServiceError(response.status >= 500 || [408, 409, 429].includes(response.status) ? 'NicePay 처리 결과를 확인할 수 없습니다. 거래 조회로 확인해 주세요.' : safeMessage(value(json, 'resultMsg', 'ResultMsg')), 'NICEPAY_REQUEST_FAILED', response.status >= 400 && response.status < 500 ? response.status : 502, response.status >= 500 || [408, 409, 429].includes(response.status));
      return json;
    } catch (error) { if (error instanceof ExternalServiceError) throw error; throw new ExternalServiceError('NicePay 처리 결과를 확인할 수 없습니다. 자동으로 다시 결제하지 않습니다.', 'NICEPAY_UNKNOWN', 502, true); }
  }
  function verify(payment: NicePayPayment, statuses: string[], resultCodes: string[], expectedOrder?: string, expectedAmount?: number) {
    const { secretKey } = config();
    if (!resultCodes.includes(payment.resultCode) || !statuses.includes(payment.status)) throw new ExternalServiceError(payment.resultMsg, 'NICEPAY_REJECTED', 422, false);
    if (expectedOrder !== undefined && payment.orderId !== expectedOrder || expectedAmount !== undefined && payment.amount !== expectedAmount) throw new ExternalServiceError('NicePay 거래 정보가 주문과 일치하지 않습니다.', 'NICEPAY_MISMATCH', 502, true);
    const expected = sha256(payment.tid + payment.amount + payment.ediDate + secretKey);
    if (!/^[a-f0-9]{64}$/i.test(payment.signature) || !same(expected.toLowerCase(), payment.signature.toLowerCase())) throw new ExternalServiceError('NicePay 응답 서명을 확인하지 못했습니다.', 'NICEPAY_SIGNATURE_INVALID', 502, true);
    return payment;
  }
  return {
    configured,
    async register(orderId, card, buyer) {
      const { secretKey } = config(), iv = Buffer.from(secretKey.slice(0, 16)), cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secretKey), iv);
      const plain = new URLSearchParams({ cardNo: card.cardNo, expYear: card.expYear, expMonth: card.expMonth, idNo: card.idNo, cardPw: card.cardPw }).toString();
      const encData = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('hex');
      const row = await request('/v1/subscribe/regist', 'POST', { encData, encMode: 'A2', orderId, buyerName: buyer.name, buyerEmail: buyer.email, buyerTel: buyer.tel });
      const result: NicePayMethod = { resultCode: required(value(row, 'resultCode', 'ResultCode'), '결과 코드', 4), resultMsg: safeMessage(value(row, 'resultMsg', 'ResultMsg')), tid: required(value(row, 'tid', 'TID'), '거래 번호', 30), orderId: required(value(row, 'orderId', 'OrderId'), '주문 번호', 64), bid: required(value(row, 'bid', 'BID'), '빌링키', 64), authDate: required(value(row, 'authDate', 'AuthDate'), '인증 시각', 64), cardCode: required(value(row, 'cardCode', 'CardCode'), '카드사 코드', 3), cardName: required(value(row, 'cardName', 'CardName'), '카드사 이름', 40) };
      if (result.resultCode !== '0000' || result.orderId !== orderId) throw new ExternalServiceError(result.resultMsg, 'NICEPAY_REJECTED', 422, false);
      return result;
    },
    async charge(bid, orderId, expectedAmount, goodsName, buyer) {
      const row = await request(`/v1/subscribe/${encodeURIComponent(bid)}/payments`, 'POST', { orderId, amount: expectedAmount, goodsName, cardQuota: '0', useShopInterest: false, buyerName: buyer.name, buyerEmail: buyer.email, buyerTel: buyer.tel });
      return verify(normalizePayment(row), ['paid'], ['0000'], orderId, expectedAmount);
    },
    async expire(bid, orderId) {
      const row = await request(`/v1/subscribe/${encodeURIComponent(bid)}/expire`, 'POST', { orderId });
      if (value(row, 'resultCode', 'ResultCode') !== '0000' || value(row, 'orderId', 'OrderId') !== orderId || value(row, 'bid', 'BID') !== bid) throw new ExternalServiceError(safeMessage(value(row, 'resultMsg', 'ResultMsg')), 'NICEPAY_REJECTED', 422, false);
      return row;
    },
    async cancel(tid, orderId, expectedAmount, reason) {
      const row = await request(`/v1/payments/${encodeURIComponent(tid)}/cancel`, 'POST', { orderId, amount: expectedAmount, reason });
      return verify(normalizePayment(row), ['cancelled', 'partialCancelled'], ['2001', '2211', '0000'], orderId, expectedAmount);
    },
    async find(orderId) { return verify(normalizePayment(await request(`/v1/payments/find/${encodeURIComponent(orderId)}`, 'GET')), ['paid', 'ready', 'failed', 'cancelled', 'partialCancelled', 'expired'], ['0000'], orderId); },
    verifyWebhook(payload) { return verify(normalizePayment(payload), ['paid', 'ready', 'failed', 'cancelled', 'partialCancelled', 'expired'], ['0000', '2001', '2211']); },
  };
}
