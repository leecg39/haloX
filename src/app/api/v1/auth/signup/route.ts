import { NextRequest, NextResponse } from 'next/server';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { registerAccount } from '@/lib/backend/accounts';
import { PhoneVerificationService } from '@/lib/backend/phone-verification';
import { PhoneVerificationError } from '@/lib/backend/sms';
import { createRateLimiter } from '@/lib/backend/rate-limit';

const attempts = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(req: NextRequest) {
  const client = process.env.HALOX_TRUST_PROXY === '1' ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'shared' : 'shared';
  const budget = attempts.hit(client);
  if (!budget.allowed) return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } });
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '입력 내용을 확인해 주세요.' }, { status: 400 });
    const service = new PhoneVerificationService(haloxStore, null, process.env.HALOX_SESSION_SECRET || '');
    await registerAccount(haloxStore, service, body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof PhoneVerificationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof StorageUnavailableError) return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    // Duplicate identities are an expected conflict, other internals stay private.
    if (error instanceof Error && error.message.startsWith('이미 등록된')) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: '가입을 완료하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.' }, { status: 400 });
  }
}
