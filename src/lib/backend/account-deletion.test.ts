import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersistentHaloXStore } from './store.ts';
import { hashPassword, authenticatePassword } from './accounts.ts';
import { issueSession, resolveSession, credentialVersion } from './account-session.ts';
import { readSessionToken } from './session.ts';
import { requestAccountDeletion, restoreAccount, processAccountDeletionTick, startAccountDeletionWorker } from './account-deletion-service.ts';
import { DELETION_GRACE_MS } from './account-deletion-model.ts';
import { runApiKeyCommand } from './api-key-service.ts';
import { PhoneVerificationService } from './phone-verification.ts';
import { runRecoveryCommand } from './account-security.ts';
import type { Row } from './database.ts';
const password = 'deletion-test-password', secret = 'deletion-isolated-session-secret-0123456789', dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
async function fixture() {
  process.env.HALOX_SESSION_SECRET = secret;
  const dir = mkdtempSync(path.join(tmpdir(), 'halox-deletion-')); dirs.push(dir);
  const file = path.join(dir, 'runtime.sqlite'), store = new PersistentHaloXStore(file), hash = await hashPassword(password);
  const user = await store.write(db => db.createAccount({ email: 'leaving@example.test', fullName: '탈퇴 회원', phone: '01011112222', passwordHash: hash }));
  const other = await store.write(db => db.createAccount({ email: 'remaining@example.test', fullName: '남는 회원', phone: '01033334444', passwordHash: hash }));
  const workspace = await store.read(db => String(db.queryTable('workspaces', {}, user.id).data[0].id)), otherWorkspace = await store.read(db => String(db.queryTable('workspaces', {}, other.id).data[0].id));
  const session = await store.write(db => issueSession(db, user.id, 0)), now = Date.now();
  async function input() { const view = await store.read(db => db.accountDeletionView(user.id)); return { current_password: password, confirm_email: user.email, confirm_text: '계정 탈퇴', acknowledged: true, expected_revision: view.revision, expected_scope: view.scope, request_id: crypto.randomUUID() }; }
  const restore = (values: Row = {}, at = now + 1000) => restoreAccount(store, { email: user.email, password, action: 'restore', expected_revision: 1, confirm: true, ...values }, 'test-client', at);
  return { store, file, user, other, workspace, otherWorkspace, session, now, input, restore, request: async (values: Row = {}) => requestAccountDeletion(store, user.id, session.id, { ...await input(), ...values }, now) };
}
describe('account withdrawal and bounded restoration', () => {
  it('reauthenticates, requires explicit scope confirmation, rejects stale shared membership and does not partially suspend', async () => {
    const f = await fixture();
    await f.store.read(db => assert.throws(() => db.callRpc('cancel_account_deletion', {}, f.user.id), /비밀번호/));
    await assert.rejects(f.store.write(db => db.invokeEdgeFunction('rpc-cache', { rpc_name: 'cancel_account_deletion', args: {} }, f.user.id)), /계정 복원/);
    await assert.rejects(f.request({ current_password: 'wrong' }), /비밀번호/);
    await assert.rejects(f.request({ confirm_email: f.other.email }), /확인/);
    await assert.rejects(f.request({ acknowledged: false }), /확인/);
    const input = await f.input();
    await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: f.other.id, role: 'member' }, f.user.id));
    await assert.rejects(requestAccountDeletion(f.store, f.user.id, f.session.id, input, f.now), /변경/);
    await assert.rejects(f.request(), /멤버/);
    assert.equal((await f.store.read(db => db.accountDeletionView(f.user.id))).status, 'active');
    assert.ok(await authenticatePassword(f.store, f.user.email, password));
  });
  it('revokes all sessions and keys, cancels work and disables schedules durably without deleting retained data', async () => {
    const f = await fixture(), second = await f.store.write(db => issueSession(db, f.user.id, 0));
    const key = await f.store.write(db => runApiKeyCommand(db, f.user.id, { workspace_id: f.workspace, action: 'key-create', name: '발급 키', request_id: crypto.randomUUID() }));
    await f.store.write(db => {
      const state = db.exportState();
      state.tables.geo_prompt_sets.push({ id: 'schedule', workspace_id: f.workspace, schedule_enabled: true, is_active: true, next_run_at: new Date(f.now - 1).toISOString() });
      state.tables.monitor_rules.push({ id: 'monitor', workspace_id: f.workspace, enabled: true, next_evaluation_at: new Date(f.now - 1).toISOString() });
      state.tables.site_audit_scans.push({ id: 'scan', workspace_id: f.workspace, status: 'running', quota_status: 'reserved', reservation_id: 'reserved' });
      state.tables.usage_reservations.push({ id: 'reserved', workspace_id: f.workspace, status: 'reserved' });
      state.serverRecords!.audit_work = [{ scan_id: 'scan', workspace_id: f.workspace, actor_id: f.user.id, lease_until: 0, next_at: 0 }];
      state.serverRecords!.export_credentials = [{ workspace_id: f.workspace, secret: 'encrypted-private-secret' }];
      db.restoreState(state);
    });
    const result = await f.request(); assert.equal(result.delete_after, f.now + DELETION_GRACE_MS);
    const reopened = new PersistentHaloXStore(f.file);
    for (const token of [f.session.token, second.token]) await assert.rejects(reopened.read(db => resolveSession(db, readSessionToken(token))), /세션/);
    assert.equal(await authenticatePassword(reopened, f.user.email, password), null);
    await reopened.read(db => { assert.equal(db.verifyWorkspaceApiKey(String(key.secret)), null); assert.equal(db.getAllowedWorkspaceIds(f.user.id).size, 0); assert.equal(db.queryTable('profiles', {}, f.user.id).count, 0); assert.throws(() => db.insertTable('workspaces', { name: '경합 우회' }, f.user.id)); assert.equal(db.hasDueGeoSchedules(f.now), false); assert.equal(db.hasDueObservability(f.now), false); const state = db.exportState(); assert.ok(state.tables.workspaces.some(row => row.id === f.workspace)); assert.equal(state.tables.site_audit_scans.find(row => row.id === 'scan')!.status, 'cancelled'); assert.equal(state.tables.site_audit_scans.find(row => row.id === 'scan')!.quota_status, 'released'); assert.equal(db.getServerRecords('audit_work').length, 0); assert.equal(db.getServerRecords('export_credentials').length, 0); });
  });
  it('restores only before the exact deadline, keeps revoked keys inactive and prevents request replay and old login races', async () => {
    const f = await fixture(), before = await authenticatePassword(f.store, f.user.email, password), input = await f.input();
    await requestAccountDeletion(f.store, f.user.id, f.session.id, input, f.now);
    await assert.rejects(f.restore({ password: 'wrong' }), /비밀번호/);
    const inspection = await f.restore({ action: 'inspect' }); assert.ok('delete_after' in inspection);
    assert.equal((await f.store.read(db => db.accountDeletionState(f.user.id)))!.status, 'pending');
    await assert.rejects(f.restore({ expected_revision: 0 }), /다시 확인/);
    await f.restore({}, f.now + DELETION_GRACE_MS - 1);
    assert.ok(await authenticatePassword(new PersistentHaloXStore(f.file), f.user.email, password));
    await assert.rejects(f.store.write(db => issueSession(db, f.user.id, before!.credential_version)), /인증 정보/);
    const session = await f.store.write(db => issueSession(db, f.user.id, credentialVersion(db, f.user.id)));
    const fresh = await f.input(); await assert.rejects(requestAccountDeletion(f.store, f.user.id, session.id, { ...fresh, request_id: input.request_id }, f.now), /이미 처리/);
    await requestAccountDeletion(f.store, f.user.id, session.id, fresh, f.now);
    await assert.rejects(f.restore({ expected_revision: 3 }, f.now + DELETION_GRACE_MS), /기간/);
    assert.equal((await processAccountDeletionTick(f.store, f.now + DELETION_GRACE_MS)).purged, 1);
    assert.equal(await authenticatePassword(f.store, f.user.email, password, true), null);
  });
  it('atomically purges owned graphs, files and personal portal data while retaining other workspaces and anonymous reward evidence', async () => {
    const f = await fixture();
    await f.store.write(db => {
      db.insertTable('workspace_members', { workspace_id: f.otherWorkspace, user_id: f.user.id, role: 'member' }, f.other.id);
      const state = db.exportState();
      state.tables.keywords.push({ id: 'kw-to-delete', workspace_id: f.workspace, keyword: '보관 자료' });
      state.tables.serp_snapshots.push({ id: 'child-no-workspace', keyword_id: 'kw-to-delete' });
      state.tables.content_jobs.push({ id: 'shared-contribution', workspace_id: f.otherWorkspace, title: '공유 자료 유지', created_by: f.user.id });
      state.tables.workspace_invitations.push({ id: 'accepted', workspace_id: f.otherWorkspace, email: f.user.email, accepted_by: f.user.id, status: 'accepted' });
      state.serverRecords!.api_key_issue_requests = [{ workspace_id: f.otherWorkspace, actor: f.user.id, request_id: 'shared-key-receipt' }];
      state.serverRecords!.api_tool_requests = [{ workspace_id: f.otherWorkspace, result: { actor_id: f.user.id, email: f.user.email } }];
      state.serverRecords!.knowledge_files = [{ workspace_id: f.workspace, base64: 'private' }];
      state.serverRecords!.feedback_threads = [{ id: 'thread', owner_id: f.user.id, body: 'private feedback' }];
      state.serverRecords!.feedback_replies = [{ thread_id: 'thread', owner_id: f.other.id, body: 'reply' }];
      state.serverRecords!.referral_partners = [{ owner_id: f.user.id, email: f.user.email }];
      state.serverRecords!.referral_codes = [{ id: 'code', owner_id: f.user.id, code: 'code-tombstone', name: 'private' }];
      state.serverRecords!.referral_invites = [{ owner_id: f.other.id, joined_user_id: f.user.id, email: f.user.email, name: 'private', signup_email_masked: 'l***@example.test', status: 'registered' }];
      state.serverRecords!.referral_rewards = [{ owner_id: f.user.id, amount: 20, kind: 'earned', currency: 'KRW' }, { owner_id: f.user.id, amount: 20, kind: 'paid', currency: 'KRW' }];
      db.restoreState(state);
    });
    await f.request(); assert.equal((await processAccountDeletionTick(f.store, f.now + DELETION_GRACE_MS - 1)).purged, 0);
    await Promise.all([processAccountDeletionTick(f.store, f.now + DELETION_GRACE_MS), processAccountDeletionTick(new PersistentHaloXStore(f.file), f.now + DELETION_GRACE_MS)]);
    const state = await new PersistentHaloXStore(f.file).read(db => db.exportState());
    assert.ok(!state.tables.profiles.some(row => row.id === f.user.id)); assert.ok(!state.tables.workspaces.some(row => row.id === f.workspace)); assert.ok(state.tables.workspaces.some(row => row.id === f.otherWorkspace));
    assert.ok(!state.tables.workspace_members.some(row => row.user_id === f.user.id)); assert.ok(!state.tables.serp_snapshots.some(row => row.id === 'child-no-workspace'));
    assert.equal(state.tables.content_jobs.find(row => row.id === 'shared-contribution')!.created_by, null);
    assert.equal(state.serverRecords!.feedback_threads.length, 0); assert.equal(state.serverRecords!.feedback_replies.length, 0); assert.equal(state.serverRecords!.knowledge_files.length, 0);
    assert.equal(state.serverRecords!.referral_rewards.length, 2); assert.ok(state.serverRecords!.referral_rewards.every(row => row.owner_id === null));
    assert.equal(state.serverRecords!.referral_invites[0].signup_email_masked, ''); assert.equal(state.serverRecords!.referral_codes[0].code, 'code-tombstone');
    assert.ok(!JSON.stringify(state).includes(f.user.id)); assert.ok(!JSON.stringify(state).includes(f.user.email));
    assert.equal((await processAccountDeletionTick(f.store, f.now + DELETION_GRACE_MS)).purged, 0);
  });
  it('blocks unresolved external operations and unsettled balances without changing them', async () => {
    const f = await fixture();
    await f.store.write(db => { const state = db.exportState(); state.tables.export_publications.push({ id: 'remote', workspace_id: f.workspace, status: 'unknown' }); db.restoreState(state); });
    await assert.rejects(f.request(), /게시/);
    await f.store.write(db => { const state = db.exportState(); state.tables.export_publications = state.tables.export_publications.filter(row => row.id !== 'remote'); db.restoreState(state); db.setServerRecords('referral_rewards', [{ owner_id: f.user.id, amount: 1, currency: 'KRW', kind: 'earned' }]); });
    await assert.rejects(f.request(), /미정산/); assert.ok(await authenticatePassword(f.store, f.user.email, password));
  });
  it('supports phone-proven password recovery during grace without silently restoring and limits failed restore attempts across restart', async () => {
    const f = await fixture(); await f.request(); let code = '';
    const verifier = new PhoneVerificationService(f.store, { async send(_phone, value) { code = value; } }, secret);
    const recovery = (body: Row) => runRecoveryCommand(f.store, verifier, { email: f.user.email, phone: '01011112222', ...body }, 'recovery');
    const sent = await recovery({ action: 'send' }); assert.ok('challengeId' in sent);
    const proof = await recovery({ action: 'verify', challengeId: sent.challengeId, code }); assert.ok('verificationToken' in proof);
    await recovery({ action: 'reset', verificationToken: proof.verificationToken, password: 'changed-deletion-password' });
    assert.equal(await authenticatePassword(f.store, f.user.email, 'changed-deletion-password'), null);
    await f.restore({ password: 'changed-deletion-password' }); assert.ok(await authenticatePassword(f.store, f.user.email, 'changed-deletion-password'));
    for (let i = 0; i < 10; i++) await assert.rejects(restoreAccount(new PersistentHaloXStore(f.file), { email: 'unknown@example.test', password: 'wrong', action: 'inspect' }, 'limited-client'), /비밀번호/);
    await assert.rejects(restoreAccount(new PersistentHaloXStore(f.file), { email: 'unknown@example.test', password: 'wrong', action: 'inspect' }, 'limited-client'), /너무 많습니다/);
  });
  it('checks the deadline at commit after password verification, not when the request first arrived', async t => {
    const f = await fixture(); await f.request();
    const deadline = f.now + DELETION_GRACE_MS; let clock = deadline - 1;
    t.mock.method(Date, 'now', () => clock);
    const originalRead = f.store.read.bind(f.store);
    f.store.read = async operation => { const result = await originalRead(operation); clock = deadline; return result; };
    await assert.rejects(restoreAccount(f.store, { email: f.user.email, password, action: 'restore', expected_revision: 1, confirm: true }, 'deadline-test'), /기간/);
    assert.equal((await originalRead(db => db.accountDeletionState(f.user.id)))!.status, 'pending');
  });
  it('the actual background worker resumes overdue deletion after reopening the persisted database', async () => {
    const f = await fixture(); await f.request();
    await f.store.write(db => db.setServerRecords('account_deletions', db.getServerRecords('account_deletions').map(row => ({ ...row, delete_after: Date.now() - 1 }))));
    const reopened = new PersistentHaloXStore(f.file), stop = startAccountDeletionWorker(reopened, 1000);
    try { const deadline = Date.now() + 3000; while (await reopened.read(db => !!db.findProfileByEmail(f.user.email))) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 50)); } } finally { stop(); }
    assert.equal(await authenticatePassword(reopened, f.user.email, password, true), null);
  });
});
