import crypto from 'node:crypto';
import { ExternalServiceError } from './public-json.ts';

function key(env: Record<string, string | undefined>) {
  const secret = env.HALOX_INTEGRATION_SECRET || env.HALOX_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new ExternalServiceError('서버의 연동 암호화 키를 설정해 주세요.', 'INTEGRATION_KEY_MISSING', 503, false);
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'halox-integrations-v1', 'credential-encryption', 32));
}
export function sealIntegrationSecret(value: string, scope: string, env: Record<string, string | undefined> = process.env) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(env), iv); cipher.setAAD(Buffer.from(scope));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function openIntegrationSecret(value: string, scope: string, env: Record<string, string | undefined> = process.env) {
  try {
    const [version, iv, tag, encrypted, extra] = value.split('.');
    if (version !== 'v1' || extra || !encrypted) throw new Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(env), Buffer.from(iv, 'base64url')); decipher.setAAD(Buffer.from(scope)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new ExternalServiceError('저장한 자격증명을 읽을 수 없습니다. 연결 비밀번호를 다시 저장해 주세요.', 'INTEGRATION_KEY_INVALID', 503, false); }
}
