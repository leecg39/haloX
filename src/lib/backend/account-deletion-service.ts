import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { haloxStore, type PersistentHaloXStore } from './store.ts';
import { authenticatePassword } from './accounts.ts';
import { confirmPassword } from './account-security.ts';
import { assertActiveSession, credentialVersion, revokeSessions } from './account-session.ts';
import { deletionError } from './account-deletion-model.ts';
import { AuthRequiredError } from './session.ts';

function bumpVersion(db: HaloXDatabase, actor: string) {
  const all = db.getServerRecords('account_credentials'), old = all.find(row => row.user_id === actor);
  db.setServerRecords('account_credentials', [...all.filter(row => row.user_id !== actor), { ...old, user_id: actor, version: credentialVersion(db, actor) + 1 }]);
}
export async function requestAccountDeletion(store: PersistentHaloXStore, actor: string, session: string, input: Row, now?: number) {
  const version = await confirmPassword(store, actor, session, input.current_password);
  return store.write(db => {
    assertActiveSession(db, actor, session);
    if (credentialVersion(db, actor) !== version) throw new AuthRequiredError('인증 정보가 변경되었습니다. 다시 로그인해 주세요.');
    const result = db.scheduleAccountDeletion(actor, input, now ?? Date.now());
    bumpVersion(db, actor);
    return result;
  });
}
export async function restoreAccount(store: PersistentHaloXStore, input: Row, client: string, now?: number) {
  if (!['inspect', 'restore'].includes(String(input.action)) || typeof input.email !== 'string' || input.email.length > 254 || typeof input.password !== 'string' || !input.password || input.password.length > 512) throw deletionError('이메일과 비밀번호를 확인해 주세요.', 'INVALID_REQUEST', 400);
  const email = input.email.trim().toLowerCase(), hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
  // Durable limits include successes; unknown identities incur the same password derivation.
  await store.write(db => {
    const at = now ?? Date.now();
    const attempts = db.getServerRecords('account_restore_attempts').filter(row => Number(row.at) > at - 900000);
    if (attempts.filter(row => row.email_hash === hash(email)).length >= 10 || attempts.filter(row => row.client_hash === hash(client)).length >= 100) throw deletionError('복원 인증 요청이 너무 많습니다. 15분 후 다시 시도해 주세요.', 'RESTORE_RATE_LIMITED', 429);
    db.setServerRecords('account_restore_attempts', [...attempts, { email_hash: hash(email), client_hash: hash(client), at }]);
  });
  const identity = await authenticatePassword(store, email, input.password, true);
  if (!identity) throw deletionError('이메일 또는 비밀번호가 올바르지 않습니다.', 'INVALID_CREDENTIALS', 401);
  return store.write(db => {
    if (credentialVersion(db, identity.id) !== identity.credential_version) throw new AuthRequiredError('인증 정보가 변경되었습니다. 다시 확인해 주세요.');
    const state = db.accountDeletionState(identity.id);
    if (!state || state.status !== 'pending') throw deletionError('복원 대기 중인 계정이 아닙니다. 로그인해 주세요.', 'NOT_PENDING', 409);
    const at = now ?? Date.now();
    if (Number(state.delete_after) <= at) throw deletionError('30일 복원 기간이 지났습니다. 이 계정은 복원할 수 없습니다.', 'RESTORE_EXPIRED', 410);
    if (input.action === 'inspect') return { pending: true, delete_after: Number(state.delete_after), revision: Number(state.revision) };
    if (input.expected_revision !== state.revision || input.confirm !== true) throw deletionError('계정 상태와 복원 안내를 다시 확인해 주세요.');
    db.setServerRecords('account_deletions', db.getServerRecords('account_deletions').map(row => row.user_id === identity.id ? { user_id: identity.id, status: 'active', revision: Number(row.revision) + 1, restored_at: at } : row));
    bumpVersion(db, identity.id); revokeSessions(db, identity.id);
    return { ok: true };
  });
}
export async function processAccountDeletionTick(store: PersistentHaloXStore = haloxStore, now = Date.now()) {
  if (!await store.read(db => db.getServerRecords('account_deletions').some(row => row.status === 'pending' && Number(row.delete_after) <= now))) return { purged: 0 };
  return store.write(db => db.purgeDueAccounts(now));
}
export function startAccountDeletionWorker(store: PersistentHaloXStore = haloxStore, interval = 60000) {
  let busy = false, stopped = false;
  const tick = async () => { if (busy || stopped) return; busy = true; try { await processAccountDeletionTick(store); } catch { console.error('HaloX: 계정 정리 저장소를 확인하지 못했습니다. 다음 주기에 재시도합니다.'); } finally { busy = false; } };
  const timer = setInterval(() => { void tick(); }, Math.max(1000, interval)); timer.unref(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
