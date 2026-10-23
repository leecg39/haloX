import crypto from 'node:crypto';
import type { HaloXDatabase } from './database.ts';
import { AuthRequiredError, createSessionToken, SESSION_TTL_MS, type SessionClaims } from './session.ts';

export type AccountCollection = 'account_sessions' | 'account_security_attempts';
export function credentialVersion(db: HaloXDatabase, actor: string): number {
  return Number(db.getServerRecords('account_credentials').find(row => row.user_id === actor)?.version || 0);
}
export function assertActiveSession(db: HaloXDatabase, actor: string, sessionId: string, now = Date.now()) {
  const session = db.getServerRecords('account_sessions').find(row => row.id === sessionId && row.user_id === actor && Number(row.expires_at) > now);
  if (!session || !db.queryTable('profiles', {}, actor).data.length) throw new AuthRequiredError('세션이 종료되었습니다. 다시 로그인해 주세요.');
  return session;
}
export function resolveSession(db: HaloXDatabase, claims: SessionClaims | null) {
  if (!claims) throw new AuthRequiredError();
  const row = assertActiveSession(db, claims.sub, claims.sid);
  if (row.expires_at !== claims.exp || row.created_at !== claims.iat) throw new AuthRequiredError();
  return { actor: claims.sub, sessionId: claims.sid };
}
export function issueSession(db: HaloXDatabase, actor: string, expectedCredentialVersion: number, agent = '', now = Date.now()) {
  if (credentialVersion(db, actor) !== expectedCredentialVersion || !db.queryTable('profiles', {}, actor).data.length) throw new AuthRequiredError('인증 정보가 변경되었습니다. 다시 로그인해 주세요.');
  const id = crypto.randomUUID(), token = createSessionToken(actor, { now, sessionId: id });
  const rows = db.getServerRecords('account_sessions').filter(row => Number(row.expires_at) > now);
  const own = rows.filter(row => row.user_id === actor).sort((a, b) => Number(b.created_at) - Number(a.created_at));
  const removed = new Set(own.slice(19).map(row => row.id));
  db.setServerRecords('account_sessions', [...rows.filter(row => !removed.has(row.id)), { id, user_id: actor, created_at: now, expires_at: now + SESSION_TTL_MS, device: deviceLabel(agent) }]);
  return { token, id };
}
function deviceLabel(agent: string) {
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome 계열' : /Safari\//.test(agent) ? 'Safari' : 'API / 기타';
  const os = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Macintosh|Mac OS/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ');
}
export function revokeSessions(db: HaloXDatabase, actor: string, keepId?: string) {
  db.setServerRecords('account_sessions', db.getServerRecords('account_sessions').filter(row => row.user_id !== actor || row.id === keepId));
}
export function revokeSession(db: HaloXDatabase, actor: string, id: unknown) {
  const rows = db.getServerRecords('account_sessions');
  if (!rows.some(row => row.id === id && row.user_id === actor)) throw new AuthRequiredError('본인의 활성 세션만 종료할 수 있습니다.');
  db.setServerRecords('account_sessions', rows.filter(row => row.id !== id));
}
