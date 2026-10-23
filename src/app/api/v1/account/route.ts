import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { accountBody, accountClient, accountError } from '@/lib/api/account-http';
import { haloxStore } from '@/lib/backend/store';
import { readAccount, runAccountCommand } from '@/lib/backend/account-security';
import { PhoneVerificationService } from '@/lib/backend/phone-verification';
import { createSolapiSender } from '@/lib/backend/sms';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/backend/session';

export async function GET(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { return NextResponse.json(await haloxStore.read(db => readAccount(db, auth.actor, auth.sessionId!)), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return accountError(error); }
}
export async function POST(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try {
    const body = await accountBody(request);
    const verification = new PhoneVerificationService(haloxStore, body.action === 'phone-send' ? createSolapiSender() : null, process.env.HALOX_SESSION_SECRET || '');
    const result = await runAccountCommand(haloxStore, verification, auth.actor, auth.sessionId!, body, accountClient(request));
    const response = NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    if ('reauthenticate' in result && result.reauthenticate) response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch (error) { return accountError(error); }
}
