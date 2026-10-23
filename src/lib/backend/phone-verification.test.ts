import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersistentHaloXStore } from './store.ts';
import { PhoneVerificationService } from './phone-verification.ts';
import { createSolapiSender, normalizePhone, PhoneVerificationError, type SmsSender } from './sms.ts';
import { authenticatePassword, registerAccount } from './accounts.ts';

const secret = 'phone-verification-unit-test-secret-only';
const phone = '01012345678';
const directories: string[] = [];
function fixture(sender?: SmsSender) {
  const directory = mkdtempSync(path.join(tmpdir(), 'halox-phone-'));
  directories.push(directory);
  const filename = path.join(directory, 'store.sqlite');
  const store = new PersistentHaloXStore(filename);
  let time = Date.now();
  const deliveries: Array<{ phone: string; code: string }> = [];
  const service = new PhoneVerificationService(store, sender ?? { async send(phone, code) { deliveries.push({ phone, code }); } }, secret, () => time);
  return { filename, store, service, deliveries, advance(ms: number) { time += ms; } };
}
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

describe('SOLAPI transport', () => {
  it('requires server configuration and validates Korean phone numbers', () => {
    assert.throws(() => createSolapiSender({}), (error: unknown) => error instanceof PhoneVerificationError && error.status === 503);
    assert.equal(normalizePhone('+82 10-1234-5678'), phone);
    for (const bad of ['', 'abcd01012345678', '+1 555 123 4567', '0101234', null]) assert.throws(() => normalizePhone(bad));
  });
  it('signs requests and accepts only a confirmed registration', async () => {
    const env = { SOLAPI_API_KEY: 'test-key', SOLAPI_API_SECRET: 'test-secret', SOLAPI_SENDER: '0212345678' };
    let called = false;
    const fetcher: typeof fetch = async (url, options) => {
      called = true;
      assert.equal(url, 'https://api.solapi.com/messages/v4/send-many/detail');
      const headers = new Headers(options?.headers);
      const auth = headers.get('Authorization')!;
      const date = auth.match(/date=([^,]+)/)![1];
      const salt = auth.match(/salt=([^,]+)/)![1];
      const signature = crypto.createHmac('sha256', env.SOLAPI_API_SECRET).update(date + salt).digest('hex');
      assert.ok(auth.endsWith(`signature=${signature}`));
      const body = JSON.parse(String(options?.body));
      assert.equal(body.messages[0].to, phone);
      assert.equal(body.messages[0].from, env.SOLAPI_SENDER);
      assert.match(body.messages[0].text, /654321/);
      return Response.json({ failedMessageList: [], groupInfo: { groupId: 'test-group', count: { registeredSuccess: 1, registeredFailed: 0 } } });
    };
    await createSolapiSender(env, fetcher).send(phone, '654321');
    assert.ok(called);
    for (const response of [Response.json({}), Response.json({ failedMessageList: [{}], groupInfo: { groupId: 'failed', count: { registeredSuccess: 0, registeredFailed: 1 } } }), Response.json({ error: 'test-secret' }, { status: 403 })]) {
      await assert.rejects(createSolapiSender(env, async () => response).send(phone, '654321'), (error: unknown) => error instanceof PhoneVerificationError && error.status === 502 && !error.message.includes('test-secret'));
    }
    await assert.rejects(createSolapiSender(env, async () => { throw new Error('timeout'); }).send(phone, '654321'), /발송 요청/);
  });
});

