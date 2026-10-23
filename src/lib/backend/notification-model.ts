import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { NOTIFICATION_EVENTS, type NotificationEvent, type NotificationPreferences } from '../api/notifications.ts';
import type { NotificationChannel } from './notification-provider.ts';
export type NotificationCollection = 'notification_preferences' | 'notification_inbox' | 'notification_deliveries' | 'notification_email_checks' | 'notification_email_verified' | 'notification_email_attempts';
export const notificationWhere = (workspace: string, actor: string) => (row: Row) => row.workspace_id === workspace && row.user_id === actor;
export const notificationProfile = (db: HaloXDatabase, actor: string) => db.queryTable('profiles', {}, actor).data.find(row => row.id === actor);
export function notificationPreferences(db: HaloXDatabase, workspace: string, actor: string): NotificationPreferences {
  const row = db.getServerRecords('notification_preferences').find(notificationWhere(workspace, actor));
  return { revision: Number(row?.revision || 0), saved: !!row && !row.deleted, inbox: !!row?.inbox, email: !!row?.email, sms: !!row?.sms, events: (row?.events || []) as NotificationEvent[], rule_ids: (row?.rule_ids || []) as string[] };
}
export function notificationEmailVerified(db: HaloXDatabase, actor: string, email: unknown) { return db.getServerRecords('notification_email_verified').some(row => row.user_id === actor && row.email === email); }
export function notificationAccess(db: HaloXDatabase, workspace: string, actor: string, row?: Row) {
  try {
    db.assertWorkspaceAccess(workspace, actor, 'other'); db.assertWorkspaceAccess(workspace, actor, 'monitoring');
    if (row?.metric) db.assertWorkspaceAccess(workspace, actor, row.metric === 'audit_health' ? 'strategy' : 'analysis');
    if (row?.source_id) {
      const table = row.event_type === 'report.ready' ? 'report_snapshots' : 'workspace_events';
      if (!db.queryTable(table, { filters: { workspace_id: `eq.${workspace}`, id: `eq.${row.source_id}` } }, actor).data.length) return false;
    }
    return true;
  } catch { return false; }
}
export function notificationSubscribed(db: HaloXDatabase, row: Row) {
  const workspace = String(row.workspace_id), actor = String(row.user_id);
  if (!notificationAccess(db, workspace, actor, row)) return false;
  const prefs = notificationPreferences(db, workspace, actor), profile = notificationProfile(db, actor);
  if (!prefs[row.channel as NotificationChannel] || !prefs.events.includes(row.event_type as NotificationEvent) || row.rule_id && prefs.rule_ids.length && !prefs.rule_ids.includes(String(row.rule_id))) return false;
  return row.channel === 'email' ? profile?.email === row.target && notificationEmailVerified(db, actor, row.target) : !!profile?.phone_verified_at && profile.phone_number === row.target;
}
export function cancelNotificationQueue(db: HaloXDatabase, workspace: string, actor: string, all = false) {
  db.setServerRecords('notification_deliveries', db.getServerRecords('notification_deliveries').map(row => notificationWhere(workspace, actor)(row) && ['queued', 'blocked'].includes(String(row.status)) && (all || !notificationSubscribed(db, row)) ? { ...row, target: '', status: 'cancelled', error: '수신 설정 또는 접근 권한이 변경되었습니다.', revision: Number(row.revision) + 1 } : row));
}
/** Called only by real source transitions, inside their transaction. No legacy seed replay. */
export function emitNotification(db: HaloXDatabase, workspace: string, source: Row, now: number) {
  if (!Object.hasOwn(NOTIFICATION_EVENTS, String(source.event_type))) return;
  const inbox = db.getServerRecords('notification_inbox'), deliveries = db.getServerRecords('notification_deliveries');
  for (const preference of db.getServerRecords('notification_preferences').filter(row => row.workspace_id === workspace && !row.deleted)) {
    const actor = String(preference.user_id), prefs = notificationPreferences(db, workspace, actor);
    if (!notificationAccess(db, workspace, actor, source) || !prefs.events.includes(source.event_type as NotificationEvent) || source.rule_id && prefs.rule_ids.length && !prefs.rule_ids.includes(String(source.rule_id))) continue;
    const common = { workspace_id: workspace, user_id: actor, source_id: source.source_id, event_type: source.event_type, rule_id: source.rule_id || null, metric: source.metric || null, title: `${NOTIFICATION_EVENTS[source.event_type as NotificationEvent]} · ${String(source.title).slice(0, 200)}`, created_at: new Date(now).toISOString(), revision: 1 };
    // Source transaction deduplication plus stable recipient IDs prevents duplicate fan-out.
    const id = crypto.createHash('sha256').update(`${workspace}:${source.event_type}:${source.source_id}:${actor}`).digest('hex');
    if (prefs.inbox && !inbox.some(row => row.id === id)) inbox.push({ ...common, id, is_read: false });
    const profile = notificationProfile(db, actor);
    for (const channel of ['email', 'sms'] as const) {
      const row = { ...common, id: `${id}:${channel}`, channel, target: String(channel === 'email' ? profile?.email || '' : profile?.phone_number || ''), status: 'queued', next_at: now, attempts: 0 };
      if (notificationSubscribed(db, row) && !deliveries.some(item => item.id === row.id)) {
        const recent = deliveries.filter(item => item.workspace_id === workspace && item.user_id === actor && Date.parse(String(item.created_at)) > now - 86400000);
        deliveries.push(recent.length >= 100 ? { ...row, status: 'cancelled', target: '', error: '하루 외부 알림 한도(100건)에 도달해 취소되었습니다.' } : row);
      }
    }
  }
  db.setServerRecords('notification_inbox', inbox); db.setServerRecords('notification_deliveries', deliveries); pruneNotifications(db, now);
}
export function pruneNotifications(db: HaloXDatabase, now: number) {
  for (const name of ['notification_inbox', 'notification_deliveries'] as const) {
    const retained = db.getServerRecords(name).filter(row => Date.parse(String(row.created_at)) > now - 30 * 86400000);
    const active = (row: Row) => name === 'notification_deliveries' && (['queued', 'blocked', 'sending'].includes(String(row.status)) || row.status === 'accepted' && row.next_at !== null);
    retained.sort((a, b) => Number(active(b)) - Number(active(a)) || String(b.created_at).localeCompare(String(a.created_at)));
    const counts = new Map<string, number>();
    db.setServerRecords(name, retained.filter(row => { const key = `${row.workspace_id}:${row.user_id}`, count = (counts.get(key) || 0) + 1; counts.set(key, count); return count <= 500 || active(row); }));
  }
  db.setServerRecords('notification_email_checks', db.getServerRecords('notification_email_checks').filter(row => Number(row.expires_at) > now));
  db.setServerRecords('notification_email_attempts', db.getServerRecords('notification_email_attempts').filter(row => Number(row.at) > now - 3600000));
}
