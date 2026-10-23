import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import type { PersistentHaloXStore } from './store.ts';
import type { PhoneVerificationService } from './phone-verification.ts';
import { authenticatePassword, hashPassword } from './accounts.ts';
import { AuthRequiredError } from './session.ts';
import { assertActiveSession, credentialVersion, revokeSession, revokeSessions } from './account-session.ts';
import { normalizePhone, PhoneVerificationError } from './sms.ts';

export function accountProfile(db: HaloXDatabase, actor: string) {
  const row = db.queryTable('profiles', {}, actor).data[0];
  if (!row) throw new AuthRequiredError();
  return row;
}
function passwordValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new PhoneVerificationError('비밀번호는 8~128자로 입력해 주세요.', 'INVALID_PASSWORD');
  return value;
}
function emailValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new PhoneVerificationError('이메일 주소를 확인해 주세요.', 'INVALID_EMAIL');
  return value.trim().toLowerCase();
}
function checkVersion(db: HaloXDatabase, actor: string, version: number) {
  if (credentialVersion(db, actor) !== version) throw new AuthRequiredError('인증 정보가 변경되었습니다. 다시 로그인해 주세요.');
}
function bumpCredential(db: HaloXDatabase, actor: string, passwordHash?: string) {
  const rows = db.getServerRecords('account_credentials'), current = rows.find(row => row.user_id === actor);
  const row = { ...current, user_id: actor, version: credentialVersion(db, actor) + 1, ...(passwordHash ? { password_hash: passwordHash } : {}), updated_at: new Date().toISOString() };
  db.setServerRecords('account_credentials', [...rows.filter(row => row.user_id !== actor), row]);
}
export async function confirmPassword(store: PersistentHaloXStore, actor: string, sessionId: string, password: unknown) {
  if (typeof password !== 'string' || !password || password.length > 512) throw new PhoneVerificationError('현재 비밀번호를 입력해 주세요.', 'PASSWORD_REQUIRED');
  // Reserve before expensive password verification; failed and successful attempts share a durable budget.
  const profile = await store.write(db => {
    assertActiveSession(db, actor, sessionId);
    const now = Date.now(), rows = db.getServerRecords('account_security_attempts').filter(row => Number(row.at) > now - 15 * 60_000);
    if (rows.filter(row => row.actor === actor).length >= 10) throw new PhoneVerificationError('인증 요청이 너무 많습니다. 15분 후 다시 시도해 주세요.', 'SECURITY_RATE_LIMITED', 429, 900);
    db.setServerRecords('account_security_attempts', [...rows, { id: crypto.randomUUID(), actor, at: now }]);
    return accountProfile(db, actor);
  });
  const verified = await authenticatePassword(store, String(profile.email), password);
  if (!verified || verified.id !== actor) throw new PhoneVerificationError('현재 비밀번호가 올바르지 않습니다.', 'INVALID_PASSWORD', 403);
  return verified.credential_version;
}
export function readAccount(db: HaloXDatabase, actor: string, sessionId: string) {
  assertActiveSession(db, actor, sessionId);
  const profile = accountProfile(db, actor);
  return {
    profile: { id: profile.id, email: profile.email, full_name: profile.full_name, phone_number: profile.phone_number || '', phone_verified_at: profile.phone_verified_at || null, revision: Number(profile.revision || 0) },
    sessions: db.getServerRecords('account_sessions').filter(row => row.user_id === actor && Number(row.expires_at) > Date.now()).sort((a, b) => Number(b.created_at) - Number(a.created_at)).map(row => ({ id: row.id, device: row.device, created_at: row.created_at, expires_at: row.expires_at, current: row.id === sessionId })),
  };
}
export async function runAccountCommand(store: PersistentHaloXStore, verification: PhoneVerificationService, actor: string, sessionId: string, body: Row, client: string) {
  const action = body.action;
  if (action === 'profile-update') return store.write(db => {
    assertActiveSession(db, actor, sessionId); const profile = accountProfile(db, actor);
    if (body.expected_revision !== Number(profile.revision || 0)) throw new PhoneVerificationError('다른 화면에서 변경되었습니다. 새로고침 후 다시 저장해 주세요.', 'REVISION_CONFLICT', 409);
    if (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.trim().length > 100) throw new PhoneVerificationError('이름은 1~100자로 입력해 주세요.', 'INVALID_NAME');
    db.updateTable('profiles', { full_name: body.full_name.trim() }, { id: `eq.${actor}` }, actor); return { ok: true };
  });
  if (action === 'session-revoke' || action === 'sessions-revoke-others') return store.write(db => {
    assertActiveSession(db, actor, sessionId);
    if (action === 'session-revoke') revokeSession(db, actor, body.session_id); else revokeSessions(db, actor, sessionId);
    return { ok: true, reauthenticate: action === 'session-revoke' && body.session_id === sessionId };
  });
  if (action === 'phone-verify') {
    const version = await store.read(db => { assertActiveSession(db, actor, sessionId); return credentialVersion(db, actor); });
    return verification.verify(body.phone, body.challengeId, body.code, `phone-change:${actor}:${version}`);
  }
  if (!['phone-send', 'phone-update', 'password-update'].includes(String(action))) throw new PhoneVerificationError('요청 내용을 확인해 주세요.', 'INVALID_ACTION');
  const version = await confirmPassword(store, actor, sessionId, body.current_password);
  if (action === 'phone-send') return verification.send(body.phone, client, `phone-change:${actor}:${version}`);
  if (action === 'phone-update') return store.write(db => {
    assertActiveSession(db, actor, sessionId); checkVersion(db, actor, version);
    const phone = normalizePhone(body.phone);
    verification.consume(db, phone, body.verificationToken, `phone-change:${actor}:${version}`);
    db.setVerifiedAccountPhone(actor, phone); bumpCredential(db, actor); revokeSessions(db, actor, sessionId);
    return { ok: true };
  });
  const password = passwordValue(body.password);
  if (password === body.current_password) throw new PhoneVerificationError('현재와 다른 비밀번호를 입력해 주세요.', 'SAME_PASSWORD');
  const hash = await hashPassword(password);
  return store.write(db => {
    assertActiveSession(db, actor, sessionId); checkVersion(db, actor, version);
    bumpCredential(db, actor, hash); revokeSessions(db, actor); return { ok: true, reauthenticate: true };
  });
}

