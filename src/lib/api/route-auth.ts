import { NextResponse } from 'next/server';
import { SessionConfigError, actorFromHeaders } from '@/lib/backend/session';

export type AuthResult = { actor: string; response?: undefined } | { actor?: undefined; response: NextResponse };

/**
 * Resolve the acting user from a verified session (cookie or Bearer token).
 * Returns a ready 401/500 response instead of throwing so route handlers can return early.
 */
export function authenticate(req: Request): AuthResult {
  try {
    const actor = actorFromHeaders(req.headers);
    if (actor) return { actor };
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
