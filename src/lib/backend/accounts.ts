import crypto from 'node:crypto';
import { validateReferralCode, recordReferralSignup } from './referral-service.ts';
import { promisify } from 'node:util';
import { ADMIN_USER_ID, DEFAULT_USER_ID, OTHER_USER_ID } from './database.ts';
import type { PersistentHaloXStore } from './store.ts';
import type { PhoneVerificationService } from './phone-verification.ts';
import { verifyDemoPassword } from './session.ts';
import { normalizePhone, PhoneVerificationError } from './sms.ts';

const scrypt = promisify(crypto.scrypt);
const SEEDED_ACCOUNTS = new Set([ADMIN_USER_ID, DEFAULT_USER_ID, OTHER_USER_ID]);

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPasswordHash(password: string, hash: string): Promise<boolean> {
  const [algorithm, salt, expected] = hash.split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  return crypto.timingSafeEqual(key, Buffer.from(expected, 'hex'));
}

export async function authenticatePassword(store: PersistentHaloXStore, email: string, password: string) {
  const { profile, credential } = await store.read(db => {
    const profile = db.findProfileByEmail(email);
    const credential = db.getServerRecords('account_credentials').find(row => row.user_id === profile?.id);
    return { profile, credential };
  });
  if (profile && credential && typeof credential.password_hash === 'string') {
    return await verifyPasswordHash(password, credential.password_hash) ? profile : null;
  }
  if (profile && SEEDED_ACCOUNTS.has(profile.id)) return verifyDemoPassword(password) ? profile : null;
  // Unknown accounts do the same expensive derivation as registered accounts.
  await scrypt(password, '00000000000000000000000000000000', 64);
  return null;
}

export async function registerAccount(store: PersistentHaloXStore, verification: PhoneVerificationService, body: Record<string, unknown>) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !fullName || fullName.length > 100 || password.length < 8 || password.length > 128) {
    throw new PhoneVerificationError('이름, 이메일과 8~128자 비밀번호를 확인해 주세요.', 'INVALID_SIGNUP');
  }
  const phone = normalizePhone(body.phone);
  if (typeof body.verificationToken !== 'string' || body.verificationToken.length !== 43) {
    throw new PhoneVerificationError('휴대폰 인증을 먼저 완료해 주세요.', 'PHONE_VERIFICATION_REQUIRED');
  }
  const passwordHash = await hashPassword(password);
  return store.write(db => {
    const referral = validateReferralCode(db, body.referralCode, email);
    verification.consume(db, phone, body.verificationToken);
    const account = db.createAccount({ email, fullName, phone, passwordHash });
    recordReferralSignup(db, referral, account);
    return account;
  });
}
