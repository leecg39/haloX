import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_USER_ID as OWNER, OTHER_USER_ID as OTHER, type Row } from './database.ts';
import { PersistentHaloXStore } from './store.ts';
import { notificationCommand, notificationsView } from './notification-service.ts';
import { emitNotification } from './notification-model.ts';
import { createNotificationProvider, type NotificationProvider } from './notification-provider.ts';
import { processNotificationTick } from './notification-worker.ts';
import { runReportCommand } from './report-service.ts';
import { runMonitorCommand } from './monitor-service.ts';
import { ExternalServiceError } from './public-json.ts';
import { assertRestWrite } from './rest-policy.ts';
const dirs: string[] = []; afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const events = ['monitor.triggered', 'monitor.resolved', 'monitor.insufficient', 'report.ready'];
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'halox-notifications-')); dirs.push(dir); const file = path.join(dir, 'state.sqlite'), store = new PersistentHaloXStore(file), now = Date.now(), sent: { channel: string; target: string; text: string }[] = [];
  const workspace = String((await store.write(db => { db.updateTable('profiles', { phone_number: '01012345678', phone_verified_at: new Date(now).toISOString() }, { id: `eq.${OWNER}` }, OWNER); return db.insertTable('workspaces', { name: '알림 검증', default_brand_filter: 'brand.test' }, OWNER)[0]; })).id);
  const provider: NotificationProvider = { configured: () => true, send: async (channel, target, _title, text) => { sent.push({ channel, target, text }); return `accepted-${sent.length}`; }, status: async () => 'delivered' };
  const view = (actor = OWNER) => store.read(db => notificationsView(db, workspace, actor, provider));
  const command = async (action: string, fields: Row = {}, actor = OWNER, at = now) => notificationCommand(store, actor, { workspace_id: workspace, action, expected_revision: (await view(actor)).preferences.revision, ...fields }, provider, at);
  const prefs = (fields: Row = {}, actor = OWNER) => command('preferences-save', { inbox: true, email: false, sms: false, events, rule_ids: [], ...fields }, actor);
  const report = (key = 'one') => store.write(db => runReportCommand(db, 'report-create', { period_type: 'week', date: new Date(now).toISOString().slice(0, 10), idempotency_key: key }, workspace, OWNER, now));
  const verify = async () => { await command('email-send'); const code = sent.at(-1)!.text.match(/\d{8}/)![0]; await command('email-confirm', { code }); sent.length = 0; };
  return { store, workspace, file, now, provider, sent, view, command, prefs, report, verify };
}
test('subscriptions default off, persist per user/workspace, reject stale saves, and delete without ABA revision reuse', async () => {
  const f = await fixture(); assert.equal((await f.view()).preferences.saved, false); await f.report(); assert.equal((await f.view()).inbox.length, 0);
  await f.prefs(); const reopened = new PersistentHaloXStore(f.file); assert.equal((await reopened.read(db => notificationsView(db, f.workspace, OWNER))).preferences.inbox, true);
  await assert.rejects(f.command('preferences-save', { expected_revision: 0 }), /변경/);
  await f.command('preferences-delete'); assert.equal((await f.view()).preferences.saved, false); assert.equal((await f.view()).preferences.revision, 2);
  await assert.rejects(f.command('preferences-save', { expected_revision: 0 }), /변경/);
  await assert.rejects(f.view(OTHER)); await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: OTHER, role: 'viewer', allowed_sections: ['other', 'monitoring'] }, OWNER));
  await f.prefs({}, OTHER); assert.equal((await f.view(OTHER)).preferences.inbox, true); assert.equal((await f.view()).preferences.inbox, false);
});
test('email ownership proof is single-use, rate-limited, hashed and required before opt-in', async () => {
  const f = await fixture(); await assert.rejects(f.prefs({ email: true }), /이메일을 인증/); await f.command('email-send');
  assert.equal(f.sent[0].target, 'demo@halox.local'); const code = f.sent[0].text.match(/\d{8}/)![0];
  assert.equal(JSON.stringify(await f.store.read(db => db.getServerRecords('notification_email_checks'))).includes(code), false);
  await assert.rejects(f.command('email-send'), /요청이 많/);
  for (let i = 0; i < 5; i++) await assert.rejects(f.command('email-confirm', { code: '00000000' }), /일치/);
  await assert.rejects(f.command('email-confirm', { code }), /새로 요청/);
  await f.command('email-send', {}, OWNER, f.now + 60001); const next = f.sent.at(-1)!.text.match(/\d{8}/)![0]; await f.command('email-confirm', { code: next }, OWNER, f.now + 60002);
  await assert.rejects(f.command('email-confirm', { code: next }), /새로 요청/); await f.prefs({ email: true }); assert.equal((await f.view()).contact.email_verified, true);
});
test('verification expiry, email change and missing SMTP prevent verification or sending', async () => {
  const f = await fixture(); await assert.rejects(notificationCommand(f.store, OWNER, { workspace_id: f.workspace, action: 'email-send' }, { ...f.provider, configured: () => false }), /설정/);
  await f.command('email-send'); const code = f.sent[0].text.match(/\d{8}/)![0]; await assert.rejects(f.command('email-confirm', { code }, OWNER, f.now + 600001), /새로/);
  await f.command('email-send', {}, OWNER, f.now + 660001); await f.store.write(db => db.updateTable('profiles', { email: 'changed@example.test' }, { id: `eq.${OWNER}` }, OWNER));
  await assert.rejects(f.command('email-confirm', { code: f.sent.at(-1)!.text.match(/\d{8}/)![0] }, OWNER, f.now + 660002), /새로/);
});
test('real report creation fans out atomically once, inbox read/delete and delivery privacy persist', async () => {
  const f = await fixture(); await f.verify(); await f.prefs({ email: true, sms: true }); await f.report(); await f.report();
  let data = await f.view(); assert.equal(data.inbox.length, 1); assert.equal(data.deliveries.length, 2); assert.equal(data.unread, 1); assert.ok(data.deliveries.every(row => !('target' in row)));
  const row = data.inbox[0]; await f.command('inbox-read', { id: row.id, expected_revision: row.revision, is_read: true }); data = await f.view(); assert.equal(data.unread, 0);
  await assert.rejects(f.command('inbox-delete', { id: row.id, expected_revision: row.revision }), /변경/);
  await f.command('inbox-delete', { id: row.id, expected_revision: data.inbox[0].revision }); await f.report(); assert.equal((await f.view()).inbox.length, 0);
  await f.store.read(db => { assert.throws(() => db.queryTable('notification_inbox', {}, OWNER)); assert.throws(() => assertRestWrite(db, 'notifications', 'POST', OWNER, { workspace_id: f.workspace })); });
});
test('monitor transitions emit only real recovery; rule selection and source permissions are enforced', async () => {
  const f = await fixture(); const rule = await f.store.write(db => (runMonitorCommand(db, 'monitor-rule-create', { name: 'SEO 기준', metric: 'seo_top10', operator: 'lt', threshold: 80, window_days: 7, interval_minutes: 5, min_samples: 1, enabled: true }, f.workspace, OWNER, f.now).rule as Row));
  await f.prefs({ rule_ids: [rule.id] });
  await f.store.write(db => runMonitorCommand(db, 'monitor-rule-check', { rule_id: rule.id, expected_revision: rule.revision }, f.workspace, OWNER, f.now));
  assert.equal((await f.view()).inbox[0].event_type, 'monitor.insufficient');
  const kw = await f.store.write(db => db.insertTable('keywords', { workspace_id: f.workspace, keyword: '검색' }, OWNER)[0]);
  await f.store.write(db => { db.insertTable('serp_snapshots', { workspace_id: f.workspace, keyword_id: kw.id, keyword_text: '검색', captured_at: new Date(f.now - 1000).toISOString(), provider: 'fixture', engine: 'google', language: kw.language, country: kw.country, our_domain: 'brand.test', our_rank: 25, top_results_json: [] }, OWNER); runMonitorCommand(db, 'monitor-rule-check', { rule_id: rule.id, expected_revision: rule.revision }, f.workspace, OWNER, f.now); });
  assert.equal((await f.view()).inbox.length, 2);
  await f.store.write(db => runMonitorCommand(db, 'monitor-rule-update', { ...rule, expected_revision: rule.revision, rule_id: rule.id, threshold: 70 }, f.workspace, OWNER, f.now));
  assert.equal((await f.view()).inbox.filter(row => row.event_type === 'monitor.resolved').length, 0);
  await f.store.write(db => { runMonitorCommand(db, 'monitor-rule-check', { rule_id: rule.id, expected_revision: 2 }, f.workspace, OWNER, f.now); db.updateTable('serp_snapshots', { our_rank: 2, top_results_json: [{ url: 'https://brand.test/page', rank: 2 }] }, { keyword_id: `eq.${kw.id}` }, OWNER); runMonitorCommand(db, 'monitor-rule-check', { rule_id: rule.id, expected_revision: 2 }, f.workspace, OWNER, f.now); });
  assert.equal((await f.view()).inbox.filter(row => row.event_type === 'monitor.resolved').length, 1);
  await f.store.write(db => db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: OTHER, role: 'viewer', allowed_sections: ['other', 'monitoring'] }, OWNER));
  await assert.rejects(f.prefs({ rule_ids: [rule.id] }, OTHER), /감시 규칙/);
});
test('workers claim once across processes, distinguish SMTP accepted from SMS delivery, allow completed history deletion', async () => {
  const f = await fixture(); await f.verify(); await f.prefs({ email: true, sms: true }); await f.report();
  await Promise.all([processNotificationTick(f.store, f.provider, f.now), processNotificationTick(new PersistentHaloXStore(f.file), f.provider, f.now)]);
  assert.equal(f.sent.length, 2); let data = await f.view(); assert.ok(data.deliveries.every(row => row.status === 'accepted'));
  await processNotificationTick(f.store, f.provider, f.now + 30001); data = await f.view(); assert.equal(data.deliveries.find(row => row.channel === 'sms')!.status, 'delivered'); assert.equal(data.deliveries.find(row => row.channel === 'email')!.status, 'accepted');
  for (const row of data.deliveries) await f.command('delivery-delete', { id: row.id, expected_revision: row.revision }); assert.equal((await f.view()).deliveries.length, 0); await f.report(); assert.equal(f.sent.length, 2);
});
test('preference opt-out cancels queued sends and verification contact changes fence delivery', async () => {
  const f = await fixture(); await f.prefs({ sms: true }); await f.report(); await f.prefs({ sms: false }); await processNotificationTick(f.store, f.provider, f.now); assert.equal(f.sent.length, 0); assert.equal((await f.view()).deliveries[0].status, 'cancelled');
  await f.prefs({ sms: true }); await f.report('two'); await f.store.write(db => db.updateTable('profiles', { phone_number: '01087654321' }, { id: `eq.${OWNER}` }, OWNER)); await processNotificationTick(f.store, f.provider, f.now); assert.equal(f.sent.length, 0);
});
test('revoked membership, deleted source and account withdrawal stop queued notifications', async () => {
  const f = await fixture(); await f.store.write(db => { db.insertTable('workspace_members', { workspace_id: f.workspace, user_id: OTHER, role: 'viewer', allowed_sections: ['other', 'monitoring'] }, OWNER); db.updateTable('profiles', { phone_number: '01022223333', phone_verified_at: new Date(f.now).toISOString() }, { id: `eq.${OTHER}` }, OTHER); });
  await f.prefs({ sms: true }, OTHER); await f.report(); await f.store.write(db => db.deleteTable('workspace_members', { workspace_id: `eq.${f.workspace}`, user_id: `eq.${OTHER}` }, OWNER)); await processNotificationTick(f.store, f.provider, f.now); assert.equal(f.sent.length, 0);
  await f.prefs({ sms: true }); const report = await f.report('two'); await f.store.write(db => db.deleteTable('report_snapshots', { id: `eq.${(report.report as Row).id}` }, OWNER)); await processNotificationTick(f.store, f.provider, f.now); assert.equal(f.sent.length, 0);
  await f.report('three'); await f.store.write(db => db.setServerRecords('account_deletions', [{ user_id: OWNER, status: 'pending' }])); await processNotificationTick(f.store, f.provider, f.now); assert.equal(f.sent.length, 0);
});
test('unconfigured sends wait then expire, unknown outcome never retries, definite rejection retries at most three times', async () => {
  const f = await fixture(); await f.prefs({ sms: true }); await f.report(); await processNotificationTick(f.store, { ...f.provider, configured: () => false }, f.now); assert.equal((await f.view()).deliveries[0].status, 'blocked');
  const failed = { ...f.provider, send: async () => { throw new ExternalServiceError('secret must not leak', 'REJECTED', 502, false); } };
  for (let i = 0; i < 3; i++) { await processNotificationTick(f.store, failed, f.now + 60001 + i); const row = (await f.view()).deliveries[0]; assert.equal(row.status, 'failed'); assert.ok(!String(row.error).includes('secret')); if (i < 2) await f.command('delivery-retry', { id: row.id, expected_revision: row.revision }); else await assert.rejects(f.command('delivery-retry', { id: row.id, expected_revision: row.revision }), /3회/); }
  await f.report('two'); await processNotificationTick(f.store, { ...f.provider, send: async () => { throw new Error('timeout'); } }, f.now); const unknown = (await f.view()).deliveries.find(row => row.status === 'unknown')!; await assert.rejects(f.command('delivery-retry', { id: unknown.id, expected_revision: unknown.revision }), /확실히/); await processNotificationTick(f.store, f.provider, f.now + 100000); assert.equal(f.sent.length, 0);
  await f.report('three'); await processNotificationTick(f.store, f.provider, f.now + 86400001); assert.equal(f.sent.length, 0);
});
test('restart after an interrupted send marks unknown without replay; old inbox and targets are pruned', async () => {
  const f = await fixture(); await f.prefs({ sms: true }); await f.report(); await f.store.write(db => db.setServerRecords('notification_deliveries', db.getServerRecords('notification_deliveries').map(row => ({ ...row, status: 'sending', lease_until: f.now + 60000 }))));
  await processNotificationTick(new PersistentHaloXStore(f.file), f.provider, f.now + 60001); assert.equal(f.sent.length, 0); assert.equal((await f.view()).deliveries[0].status, 'unknown');
  await processNotificationTick(f.store, f.provider, f.now + 31 * 86400000); assert.equal((await f.view()).inbox.length, 0); assert.equal((await f.view()).deliveries.length, 0);
});
test('SMTP uses TLS and no file/URL access, sanitizes errors and only claims server acceptance', async () => {
  const env = { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USER: 'user', SMTP_PASSWORD: 'private', NOTIFICATION_EMAIL_FROM: 'HaloX <sender@example.test>' }; let closed = false;
  const provider = createNotificationProvider(env, fetch, options => { assert.equal(options.requireTLS, true); assert.equal(options.secure, false); assert.equal(options.tls?.rejectUnauthorized, true); assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true); return { sendMail: async input => { assert.equal(input.to, 'self@example.test'); assert.ok(input.messageId); return { accepted: [input.to], rejected: [] }; }, close: () => { closed = true; } }; });
  assert.ok(await provider.send('email', 'self@example.test', 'title', 'body', 'key')); assert.equal(closed, true); assert.equal(await provider.status('email', 'id'), 'accepted');
  for (const [error, uncertain] of [[{ responseCode: 550, message: 'password' }, false], [{ code: 'ETIMEDOUT', message: 'password' }, true]] as const) { const failing = createNotificationProvider(env, fetch, () => ({ sendMail: async () => { throw error; }, close() {} })); await assert.rejects(failing.send('email', 'self@example.test', 't', 'b', 'k'), cause => cause instanceof ExternalServiceError && cause.uncertain === uncertain && !cause.message.includes('password')); }
});
test('SOLAPI transport signs fixed HTTPS LMS requests, validates receipts and polls success or failure', async () => {
  const env = { SOLAPI_API_KEY: 'key', SOLAPI_API_SECRET: 'secret', SOLAPI_SENDER: '0212345678' }; let calls = 0;
  const provider = createNotificationProvider(env, (async (url, init) => { assert.equal(init!.redirect, 'error'); assert.ok(new Headers(init!.headers).get('Authorization')!.startsWith('HMAC-SHA256')); calls++; if (calls === 1) { assert.equal(url, 'https://api.solapi.com/messages/v4/send-many/detail'); assert.equal(JSON.parse(String(init!.body)).messages[0].type, 'LMS'); return Response.json({ groupInfo: { groupId: 'G4Vtest', count: { registeredSuccess: 1, registeredFailed: 0 } }, failedMessageList: [] }); } return Response.json({ groupId: 'G4Vtest', count: { sentSuccess: calls === 2 ? 1 : 0, sentFailed: calls === 3 ? 1 : 0 } }); }) as typeof fetch);
  assert.equal(await provider.send('sms', '01012345678', 'title', 'body', 'key'), 'G4Vtest'); assert.equal(await provider.status('sms', 'G4Vtest'), 'delivered'); assert.equal(await provider.status('sms', 'G4Vtest'), 'failed');
  const malformed = createNotificationProvider(env, (async () => Response.json({ groupInfo: { groupId: 'G4Vtest' } })) as typeof fetch); await assert.rejects(malformed.send('sms', '01012345678', 't', 'b', 'k'), error => error instanceof ExternalServiceError && error.uncertain);
});

