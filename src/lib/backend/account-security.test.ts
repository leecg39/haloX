import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersistentHaloXStore } from './store.ts';
import { hashPassword, authenticatePassword } from './accounts.ts';
import { readSessionToken, createSessionToken, AuthRequiredError } from './session.ts';
import { issueSession, resolveSession, revokeSession, credentialVersion } from './account-session.ts';
import { accountProfile, readAccount, runAccountCommand, runRecoveryCommand } from './account-security.ts';
import { PhoneVerificationService } from './phone-verification.ts';
import { PhoneVerificationError } from './sms.ts';
import { assertRestWrite } from './rest-policy.ts';
import { ADMIN_USER_ID } from './database.ts';

const secret = 'account-security-isolated-test-secret-0123456789', password = 'private-account-password';
const directories: string[] = [];
afterEach(() => { directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
async function fixture() {
  process.env.HALOX_SESSION_SECRET = secret;
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-account-')); directories.push(directory);
  const filename = path.join(directory, 'state.sqlite'), store = new PersistentHaloXStore(filename), hash = await hashPassword(password);
  const user = await store.write(db => db.createAccount({ email: 'account@example.test', fullName: '계정 회원', phone: '01011112222', passwordHash: hash }));
  const outsider = await store.write(db => db.createAccount({ email: 'outsider@example.test', fullName: '다른 회원', phone: '01033334444', passwordHash: hash }));
  const session = await store.write(db => issueSession(db, user.id, 0, 'Mozilla Chrome/130 Macintosh'));
  let now = Date.now(); const deliveries: { phone: string; code: string; purpose?: string }[] = [];
  const service = new PhoneVerificationService(store, { async send(phone, code, purpose) { deliveries.push({ phone, code, purpose }); } }, secret, () => now);
  const account = (body: Record<string, unknown>) => runAccountCommand(store, service, user.id, session.id, body, 'unit-client');
  const recovery = (body: Record<string, unknown>) => runRecoveryCommand(store, service, { email: user.email, phone: '01011112222', ...body }, 'unit-client');
  async function proof() { const sent = await recovery({ action: 'send' }); assert.ok('challengeId' in sent); const verified = await recovery({ action: 'verify', challengeId: sent.challengeId, code: deliveries.at(-1)!.code }); assert.ok('verificationToken' in verified); return verified.verificationToken; }
  return { filename, store, user, outsider, session, service, deliveries, account, recovery, proof, advance(ms: number) { now += ms; } };
}
describe('durable account sessions and security', () => {
  it('requires a persisted unique session and rejects signed but unregistered or legacy tokens', async () => {
    const f = await fixture(), claims = readSessionToken(f.session.token)!;
    assert.equal((await new PersistentHaloXStore(f.filename).read(db => resolveSession(db, claims))).actor, f.user.id);
    await assert.rejects(f.store.read(db => resolveSession(db, readSessionToken(createSessionToken(f.user.id)))), AuthRequiredError);
    const body = Buffer.from(JSON.stringify({ sub: f.user.id, exp: Date.now() + 60_000 })).toString('base64url');
    const legacy = `v1.${body}.${crypto.createHmac('sha256', secret).update('v1.' + body).digest('base64url')}`;
    assert.equal(readSessionToken(legacy), null);
    const second = await f.store.write(db => issueSession(db, f.user.id, 0)); assert.notEqual(second.token, f.session.token);
    const raw = await f.store.read(db => db.getServerRecords('account_sessions')); assert.ok(!JSON.stringify(raw).includes(f.session.token));
    await assert.rejects(f.store.read(db => db.queryTable('account_sessions')), /does not exist/);
  });
  it('logout invalidates copied tokens after restart, and active sessions belong only to their owner', async () => {
    const f = await fixture(), other = await f.store.write(db => issueSession(db, f.outsider.id, 0));
    const view = await f.store.read(db => readAccount(db, f.user.id, f.session.id)); assert.equal(view.sessions.length, 1); assert.equal(view.sessions[0].current, true);
    await assert.rejects(f.account({ action: 'session-revoke', session_id: other.id }), AuthRequiredError);
    await f.store.write(db => revokeSession(db, f.user.id, f.session.id));
    await assert.rejects(new PersistentHaloXStore(f.filename).read(db => resolveSession(db, readSessionToken(f.session.token))), AuthRequiredError);
    assert.equal((await f.store.read(db => resolveSession(db, readSessionToken(other.token)))).actor, f.outsider.id);
  });
  it('limits sessions to 20, revokes others and rejects expired entries', async () => {
    const f = await fixture(); let last = f.session;
    for (let i = 0; i < 21; i++) last = await f.store.write(db => issueSession(db, f.user.id, 0, '', Date.now() + i));
    const rows = await f.store.read(db => readAccount(db, f.user.id, last.id)); assert.equal(rows.sessions.length, 20);
    await runAccountCommand(f.store, f.service, f.user.id, last.id, { action: 'sessions-revoke-others' }, 'unit');
    assert.equal((await f.store.read(db => readAccount(db, f.user.id, last.id))).sessions.length, 1);
    await f.store.write(db => db.setServerRecords('account_sessions', db.getServerRecords('account_sessions').map(row => ({ ...row, expires_at: Date.now() - 1 }))));
    await assert.rejects(f.store.read(db => resolveSession(db, readSessionToken(last.token))), AuthRequiredError);
  });
  it('updates only the actor profile, validates names and detects changes made through REST', async () => {
    const f = await fixture();
    await f.account({ action: 'profile-update', full_name: ' 변경된 이름 ', expected_revision: 0, user_id: f.outsider.id, phone_number: '01099998888' });
    assert.equal((await f.store.read(db => accountProfile(db, f.user.id))).full_name, '변경된 이름');
    assert.equal((await f.store.read(db => accountProfile(db, f.outsider.id))).full_name, '다른 회원');
    await assert.rejects(f.account({ action: 'profile-update', full_name: 'stale', expected_revision: 0 }), (error: unknown) => error instanceof PhoneVerificationError && error.status === 409);
    for (const full_name of ['', 'a'.repeat(101)]) await assert.rejects(f.account({ action: 'profile-update', full_name, expected_revision: 1 }));
    await assert.rejects(f.store.write(db => assertRestWrite(db, 'profiles', 'PATCH', f.user.id, { phone_number: '01099998888', phone_verified_at: 'forged' }, { id: `eq.${f.user.id}` })));
    await f.store.write(db => { assertRestWrite(db, 'profiles', 'PATCH', f.user.id, { full_name: 'REST 이름' }, { id: `eq.${f.user.id}` }); db.updateTable('profiles', { full_name: 'REST 이름' }, { id: `eq.${f.user.id}` }, f.user.id); });
    await assert.rejects(f.account({ action: 'profile-update', full_name: 'stale', expected_revision: 1 }));
    assert.equal((await new PersistentHaloXStore(f.filename).read(db => accountProfile(db, f.user.id))).full_name, 'REST 이름');
  });
  it('password change checks the current password, invalidates all sessions and rejects a racing old login', async () => {
    const f = await fixture(), before = await authenticatePassword(f.store, f.user.email, password);
    await assert.rejects(f.account({ action: 'password-update', current_password: 'wrong', password: 'changed-password' }), /현재 비밀번호/);
    await assert.rejects(f.account({ action: 'password-update', current_password: password, password }), /다른 비밀번호/);
    await f.account({ action: 'password-update', current_password: password, password: 'changed-password' });
    assert.equal(await authenticatePassword(f.store, f.user.email, password), null);
    const logged = await authenticatePassword(new PersistentHaloXStore(f.filename), f.user.email, 'changed-password'); assert.equal(logged?.id, f.user.id);
    await assert.rejects(f.store.read(db => resolveSession(db, readSessionToken(f.session.token))), AuthRequiredError);
    await assert.rejects(f.store.write(db => issueSession(db, f.user.id, before!.credential_version)), AuthRequiredError);
    assert.ok((await f.store.write(db => issueSession(db, f.user.id, logged!.credential_version))).token);
  });
  it('phone changes require a purpose-bound proof and current password, preserve uniqueness and revoke other sessions', async () => {
    const f = await fixture(), phone = '01055556666', other = await f.store.write(db => issueSession(db, f.user.id, 0));
    const signup = await f.service.send(phone, 'unit'), wrongScope = await f.service.verify(phone, signup.challengeId, f.deliveries.at(-1)!.code);
    await assert.rejects(f.account({ action: 'phone-update', phone, current_password: password, verificationToken: wrongScope.verificationToken }), /만료/);
    f.advance(61_000);
    const sent = await f.account({ action: 'phone-send', phone, current_password: password }); assert.ok('challengeId' in sent);
    assert.equal(f.deliveries.at(-1)?.purpose, 'phone-change');
    const verified = await f.account({ action: 'phone-verify', phone, challengeId: sent.challengeId, code: f.deliveries.at(-1)!.code }); assert.ok('verificationToken' in verified);
    await assert.rejects(f.account({ action: 'phone-update', phone, current_password: 'wrong', verificationToken: verified.verificationToken }), /비밀번호/);
    await f.account({ action: 'phone-update', phone, current_password: password, verificationToken: verified.verificationToken });
    const view = await f.store.read(db => readAccount(db, f.user.id, f.session.id)); assert.equal(view.profile.phone_number, phone); assert.ok(view.profile.phone_verified_at); assert.equal(view.sessions.length, 1);
    await assert.rejects(f.store.read(db => resolveSession(db, readSessionToken(other.token))), AuthRequiredError);
    await assert.rejects(f.account({ action: 'phone-update', phone, current_password: password, verificationToken: verified.verificationToken }));
    assert.equal((await authenticatePassword(f.store, f.user.email, password))?.id, f.user.id);
  });
  it('duplicate phone changes roll back proof consumption and profile writes', async () => {
    const f = await fixture(), phone = '01033334444';
    const sent = await f.account({ action: 'phone-send', phone, current_password: password }); assert.ok('challengeId' in sent);
    const proof = await f.account({ action: 'phone-verify', phone, challengeId: sent.challengeId, code: f.deliveries.at(-1)!.code }); assert.ok('verificationToken' in proof);
    await assert.rejects(f.account({ action: 'phone-update', phone, current_password: password, verificationToken: proof.verificationToken }), /이미 등록된/);
    assert.equal((await f.store.read(db => accountProfile(db, f.user.id))).phone_number, '01011112222');
    await f.store.write(db => db.setVerifiedAccountPhone(f.outsider.id, '01077778888'));
    await f.account({ action: 'phone-update', phone, current_password: password, verificationToken: proof.verificationToken });
    assert.equal((await f.store.read(db => accountProfile(db, f.user.id))).phone_number, phone);
  });
  it('keeps a durable budget for sensitive current-password attempts', async () => {
    const f = await fixture();
    for (let i = 0; i < 10; i++) await assert.rejects(f.account({ action: 'password-update', current_password: 'wrong', password: 'other-password' }), /현재 비밀번호/);
    await assert.rejects(runAccountCommand(new PersistentHaloXStore(f.filename), f.service, f.user.id, f.session.id, { action: 'password-update', current_password: password, password: 'other-password' }, 'unit'), (error: unknown) => error instanceof PhoneVerificationError && error.status === 429);
  });
});
describe('phone-based account recovery', () => {
  it('returns the same challenge shape without sending for unknown or mismatched identities', async () => {
    const f = await fixture();
    const missing = await f.recovery({ action: 'send', email: 'missing@example.test' }); assert.ok('challengeId' in missing); assert.equal(f.deliveries.length, 0);
    f.advance(61_000); const known = await f.recovery({ action: 'send' }); assert.ok('challengeId' in known); assert.deepEqual(Object.keys(known).sort(), Object.keys(missing).sort()); assert.equal(f.deliveries.length, 1); assert.equal(f.deliveries[0].purpose, 'password-reset');
    await assert.rejects(f.recovery({ action: 'verify', email: 'missing@example.test', challengeId: known.challengeId, code: f.deliveries[0].code }));
    await assert.rejects(f.recovery({ action: 'verify', challengeId: missing.challengeId, code: f.deliveries[0].code }));
    const raw = JSON.stringify(await f.store.read(db => db.getServerRecords('phone_verification'))); assert.ok(!raw.includes(f.user.email)); assert.ok(!raw.includes('01011112222')); assert.ok(!raw.includes(f.deliveries[0].code));
    const failure = async (email: string, action: string) => { try { await f.recovery({ action, email, code: '000000', challengeId: 'missing', verificationToken: 'invalid', password: 'reset-password' }); assert.fail('must reject'); } catch (error) { assert.ok(error instanceof PhoneVerificationError); return { message: error.message, code: error.code, status: error.status }; } };
    for (const action of ['verify', 'reset']) assert.deepEqual(await failure(f.user.email, action), await failure('missing@example.test', action));
  });
  it('consumes the verified token once with password update and session revocation in one transaction', async () => {
    const f = await fixture(), token = await f.proof();
    await assert.rejects(f.recovery({ action: 'reset', verificationToken: token, password: 'short' }));
    await f.recovery({ action: 'reset', verificationToken: token, password: 'recovered-password' });
    assert.equal(await authenticatePassword(f.store, f.user.email, password), null);
    assert.equal((await authenticatePassword(new PersistentHaloXStore(f.filename), f.user.email, 'recovered-password'))?.id, f.user.id);
    await assert.rejects(f.store.read(db => resolveSession(db, readSessionToken(f.session.token))), AuthRequiredError);
    await assert.rejects(f.recovery({ action: 'reset', verificationToken: token, password: 'second-password' }));
  });
  it('does not accept signup proofs and invalidates outstanding recovery proofs on password or phone changes', async () => {
    const f = await fixture(), sent = await f.service.send('01011112222', 'unit');
    const signup = await f.service.verify('01011112222', sent.challengeId, f.deliveries.at(-1)!.code);
    await assert.rejects(f.recovery({ action: 'reset', verificationToken: signup.verificationToken, password: 'recovered-password' }));
    f.advance(61_000); const token = await f.proof();
    await f.account({ action: 'password-update', current_password: password, password: 'current-new-password' });
    await assert.rejects(f.recovery({ action: 'reset', verificationToken: token, password: 'old-proof-password' }));
    assert.equal((await authenticatePassword(f.store, f.user.email, 'current-new-password'))?.id, f.user.id);
  });
  it('locks wrong OTP attempts and rejects expired verification tokens across restart', async () => {
    const f = await fixture(), sent = await f.recovery({ action: 'send' }); assert.ok('challengeId' in sent);
    const code = f.deliveries[0].code, wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await assert.rejects(f.recovery({ action: 'verify', challengeId: sent.challengeId, code: wrong }));
    await assert.rejects(f.recovery({ action: 'verify', challengeId: sent.challengeId, code }));
    assert.equal((await new PersistentHaloXStore(f.filename).read(db => db.getServerRecords('phone_verification')[0])).attempts, 5);
    f.advance(61_000); const token = await f.proof(); f.advance(10 * 60_000);
    await assert.rejects(f.recovery({ action: 'reset', verificationToken: token, password: 'expired-password' }));
    assert.equal((await authenticatePassword(f.store, f.user.email, password))?.id, f.user.id);
  });
  it('allows only one concurrent reset and refuses recovery after the registered phone changed', async () => {
    const f = await fixture(), token = await f.proof();
    const results = await Promise.allSettled([f.recovery({ action: 'reset', verificationToken: token, password: 'recovery-one-password' }), f.recovery({ action: 'reset', verificationToken: token, password: 'recovery-two-password' })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(await f.store.read(db => credentialVersion(db, f.user.id)), 1);
    f.advance(61_000); const second = await f.proof(); await f.store.write(db => db.setVerifiedAccountPhone(f.user.id, '01055556666'));
    await assert.rejects(f.recovery({ action: 'reset', verificationToken: second, password: 'phone-mismatch-password' }));
  });
  it('seeded accounts need a verified phone and a reset disables the environment password fallback', async () => {
    process.env.HALOX_DEMO_PASSWORD = 'seed-test-password'; const f = await fixture();
    await f.recovery({ action: 'send', email: 'admin@halox.local' }); assert.equal(f.deliveries.length, 0);
    await f.store.write(db => db.setVerifiedAccountPhone(ADMIN_USER_ID, '01077778888'));
    const sent = await f.recovery({ action: 'send', email: 'admin@halox.local', phone: '01077778888' }); assert.ok('challengeId' in sent);
    const proof = await f.recovery({ action: 'verify', email: 'admin@halox.local', phone: '01077778888', challengeId: sent.challengeId, code: f.deliveries.at(-1)!.code }); assert.ok('verificationToken' in proof);
    await f.recovery({ action: 'reset', email: 'admin@halox.local', phone: '01077778888', verificationToken: proof.verificationToken, password: 'admin-personal-password' });
    assert.equal(await authenticatePassword(f.store, 'admin@halox.local', 'seed-test-password'), null);
    assert.equal((await authenticatePassword(f.store, 'admin@halox.local', 'admin-personal-password'))?.id, ADMIN_USER_ID);
  });
});
