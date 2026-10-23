import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { createRateLimiter } from '@/lib/backend/rate-limit';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { RlsAccessDeniedError } from '@/lib/backend/database';
import { createContactRequest, runSiteContentCommand } from '@/lib/backend/site-content-service';
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
const ip = (request: NextRequest) => request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action) { const auth = await authenticate(request); if (auth.response) return auth.response; return NextResponse.json(await haloxStore.write(db => runSiteContentCommand(db, auth.actor, String(body.action), body))); }
    const address = ip(request), budget = limiter.hit(address); if (!budget.allowed) return NextResponse.json({ error: '잠시 후 다시 문의해 주세요.' }, { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } });
    return NextResponse.json(await haloxStore.write(db => createContactRequest(db, body, { ip: address })), { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '문의 접수 실패' }, { status: error instanceof RlsAccessDeniedError ? 403 : error instanceof StorageUnavailableError ? 503 : 400 }); }
}
