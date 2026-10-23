import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { DEFAULT_WORKSPACE_ID, haloxDb } from '@/lib/backend/database';
import {
  SESSION_COOKIE,
  SessionConfigError,
  createSessionToken,
  sessionCookieOptions,
  verifyDemoPassword,
} from '@/lib/backend/session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionView(userId: string) {
  const profile = haloxDb.queryTable('profiles', {}, userId).data[0];
  const workspaces = haloxDb.queryTable('workspaces', {}, userId).data;
  return {
    user: profile
      ? { id: profile.id, email: profile.email, full_name: profile.full_name }
      : { id: userId },
    default_workspace_id: workspaces[0]?.id || DEFAULT_WORKSPACE_ID,
    workspaces,
  };
}

/** Current session. */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if (auth.response) return auth.response;
  return NextResponse.json({ authenticated: true, ...sessionView(auth.actor) });
}

/** Password login: validates input, checks credentials, issues a signed session cookie. */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON body required', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!EMAIL_RE.test(email) || email.length > 254 || !password || password.length > 512) {
    return NextResponse.json({ error: 'Valid email and password are required', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  try {
    const profile = haloxDb.findProfileByEmail(email);
    // Always run the password check so unknown emails and wrong passwords take similar time.
    const passwordOk = verifyDemoPassword(password);
    if (!profile || !passwordOk) {
      return NextResponse.json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' }, { status: 401 });
    }

    const token = createSessionToken(profile.id);
    haloxDb.callRpc('record_auth_login', { p_method: 'password', p_device_id: null }, profile.id);
    const res = NextResponse.json({ ok: true, access_token: token, token_type: 'bearer', ...sessionView(profile.id) });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (error) {
    if (error instanceof SessionConfigError) {
      console.error('Session configuration error:', error.message);
      return NextResponse.json({ error: 'Server authentication is not configured', code: error.code }, { status: 500 });
    }
    console.error('Login failed:', error);
    return NextResponse.json({ error: 'Login failed', code: 'LOGIN_FAILED' }, { status: 500 });
  }
}

/** Logout: clears the session cookie. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
