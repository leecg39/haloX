import crypto from 'node:crypto';
import { haloxStore, type PersistentHaloXStore } from './store.ts';
import { createNotificationProvider, type NotificationChannel, type NotificationProvider } from './notification-provider.ts';
import { notificationSubscribed, pruneNotifications } from './notification-model.ts';
import { ExternalServiceError } from './public-json.ts';
const DAY = 86400000;
export async function processNotificationTick(store: PersistentHaloXStore, provider = createNotificationProvider(), now = Date.now()) {
  const due = await store.read(db => db.getServerRecords('notification_deliveries').some(row => ['queued', 'blocked', 'accepted'].includes(String(row.status)) && row.next_at !== null && Number(row.next_at) <= now || row.status === 'sending' && Number(row.lease_until) <= now) || ['notification_inbox', 'notification_deliveries'].some(name => db.getServerRecords(name as 'notification_inbox' | 'notification_deliveries').some(row => Date.parse(String(row.created_at)) <= now - 30 * DAY)) || db.getServerRecords('notification_email_checks').some(row => Number(row.expires_at) <= now) || db.getServerRecords('notification_email_attempts').some(row => Number(row.at) <= now - 3600000));
  if (!due) return;
  const claim = await store.write(db => {
    pruneNotifications(db, now);
    const all = db.getServerRecords('notification_deliveries');
    for (const row of all) {
      if (row.status === 'sending' && Number(row.lease_until) <= now) { row.status = 'unknown'; row.error = '서버 중단으로 발송 결과를 확인하지 못했습니다. 제공사 발송 내역을 확인해 주세요.'; row.target = ''; row.revision = Number(row.revision) + 1; }
      if (['queued', 'blocked'].includes(String(row.status)) && (!notificationSubscribed(db, row) || Date.parse(String(row.created_at)) < now - DAY)) { row.status = 'cancelled'; row.target = ''; row.error = '수신 설정·권한 변경 또는 대기 24시간 초과로 취소되었습니다.'; row.revision = Number(row.revision) + 1; }
    }
    const row = all.find(item => !item.deleted && ['queued', 'blocked', 'accepted'].includes(String(item.status)) && item.next_at !== null && Number(item.next_at) <= now && (!item.lease_until || Number(item.lease_until) <= now));
    if (!row) { db.setServerRecords('notification_deliveries', all); return null; }
    const polling = row.status === 'accepted';
    if (polling && Number(row.accepted_at) <= now - DAY) { row.next_at = null; row.error = '24시간 내 최종 전달 결과를 확인하지 못했습니다. 제공사 발송 내역을 확인해 주세요.'; row.revision = Number(row.revision) + 1; db.setServerRecords('notification_deliveries', all); return null; }
    if (!provider.configured(row.channel as NotificationChannel)) { if (!polling) row.status = 'blocked'; row.next_at = now + 60000; row.error = '서버 관리자의 발송 서비스 설정을 기다리고 있습니다.'; row.revision = Number(row.revision) + 1; db.setServerRecords('notification_deliveries', all); return null; }
    row.lease = crypto.randomUUID(); row.lease_until = now + 60000;
    if (!polling) { row.status = 'sending'; row.attempts = Number(row.attempts) + 1; }
    row.revision = Number(row.revision) + 1; db.setServerRecords('notification_deliveries', all); return { id: row.id, lease: row.lease, polling };
  });
  if (!claim) return;
  // Recheck and send while holding the same writer lock used by preference, membership,
  // source and account deletion. A committed claim survives crashes; never blindly resend it.
  return store.write(async db => {
    const all = db.getServerRecords('notification_deliveries'), row = all.find(item => item.id === claim.id && item.lease === claim.lease);
    if (!row) return;
    const channel = row.channel as NotificationChannel;
    if (!claim.polling && !notificationSubscribed(db, row)) { row.status = 'cancelled'; row.target = ''; row.error = '수신 설정 또는 접근 권한이 변경되었습니다.'; }
    else if (claim.polling) {
      try { row.status = await provider.status(channel, String(row.provider_id)); row.error = row.status === 'failed' ? '제공사가 전달 실패를 보고했습니다.' : ''; } catch { row.error = '전달 결과를 조회하지 못했습니다. 발송을 다시 시도하지 않습니다.'; }
      row.next_at = row.status === 'accepted' && Number(row.accepted_at) > now - DAY ? now + 300000 : null;
      if (row.status === 'accepted' && row.next_at === null) row.error = '24시간 내 최종 전달 결과를 확인하지 못했습니다. 제공사 발송 내역을 확인해 주세요.';
    } else {
      try {
        row.provider_id = await provider.send(channel, String(row.target), `[HaloX] ${row.title}`, `[HaloX] ${row.title}\n설정 > 알림 또는 모니터링 화면에서 내용을 확인해 주세요. 수신 설정은 설정 > 알림에서 변경할 수 있습니다.`, `notification/${row.id}/${row.attempts}`);
        row.status = 'accepted'; row.accepted_at = now; row.next_at = channel === 'sms' ? now + 30000 : null; row.target = ''; row.error = '';
      } catch (error) {
        row.status = error instanceof ExternalServiceError && !error.uncertain ? 'failed' : 'unknown';
        row.error = row.status === 'failed' ? '발송이 거절되었습니다. 서비스 설정을 확인한 후 다시 시도할 수 있습니다.' : '접수 결과를 확인하지 못했습니다. 중복 방지를 위해 다시 보내지 않습니다.';
        if (row.status === 'unknown') row.target = '';
      }
    }
    row.lease = null; row.lease_until = null; row.revision = Number(row.revision) + 1; db.setServerRecords('notification_deliveries', all);
    return { id: row.id, status: row.status };
  });
}
export function startNotificationWorker(store: PersistentHaloXStore = haloxStore, provider: NotificationProvider = createNotificationProvider()) {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await processNotificationTick(store, provider); } catch { console.error('알림 작업을 처리하지 못했습니다. 다음 주기에 다시 확인합니다.'); } finally { busy = false; } };
  const timer = setInterval(() => void tick(), 5000); timer.unref(); void tick(); return () => clearInterval(timer);
}
