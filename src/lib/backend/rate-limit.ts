/**
 * In-process fixed-window rate limiter.
 * Suitable for the single-process local runtime; a multi-instance deployment needs a shared store.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Count one attempt for `key` and report whether it is allowed. */
  hit(key: string): RateLimitResult;
  /** Report the state for `key` without counting an attempt. */
  check(key: string): RateLimitResult;
  reset(key: string): void;
  size(): number;
}

interface Options {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}

export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }: Options): RateLimiter {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('windowMs must be positive');

  let windows = new Map<string, { start: number; count: number }>();

  const prune = (t: number) => {
    windows = new Map([...windows].filter(([, w]) => t - w.start < windowMs));
    if (windows.size > maxKeys) windows = new Map([...windows].slice(windows.size - maxKeys));
  };

  const state = (key: string, t: number) => {
    const w = windows.get(key);
    return w && t - w.start < windowMs ? w : null;
  };

  const result = (w: { start: number; count: number } | null, t: number): RateLimitResult => {
    const count = w?.count ?? 0;
    const allowed = count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: allowed || !w ? 0 : Math.ceil((w.start + windowMs - t) / 1000),
    };
  };

  return {
    hit(key) {
      const t = now();
      const current = state(key, t);
      const next = current ? { start: current.start, count: current.count + 1 } : { start: t, count: 1 };
      windows = new Map(windows).set(key, next);
      if (windows.size > maxKeys) prune(t);
      return result(next, t);
    },
    check(key) {
      const t = now();
      const current = state(key, t);
      // A check reports whether the *next* attempt would be allowed.
      return current ? result({ ...current, count: current.count + 1 }, t) : result(null, t);
    },
    reset(key) {
      const copy = new Map(windows);
      copy.delete(key);
      windows = copy;
    },
    size() {
      prune(now());
      return windows.size;
    },
  };
}
