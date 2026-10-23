import { NextResponse } from 'next/server';
import { AuthRequiredError, SessionConfigError, sessionFromHeaders } from '@/lib/backend/session';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';
import { resolveSession } from '@/lib/backend/account-session';
import { createRateLimiter } from '@/lib/backend/rate-limit';

// Authenticated API budget per user.
const apiRequestsByActor = createRateLimiter({ limit: 300, windowMs: 60_000 });

export type AuthResult = { actor: string; sessionId?: string; response?: undefined } | { actor?: undefined; response: NextResponse };

/**
 * Resolve the acting user from a verified session (cookie or Bearer token).
 * Returns a ready 401/500 response instead of throwing so route handlers can return early.
 */
export async function authenticate(req: Request): Promise<AuthResult> {
  try {
    const claims = sessionFromHeaders(req.headers);
    if (!claims) throw new AuthRequiredError();
    const session = await haloxStore.read(db => resolveSession(db, claims));
    const actor = session.actor;
    if (actor) {
      const budget = apiRequestsByActor.hit(actor);
      if (budget.allowed) return session;
      return {
        response: NextResponse.json(
          { error: 'Too many requests', code: 'RATE_LIMITED' },
          { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } }
        ),
      };
    }
    return {
      response: NextResponse.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, { status: 401 }),
    };
  } catch (error) {
    if (error instanceof AuthRequiredError) return { response: NextResponse.json({ error: error.message, code: error.code }, { status: 401 }) };
    if (error instanceof StorageUnavailableError) return { response: NextResponse.json({ error: error.message, code: error.code }, { status: 503 }) };
    if (error instanceof SessionConfigError) {
      console.error('Session configuration error:', error.message);
      return {
        response: NextResponse.json({ error: 'Server authentication is not configured', code: error.code }, { status: 500 }),
      };
    }
    throw error;
  }
}
