import { NextResponse } from 'next/server';
import { assertActiveSession } from '@/lib/backend/account-session';
import { authenticate } from '@/lib/api/route-auth';
import { accountBody, accountError } from '@/lib/api/account-http';
import { haloxStore } from '@/lib/backend/store';
import { requestAccountDeletion } from '@/lib/backend/account-deletion-service';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/backend/session';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try { return NextResponse.json(await haloxStore.read(db => { assertActiveSession(db, auth.actor, auth.sessionId!); return db.accountDeletionView(auth.actor); }), { headers }); } catch (error) { return accountError(error); }
}
export async function POST(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  try {
    const result = await requestAccountDeletion(haloxStore, auth.actor, auth.sessionId!, await accountBody(request));
    const response = NextResponse.json(result, { headers }); response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 }); return response;
  } catch (error) { return accountError(error); }
}
