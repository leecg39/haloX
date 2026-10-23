/**
 * Fixed-window rate limiter used for login attempts and authenticated API calls.
 * Run: node --experimental-strip-types --test src/lib/backend/rate-limit.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './rate-limit.ts';

describe('createRateLimiter', () => {
  it('allows up to the limit within a window, then blocks with a retry hint', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 3; i += 1) assert.equal(limiter.hit('k').allowed, true, `hit ${i}`);
    const blocked = limiter.hit('k');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 60);
    now += 30_000;
    assert.equal(limiter.hit('k').retryAfterSeconds, 30);
  });

  it('opens again after the window passes', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });
    assert.equal(limiter.hit('k').allowed, true);
    assert.equal(limiter.hit('k').allowed, false);
    now = 1_000;
    assert.equal(limiter.hit('k').allowed, true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    assert.equal(limiter.hit('a').allowed, true);
    assert.equal(limiter.hit('a').allowed, false);
    assert.equal(limiter.hit('b').allowed, true);
  });

  it('check() reports state without consuming, reset() clears a key', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    assert.equal(limiter.check('k').allowed, true);
    assert.equal(limiter.check('k').allowed, true);
    limiter.hit('k');
    assert.equal(limiter.check('k').allowed, false);
    limiter.reset('k');
    assert.equal(limiter.check('k').allowed, true);
  });

  it('evicts expired entries so memory stays bounded', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now, maxKeys: 10 });
    for (let i = 0; i < 50; i += 1) limiter.hit(`k${i}`);
    assert.ok(limiter.size() <= 10, `size ${limiter.size()}`);
    now = 5_000;
    limiter.hit('fresh');
    assert.equal(limiter.size(), 1);
  });

  it('rejects invalid configuration', () => {
    assert.throws(() => createRateLimiter({ limit: 0, windowMs: 1_000 }));
    assert.throws(() => createRateLimiter({ limit: 1, windowMs: 0 }));
  });
});
