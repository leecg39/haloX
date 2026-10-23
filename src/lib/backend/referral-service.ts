import crypto from 'node:crypto';
import { RlsAccessDeniedError, type HaloXDatabase, type Row } from './database.ts';
import { contentText } from './content-model.ts';
import { observationRevision } from './monitor-service.ts';
import { normalizePhone } from './sms.ts';
import { portalActor, portalRows, portalInsert, portalUpdate, portalFind, portalOwn, portalDelete, portalEmail, portalRequest, portalTime } from './portal-model.ts';
import type { ReferralData } from '../api/portal.ts';
export const REFERRAL_COMMANDS = ['referral-partner-save', 'referral-partner-delete', 'referral-code-create', 'referral-code-update', 'referral-code-revoke', 'referral-invite-create', 'referral-invite-update', 'referral-invite-delete'];
function partnerFields(payload: Row) {
  const channel = contentText(payload.channel, '소개 채널', 2000); if (channel) { let url: URL; try { url = new URL(channel); } catch { throw new Error('소개 채널은 HTTP(S) URL로 입력해 주세요.'); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('소개 채널은 인증정보 없는 HTTP(S) URL로 입력해 주세요.'); }
  return { name: contentText(payload.name, '이름 / 상호', 100, true), email: portalEmail(payload.email), phone: normalizePhone(payload.phone), channel };
}
function createCode(db: HaloXDatabase, actor: string, name: string, now: number) {
  const all = portalRows(db, 'referral_codes'); if (all.filter(row => row.owner_id === actor && !row.revoked_at).length >= 20) throw new Error('활성 추천 코드는 최대 20개입니다.');
  let code = ''; do { code = crypto.randomBytes(9).toString('hex').toUpperCase(); } while (all.some(row => row.code === code));
  return portalInsert(db, 'referral_codes', { owner_id: actor, name, code, revoked_at: null }, now);
}
export function readReferral(db: HaloXDatabase, actor: string): ReferralData {
  portalActor(db, actor); const own = (table: 'referral_partners' | 'referral_codes' | 'referral_invites' | 'referral_rewards') => portalRows(db, table).filter(row => row.owner_id === actor).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const rewards = own('referral_rewards'), totals: ReferralData['totals'] = {};
  for (const row of rewards) { const currency = String(row.currency); const total = totals[currency] ||= { earned: 0, reversed: 0, paid: 0 }; if (row.kind === 'earned') total.earned += Number(row.amount); if (row.kind === 'reversed') total.reversed += Number(row.amount); if (row.kind === 'paid') total.paid += Number(row.amount); }
  // Signup participants' full identities never appear in the referrer's response.
  const invites = own('referral_invites').map(({ joined_user_id: _id, ...row }) => row);
  return { partner: own('referral_partners')[0] || null, codes: own('referral_codes'), invites, rewards: rewards.map(({ event_id: _event, ...row }) => row), totals, settlement_available: false } as ReferralData;
}
export function runReferralCommand(db: HaloXDatabase, command: string, payload: Row, actor: string, now = Date.now()): Row {
  const profile = portalActor(db, actor), partner = portalRows(db, 'referral_partners').find(row => row.owner_id === actor);
  if (command === 'referral-partner-save') {
    observationRevision(partner, payload.expected_revision); const values = partnerFields(payload);
    if (!partner) { const saved = portalInsert(db, 'referral_partners', { ...values, owner_id: actor }, now); createCode(db, actor, '기본 추천 링크', now); return { ok: true, id: saved.id }; }
    return { ok: true, id: portalUpdate(db, 'referral_partners', partner, values, now).id };
  }
  if (command === 'referral-partner-delete') {
    if (!partner) throw new Error('파트너 등록 정보가 없습니다.'); observationRevision(partner, payload.expected_revision); portalDelete(db, 'referral_partners', partner.id);
    for (const row of portalRows(db, 'referral_codes').filter(row => row.owner_id === actor && !row.revoked_at)) portalUpdate(db, 'referral_codes', row, { revoked_at: portalTime(now) }, now);
    db.setServerRecords('referral_invites', portalRows(db, 'referral_invites').filter(row => row.owner_id !== actor || row.status === 'registered').map(row => row.owner_id === actor ? { ...row, email: '', name: '' } : row)); return { ok: true };
  }
  if (!partner) throw new Error('파트너 연락처를 먼저 등록해 주세요.');
  if (command === 'referral-code-create') return portalRequest(db, actor, command, payload, 'referral_codes', () => createCode(db, actor, contentText(payload.name, '코드 이름', 100, true), now));
  if (command.startsWith('referral-code-')) {
    const code = portalFind(db, 'referral_codes', payload.code_id); portalOwn(code, actor); observationRevision(code, payload.expected_revision);
    if (code.revoked_at) throw new Error('폐기한 코드는 변경하거나 다시 활성화할 수 없습니다.');
    portalUpdate(db, 'referral_codes', code, command === 'referral-code-revoke' ? { revoked_at: portalTime(now) } : { name: contentText(payload.name, '코드 이름', 100, true) }, now); return { ok: true };
  }
  if (command === 'referral-invite-create') return portalRequest(db, actor, command, payload, 'referral_invites', () => {
    const code = portalFind(db, 'referral_codes', payload.code_id); portalOwn(code, actor); if (code.revoked_at) throw new Error('활성 추천 코드를 선택해 주세요.');
    const email = portalEmail(payload.email), all = portalRows(db, 'referral_invites'); if (email === String(profile.email).toLowerCase()) throw new Error('본인에게 추천할 수 없습니다.');
    if (all.some(row => row.owner_id === actor && row.email === email)) throw new Error('이미 기록된 초대 이메일입니다.'); if (all.filter(row => row.owner_id === actor && row.status === 'pending').length >= 200) throw new Error('가입 전 초대는 최대 200개입니다.');
    return portalInsert(db, 'referral_invites', { owner_id: actor, code_id: code.id, code: code.code, email, name: contentText(payload.name, '초대 이름', 100), status: 'pending', joined_user_id: null, registered_at: null, signup_email_masked: '' }, now);
  });
  const invite = portalFind(db, 'referral_invites', payload.invite_id); portalOwn(invite, actor); observationRevision(invite, payload.expected_revision);
  if (invite.status !== 'pending') throw new Error('가입으로 확정된 추천 내역은 수정·삭제할 수 없습니다.');
  if (command === 'referral-invite-delete') { portalDelete(db, 'referral_invites', invite.id); return { ok: true }; }
  portalUpdate(db, 'referral_invites', invite, { name: contentText(payload.name, '초대 이름', 100) }, now); return { ok: true };
}
export function validateReferralCode(db: HaloXDatabase, value: unknown, email: string) {
  if (value === undefined || value === '') return null;
  const code = contentText(value, '추천 코드', 18, true).toUpperCase(); if (!/^[A-F0-9]{18}$/.test(code)) throw new Error('추천 코드 형식을 확인하거나 입력값을 지워 주세요.');
  const row = portalRows(db, 'referral_codes').find(row => row.code === code && !row.revoked_at), partner = row && portalRows(db, 'referral_partners').find(partner => partner.owner_id === row.owner_id);
  if (!row || !partner) throw new Error('사용할 수 없는 추천 코드입니다. 코드를 확인하거나 입력값을 지워 주세요.');
  const owner = db.queryTable('profiles', {}, String(row.owner_id)).data[0]; if (String(owner?.email).toLowerCase() === email.toLowerCase()) throw new Error('본인 계정의 추천 코드는 사용할 수 없습니다.'); return row;
}
/** Only called inside account creation's transaction, after phone verification. */
export function recordReferralSignup(db: HaloXDatabase, code: Row | null, account: { id: string; email: string }, now = Date.now()) {
  if (!code) return; if (code.owner_id === account.id) throw new Error('본인 계정을 추천할 수 없습니다.');
  if (portalRows(db, 'referral_invites').some(row => row.joined_user_id === account.id)) throw new Error('이미 추천 가입이 기록된 계정입니다.');
  const email = account.email.toLowerCase(), invite = portalRows(db, 'referral_invites').find(row => row.owner_id === code.owner_id && row.email === email && row.status === 'pending');
  const [local, host] = email.split('@'), values = { owner_id: code.owner_id, code_id: code.id, code: code.code, status: 'registered', joined_user_id: account.id, registered_at: portalTime(now), signup_email_masked: `${local.slice(0, 1)}***@${host}` };
  if (invite) portalUpdate(db, 'referral_invites', invite, values, now); else portalInsert(db, 'referral_invites', { ...values, name: '', email: '' }, now);
}
/** Trusted settlement adapter only; deliberately absent from public command dispatch. */
export function recordReferralReward(db: HaloXDatabase, input: { event_id: string; invite_id: string; kind: 'earned' | 'reversed' | 'paid'; amount: number; currency: string; reference_id?: string }, now = Date.now()) {
  const event = contentText(input.event_id, '정산 이벤트', 200, true), existing = portalRows(db, 'referral_rewards').find(row => row.event_id === event);
  if (existing) { if (['invite_id', 'kind', 'amount', 'currency', 'reference_id'].some(key => (existing[key] ?? '') !== (input[key as keyof typeof input] ?? ''))) throw new Error('정산 이벤트 내용이 일치하지 않습니다.'); return existing; }
  const invite = portalFind(db, 'referral_invites', input.invite_id); if (invite.status !== 'registered' || !Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1e12 || !/^[A-Z]{3}$/.test(input.currency) || !['earned', 'reversed', 'paid'].includes(input.kind)) throw new Error('정산 내역을 확인해 주세요.');
  if (input.kind !== 'earned') {
    const earned = portalFind(db, 'referral_rewards', input.reference_id); if (earned.kind !== 'earned' || earned.invite_id !== invite.id || earned.currency !== input.currency) throw new Error('같은 추천의 적립 원장을 참조해 주세요.');
    const used = portalRows(db, 'referral_rewards').filter(row => row.reference_id === earned.id).reduce((sum, row) => sum + Number(row.amount), 0); if (used + input.amount > Number(earned.amount)) throw new Error('적립 잔액보다 큰 취소/지급은 처리할 수 없습니다.');
  } else if (input.reference_id) throw new Error('적립 이벤트에는 취소/지급 참조를 지정할 수 없습니다.');
  return portalInsert(db, 'referral_rewards', { ...input, event_id: event, owner_id: invite.owner_id, code: invite.code, reference_id: input.reference_id || null }, now);
}
