import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_USER_ID as USER, OTHER_USER_ID as OTHER, ADMIN_USER_ID as ADMIN, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { readReferral, validateReferralCode, recordReferralSignup, recordReferralReward } from './referral-service.ts';
import { readFeedback } from './feedback-service.ts';
import { registerAccount, authenticatePassword } from './accounts.ts';
import { PhoneVerificationService } from './phone-verification.ts';
import type { PortalCollection } from '../api/portal.ts';
const folders: string[] = [], contact = { name: '검증 파트너', email: 'partner@example.com', phone: '01012345678', channel: 'https://example.com/channel', expected_revision: 0 }, feedback = { title: '저장 오류', body: '첫째 줄\n둘째 줄 😀 <script>text only</script>', category: 'bug' };
afterEach(() => folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true })));
function fixture() {
  const folder = mkdtempSync(path.join(tmpdir(), 'halox-portal-')); folders.push(folder); const filename = path.join(folder, 'db.sqlite'), store = new PersistentHaloXStore(filename);
  const invoke = (name: string, values: Row = {}, actor = USER) => store.write(db => db.invokeEdgeFunction(name, values, actor));
  const referral = (actor = USER) => store.read(db => readReferral(db, actor)); const read = (table: PortalCollection) => store.read(db => db.getServerRecords(table));
  const createThread = (actor = USER, key = 'thread-create') => invoke('feedback-thread-create', { ...feedback, idempotency_key: key }, actor);
  const board = (actor = USER, id?: string, view = 'mine') => store.read(db => readFeedback(db, actor, view, id));
  return { store, filename, invoke, referral, read, createThread, board };
}
describe('계정별 추천 프로그램', () => {
  it('registers private partner contacts, issues globally unique codes, revises contacts and persists across restart', async () => {
    const f = fixture(); await f.invoke('referral-partner-save', contact); const data = await f.referral(); assert.equal(data.partner?.name, contact.name); assert.match(String(data.codes[0].code), /^[A-F0-9]{18}$/); assert.equal((await f.referral(OTHER)).codes.length, 0);
    await f.invoke('referral-partner-save', { ...contact, name: '수정 상호', expected_revision: 1 }); await assert.rejects(f.invoke('referral-partner-save', contact), /변경/);
    await f.invoke('referral-partner-save', contact, OTHER); const all = await f.read('referral_codes'); assert.equal(new Set(all.map(row => row.code)).size, 2);
    const restarted = new PersistentHaloXStore(f.filename); assert.equal((await restarted.read(db => readReferral(db, USER))).partner?.name, '수정 상호');
  });
  it('rejects invalid contacts without partial codes and cannot override ownership with client fields', async () => {
    const f = fixture(); for (const bad of [{ email: 'bad' }, { phone: '123' }, { channel: 'javascript:alert(1)' }, { channel: 'https://user:pass@example.com' }, { name: ' ' }]) await assert.rejects(f.invoke('referral-partner-save', { ...contact, ...bad })); assert.equal((await f.read('referral_codes')).length, 0);
    await f.invoke('referral-partner-save', { ...contact, owner_id: OTHER }); assert.equal((await f.referral(OTHER)).partner, null);
  });
  it('deduplicates concurrent creates, prevents key reuse, enforces revisions and permanently revokes a code', async () => {
    const f = fixture(); await f.invoke('referral-partner-save', contact); const payload = { name: '방송 채널', idempotency_key: 'code-1' };
    const [a, b] = await Promise.all([f.invoke('referral-code-create', payload), new PersistentHaloXStore(f.filename).write(db => db.invokeEdgeFunction('referral-code-create', payload, USER))]); assert.equal(a.id, b.id); assert.equal((await f.referral()).codes.length, 2);
    await assert.rejects(f.invoke('referral-code-create', { ...payload, name: 'different' }), /변경/); await f.invoke('referral-code-update', { code_id: a.id, expected_revision: 1, name: '수정 이름' }); await assert.rejects(f.invoke('referral-code-revoke', { code_id: a.id, expected_revision: 1 }), /변경/);
    await f.invoke('referral-code-revoke', { code_id: a.id, expected_revision: 2 }); const code = (await f.referral()).codes.find(row => row.id === a.id)!; await assert.rejects(f.store.read(db => validateReferralCode(db, code.code, 'new@example.com')), /사용할 수 없는/); await assert.rejects(f.invoke('referral-code-update', { code_id: code.id, expected_revision: 3, name: 'reactivate' }), /폐기/);
  });
  it('supports pending invite CRUD and rejects self/duplicate/cross-owner mutations', async () => {
    const f = fixture(); await f.invoke('referral-partner-save', contact); await f.invoke('referral-partner-save', contact, OTHER); const code = (await f.referral()).codes[0];
    await assert.rejects(f.invoke('referral-invite-create', { code_id: code.id, email: 'demo@halox.local', idempotency_key: 'self' }), /본인/);
    const invite = await f.invoke('referral-invite-create', { code_id: code.id, email: 'guest@example.com', name: '방문자', idempotency_key: 'invite' });
    await assert.rejects(f.invoke('referral-invite-create', { code_id: code.id, email: 'GUEST@example.com', idempotency_key: 'duplicate' }), /이미/); await assert.rejects(f.invoke('referral-invite-update', { invite_id: invite.id, name: 'attack', expected_revision: 1 }, OTHER), /본인/);
    await f.invoke('referral-invite-update', { invite_id: invite.id, name: '새 이름', expected_revision: 1 }); await f.invoke('referral-invite-delete', { invite_id: invite.id, expected_revision: 2 }); assert.equal((await f.referral()).invites.length, 0);
    await assert.rejects(f.invoke('referral-invite-create', { code_id: code.id, email: 'guest@example.com', name: '방문자', idempotency_key: 'invite' }), /삭제한 요청/);
  });
  it('records only verified signup atomically and a bad referral does not consume the phone token', async () => {
    const f = fixture(); await f.invoke('referral-partner-save', contact); const code = (await f.referral()).codes[0]; let delivered = '';
    const service = new PhoneVerificationService(f.store, { async send(_phone, value) { delivered = value; } }, 'test-only-portal-phone-signing-secret'); const phone = '01098761234', sent = await service.send(phone, 'portal-unit'), verified = await service.verify(phone, sent.challengeId, delivered);
    const body = { email: 'new-customer@example.com', fullName: '새 가입자', phone, password: 'personal-test-password', verificationToken: verified.verificationToken };
    await assert.rejects(registerAccount(f.store, service, { ...body, referralCode: 'AAAAAAAAAAAAAAAAAA' }), /사용할 수 없는/); assert.equal(await f.store.read(db => db.findProfileByEmail(body.email)), null);
    const account = await registerAccount(f.store, service, { ...body, referralCode: code.code }); const data = await f.referral(); assert.equal(data.invites.length, 1); assert.equal(data.invites[0].status, 'registered'); assert.equal(data.invites[0].signup_email_masked, 'n***@example.com'); assert.equal(Object.hasOwn(data.invites[0], 'joined_user_id'), false); assert.equal(data.invites[0].email, ''); assert.equal(data.rewards.length, 0);
    assert.equal((await authenticatePassword(new PersistentHaloXStore(f.filename), body.email, body.password))?.id, account.id); await assert.rejects(f.store.write(db => recordReferralSignup(db, code, account)), /이미/); await assert.rejects(registerAccount(f.store, service, { ...body, referralCode: code.code }), /만료/);
  });
  it('matches a pending email to the actual signup code and rejects self-attribution', async () => {
    const f = fixture(); await f.invoke('referral-partner-save', contact); const code = (await f.referral()).codes[0]; await f.invoke('referral-invite-create', { code_id: code.id, email: 'guest@example.com', idempotency_key: 'invite' });
    await assert.rejects(f.store.read(db => validateReferralCode(db, code.code, 'DEMO@halox.local')), /本인|본인/); await assert.rejects(f.store.write(db => recordReferralSignup(db, code, { id: USER, email: 'elsewhere@example.com' })), /본인/);
    await f.store.write(db => recordReferralSignup(db, code, { id: OTHER, email: 'guest@example.com' })); const invite = (await f.referral()).invites[0]; assert.equal(invite.status, 'registered'); assert.equal((await f.referral()).invites.length, 1); await assert.rejects(f.invoke('referral-invite-delete', { invite_id: invite.id, expected_revision: invite.revision }), /확정/);
  });
  it('settlement ledger is server-only, idempotent and cannot overpay/reverse or cross-reference another invite', async () => {
    const f = fixture(); await f.invoke('referral-partner-save', contact); const code = (await f.referral()).codes[0]; await f.store.write(db => recordReferralSignup(db, code, { id: OTHER, email: 'guest@example.com' })); const invite = (await f.referral()).invites[0];
    const fields = { event_id: 'payment-verified-1', invite_id: invite.id, kind: 'earned' as const, amount: 10000, currency: 'KRW' }; const earned = await f.store.write(db => recordReferralReward(db, fields)); assert.equal((await f.store.write(db => recordReferralReward(db, fields))).id, earned.id);
    await assert.rejects(f.store.write(db => recordReferralReward(db, { ...fields, amount: 999 })), /일치/); await f.store.write(db => recordReferralReward(db, { ...fields, event_id: 'paid-1', kind: 'paid', reference_id: String(earned.id), amount: 4000 })); await f.store.write(db => recordReferralReward(db, { ...fields, event_id: 'reverse-1', kind: 'reversed', reference_id: String(earned.id), amount: 2000 }));
    await assert.rejects(f.store.write(db => recordReferralReward(db, { ...fields, event_id: 'overpayment', kind: 'paid', reference_id: String(earned.id), amount: 5000 })), /잔액/); await assert.rejects(f.invoke('referral-reward-create', fields)); assert.deepEqual((await f.referral()).totals.KRW, { earned: 10000, reversed: 2000, paid: 4000 }); assert.equal((await f.referral(OTHER)).rewards.length, 0);
  });
  it('withdrawal erases contact/pending invitations, revokes links and preserves registered/reward evidence', async () => {
    const f = fixture(); await f.invoke('referral-partner-save', contact); const code = (await f.referral()).codes[0]; await f.invoke('referral-invite-create', { code_id: code.id, email: 'pending@example.com', idempotency_key: 'pending' }); await f.store.write(db => recordReferralSignup(db, code, { id: OTHER, email: 'joined@example.com' }));
    await f.invoke('referral-partner-delete', { expected_revision: 1 }); const data = await f.referral(); assert.equal(data.partner, null); assert.ok(data.codes.every(row => row.revoked_at)); assert.equal(data.invites.length, 1); await assert.rejects(f.store.read(db => validateReferralCode(db, code.code, 'third@example.com')), /사용할 수 없는/); await f.invoke('referral-partner-save', contact); assert.equal((await f.referral()).codes.filter(row => !row.revoked_at).length, 1);
  });
});
describe('작성자 비공개 피드백과 서비스 운영자', () => {
  it('creates, revises and persists feedback with a workspace context snapshot', async () => {
    const f = fixture(); const ws = await f.store.write(db => db.insertTable('workspaces', { name: '작성 맥락' }, USER)[0]); const created = await f.invoke('feedback-thread-create', { ...feedback, workspace_id: ws.id, idempotency_key: 'thread' }); const board = await f.board(USER, String(created.id)); assert.equal(board.thread?.body, feedback.body); assert.equal(board.thread?.workspace_name, '작성 맥락');
    await f.invoke('feedback-thread-update', { ...feedback, title: '수정 제목', thread_id: created.id, expected_revision: 1 }); await f.store.write(db => db.deleteTable('workspaces', { id: `eq.${ws.id}` }, USER)); const restarted = new PersistentHaloXStore(f.filename); assert.equal((await restarted.read(db => readFeedback(db, USER, 'mine', String(created.id)))).thread?.title, '수정 제목');
  });
  it('hides other authors even from workspace owners and exposes the support queue only to the service operator', async () => {
    const f = fixture(); const thread = await f.createThread(); await f.createThread(OTHER); assert.equal((await f.board(USER)).threads.length, 1); assert.equal((await f.board(ADMIN, undefined, 'support')).threads.length, 2);
    for (const fn of [() => f.board(OTHER, String(thread.id)), () => f.board(USER, undefined, 'support'), () => f.invoke('feedback-thread-update', { ...feedback, thread_id: thread.id, expected_revision: 1 }, OTHER), () => f.invoke('feedback-thread-update', { ...feedback, thread_id: thread.id, expected_revision: 1 }, ADMIN)]) await assert.rejects(fn(), /권한|작성자|본인/);
    await assert.rejects(f.invoke('feedback-thread-create', { ...feedback, workspace_id: 'foreign', idempotency_key: 'bad' }), /authorized/);
  });
  it('supports operator status transitions with reasons and prevents author status forgery and stale writes', async () => {
    const f = fixture(), thread = await f.createThread(); await assert.rejects(f.invoke('feedback-status-update', { thread_id: thread.id, expected_revision: 1, status: 'completed', note: 'fake' }), /운영자/);
    await f.invoke('feedback-thread-update', { ...feedback, thread_id: thread.id, expected_revision: 1, status: 'completed', owner_id: OTHER }); assert.equal((await f.board(USER, String(thread.id))).thread?.status, 'open');
    await f.invoke('feedback-status-update', { thread_id: thread.id, expected_revision: 2, status: 'reviewing', note: '재현 확인 중' }, ADMIN); const view = await f.board(USER, String(thread.id)); assert.equal(view.events[0].note, '재현 확인 중'); assert.equal(view.thread?.status, 'reviewing'); await assert.rejects(f.invoke('feedback-thread-update', { ...feedback, thread_id: thread.id, expected_revision: 2 }), /변경/);
  });
  it('supports author/operator reply CRUD while rejecting cross-thread IDs and editing another author', async () => {
    const f = fixture(), thread = await f.createThread(), other = await f.createThread(USER, 'another');
    const reply = await f.invoke('feedback-reply-create', { thread_id: thread.id, body: '추가 재현 내용', idempotency_key: 'reply' }); const response = await f.invoke('feedback-reply-create', { thread_id: thread.id, body: '확인했습니다', idempotency_key: 'support-reply' }, ADMIN);
    await assert.rejects(f.invoke('feedback-reply-update', { thread_id: other.id, reply_id: reply.id, expected_revision: 1, body: 'cross' }), /속한 답변/); await assert.rejects(f.invoke('feedback-reply-update', { thread_id: thread.id, reply_id: reply.id, expected_revision: 1, body: 'rewrite' }, ADMIN), /본인/);
    await f.invoke('feedback-reply-update', { thread_id: thread.id, reply_id: reply.id, expected_revision: 1, body: '수정 추가 내용' }); await assert.rejects(f.invoke('feedback-reply-delete', { thread_id: thread.id, reply_id: response.id, expected_revision: 1 }), /본인/); await f.invoke('feedback-reply-delete', { thread_id: thread.id, reply_id: reply.id, expected_revision: 2 }, ADMIN); assert.equal((await f.board(USER, String(thread.id))).replies.length, 1);
  });
  it('deduplicates creates across concurrent transactions and after restart without resurrecting deleted threads', async () => {
    const f = fixture(); const [a, b] = await Promise.all([f.createThread(), f.createThread()]); assert.equal(a.id, b.id); assert.equal((await f.board()).threads.length, 1); await assert.rejects(f.invoke('feedback-thread-create', { ...feedback, title: 'different', idempotency_key: 'thread-create' }), /변경/);
    await f.invoke('feedback-reply-create', { thread_id: a.id, body: '보충 내용', idempotency_key: 'reply' }); const thread = (await f.board(USER, String(a.id))).thread!; await f.invoke('feedback-thread-delete', { thread_id: a.id, expected_revision: thread.revision }); assert.equal((await f.read('feedback_replies')).length, 0); assert.equal((await f.read('feedback_events')).length, 0); await assert.rejects(f.createThread(), /삭제한 요청/);
  });
  it('validates bodies/categories, bounds record counts and prevents direct REST access to private models', async () => {
    const f = fixture(); for (const bad of [{ title: '' }, { category: 'invalid' }, { body: 'x'.repeat(20001) }]) await assert.rejects(f.invoke('feedback-thread-create', { ...feedback, ...bad, idempotency_key: 'invalid' })); assert.equal((await f.board()).threads.length, 0);
    for (const table of ['referral_partners', 'referral_codes', 'referral_invites', 'referral_rewards', 'feedback_threads', 'feedback_replies', 'feedback_events', 'portal_requests']) await assert.rejects(f.store.read(db => db.queryTable(table, {}, USER)), /does not exist/);
    await f.store.write(db => db.setServerRecords('feedback_threads', Array.from({ length: 100 }, (_, i) => ({ id: String(i), owner_id: USER })))); await assert.rejects(f.createThread(), /100개/);
  });
});
