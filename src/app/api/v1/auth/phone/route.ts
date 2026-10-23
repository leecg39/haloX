import { NextRequest, NextResponse } from 'next/server';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { PhoneVerificationService } from '@/lib/backend/phone-verification';
import { createSolapiSender, PhoneVerificationError } from '@/lib/backend/sms';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown> | null;
    if (!body || (body.action !== 'send' && body.action !== 'verify')) {
      return NextResponse.json({ error: '요청 내용을 확인해 주세요.' }, { status: 400 });
    }
    const service = new PhoneVerificationService(haloxStore, body.action === 'send' ? createSolapiSender() : null, process.env.HALOX_SESSION_SECRET || '');
    const client = process.env.HALOX_TRUST_PROXY === '1'
      ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'shared'
      : 'shared';
    const result = body.action === 'send'
      ? await service.send(body.phone, client)
      : await service.verify(body.phone, body.challengeId, body.code);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PhoneVerificationError) {
      return NextResponse.json({ error: error.message, code: error.code }, {
        status: error.status,
        headers: error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {},
      });
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: '요청 형식을 확인해 주세요.' }, { status: 400 });
    const unavailable = new StorageUnavailableError();
    return NextResponse.json({ error: unavailable.message, code: unavailable.code }, { status: 503 });
  }
}
