import { NextResponse } from 'next/server';
import { AuthRequiredError, SessionConfigError } from '@/lib/backend/session';
import { PhoneVerificationError } from '@/lib/backend/sms';
import { StorageUnavailableError } from '@/lib/backend/store';

export async function accountBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 16_384) throw new PhoneVerificationError('입력 내용이 너무 깁니다.', 'BODY_TOO_LARGE', 413);
  const body = JSON.parse(text);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PhoneVerificationError('입력 내용을 확인해 주세요.', 'INVALID_REQUEST');
  return body;
}
export const accountClient = (request: Request) => process.env.HALOX_TRUST_PROXY === '1' ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'shared' : 'shared';
export function accountError(error: unknown) {
  if (error instanceof PhoneVerificationError || error instanceof AuthRequiredError || error instanceof SessionConfigError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store', ...(error instanceof PhoneVerificationError && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}) } });
  if (error instanceof StorageUnavailableError) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
  if (error instanceof Error && error.message.startsWith('이미 등록된')) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ error: '요청을 처리하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.' }, { status: 400 });
}