export async function runRecoveryCommand(store: PersistentHaloXStore, verification: PhoneVerificationService, body: Row, client: string) {
  if (!['send', 'verify', 'reset'].includes(String(body.action))) throw new PhoneVerificationError('요청 내용을 확인해 주세요.', 'INVALID_ACTION');
  const email = emailValue(body.email), phone = normalizePhone(body.phone);
  const identity = await store.read(db => {
    const profile = db.recoveryIdentity(email);
    return profile && profile.phone_number === phone && profile.phone_verified_at ? { id: String(profile.id), version: credentialVersion(db, String(profile.id)) } : null;
  });
  // Suppressed challenges have the same shape and budget as real ones, but can never verify.
  const context = `password-reset:${email}:${identity?.version ?? 0}`;
  if (body.action === 'send') return verification.send(phone, client, context, !!identity);
  if (body.action === 'verify') {
    const result = await verification.verify(phone, body.challengeId, body.code, context);
    if (!identity) throw new PhoneVerificationError('인증번호가 일치하지 않거나 만료되었습니다. 5회 실패한 경우 다시 발송해 주세요.', 'VERIFICATION_FAILED');
    return result;
  }
  const hash = await hashPassword(passwordValue(body.password));
  try { return await store.write(db => {
    const profile = db.recoveryIdentity(email);
    if (!identity || !profile || profile.id !== identity.id || profile.phone_number !== phone || !profile.phone_verified_at) throw new PhoneVerificationError('인증 정보가 일치하지 않거나 만료되었습니다. 다시 인증해 주세요.', 'RECOVERY_FAILED');
    checkVersion(db, identity.id, identity.version);
    verification.consume(db, phone, body.verificationToken, context);
    bumpCredential(db, identity.id, hash); revokeSessions(db, identity.id);
    return { ok: true };
  }); } catch (error) {
    // Invalid proofs must not reveal whether the email/phone pair exists.
    if (error instanceof PhoneVerificationError || error instanceof AuthRequiredError) throw new PhoneVerificationError('인증 정보가 일치하지 않거나 만료되었습니다. 다시 인증해 주세요.', 'RECOVERY_FAILED');
    throw error;
  }
}
