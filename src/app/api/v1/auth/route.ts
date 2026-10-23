import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/api/route-auth';
import { type HaloXDatabase } from '@/lib/backend/database';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import {
  SESSION_COOKIE,
  SessionConfigError,
  createSessionToken,
  sessionCookieOptions,
} from '@/lib/backend/session';
import { createRateLimiter, type RateLimitResult } from '@/lib/backend/rate-limit';
import { authenticatePassword } from '@/lib/backend/accounts';

// Failed-login limits (15 min windows): per client+email, per email (spoofed IPs), per client.
const WINDOW_MS = 15 * 60 * 1000;
const failuresByClientEmail = createRateLimiter({ limit: 5, windowMs: WINDOW_MS });
const failuresByEmail = createRateLimiter({ limit: 10, windowMs: WINDOW_MS });
const failuresByClient = createRateLimiter({ limit: 20, windowMs: WINDOW_MS });

function clientKey(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

function tooManyAttempts(results: RateLimitResult[]) {
  const retryAfter = Math.max(...results.map(r => r.retryAfterSeconds));
  return NextResponse.json(
    { error: 'Too many login attempts. Try again later.', code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionView(db: HaloXDatabase, userId: string) {
  const profile = db.queryTable('profiles', {}, userId).data[0];
  const workspaces = db.queryTable('workspaces', {}, userId).data;
  return {
    user: profile
      ? { id: profile.id, email: profile.email, full_name: profile.full_name }
      : { id: userId },
    default_workspace_id: workspaces[0]?.id || null,
    workspaces,
    workspace_plans: db.queryTable('workspace_plans', {}, userId).data,
  };
}

/** Current session. */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if (auth.response) return auth.response;
  try {
    const session = await haloxStore.read(db => sessionView(db, auth.actor));
    return NextResponse.json({ authenticated: true, ...session }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    const error = new StorageUnavailableError();
    return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
  }
}

/** Password login: validates input, checks credentials, issues a signed session cookie. */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON body required', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!EMAIL_RE.test(email) || email.length > 254 || !password || password.length > 512) {
    return NextResponse.json({ error: 'Valid email and password are required', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const keys = { clientEmail: `${clientKey(req)}|${email.toLowerCase()}`, email: email.toLowerCase(), client: clientKey(req) };
  const precheck = [
    failuresByClientEmail.check(keys.clientEmail),
    failuresByEmail.check(keys.email),
    failuresByClient.check(keys.client),
  ];
  if (precheck.some(r => !r.allowed)) return tooManyAttempts(precheck.filter(r => !r.allowed));

  try {
    const profile = await authenticatePassword(haloxStore, email, password);
    if (!profile) {
      failuresByClientEmail.hit(keys.clientEmail);
      failuresByEmail.hit(keys.email);
      failuresByClient.hit(keys.client);
      return NextResponse.json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' }, { status: 401 });
    }

    failuresByClientEmail.reset(keys.clientEmail);
    failuresByEmail.reset(keys.email);
    const token = createSessionToken(profile.id);
    const session = await haloxStore.write(db => {
      db.callRpc('record_auth_login', { p_method: 'password', p_device_id: null }, profile.id);
      return sessionView(db, profile.id);
    });
    const res = NextResponse.json({ ok: true, access_token: token, token_type: 'bearer', ...session });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
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
