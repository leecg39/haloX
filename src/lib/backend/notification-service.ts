import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import type { PersistentHaloXStore } from './store.ts';
import { ContentConflictError } from './content-model.ts';
import { createNotificationProvider, type NotificationProvider } from './notification-provider.ts';
import { cancelNotificationQueue, notificationAccess, notificationEmailVerified, notificationPreferences, notificationProfile, notificationSubscribed, notificationWhere, pruneNotifications } from './notification-model.ts';
import { NOTIFICATION_EVENTS, type NotificationEvent, type NotificationsView } from '../api/notifications.ts';
import { PhoneVerificationError } from './sms.ts';
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
function revision(row: Row | undefined, expected: unknown) { if (!Number.isSafeInteger(expected) || Number(row?.revision || 0) !== expected) throw new ContentConflictError(); }
const mask = (value: string, email = false) => email ? value.replace(/^(.).*?(@.*)$/, '$1***$2') : value.replace(/^(\d{3})\d+(\d{4})$/, '$1-****-$2');
export function notificationsView(db: HaloXDatabase, workspace: string, actor: string, provider = createNotificationProvider()): NotificationsView {
  db.assertWorkspaceAccess(workspace, actor, 'other');
  const profile = notificationProfile(db, actor), allowed = notificationAccess(db, workspace, actor), mine = notificationWhere(workspace, actor);
  const inbox = db.getServerRecords('notification_inbox').filter(row => mine(row) && !row.deleted && notificationAccess(db, workspace, actor, row)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const deliveries = db.getServerRecords('notification_deliveries').filter(row => mine(row) && !row.deleted && notificationAccess(db, workspace, actor, row)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(({ target: _target, lease: _lease, ...row }) => row);
  const rules = allowed ? db.queryTable('monitor_rules', { filters: { workspace_id: `eq.${workspace}` } }, actor).data.filter(row => notificationAccess(db, workspace, actor, row)).map(row => ({ id: row.id, name: row.name })) : [];
  return { preferences: notificationPreferences(db, workspace, actor), inbox, deliveries, rules, unread: inbox.filter(row => !row.is_read).length, configured: { email: provider.configured('email'), sms: provider.configured('sms') }, contact: { email: mask(String(profile?.email || ''), true), email_verified: notificationEmailVerified(db, actor, profile?.email), phone: mask(String(profile?.phone_number || '')), phone_verified: !!profile?.phone_verified_at }, can_monitor: allowed } as unknown as NotificationsView;
}
export async function notificationCommand(store: PersistentHaloXStore, actor: string, input: Row, provider = createNotificationProvider(), now = Date.now()) {
  const workspace = String(input.workspace_id || ''), action = String(input.action);
  if (action === 'email-send') return sendVerification(store, workspace, actor, provider, now);
  const result = await store.write(db => {
    db.assertWorkspaceAccess(workspace, actor, 'other'); pruneNotifications(db, now);
    const mine = notificationWhere(workspace, actor);
    if (action === 'email-confirm') {
      const checks = db.getServerRecords('notification_email_checks'), check = checks.find(row => row.user_id === actor), profile = notificationProfile(db, actor);
      if (!profile || !check || check.email !== profile.email || Number(check.expires_at) <= now || Number(check.attempts) >= 5) throw new Error('인증번호를 새로 요청해 주세요.');
      check.attempts = Number(check.attempts) + 1;
      if (typeof input.code !== 'string' || !/^\d{8}$/.test(input.code) || check.hash !== hash(`${check.id}:${input.code}`)) { db.setServerRecords('notification_email_checks', checks); return { verification_error: true }; }
      db.setServerRecords('notification_email_verified', [...db.getServerRecords('notification_email_verified').filter(row => row.user_id !== actor), { user_id: actor, email: profile.email, verified_at: now }]);
      db.setServerRecords('notification_email_checks', checks.filter(row => row.user_id !== actor));
    } else if (action === 'preferences-save' || action === 'preferences-delete') {
      const all = db.getServerRecords('notification_preferences'), previous = all.find(mine); revision(previous, input.expected_revision);
      const deleting = action === 'preferences-delete';
      if (!deleting) {
        if (['inbox', 'email', 'sms'].some(key => typeof input[key] !== 'boolean') || !Array.isArray(input.events) || input.events.length > 4 || new Set(input.events).size !== input.events.length || input.events.some(value => !Object.hasOwn(NOTIFICATION_EVENTS, String(value))) || !Array.isArray(input.rule_ids) || input.rule_ids.length > 100 || new Set(input.rule_ids).size !== input.rule_ids.length) throw new Error('알림 채널·유형·규칙 선택을 확인해 주세요.');
        if (input.inbox || input.email || input.sms) {
          if (!notificationAccess(db, workspace, actor)) throw new Error('알림을 받으려면 모니터링 메뉴 접근 권한이 필요합니다.');
          if (!input.events.length) throw new Error('수신할 알림 유형을 선택해 주세요.');
        }
        const rules = notificationsView(db, workspace, actor, provider).rules;
        if (input.rule_ids.some(id => !rules.some(row => row.id === id))) throw new Error('현재 접근할 수 있는 감시 규칙을 선택해 주세요.');
        const profile = notificationProfile(db, actor);
        if (input.email && !notificationEmailVerified(db, actor, profile?.email)) throw new Error('먼저 계정 이메일을 인증해 주세요.');
        if (input.sms && !profile?.phone_verified_at) throw new Error('먼저 내 프로필에서 휴대전화를 인증해 주세요.');
      }
      db.setServerRecords('notification_preferences', [...all.filter(row => !mine(row)), { workspace_id: workspace, user_id: actor, revision: Number(previous?.revision || 0) + 1, deleted: deleting, inbox: deleting ? false : input.inbox, email: deleting ? false : input.email, sms: deleting ? false : input.sms, events: deleting ? [] : input.events, rule_ids: deleting ? [] : input.rule_ids }]);
      cancelNotificationQueue(db, workspace, actor);
    } else if (['inbox-read', 'inbox-delete', 'delivery-cancel', 'delivery-delete', 'delivery-retry'].includes(action)) {
      const name = action.startsWith('inbox-') ? 'notification_inbox' : 'notification_deliveries', all = db.getServerRecords(name), row = all.find(item => mine(item) && item.id === input.id && !item.deleted);
      if (!row || !notificationAccess(db, workspace, actor, row)) throw new Error('알림을 찾을 수 없습니다.'); revision(row, input.expected_revision);
      if (action === 'inbox-read') { if (typeof input.is_read !== 'boolean') throw new Error('읽음 상태를 확인해 주세요.'); row.is_read = input.is_read; }
      else if (action === 'delivery-retry') {
        if (row.status !== 'failed' || row.provider_id || Number(row.attempts) >= 3 || !notificationSubscribed(db, row) || Date.parse(String(row.created_at)) < now - 86400000) throw new Error('확실히 접수되지 않은 실패만 24시간 내 최대 3회 시도할 수 있습니다.');
        row.status = 'queued'; row.error = ''; row.next_at = now;
      } else if (action === 'delivery-cancel') {
        if (!['queued', 'blocked'].includes(String(row.status))) throw new Error('발송 대기 중인 알림만 취소할 수 있습니다.'); row.status = 'cancelled'; row.target = '';
      } else {
        if (name === 'notification_deliveries' && (row.status === 'sending' || row.status === 'accepted' && row.next_at !== null)) throw new Error('진행 중인 발송 결과를 확인한 뒤 삭제해 주세요.');
        row.deleted = true; row.title = ''; if (name === 'notification_deliveries') { row.target = ''; if (['queued', 'blocked'].includes(String(row.status))) row.status = 'cancelled'; }
      }
      row.revision = Number(row.revision) + 1; db.setServerRecords(name, all);
    } else throw new Error('지원하지 않는 알림 요청입니다.');
    return notificationsView(db, workspace, actor, provider);
  });
  if ('verification_error' in result) throw new Error('인증번호가 일치하지 않습니다.'); return result;
}
async function sendVerification(store: PersistentHaloXStore, workspace: string, actor: string, provider: NotificationProvider, now: number) {
  const code = String(crypto.randomInt(10000000, 100000000));
  const check = await store.write(db => {
    db.assertWorkspaceAccess(workspace, actor, 'other');
    if (!provider.configured('email')) throw new PhoneVerificationError('이메일 발송 서비스 설정이 필요합니다.', 'NOTIFICATION_NOT_CONFIGURED', 503);
    const email = String(notificationProfile(db, actor)?.email || ''); if (!email || notificationEmailVerified(db, actor, email)) throw new Error('이미 인증했거나 유효하지 않은 이메일입니다.');
    const attempts = db.getServerRecords('notification_email_attempts').filter(row => Number(row.at) > now - 3600000), matching = attempts.filter(row => row.user_id === actor || row.email_hash === hash(email));
    if (matching.length >= 3 || matching.some(row => Number(row.at) > now - 60000) || attempts.length >= 100) throw new PhoneVerificationError('인증 메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.', 'NOTIFICATION_RATE_LIMIT', 429);
    const result = { id: crypto.randomUUID(), user_id: actor, email, expires_at: now + 600000, attempts: 0, hash: '' }; result.hash = hash(`${result.id}:${code}`);
    db.setServerRecords('notification_email_attempts', [...attempts, { user_id: actor, email_hash: hash(email), at: now }]);
    db.setServerRecords('notification_email_checks', [...db.getServerRecords('notification_email_checks').filter(row => row.user_id !== actor), result]); return result;
  });
  // Verification consent is this explicit user action; the target is always their account email.
  await store.write(async db => {
    db.assertWorkspaceAccess(workspace, actor, 'other');
    if (!db.getServerRecords('notification_email_checks').some(row => row.id === check.id) || notificationProfile(db, actor)?.email !== check.email) throw new Error('계정이 변경되었습니다. 다시 요청해 주세요.');
    await provider.send('email', check.email, '[HaloX] 알림 이메일 인증', `[HaloX] 알림 이메일 인증번호는 ${code}입니다. 10분 안에 설정 화면에 입력해 주세요. 본인이 요청하지 않았다면 무시해 주세요.`, `verification/${check.id}`);
  });
  return store.read(db => notificationsView(db, workspace, actor, provider));
}
