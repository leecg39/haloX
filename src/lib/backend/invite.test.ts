/**
 * workspace-invite edge function (original inventory name, REA E1-4).
 * Run: node --experimental-strip-types --test src/lib/backend/invite.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  HaloXDatabase,
  ISOLATED_WORKSPACE_ID,
  OTHER_USER_ID,
  RlsAccessDeniedError,
} from './database.ts';

type Invite = { id: string; workspace_id: string; email: string; role: string; status: string; expires_at: string };

async function invite(db: HaloXDatabase, payload: Record<string, unknown>, actor = DEFAULT_USER_ID): Promise<Invite> {
  const res = await db.invokeEdgeFunction('workspace-invite', { workspace_id: DEFAULT_WORKSPACE_ID, ...payload }, actor);
  return res.invitation as Invite;
}

describe('workspace-invite', () => {
  it('creates a pending member invitation that expires in 7 days', async () => {
    const db = new HaloXDatabase();
    const before = Date.now();
    const inv = await invite(db, { email: 'New.Person@Example.com' });
    assert.equal(inv.workspace_id, DEFAULT_WORKSPACE_ID);
    assert.equal(inv.email, 'new.person@example.com');
    assert.equal(inv.role, 'member');
    assert.equal(inv.status, 'pending');
    const ttl = Date.parse(inv.expires_at) - before;
    assert.ok(ttl > 6.9 * 86400_000 && ttl <= 7 * 86400_000 + 5_000, `ttl ${ttl}`);
  });

  it('is idempotent for an existing pending invitation', async () => {
    const db = new HaloXDatabase();
    const first = await invite(db, { email: 'dup@example.com' });
    const second = await invite(db, { email: 'DUP@example.com' });
    assert.equal(second.id, first.id);
    const rows = db.queryTable('workspace_invitations', { filters: { email: 'eq.dup@example.com' } }, DEFAULT_USER_ID).data;
    assert.equal(rows.length, 1);
  });

  it('accepts admin role and rejects unknown roles', async () => {
    const db = new HaloXDatabase();
    assert.equal((await invite(db, { email: 'a@example.com', role: 'admin' })).role, 'admin');
    await assert.rejects(() => invite(db, { email: 'b@example.com', role: 'owner' }), /role/);
  });

  it('rejects invalid emails', async () => {
    const db = new HaloXDatabase();
    for (const email of ['', 'not-an-email', 'a@b', null, 42]) {
      await assert.rejects(() => invite(db, { email }), /email/i, String(email));
    }
  });

  it('rejects invites into a workspace the actor does not belong to', async () => {
    const db = new HaloXDatabase();
    await assert.rejects(
      () => db.invokeEdgeFunction('workspace-invite', { workspace_id: ISOLATED_WORKSPACE_ID, email: 'x@example.com' }, DEFAULT_USER_ID),
      (err: unknown) => err instanceof RlsAccessDeniedError,
    );
  });

  it('rejects invites from a plain member', async () => {
    const db = new HaloXDatabase();
    db.insertTable('workspace_members', { workspace_id: DEFAULT_WORKSPACE_ID, user_id: OTHER_USER_ID, role: 'member' }, DEFAULT_USER_ID);
    await assert.rejects(() => invite(db, { email: 'y@example.com' }, OTHER_USER_ID), (err: unknown) => err instanceof RlsAccessDeniedError);
  });
});