describe('server phone verification and registration', () => {
  it('stores no plaintext OTP, survives reopening, and consumes a phone-bound token once', async () => {
    const f = fixture();
    const sent = await f.service.send(phone, 'client');
    assert.equal(f.deliveries.length, 1);
    assert.equal(Object.hasOwn(sent, 'code'), false);
    const state = await f.store.read(db => db.getServerRecords('phone_verification')[0]);
    assert.equal(Object.hasOwn(state, 'code'), false);
    assert.notEqual(state.codeHash, f.deliveries[0].code);
    const reopened = new PhoneVerificationService(new PersistentHaloXStore(f.filename), null, secret);
    await assert.rejects(reopened.verify('01087654321', sent.challengeId, f.deliveries[0].code), /일치하지/);
    const verified = await reopened.verify(phone, sent.challengeId, f.deliveries[0].code);
    await assert.rejects(reopened.verify(phone, sent.challengeId, f.deliveries[0].code), /일치하지/);
    await assert.rejects(f.store.write(db => reopened.consume(db, '01087654321', verified.verificationToken)), /만료/);
    await f.store.write(db => reopened.consume(db, phone, verified.verificationToken));
    await assert.rejects(f.store.write(db => reopened.consume(db, phone, verified.verificationToken)), /만료/);
    await assert.rejects(f.store.read(db => db.queryTable('phone_verification')), /does not exist/);
  });

  it('resists parallel sends, enforces cooldown, and invalidates old codes on resend', async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.service.send(phone, 'a'), f.service.send(phone, 'b')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.deliveries.length, 1);
    const first = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<{ challengeId: string }>;
    f.advance(61_000);
    const second = await f.service.send(phone, 'a');
    await assert.rejects(f.service.verify(phone, first.value.challengeId, f.deliveries[0].code), /일치하지/);
    await f.service.verify(phone, second.challengeId, f.deliveries[1].code);
  });

  it('persists wrong attempts and rejects expired or locked challenges', async () => {
    const f = fixture();
    const sent = await f.service.send(phone, 'a');
    const wrong = f.deliveries[0].code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await assert.rejects(f.service.verify(phone, sent.challengeId, wrong));
    await assert.rejects(f.service.verify(phone, sent.challengeId, f.deliveries[0].code));
    assert.equal(await f.store.read(db => db.getServerRecords('phone_verification')[0].attempts), 5);
    f.advance(61_000);
    const second = await f.service.send(phone, 'a');
    f.advance(5 * 60_000);
    await assert.rejects(f.service.verify(phone, second.challengeId, f.deliveries[1].code));
  });

  it('limits phone sends across process restarts and retains failed delivery reservations', async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) { await f.service.send(phone, 'a'); f.advance(61_000); }
    await assert.rejects(f.service.send(phone, 'a'), (error: unknown) => error instanceof PhoneVerificationError && error.code === 'SMS_RATE_LIMITED');
    const broken = fixture({ async send() { throw new PhoneVerificationError('failed', 'SMS_SEND_FAILED', 502); } });
    await assert.rejects(broken.service.send(phone, 'a'), /failed/);
    assert.equal(await broken.store.read(db => db.getServerRecords('phone_verification')[0].status), 'failed');
    const reopened = new PhoneVerificationService(new PersistentHaloXStore(broken.filename), { async send() { assert.fail('must not send'); } }, secret);
    await assert.rejects(reopened.send(phone, 'a'), (error: unknown) => error instanceof PhoneVerificationError && error.code === 'SMS_COOLDOWN');
  });

  it('creates an isolated account and logs in with its own hashed password after restart', async () => {
    const f = fixture();
    const sent = await f.service.send(phone, 'a');
    const { verificationToken } = await f.service.verify(phone, sent.challengeId, f.deliveries[0].code);
    const body = { email: 'New@Example.com', fullName: '새 사용자', password: 'private-password', phone, verificationToken };
    const profile = await registerAccount(f.store, f.service, body);
    const reopened = new PersistentHaloXStore(f.filename);
    assert.equal((await authenticatePassword(reopened, 'new@example.com', body.password))?.id, profile.id);
    assert.equal(await authenticatePassword(reopened, 'new@example.com', 'wrong'), null);
    const workspaces = await reopened.read(db => db.queryTable('workspaces', {}, profile.id).data);
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].owner_id, profile.id);
    const member = await reopened.read(db => db.queryTable('workspace_members', {}, profile.id).data[0]);
    assert.equal(member.email, 'new@example.com');
    const ownProfile = await reopened.read(db => db.queryTable('profiles', {}, profile.id).data[0]);
    assert.equal(Object.hasOwn(ownProfile, 'password_hash'), false);
    await assert.rejects(reopened.read(db => db.queryTable('account_credentials')), /does not exist/);
    await assert.rejects(registerAccount(f.store, f.service, body), /만료/);
  });

  it('rolls back token consumption for a duplicate identity and allows a corrected retry', async () => {
    const f = fixture();
    const sent = await f.service.send(phone, 'a');
    const { verificationToken } = await f.service.verify(phone, sent.challengeId, f.deliveries[0].code);
    const body = { email: 'admin@halox.local', fullName: '테스트', password: 'password-123', phone, verificationToken };
    await assert.rejects(registerAccount(f.store, f.service, body), /이미 등록된/);
    const created = await registerAccount(f.store, f.service, { ...body, email: 'corrected@example.com' });
    assert.equal(created.email, 'corrected@example.com');
  });
});
