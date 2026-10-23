import { NextResponse } from 'next/server';
import { accountBody, accountClient, accountError } from '@/lib/api/account-http';
import { haloxStore } from '@/lib/backend/store';
import { runRecoveryCommand } from '@/lib/backend/account-security';
import { PhoneVerificationService } from '@/lib/backend/phone-verification';
import { createSolapiSender } from '@/lib/backend/sms';
import { createRateLimiter } from '@/lib/backend/rate-limit';

const requests = createRateLimiter({ limit: 30, windowMs: 60_000 });
export async function POST(request: Request) {
  const client = accountClient(request), budget = requests.hit(client);
  if (!budget.allowed) return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } });
  try {
    const body = await accountBody(request);
    const verification = new PhoneVerificationService(haloxStore, body.action === 'send' ? createSolapiSender() : null, process.env.HALOX_SESSION_SECRET || '');
    return NextResponse.json(await runRecoveryCommand(haloxStore, verification, body, client), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accountError(error); }
}
