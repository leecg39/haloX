import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { creditView, recordWorkspaceCredit, workspaceCreditBalance } from './credit-service.ts';
import { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, HaloXDatabase, OTHER_USER_ID, QuotaExceededError } from './database.ts';
import { assertRestWrite } from './rest-policy.ts';
import { PersistentHaloXStore } from './store.ts';

describe('server-controlled workspace credits', () => {
  it('keeps an immutable, idempotent ledger and validates correction references', () => {
    const db = new HaloXDatabase();
    const grant = recordWorkspaceCredit(db, { event_id: 'support:grant-1', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'keyword_create', kind: 'grant', amount: 4, source_type: 'support', source_id: 'ticket-1' });
    assert.equal(workspaceCreditBalance(db, DEFAULT_WORKSPACE_ID, 'keyword_create'), 4);
    assert.equal(recordWorkspaceCredit(db, { event_id: 'support:grant-1', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'keyword_create', kind: 'grant', amount: 4, source_type: 'support', source_id: 'ticket-1' }).id, grant.id);
    assert.throws(() => recordWorkspaceCredit(db, { event_id: 'support:grant-1', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'keyword_create', kind: 'grant', amount: 5, source_type: 'support', source_id: 'ticket-1' }), /일치/);
    const revoked = recordWorkspaceCredit(db, { event_id: 'support:revoke-1', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'keyword_create', kind: 'revoke', amount: 2, source_type: 'support', source_id: 'ticket-1', reference_id: String(grant.id) });
    assert.throws(() => recordWorkspaceCredit(db, { event_id: 'support:revoke-over', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'keyword_create', kind: 'revoke', amount: 3, source_type: 'support', source_id: 'ticket-1', reference_id: String(grant.id) }), /초과/);
    recordWorkspaceCredit(db, { event_id: 'support:restore-1', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'keyword_create', kind: 'restore', amount: 1, source_type: 'support', source_id: 'ticket-1', reference_id: String(revoked.id) });
    recordWorkspaceCredit(db, { event_id: 'usage:manual', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'keyword_create', kind: 'consume', amount: 1, source_type: 'usage', source_id: 'manual' });
    assert.equal(workspaceCreditBalance(db, DEFAULT_WORKSPACE_ID, 'keyword_create'), 2);
  });

  it('uses plan quota first, holds credits for pending reservations and consumes once on commit', () => {
    const db = new HaloXDatabase();
    const summary = () => (db.callRpc('get_workspace_quota_summary', { _workspace_id: DEFAULT_WORKSPACE_ID }, DEFAULT_USER_ID) as Array<Record<string, unknown>>).find(row => row.unit_key === 'keyword_create')!;
    const planRemaining = Number(summary().plan_remaining);
    db.callRpc('reserve_unit_with_bypass', { _workspace_id: DEFAULT_WORKSPACE_ID, _unit_key: 'keyword_create', _amount: planRemaining, _idempotency_key: 'fill-plan' }, DEFAULT_USER_ID);
    recordWorkspaceCredit(db, { event_id: 'billing:credit-pack', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'keyword_create', kind: 'grant', amount: 2, source_type: 'billing', source_id: 'order-credit-pack' });
    const held = db.callRpc('reserve_unit_with_bypass', { _workspace_id: DEFAULT_WORKSPACE_ID, _unit_key: 'keyword_create', _amount: 2, _idempotency_key: 'credit-job' }, DEFAULT_USER_ID) as { reservation_id: string };
    assert.equal(summary().effective_remaining, 0);
    assert.equal(workspaceCreditBalance(db, DEFAULT_WORKSPACE_ID, 'keyword_create'), 2);
    assert.throws(() => db.callRpc('reserve_unit_with_bypass', { _workspace_id: DEFAULT_WORKSPACE_ID, _unit_key: 'keyword_create', _amount: 1, _idempotency_key: 'overspend' }, DEFAULT_USER_ID), QuotaExceededError);
    assert.equal(db.callRpc('release_reservation', { p_reservation_id: held.reservation_id }, DEFAULT_USER_ID), true);
    assert.equal(summary().effective_remaining, 2);
    const replacement = db.callRpc('reserve_unit_with_bypass', { _workspace_id: DEFAULT_WORKSPACE_ID, _unit_key: 'keyword_create', _amount: 2, _idempotency_key: 'replacement' }, DEFAULT_USER_ID) as { reservation_id: string };
    assert.equal(db.callRpc('commit_reservation', { p_reservation_id: replacement.reservation_id }, DEFAULT_USER_ID), true);
    assert.equal(db.callRpc('commit_reservation', { p_reservation_id: replacement.reservation_id }, DEFAULT_USER_ID), true);
    assert.equal(workspaceCreditBalance(db, DEFAULT_WORKSPACE_ID, 'keyword_create'), 0);
    assert.equal(db.queryTable('workspace_credit_ledger', { filters: { workspace_id: `eq.${DEFAULT_WORKSPACE_ID}` } }, DEFAULT_USER_ID).data.filter(row => row.kind === 'consume').length, 1);
  });

  it('blocks public writes and isolates workspace balances while keeping personal rewards account-scoped', () => {
    const db = new HaloXDatabase();
    recordWorkspaceCredit(db, { event_id: 'migration:isolated', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'content_gen', kind: 'grant', amount: 3, source_type: 'migration', source_id: 'legacy' });
    for (const table of ['workspace_credit_balances', 'workspace_credit_ledger']) for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const payload = method === 'DELETE' ? undefined : { workspace_id: DEFAULT_WORKSPACE_ID };
      assert.throws(() => assertRestWrite(db, table, method, DEFAULT_USER_ID, payload, { workspace_id: `eq.${DEFAULT_WORKSPACE_ID}` }));
    }
    assert.throws(() => creditView(db, DEFAULT_WORKSPACE_ID, OTHER_USER_ID));
    db.setServerRecords('referral_rewards', [{ id: 'mine', owner_id: DEFAULT_USER_ID, kind: 'earned', amount: 1000, currency: 'KRW', created_at: new Date().toISOString() }, { id: 'other', owner_id: OTHER_USER_ID, kind: 'earned', amount: 9000, currency: 'KRW', created_at: new Date().toISOString() }]);
    const view = creditView(db, DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID);
    assert.deepEqual(view.reward_totals.KRW, { earned: 1000, reversed: 0, paid: 0, balance: 1000 });
    assert.equal(JSON.stringify(view).includes('other'), false);
    assert.equal(JSON.stringify(view.ledger).includes('signature'), false);
  });

  it('persists balances and ledger rows across store restart', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'halox-credit-')), filename = path.join(directory, 'state.sqlite');
    try {
      const store = new PersistentHaloXStore(filename);
      await store.write(db => recordWorkspaceCredit(db, { event_id: 'support:persist', workspace_id: DEFAULT_WORKSPACE_ID, unit_key: 'site_audit_scan', kind: 'grant', amount: 7, source_type: 'support', source_id: 'ticket-persist' }));
      const reopened = new PersistentHaloXStore(filename);
      const view = await reopened.read(db => creditView(db, DEFAULT_WORKSPACE_ID, DEFAULT_USER_ID));
      assert.equal(view.balances.find(row => row.unit_key === 'site_audit_scan')?.balance, 7);
      assert.equal(view.ledger[0].event_id, 'support:persist');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
