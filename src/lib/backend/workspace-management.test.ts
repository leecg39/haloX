import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PersistentHaloXStore } from './store.ts';
import { DEFAULT_USER_ID as OWNER, ADMIN_USER_ID as ADMIN, OTHER_USER_ID as OTHER, DEFAULT_WORKSPACE_ID as WS, HaloXDatabase, type Row } from './database.ts';
import { readWorkspaceManagement, runWorkspaceCommand } from './workspace-management.ts';
import { assertRestWrite } from './rest-policy.ts';
import { runAuditCommand } from './site-audit-service.ts';
const run = (db: HaloXDatabase, action: string, values: Row = {}, actor = OWNER) => runWorkspaceCommand(db, actor, { action, workspace_id: WS, ...values });
const invite = (db: HaloXDatabase, email = 'other@halox.local', role = 'member') => run(db, 'invite-create', { email, role }) as { invitation: Row; token: string };

describe('workspace settings and invitations', () => {
  it('validates profile values and slug uniqueness, shares REST revisions and preserves unrelated settings', () => {
    const db = new HaloXDatabase(), initial = readWorkspaceManagement(db, WS, OWNER).workspace;
    run(db, 'workspace-update', { name: ' 새 브랜드 ', description: '안내', brand_name: '브랜드', default_brand_filter: 'EXAMPLE.COM', slug: 'brand-team', expected_revision: 0 });
    const next = readWorkspaceManagement(db, WS, OWNER).workspace;
    assert.equal(next.name, '새 브랜드'); assert.equal(next.default_brand_filter, 'example.com'); assert.deepEqual(next.settings, initial.settings);
    assert.throws(() => run(db, 'workspace-update', { name: 'stale', expected_revision: 0 }), /변경/);
    db.updateTable('workspaces', { description: '다른 화면' }, { id: `eq.${WS}` }, OWNER);
    assert.throws(() => run(db, 'workspace-update', { name: 'stale', expected_revision: 1 }), /변경/);
    for (const patch of [{ name: '' }, { description: 'x'.repeat(2001) }, { default_brand_filter: 'https://example.com/path' }, { slug: '../bad' }]) assert.throws(() => db.updateTable('workspaces', patch, { id: `eq.${WS}` }, OWNER));
    const second = db.insertTable('workspaces', { name: '두 번째', slug: 'duplicate' }, OWNER)[0]; assert.ok(second);
    assert.throws(() => db.updateTable('workspaces', { slug: 'DUPLICATE' }, { id: `eq.${WS}` }, OWNER), /슬러그/);
    assert.throws(() => run(db, 'workspace-update', { name: '타인', expected_revision: 2 }, OTHER));
  });
  it('uses the same audit target records and revision checks as site audit', () => {
    const db = new HaloXDatabase(), values = { name: '설정의 대상', target_url: 'https://example.com/', max_pages: 10, max_depth: 2, scope_rules: { include_paths: [], exclude_paths: ['/private'] } };
    const created = runAuditCommand(db, 'audit-target-create', values, WS, OWNER).target as Row;
    assert.equal(readWorkspaceManagement(db, WS, OWNER).targets[0].id, created.id);
    runAuditCommand(db, 'audit-target-update', { ...values, max_depth: 1, target_id: created.id, expected_revision: 1 }, WS, OWNER);
    assert.equal(readWorkspaceManagement(db, WS, OWNER).targets[0].max_depth, 1);
    assert.throws(() => runAuditCommand(db, 'audit-target-delete', { target_id: created.id, expected_revision: 1 }, WS, OWNER));
    runAuditCommand(db, 'audit-target-delete', { target_id: created.id, expected_revision: 2 }, WS, OWNER); assert.equal(readWorkspaceManagement(db, WS, OWNER).targets.length, 0);
  });
  it('stores only token hashes, normalizes emails and requires both the link and the invited account', () => {
    const db = new HaloXDatabase(), created = invite(db, ' OTHER@halox.local ');
    assert.equal(created.invitation.email, 'other@halox.local'); assert.equal(created.token.length, 43);
    assert.ok(!JSON.stringify(db.exportState()).includes(created.token)); assert.equal(db.queryTable('workspace_invitations', {}, OWNER).data[0].token, undefined);
    assert.throws(() => run(db, 'invite-preview', { token: created.token }, ADMIN), /이메일/);
    assert.throws(() => run(db, 'invite-accept', { token: created.invitation.id }, OTHER));
    const preview = run(db, 'invite-preview', { token: created.token }, OTHER); assert.equal(preview.email, 'other@halox.local');
    run(db, 'invite-accept', { token: created.token }, OTHER); assert.ok(db.getAllowedWorkspaceIds(OTHER).has(WS));
    assert.throws(() => run(db, 'invite-accept', { token: created.token }, OTHER)); assert.equal(db.getServerRecords('workspace_invitation_tokens').length, 0);
    assert.throws(() => invite(db), /이미/);
  });
  it('reuses pending invitations without revealing secrets and rotates the link when offered roles change', () => {
    const db = new HaloXDatabase(), first = invite(db), duplicate = invite(db);
    assert.equal(first.invitation.id, duplicate.invitation.id); assert.equal(duplicate.token, undefined);
    const revised = run(db, 'invite-update', { invitation_id: first.invitation.id, expected_revision: 1, role: 'admin' });
    assert.throws(() => run(db, 'invite-accept', { token: first.token }, OTHER));
    assert.throws(() => run(db, 'invite-rotate', { invitation_id: first.invitation.id, expected_revision: 1 }));
    run(db, 'invite-accept', { token: revised.token }, OTHER);
    assert.equal(readWorkspaceManagement(db, WS, OTHER).role, 'admin');
  });
  it('cancels, expires, deletes and renews invitation records without changing accepted membership', () => {
    const db = new HaloXDatabase(), first = invite(db);
    assert.throws(() => run(db, 'invite-delete', { invitation_id: first.invitation.id, expected_revision: 1 }), /취소/);
    run(db, 'invite-cancel', { invitation_id: first.invitation.id, expected_revision: 1 }); assert.throws(() => run(db, 'invite-accept', { token: first.token }, OTHER));
    run(db, 'invite-delete', { invitation_id: first.invitation.id, expected_revision: 2 });
    const expired = invite(db); db.updateTable('workspace_invitations', { expires_at: '2000-01-01T00:00:00Z' }, { id: `eq.${expired.invitation.id}` }, OWNER);
    assert.equal(readWorkspaceManagement(db, WS, OWNER).invitations[0].status, 'expired'); assert.throws(() => run(db, 'invite-preview', { token: expired.token }, OTHER));
    run(db, 'invite-delete', { invitation_id: expired.invitation.id, expected_revision: 2 });
    const fresh = invite(db); run(db, 'invite-accept', { token: fresh.token }, OTHER); run(db, 'invite-delete', { invitation_id: fresh.invitation.id, expected_revision: 2 });
    assert.ok(db.getAllowedWorkspaceIds(OTHER).has(WS)); assert.equal(db.getServerRecords('workspace_invitation_tokens').length, 0);
    const legacy = invite(db, 'legacy@example.test'); db.updateTable('workspace_invitations', { role: 'owner' }, { id: `eq.${legacy.invitation.id}` }, OWNER);
    assert.throws(() => run(db, 'invite-preview', { token: legacy.token }, OTHER), /유효/);
  });
  it('protects owners, denies member self-promotion and reserves administrator changes to owners', () => {
    const db = new HaloXDatabase(), first = invite(db); run(db, 'invite-accept', { token: first.token }, OTHER);
    const view = readWorkspaceManagement(db, WS, OWNER), member = view.members.find(row => row.user_id === OTHER)!, owner = view.members.find(row => row.role === 'owner')!;
    assert.throws(() => run(db, 'member-update', { member_id: member.id, role: 'admin', expected_revision: 1 }, OTHER));
    assert.throws(() => run(db, 'member-delete', { member_id: owner.id, expected_revision: 0 }), /소유자/);
    assert.throws(() => run(db, 'member-update', { member_id: member.id, role: 'admin', expected_revision: 1 }, ADMIN), /소유자/);
    assert.throws(() => run(db, 'invite-create', { email: 'admin2@example.test', role: 'admin' }, ADMIN));
    run(db, 'member-update', { member_id: member.id, role: 'admin', expected_revision: 1 }); assert.equal(readWorkspaceManagement(db, WS, OTHER).role, 'admin');
    assert.throws(() => run(db, 'member-delete', { member_id: member.id, expected_revision: 2 }, ADMIN));
    run(db, 'member-update', { member_id: member.id, role: 'member', expected_revision: 2 });
    run(db, 'member-delete', { member_id: member.id, expected_revision: 3 }, ADMIN); assert.throws(() => readWorkspaceManagement(db, WS, OTHER));
  });
  it('rejects duplicate or unknown members, REST invite tampering and administrator bypasses', () => {
    const db = new HaloXDatabase();
    assert.throws(() => db.insertTable('workspace_members', { workspace_id: WS, user_id: OWNER, role: 'admin' }, OWNER), /소유자/);
    assert.throws(() => db.insertTable('workspace_members', { workspace_id: WS, user_id: OTHER, role: 'owner' }, OWNER), /소유자/);
    assert.throws(() => db.insertTable('workspace_members', { workspace_id: WS, user_id: 'missing', role: 'member' }, OWNER), /계정/);
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) assert.throws(() => assertRestWrite(db, 'workspace_invitations', method, OWNER, method === 'DELETE' ? undefined : { status: 'accepted' }, { id: 'eq.x' }));
    const [member] = db.insertTable('workspace_members', { workspace_id: WS, user_id: OTHER, role: 'member' }, OWNER);
    assert.throws(() => assertRestWrite(db, 'workspace_members', 'PATCH', ADMIN, { role: 'admin' }, { id: `eq.${member.id}` }));
    invite(db, 'pending@example.test'); assert.equal(readWorkspaceManagement(db, WS, OTHER).invitations.length, 0); assert.equal(db.queryTable('workspace_invitations', {}, OTHER).data.length, 0);
    db.updateTable('profiles', { full_name: '새 이름' }, { id: `eq.${OTHER}` }, OTHER); assert.equal(readWorkspaceManagement(db, WS, OWNER).members.find(row => row.user_id === OTHER)?.full_name, '새 이름');
  });
  it('persists across store reopening, serializes concurrent accepts, and cleans invitation secrets on workspace deletion', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'halox-workspace-')), filename = path.join(dir, 'test.sqlite');
    try {
      const store = new PersistentHaloXStore(filename), created = await store.write(db => invite(db)), reopened = new PersistentHaloXStore(filename);
      const outcomes = await Promise.allSettled([store, reopened].map(item => item.write(db => run(db, 'invite-accept', { token: created.token }, OTHER))));
      assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
      assert.equal((await reopened.read(db => readWorkspaceManagement(db, WS, OWNER))).members.filter(row => row.user_id === OTHER).length, 1);
      const second = await store.write(db => invite(db, 'pending@example.test'));
      await store.write(db => db.deleteTable('workspaces', { id: `eq.${WS}` }, OWNER));
      await assert.rejects(reopened.write(db => run(db, 'invite-preview', { token: second.token }, OTHER)));
      assert.equal((await reopened.read(db => db.getServerRecords('workspace_invitation_tokens'))).length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
