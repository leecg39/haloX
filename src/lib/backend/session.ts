/**
 * Signed session tokens (HMAC-SHA256) for the /api/v1 surface.
 *
 * Replaces the former `x-halox-user-id` header, which let any caller act as any user.
 * Token format: `v1.<base64url(JSON {sub, exp})>.<base64url(HMAC-SHA256)>`.
 * Secrets come only from the environment and fail fast when missing.
 */
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'halox_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TOKEN_VERSION = 'v1';
const MIN_SECRET_LENGTH = 32;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionConfigError extends Error {
  public readonly code = 'SESSION_CONFIG_MISSING';
  public readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = 'SessionConfigError';
  }
}

export class AuthRequiredError extends Error {
  public readonly code = 'AUTH_REQUIRED';
  public readonly status = 401;
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

function sessionSecret(): string {
  const secret = process.env.HALOX_SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new SessionConfigError(
      `HALOX_SESSION_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters (see .env.example)`
    );
  }
  return secret;
}

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${TOKEN_VERSION}.${body}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createSessionToken(userId: string, options: { now?: number } = {}): string {
  if (!UUID_RE.test(userId)) throw new Error('Session subject must be a user UUID');
  const issuedAt = options.now ?? Date.now();
  const body = Buffer.from(JSON.stringify({ sub: userId, exp: issuedAt + SESSION_TTL_MS })).toString('base64url');
  return `${TOKEN_VERSION}.${body}.${sign(body, sessionSecret())}`;
}

/** Returns the user id for a valid, unexpired token; null for anything else. */
export function verifySessionToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, body, signature] = parts;
  if (!safeEqual(signature, sign(body, sessionSecret()))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown };
    if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** Actor from the session cookie or an `Authorization: Bearer <session>` header. */
export function actorFromHeaders(headers: Headers): string | null {
  const bearer = headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  return verifySessionToken(cookieValue(headers.get('cookie'), SESSION_COOKIE)) ?? verifySessionToken(bearer);
}

export function requireActor(headers: Headers): string {
  const actor = actorFromHeaders(headers);
  if (!actor) throw new AuthRequiredError();
  return actor;
}

/** Local demo credential check against HALOX_DEMO_PASSWORD (timing-safe). */
export function verifyDemoPassword(password: unknown): boolean {
  const expected = process.env.HALOX_DEMO_PASSWORD;
  if (!expected) {
    throw new SessionConfigError('HALOX_DEMO_PASSWORD must be set (see .env.example)');
  }
  if (typeof password !== 'string' || !password) return false;
  const a = crypto.createHash('sha256').update(password).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function sessionCookieOptions(): {
  httpOnly: true; sameSite: 'lax'; secure: boolean; path: string; maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.HALOX_INSECURE_COOKIES !== '1',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
