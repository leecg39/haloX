import { NextResponse } from 'next/server';
import { SessionConfigError, actorFromHeaders } from '@/lib/backend/session';
import { createRateLimiter } from '@/lib/backend/rate-limit';

// Authenticated API budget per user.
const apiRequestsByActor = createRateLimiter({ limit: 300, windowMs: 60_000 });

export type AuthResult = { actor: string; response?: undefined } | { actor?: undefined; response: NextResponse };

/**
 * Resolve the acting user from a verified session (cookie or Bearer token).
 * Returns a ready 401/500 response instead of throwing so route handlers can return early.
 */
export function authenticate(req: Request): AuthResult {
  try {
    const actor = actorFromHeaders(req.headers);
    if (actor) {
      const budget = apiRequestsByActor.hit(actor);
      if (budget.allowed) return { actor };
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
    if (error instanceof SessionConfigError) {
      console.error('Session configuration error:', error.message);
      return {
        response: NextResponse.json({ error: 'Server authentication is not configured', code: error.code }, { status: 500 }),
      };
    }
    throw error;
  }
}
