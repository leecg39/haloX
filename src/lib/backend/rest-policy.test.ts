import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_USER_ID, DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, HaloXDatabase, OTHER_USER_ID } from './database.ts';
import { assertRestWrite } from './rest-policy.ts';

describe('public REST permissions', () => {
  it('blocks account impersonation, plan changes, and bulk mutation without filters', () => {
    const db = new HaloXDatabase();
    for (const table of ['profiles', 'workspace_plans', 'usage_reservations', 'plan_templates']) {
      assert.throws(() => assertRestWrite(db, table, 'POST', DEFAULT_USER_ID, { id: DEFAULT_USER_ID }));
    }
    assert.throws(() => assertRestWrite(db, 'profiles', 'PATCH', DEFAULT_USER_ID, { email: 'admin@halox.local' }, { id: `eq.${DEFAULT_USER_ID}` }));
    assert.throws(() => assertRestWrite(db, 'keywords', 'DELETE', DEFAULT_USER_ID));
    assert.throws(() => assertRestWrite(db, 'keywords', 'PATCH', DEFAULT_USER_ID, { keyword: 'x' }, { select: '*' }));
    assert.throws(() => assertRestWrite(db, 'workspaces', 'POST', DEFAULT_USER_ID, { id: DEFAULT_WORKSPACE_ID, name: 'hijack' }));
    assert.throws(() => assertRestWrite(db, 'workspaces', 'PATCH', DEFAULT_USER_ID, { owner_id: OTHER_USER_ID }, { id: `eq.${DEFAULT_WORKSPACE_ID}` }));
  });

  it('denies member self-promotion and protects owner membership', () => {
    const db = new HaloXDatabase();
    const [member] = db.insertTable('workspace_members', { workspace_id: DEFAULT_WORKSPACE_ID, user_id: OTHER_USER_ID, role: 'member' });
    assert.throws(() => assertRestWrite(db, 'workspace_members', 'PATCH', OTHER_USER_ID, { role: 'admin' }, { id: `eq.${member.id}` }));
    assert.throws(() => assertRestWrite(db, 'workspace_members', 'POST', OTHER_USER_ID, { workspace_id: DEFAULT_WORKSPACE_ID, user_id: OTHER_USER_ID, role: 'admin' }));
    const owner = db.queryTable('workspace_members', { filters: { workspace_id: `eq.${DEFAULT_WORKSPACE_ID}`, role: 'eq.owner' } }).data[0];
    assert.throws(() => assertRestWrite(db, 'workspace_members', 'DELETE', ADMIN_USER_ID, undefined, { id: `eq.${owner.id}` }));
    assert.throws(() => assertRestWrite(db, 'workspaces', 'DELETE', ADMIN_USER_ID, undefined, { id: `eq.${DEFAULT_WORKSPACE_ID}` }));
    assert.doesNotThrow(() => assertRestWrite(db, 'workspace_members', 'PATCH', DEFAULT_USER_ID, { role: 'admin' }, { id: `eq.${member.id}` }));
  });

  it('cascades workspace deletion to memberships, plans and dependent data', () => {
    const db = new HaloXDatabase();
    const [workspace] = db.insertTable('workspaces', { name: '삭제할 프로젝트', owner_id: OTHER_USER_ID });
    assert.equal(workspace.owner_id, DEFAULT_USER_ID);
    const [keyword] = db.insertTable('keywords', { workspace_id: workspace.id, keyword: 'delete me' });
    db.insertTable('serp_snapshots', { workspace_id: workspace.id, keyword_id: keyword.id });
    db.deleteTable('workspaces', { id: `eq.${workspace.id}` });
    assert.ok(Object.values(db.exportState().tables).every(rows => rows.every(row => row.workspace_id !== workspace.id)));
    assert.ok(!db.getAllowedWorkspaceIds().has(String(workspace.id)));
    assert.ok(db.getAllowedWorkspaceIds().has(DEFAULT_WORKSPACE_ID));
  });

  it('requires full API key secrets, rejecting prefixes and stored hashes', () => {
    const db = new HaloXDatabase();
    db.insertTable('workspace_api_keys', { name: 'test', raw_key: 'hx_live_long_private_secret', key_prefix: 'hx_live_' });
    assert.ok(db.verifyWorkspaceApiKey('hx_live_long_private_secret'));
    assert.equal(db.verifyWorkspaceApiKey('hx_live_'), null);
    assert.equal(db.verifyWorkspaceApiKey('hx_live_wrong_secret'), null);
    const hash = db.exportState().tables.workspace_api_keys.find(row => row.name === 'test')!.key_hash;
    assert.equal(db.verifyWorkspaceApiKey(String(hash)), null);
  });

  it('generates a secret once and rejects expired keys', () => {
    const db = new HaloXDatabase();
    const [key] = db.insertTable('workspace_api_keys', { name: 'generated' });
    assert.match(String(key.raw_key), /^hx_live_[a-zA-Z0-9_-]{43}$/);
    assert.ok(db.verifyWorkspaceApiKey(String(key.raw_key)));
    assert.equal(db.queryTable('workspace_api_keys', { filters: { id: `eq.${key.id}` } }).data[0].raw_key, undefined);
    db.updateTable('workspace_api_keys', { expires_at: '2000-01-01T00:00:00Z' }, { id: `eq.${key.id}` });
    assert.equal(db.verifyWorkspaceApiKey(String(key.raw_key)), null);
    assert.throws(() => assertRestWrite(db, 'workspace_api_keys', 'POST', DEFAULT_USER_ID, { name: 'unsafe', key_hash: 'known-placeholder' }));
  });

  it('scopes RPC calls without workspace IDs to the authenticated user', () => {
    const db = new HaloXDatabase();
    const members = db.callRpc('get_workspace_members', {}, OTHER_USER_ID) as Array<{ user_id: string }>;
    assert.ok(members.every(member => member.user_id === OTHER_USER_ID));
    assert.throws(() => db.callRpc('get_workspace_members', { p_workspace_id: DEFAULT_WORKSPACE_ID }, OTHER_USER_ID));
    assert.throws(() => db.callRpc('get_workspace_members', {}, 'missing-user'));
  });
});
