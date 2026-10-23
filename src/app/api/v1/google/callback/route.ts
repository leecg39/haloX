import { NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { haloxStore } from '@/lib/backend/store';
import { finishGoogleOAuth } from '@/lib/backend/google-service';
import { googleConfig } from '@/lib/backend/google-client';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const auth = await authenticate(request); if (auth.response) return auth.response;
  let target: URL;
  try { target = new URL('/app/settings?tab=integrations', googleConfig().redirectUri); }
  catch { return NextResponse.json({ error: 'Google OAuth 설정이 필요합니다.' }, { status: 503 }); }
  try {
    const query = new URL(request.url).searchParams;
    await finishGoogleOAuth(haloxStore, auth.actor, auth.sessionId!, query.get('state') || '', query.get('code') || '', query.has('error'));
    target.searchParams.set('google', 'connected');
  } catch { target.searchParams.set('google', 'failed'); }
  const response = NextResponse.redirect(target, 303); response.headers.set('Cache-Control', 'no-store'); response.headers.set('Referrer-Policy', 'no-referrer'); return response;
}
