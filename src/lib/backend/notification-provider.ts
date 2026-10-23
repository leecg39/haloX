import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';
import { ExternalServiceError } from './public-json.ts';
export type NotificationChannel = 'email' | 'sms';
export type DeliveryResult = 'accepted' | 'delivered' | 'failed';
export interface NotificationProvider {
  configured(channel: NotificationChannel): boolean;
  send(channel: NotificationChannel, target: string, title: string, text: string, key: string): Promise<string>;
  status(channel: NotificationChannel, id: string): Promise<DeliveryResult>;
}
export type SmtpFactory = (options: SMTPTransportOptions) => { sendMail(input: { from: string; to: string; subject: string; text: string; messageId: string }): Promise<{ accepted: unknown[]; rejected: unknown[] }>; close(): void };
export function createNotificationProvider(env: Partial<NodeJS.ProcessEnv> = process.env, fetcher: typeof fetch = fetch, smtp: SmtpFactory = options => nodemailer.createTransport(options)): NotificationProvider {
  const configured = (channel: NotificationChannel) => channel === 'email' ? !!(env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASSWORD && env.NOTIFICATION_EMAIL_FROM?.trim() && Number.isInteger(Number(env.SMTP_PORT || 465)) && Number(env.SMTP_PORT || 465) > 0 && Number(env.SMTP_PORT || 465) < 65536) : !!(env.SOLAPI_API_KEY?.trim() && env.SOLAPI_API_SECRET?.trim() && /^\d{8,11}$/.test(env.SOLAPI_SENDER || ''));
  function auth(channel: NotificationChannel) {
    if (!configured(channel)) throw new ExternalServiceError('알림 발송 서비스 설정이 필요합니다.', 'NOTIFICATION_NOT_CONFIGURED', 503, false);
    const date = new Date().toISOString(), salt = crypto.randomBytes(16).toString('hex'), signature = crypto.createHmac('sha256', env.SOLAPI_API_SECRET!.trim()).update(date + salt).digest('hex');
    return `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY!.trim()}, date=${date}, salt=${salt}, signature=${signature}`;
  }
  async function request(channel: NotificationChannel, path: string, body?: unknown) {
    const authorization = auth(channel);
    try {
      const response = await fetcher(`https://api.solapi.com${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Authorization: authorization, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) { await response.body?.cancel(); throw new ExternalServiceError('제공사가 알림 요청을 처리하지 못했습니다.', 'NOTIFICATION_PROVIDER_ERROR', 502, response.status >= 500 || response.status === 408 || response.status === 409); }
      const reader = response.body?.getReader(); if (!reader) throw new Error();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 512 * 1024) { await reader.cancel(); throw new Error(); } chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { if (error instanceof ExternalServiceError) throw error; throw new ExternalServiceError('제공사의 응답을 확인하지 못했습니다. 중복 방지를 위해 다시 보내지 않습니다.', 'NOTIFICATION_UNKNOWN', 502, true); }
  }
  return { configured,
    async send(channel, target, title, text, key) {
      if (!configured(channel)) throw new ExternalServiceError('알림 발송 서비스 설정이 필요합니다.', 'NOTIFICATION_NOT_CONFIGURED', 503, false);
      if (channel === 'email') {
        const port = Number(env.SMTP_PORT || 465), transport = smtp({ host: env.SMTP_HOST!.trim(), port, secure: port === 465, requireTLS: port !== 465, auth: { user: env.SMTP_USER!.trim(), pass: env.SMTP_PASSWORD! }, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000, dnsTimeout: 5000, tls: { rejectUnauthorized: true }, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
        const id = `<${crypto.createHash('sha256').update(key).digest('hex')}@halox.notification>`;
        try {
          const result = await transport.sendMail({ from: env.NOTIFICATION_EMAIL_FROM!, to: target, subject: title, text, messageId: id });
          if (result.accepted.length === 1 && !result.rejected.length) return id;
          throw new ExternalServiceError('SMTP 서버가 수신자를 거절했습니다.', 'NOTIFICATION_REJECTED', 502, false);
        } catch (error) {
          if (error instanceof ExternalServiceError) throw error;
          const info = error as { code?: string; responseCode?: number };
          const rejected = ['EAUTH', 'EENVELOPE', 'EDNS'].includes(info.code || '') || Number(info.responseCode) >= 400;
          throw new ExternalServiceError(rejected ? 'SMTP 서버가 발송을 거절했습니다.' : 'SMTP 발송 결과를 확인하지 못했습니다. 중복 방지를 위해 다시 보내지 않습니다.', 'NOTIFICATION_SMTP_ERROR', 502, !rejected);
        } finally { transport.close(); }
      }
      const body = { messages: [{ to: target, from: env.SOLAPI_SENDER, type: 'LMS', subject: '[HaloX] 알림', text }] };
      const result = await request(channel, '/messages/v4/send-many/detail', body);
      if (channel === 'sms') {
        const group = result.groupInfo;
        if (group?.count?.registeredFailed === 1 && group?.count?.registeredSuccess === 0) throw new ExternalServiceError('문자 제공사가 발송을 거절했습니다.', 'NOTIFICATION_REJECTED', 502, false);
        if (typeof group?.groupId === 'string' && /^[\w-]{1,100}$/.test(group.groupId) && group.count?.registeredSuccess === 1 && group.count?.registeredFailed === 0 && Array.isArray(result.failedMessageList) && !result.failedMessageList.length) return group.groupId;
      }
      throw new ExternalServiceError('제공사의 발송 접수 여부를 확인하지 못했습니다.', 'NOTIFICATION_UNKNOWN', 502, true);
    },
    async status(channel, id) {
      if (channel === 'email') return 'accepted'; // SMTP acknowledgement does not prove mailbox delivery.
      if (!/^[\w-]{1,100}$/.test(id)) throw new Error('잘못된 발송 식별자입니다.');
      const result = await request(channel, `/messages/v4/groups/${id}`);
      if (result.groupId !== id) throw new Error('발송 그룹이 일치하지 않습니다.');
      return result.count?.sentFailed === 1 ? 'failed' : result.count?.sentSuccess === 1 ? 'delivered' : 'accepted';
    },
  };
}
