import crypto from 'node:crypto';

export class PhoneVerificationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter: number;
  constructor(message: string, code: string, status = 400, retryAfter = 0) {
    super(message);
    this.name = 'PhoneVerificationError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || !/^[+\d\s()-]+$/.test(value) || value.length > 25) {
    throw new PhoneVerificationError('휴대폰 번호를 확인해 주세요.', 'INVALID_PHONE');
  }
  const phone = value.replace(/\D/g, '').replace(/^82/, '0');
  if (!/^010\d{8}$/.test(phone)) throw new PhoneVerificationError('010으로 시작하는 휴대폰 번호 11자리를 입력해 주세요.', 'INVALID_PHONE');
  return phone;
}

export interface SmsSender {
  send(phone: string, code: string, purpose?: 'signup' | 'password-reset' | 'phone-change'): Promise<void>;
}

export function createSolapiSender(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): SmsSender {
  const apiKey = env.SOLAPI_API_KEY;
  const apiSecret = env.SOLAPI_API_SECRET;
  const sender = env.SOLAPI_SENDER?.replace(/\D/g, '');
  if (!apiKey || !apiSecret || !sender || !/^\d{8,11}$/.test(sender)) {
    throw new PhoneVerificationError('문자 인증 서비스가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.', 'SMS_NOT_CONFIGURED', 503);
  }
  return {
    async send(phone, code, purpose = 'signup') {
      const date = new Date().toISOString();
      const salt = crypto.randomBytes(16).toString('hex');
      const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
      try {
        const response = await fetcher('https://api.solapi.com/messages/v4/send-many/detail', {
          method: 'POST',
          headers: {
            Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messages: [{ to: phone, from: sender, text: `[HaloX] ${purpose === 'password-reset' ? '비밀번호 재설정' : purpose === 'phone-change' ? '전화번호 변경' : '회원가입'} 인증번호 [${code}] (5분 내 입력)`, type: 'SMS' }] }),
          signal: AbortSignal.timeout(8_000),
        });
        const body = await response.json() as {
          failedMessageList?: unknown[];
          groupInfo?: { groupId?: string; status?: string; count?: { registeredSuccess?: number; registeredFailed?: number } };
        };
        if (!response.ok || !body?.groupInfo?.groupId || body.groupInfo.status === 'FAILED' ||
            !Array.isArray(body.failedMessageList) || body.failedMessageList.length ||
            body.groupInfo.count?.registeredSuccess !== 1 || body.groupInfo.count?.registeredFailed !== 0) {
          throw new Error('SMS not accepted');
        }
      } catch {
        // Never expose provider responses, phone numbers, codes, or credentials.
        throw new PhoneVerificationError('문자 발송 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'SMS_SEND_FAILED', 502, 60);
      }
    },
  };
}
