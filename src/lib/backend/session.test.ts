/**
 * Signed session tokens replacing the spoofable x-halox-user-id header.
 * Run: node --experimental-strip-types --test src/lib/backend/session.test.ts
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_COOKIE,
  SessionConfigError,
  actorFromHeaders,
  createSessionToken,
  verifySessionToken,
  verifyDemoPassword,
} from './session.ts';

const USER = '00000000-0000-4000-8000-000000000001';
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

describe('session tokens', () => {
  beforeEach(() => {
    process.env.HALOX_SESSION_SECRET = SECRET;
  });

  it('round-trips the user id', () => {
    const token = createSessionToken(USER);
    assert.equal(verifySessionToken(token), USER);
  });

  it('rejects a token whose payload was altered', () => {
    const [v, , sig] = createSessionToken(USER).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000002', exp: Date.now() + 60_000 })).toString('base64url');
    assert.equal(verifySessionToken(`${v}.${forged}.${sig}`), null);
  });

  it('rejects a token signed with another secret', () => {
    const token = createSessionToken(USER);
    process.env.HALOX_SESSION_SECRET = 'another-secret-0123456789abcdef0123456789';
    assert.equal(verifySessionToken(token), null);
  });

  it('rejects expired tokens', () => {
    const token = createSessionToken(USER, { now: Date.now() - 13 * 3600_000 });
    assert.equal(verifySessionToken(token), null);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'abc', 'v1.x.y', 'v2.e30.sig', null, undefined, 123]) {
      assert.equal(verifySessionToken(bad as string), null, String(bad));
    }
  });

  it('refuses to work without a strong secret', () => {
    delete process.env.HALOX_SESSION_SECRET;
    assert.throws(() => createSessionToken(USER), SessionConfigError);
    process.env.HALOX_SESSION_SECRET = 'short';
    assert.throws(() => createSessionToken(USER), SessionConfigError);
  });
});

describe('actorFromHeaders', () => {
  beforeEach(() => {
    process.env.HALOX_SESSION_SECRET = SECRET;
  });

  it('reads the session cookie', () => {
    const headers = new Headers({ cookie: `other=1; ${SESSION_COOKIE}=${createSessionToken(USER)}` });
    assert.equal(actorFromHeaders(headers), USER);
  });

  it('reads a Bearer session token', () => {
    const headers = new Headers({ authorization: `Bearer ${createSessionToken(USER)}` });
    assert.equal(actorFromHeaders(headers), USER);
  });

  it('ignores the legacy x-halox-user-id header', () => {
    const headers = new Headers({ 'x-halox-user-id': USER });
    assert.equal(actorFromHeaders(headers), null);
  });

  it('returns null for missing or invalid credentials', () => {
    assert.equal(actorFromHeaders(new Headers()), null);
    assert.equal(actorFromHeaders(new Headers({ cookie: `${SESSION_COOKIE}=forged` })), null);
  });
});

describe('verifyDemoPassword', () => {
  it('compares against HALOX_DEMO_PASSWORD', () => {
    process.env.HALOX_DEMO_PASSWORD = 'correct horse battery';
    assert.equal(verifyDemoPassword('correct horse battery'), true);
    assert.equal(verifyDemoPassword('wrong'), false);
    assert.equal(verifyDemoPassword(''), false);
  });

  it('throws when HALOX_DEMO_PASSWORD is not configured', () => {
    delete process.env.HALOX_DEMO_PASSWORD;
    assert.throws(() => verifyDemoPassword('anything'), SessionConfigError);
  });
});
