import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import type { PersistentHaloXStore } from './store.ts';
import { normalizePhone, PhoneVerificationError, type SmsSender } from './sms.ts';

const HOUR = 60 * 60 * 1000;
const TTL = 5 * 60 * 1000;
const COOLDOWN = 60 * 1000;
interface Challenge extends Row {
  id: string;
  phoneHash: string;
  clientHash: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  status: 'pending' | 'sent' | 'failed' | 'verified' | 'consumed';
  tokenHash?: string;
  tokenExpiresAt?: number;
}

export class PhoneVerificationService {
  private readonly store: PersistentHaloXStore;
  private readonly sender: SmsSender | null;
  private readonly secret: string;
  private readonly now: () => number;
  constructor(store: PersistentHaloXStore, sender: SmsSender | null, secret: string, now = Date.now) {
    if (secret.length < 32) throw new PhoneVerificationError('인증 서비스 설정을 확인해 주세요.', 'AUTH_NOT_CONFIGURED', 503);
    this.store = store;
    this.sender = sender;
    this.secret = secret;
    this.now = now;
  }

  private hash(value: string): string {
    return crypto.createHmac('sha256', this.secret).update(`phone-verification:${value}`).digest('hex');
  }

  async send(phoneInput: unknown, client: string): Promise<{ challengeId: string; expiresAt: number; retryAfter: number }> {
    if (!this.sender) throw new PhoneVerificationError('문자 인증 서비스가 아직 설정되지 않았습니다.', 'SMS_NOT_CONFIGURED', 503);
    const phone = normalizePhone(phoneInput);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const id = crypto.randomUUID();
    const now = this.now();
    const phoneHash = this.hash(`phone:${phone}`);
    const clientHash = this.hash(`client:${client}`);
    await this.store.write(db => {
      const rows = (db.getServerRecords('phone_verification') as Challenge[]).filter(row => row.createdAt > now - HOUR);
      const phoneRows = rows.filter(row => row.phoneHash === phoneHash);
      const latest = Math.max(0, ...phoneRows.map(row => row.createdAt));
      if (latest && now - latest < COOLDOWN) {
        throw new PhoneVerificationError('잠시 후 인증번호를 다시 요청해 주세요.', 'SMS_COOLDOWN', 429, Math.ceil((latest + COOLDOWN - now) / 1000));
      }
      if (phoneRows.length >= 5 || rows.filter(row => row.clientHash === clientHash).length >= 20 || rows.length >= 100) {
        throw new PhoneVerificationError('문자 발송 요청이 너무 많습니다. 한 시간 후 다시 시도해 주세요.', 'SMS_RATE_LIMITED', 429, 3600);
      }
      // Reserving before the external call prevents concurrent double sends.
      // The reservation remains on failure/timeout, when delivery may be unknown.
      rows.push({ id, phoneHash, clientHash, codeHash: this.hash(`code:${id}:${code}`), createdAt: now, expiresAt: now + TTL, attempts: 0, status: 'pending' });
      db.setServerRecords('phone_verification', rows);
    });
    try {
      await this.sender.send(phone, code);
    } catch (error) {
      await this.store.write(db => {
        const rows = db.getServerRecords('phone_verification') as Challenge[];
        const row = rows.find(item => item.id === id);
        if (row) row.status = 'failed';
        db.setServerRecords('phone_verification', rows);
      });
      throw error;
    }
    await this.store.write(db => {
      const rows = db.getServerRecords('phone_verification') as Challenge[];
      for (const row of rows) {
        if (row.phoneHash === phoneHash && row.id !== id) row.status = 'failed';
        if (row.id === id) row.status = 'sent';
      }
      db.setServerRecords('phone_verification', rows);
    });
    return { challengeId: id, expiresAt: now + TTL, retryAfter: COOLDOWN / 1000 };
  }

  async verify(phoneInput: unknown, challengeId: unknown, code: unknown): Promise<{ verificationToken: string; expiresAt: number }> {
    const phone = normalizePhone(phoneInput);
    if (typeof challengeId !== 'string' || challengeId.length > 100 || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw new PhoneVerificationError('인증번호 6자리를 입력해 주세요.', 'INVALID_CODE');
    }
    const now = this.now();
    const token = crypto.randomBytes(32).toString('base64url');
    // Return failures from the transaction, then throw: failed attempts must persist.
    const result = await this.store.write(db => {
      const rows = db.getServerRecords('phone_verification') as Challenge[];
      const row = rows.find(item => item.id === challengeId && item.phoneHash === this.hash(`phone:${phone}`));
      if (!row || row.status !== 'sent' || now >= row.expiresAt || row.attempts >= 5) return false;
      row.attempts += 1;
      const valid = crypto.timingSafeEqual(Buffer.from(row.codeHash, 'hex'), Buffer.from(this.hash(`code:${challengeId}:${code}`), 'hex'));
      if (valid) {
        row.status = 'verified';
        row.tokenHash = this.hash(`token:${token}`);
        row.tokenExpiresAt = now + 10 * 60 * 1000;
      }
      db.setServerRecords('phone_verification', rows);
      return valid;
    });
    if (!result) throw new PhoneVerificationError('인증번호가 일치하지 않거나 만료되었습니다. 5회 실패한 경우 다시 발송해 주세요.', 'VERIFICATION_FAILED');
    return { verificationToken: token, expiresAt: now + 10 * 60 * 1000 };
  }

  /** Called inside the same transaction as account creation to prevent reuse. */
  consume(db: HaloXDatabase, phoneInput: unknown, token: unknown): string {
    const phone = normalizePhone(phoneInput);
    if (typeof token !== 'string' || token.length !== 43) throw new PhoneVerificationError('휴대폰 인증을 먼저 완료해 주세요.', 'PHONE_VERIFICATION_REQUIRED');
    const rows = db.getServerRecords('phone_verification') as Challenge[];
    const row = rows.find(item => item.phoneHash === this.hash(`phone:${phone}`) && item.tokenHash === this.hash(`token:${token}`));
    if (!row || row.status !== 'verified' || !row.tokenExpiresAt || this.now() >= row.tokenExpiresAt) {
      throw new PhoneVerificationError('휴대폰 인증이 만료되었습니다. 다시 인증해 주세요.', 'PHONE_VERIFICATION_REQUIRED');
    }
    row.status = 'consumed';
    delete row.tokenHash;
    db.setServerRecords('phone_verification', rows);
    return phone;
  }
}