test('external fan-out has a durable 100-request rolling daily cap and private history stays bounded', async () => {
  const f = await fixture(); await f.prefs({ sms: true });
  await f.store.write(db => {
    for (let i = 0; i < 502; i++) {
      const source = db.insertTable('workspace_events', { workspace_id: f.workspace, event_type: 'monitor.triggered', origin: 'monitor', title: `경보 ${i}` }, OWNER)[0];
      emitNotification(db, f.workspace, { source_id: source.id, event_type: 'monitor.triggered', title: source.title }, f.now + i);
    }
  });
  const data = await f.view(); assert.equal(data.inbox.length, 500); assert.equal(data.deliveries.length, 500); assert.equal(data.deliveries.filter(row => row.status === 'queued').length, 100); assert.equal(data.deliveries.filter(row => row.status === 'cancelled').length, 400);
});

test('SMS result lookup ends after 24h even if provider configuration disappears', async () => {
  const f = await fixture(); await f.prefs({ sms: true }); await f.report(); await processNotificationTick(f.store, f.provider, f.now);
  await processNotificationTick(f.store, { ...f.provider, configured: () => false }, f.now + 86400001);
  const row = (await f.view()).deliveries[0]; assert.equal(row.status, 'accepted'); assert.equal(row.next_at, null); assert.match(String(row.error), /24시간/);
  await f.command('delivery-delete', { id: row.id, expected_revision: row.revision }); assert.equal((await f.view()).deliveries.length, 0);
});
