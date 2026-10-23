import crypto from 'node:crypto';
import type { Row } from './database.ts';
import { PhoneVerificationError } from './sms.ts';

export const DELETION_GRACE_MS = 30 * 86400000;
export type DeletionCollection = 'account_deletions' | 'account_deletion_requests' | 'account_restore_attempts';
type Tables = Map<string, Row[]>;
type Records = Record<string, Row[]>;
const rows = (tables: Tables, name: string) => tables.get(name) || [];
export const deletionError = (message: string, code = 'DELETION_CONFLICT', status = 409) => new PhoneVerificationError(message, code, status);
export function deletionState(records: Records, actor: string) { return records.account_deletions?.find(row => row.user_id === actor); }
export function accountActive(tables: Tables, records: Records, actor: string) {
  return rows(tables, 'profiles').some(row => row.id === actor) && deletionState(records, actor)?.status !== 'pending';
}
export function deletionView(tables: Tables, records: Records, actor: string) {
  const profile = rows(tables, 'profiles').find(row => row.id === actor);
  if (!profile) throw deletionError('계정을 찾을 수 없습니다.', 'ACCOUNT_NOT_FOUND', 401);
  const state = deletionState(records, actor);
  const owned = rows(tables, 'workspaces').filter(row => row.owner_id === actor).map(row => ({ id: String(row.id), name: String(row.name), members: rows(tables, 'workspace_members').filter(member => member.workspace_id === row.id && member.user_id !== actor).map(member => String(member.id)).sort() })).sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(owned.map(row => row.id));
  // A remote result must be reconciled before deleting its local evidence/credentials.
  const unresolved = ['translation_runs', 'export_publications'].flatMap(table => rows(tables, table).filter(row => (ids.has(String(row.workspace_id)) || row.created_by === actor) && ['running', 'sending', 'unknown'].includes(String(row.status))).map(row => ({ table, id: row.id })));
  const balances: Record<string, number> = {};
  for (const row of records.referral_rewards || []) if (row.owner_id === actor) balances[String(row.currency)] = (balances[String(row.currency)] || 0) + (row.kind === 'earned' ? 1 : -1) * Number(row.amount || 0);
  const unsettledRewards = Object.values(balances).some(value => value > 0);
  const scope = crypto.createHash('sha256').update(JSON.stringify({ owned, unresolved, balances })).digest('hex');
  return { email: String(profile.email), revision: Number(state?.revision || 0), status: state?.status === 'pending' ? 'pending' as const : 'active' as const, requested_at: state?.requested_at ? Number(state.requested_at) : null, delete_after: state?.delete_after ? Number(state.delete_after) : null, scope, owned_workspaces: owned.map(row => ({ id: row.id, name: row.name, other_members: row.members.length })), unresolved_operations: unresolved.length, unsettled_rewards: unsettledRewards };
}
export function scheduleDeletion(tables: Tables, records: Records, actor: string, input: Row, now: number) {
  const view = deletionView(tables, records, actor);
  if (view.status !== 'active' || input.expected_revision !== view.revision || input.expected_scope !== view.scope) throw deletionError('계정 또는 워크스페이스가 변경되었습니다. 목록을 새로고침해 주세요.');
  if (input.confirm_email !== view.email || input.confirm_text !== '계정 탈퇴' || input.acknowledged !== true) throw deletionError('이메일, 확인 문구와 삭제 안내 동의를 확인해 주세요.', 'INVALID_CONFIRMATION', 400);
  if (view.owned_workspaces.some(row => row.other_members)) throw deletionError('다른 멤버가 있는 소유 워크스페이스의 멤버를 먼저 정리해 주세요.', 'SHARED_WORKSPACE');
  if (view.unsettled_rewards) throw deletionError('미정산 추천 보상을 먼저 정리해 주세요.', 'UNSETTLED_REWARDS');
  if (view.unresolved_operations) throw deletionError('진행 중이거나 결과가 불명확한 번역·게시 작업을 먼저 확인해 주세요.', 'UNRESOLVED_OPERATION');
  if (typeof input.request_id !== 'string' || !/^[\w-]{16,100}$/.test(input.request_id)) throw deletionError('요청 키를 확인해 주세요.', 'INVALID_REQUEST', 400);
  if (records.account_deletion_requests?.some(row => row.user_id === actor && row.request_id === input.request_id)) throw deletionError('이미 처리한 탈퇴 요청입니다. 새로고침 후 다시 요청해 주세요.');
  const ids = new Set(view.owned_workspaces.map(row => row.id)), stamp = new Date(now).toISOString();
  for (const [table, field, cursor] of [['geo_prompt_sets', 'schedule_enabled', 'next_run_at'], ['monitor_rules', 'enabled', 'next_evaluation_at'], ['report_preferences', 'enabled', 'next_run_at']]) for (const row of rows(tables, table)) if (ids.has(String(row.workspace_id))) { row[field] = false; row[cursor] = null; row.revision = Number(row.revision || 0) + 1; }
  const cancelled = new Set(['audit_work', 'site_policy_work', 'google_sync_work'].flatMap(name => (records[name] || []).filter(row => ids.has(String(row.workspace_id)) || row.actor_id === actor).map(row => row.scan_id || row.job_id)));
  for (const name of ['audit_work', 'site_policy_work', 'google_sync_work']) records[name] = (records[name] || []).filter(row => !ids.has(String(row.workspace_id)) && row.actor_id !== actor);
  for (const name of ['site_audit_scans', 'site_policy_jobs', 'google_sync_jobs']) for (const row of rows(tables, name)) if ((ids.has(String(row.workspace_id)) || cancelled.has(row.id)) && ['queued', 'running'].includes(String(row.status))) { row.status = 'cancelled'; row.completed_at = stamp; row.stop_reason = 'account_deletion'; row.revision = Number(row.revision || 0) + 1; }
  for (const row of rows(tables, 'usage_reservations')) if (ids.has(String(row.workspace_id)) && row.status === 'reserved') { row.status = 'released'; row.released_at = stamp; for (const scan of rows(tables, 'site_audit_scans')) if (scan.reservation_id === row.id) scan.quota_status = 'released'; }
  for (const row of rows(tables, 'workspace_invitations')) if (ids.has(String(row.workspace_id)) && row.status === 'pending') { row.status = 'cancelled'; row.revision = Number(row.revision || 0) + 1; }
  records.workspace_invitation_tokens = (records.workspace_invitation_tokens || []).filter(row => !ids.has(String(row.workspace_id)));
  for (const row of rows(tables, 'workspace_api_keys')) if (ids.has(String(row.workspace_id)) || row.created_by === actor) { row.revoked_at ||= stamp; row.revision = Number(row.revision || 0) + 1; }
  const googleIds = new Set(rows(tables, 'workspace_google_connections').filter(row => ids.has(String(row.workspace_id)) || row.connected_by === actor).map(row => row.id));
  records.google_resources = (records.google_resources || []).filter(row => !googleIds.has(row.connection_id));
  records.google_credentials = (records.google_credentials || []).filter(row => !googleIds.has(row.connection_id));
  records.google_oauth_states = (records.google_oauth_states || []).filter(row => row.actor_id !== actor && !ids.has(String(row.workspace_id)));
  for (const row of rows(tables, 'workspace_google_connections')) if (googleIds.has(row.id)) { row.status = 'disconnected'; row.auto_sync = false; row.next_sync_at = null; row.email = ''; row.google_subject = ''; row.resources = { sites: [], properties: [] }; row.revision = Number(row.revision || 0) + 1; }
  records.export_credentials = (records.export_credentials || []).filter(row => !ids.has(String(row.workspace_id)));
  for (const row of rows(tables, 'export_destinations')) if (ids.has(String(row.workspace_id)) && row.kind === 'wordpress') { row.has_credentials = false; row.can_publish = false; row.verification_status = 'unverified'; row.verified_revision = null; row.revision = Number(row.revision || 0) + 1; }
  for (const row of records.referral_codes || []) if (row.owner_id === actor) row.revoked_at ||= stamp;
  records.account_sessions = (records.account_sessions || []).filter(row => row.user_id !== actor);
  const state = { user_id: actor, status: 'pending', revision: view.revision + 1, requested_at: now, delete_after: now + DELETION_GRACE_MS };
  records.account_deletions = [...(records.account_deletions || []).filter(row => row.user_id !== actor), state];
  records.account_deletion_requests = [...(records.account_deletion_requests || []), { user_id: actor, request_id: input.request_id }];
  return { ok: true, delete_after: state.delete_after };
}
/** Server worker only, executed under the same writer lock as restoration. */
export function purgeDueAccounts(tables: Tables, records: Records, now: number) {
  let purged = 0;
  for (const state of [...(records.account_deletions || [])]) {
    if (state.status !== 'pending' || !Number.isFinite(state.delete_after) || Number(state.delete_after) > now) continue;
    const actor = String(state.user_id), profile = rows(tables, 'profiles').find(row => row.id === actor);
    const ids = new Set(rows(tables, 'workspaces').filter(row => row.owner_id === actor).map(row => row.id));
    const keywords = new Set(rows(tables, 'keywords').filter(row => ids.has(row.workspace_id)).map(row => row.id));
    const threads = new Set((records.feedback_threads || []).filter(row => row.owner_id === actor).map(row => row.id));
    const scrubReference = (value: unknown): unknown => {
      if (value === actor) return null;
      if (profile?.email && value === profile.email) return '';
      if (Array.isArray(value)) return value.map(scrubReference);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, scrubReference(child)]));
      return value;
    };
    const anonymize = (row: Row) => {
      const result = scrubReference(row) as Row;
      if (row.owner_id === actor && 'author_label' in row) result.author_label = '탈퇴한 사용자';
      if (row.joined_user_id === actor) { result.signup_email_masked = ''; result.email = ''; result.name = ''; }
      if (result.email === profile?.email) result.email = '';
      return result;
    };
    for (const [name, values] of tables) tables.set(name, values.filter(row => !ids.has(name === 'workspaces' ? row.id : row.workspace_id) && !(name === 'serp_snapshots' && keywords.has(row.keyword_id)) && !(name === 'profiles' && row.id === actor) && !(['workspace_members', 'dashboard_preferences'].includes(name) && row.user_id === actor)).map(anonymize));
    for (const [name, values] of Object.entries(records)) {
      records[name] = values.filter(row => {
        if (ids.has(row.workspace_id)) return false;
        if (name === 'account_restore_attempts' && profile && row.email_hash === crypto.createHash('sha256').update(String(profile.email).toLowerCase()).digest('hex')) return false;
        if (name.startsWith('account_') && (row.user_id === actor || row.actor === actor)) return false;
        if (name === 'portal_requests' && row.actor === actor) return false;
        if (name === 'feedback_threads' && threads.has(row.id) || ['feedback_replies', 'feedback_events'].includes(name) && (threads.has(row.thread_id) || row.owner_id === actor || row.actor_id === actor)) return false;
        if (name === 'referral_partners' && row.owner_id === actor || name === 'referral_invites' && row.owner_id === actor && row.status !== 'registered') return false;
        return true;
      }).map(row => { const value = anonymize(row); if (['referral_codes', 'referral_invites'].includes(name) && row.owner_id === actor) { value.name = ''; value.email = ''; value.signup_email_masked = ''; } return value; });
    }
    purged++;
  }
  // OTP records contain keyed hashes only; discard expired entries independently of the phone number.
  records.phone_verification = (records.phone_verification || []).filter(row => Number(row.tokenExpiresAt || row.expiresAt) > now);
  records.account_restore_attempts = (records.account_restore_attempts || []).filter(row => Number(row.at) > now - 900000);
  return { purged };
}
