/**
 * Quota unit compatibility with the original HaloX contract.
 * Original bundle evidence (REA E1-4): reserve_unit_with_bypass is called with
 * `_workspace_id`, `_unit_key`, `_amount`, `_idempotency_key` and unit keys
 * keyword_create · prompt_create · content_gen · site_audit_scan.
 * Run: node --experimental-strip-types --test src/lib/backend/quota-units.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUOTA_UNIT_KEYS,
  UnknownQuotaUnitError,
  normalizeQuotaUnit,
  quotaLimitFor,
} from './quota-units.ts';
import { DEFAULT_USER_ID, DEFAULT_WORKSPACE_ID, HaloXDatabase, QuotaExceededError } from './database.ts';

describe('normalizeQuotaUnit', () => {
  it('accepts the four original unit keys unchanged', () => {
    assert.deepEqual([...QUOTA_UNIT_KEYS], ['keyword_create', 'prompt_create', 'content_gen', 'site_audit_scan']);
    for (const key of QUOTA_UNIT_KEYS) assert.equal(normalizeQuotaUnit(key), key);
  });
  it('maps legacy clone keys to original keys', () => {
    assert.equal(normalizeQuotaUnit('keywords'), 'keyword_create');
    assert.equal(normalizeQuotaUnit('prompts'), 'prompt_create');
    assert.equal(normalizeQuotaUnit('contents'), 'content_gen');
    assert.equal(normalizeQuotaUnit(' Keyword_Create '), 'keyword_create');
  });
  it('rejects unknown, empty and non-string unit keys', () => {
    for (const bad of ['credits', '', null, undefined, 42, {}]) {
      assert.throws(() => normalizeQuotaUnit(bad), (err: unknown) =>
        err instanceof UnknownQuotaUnitError && (err as UnknownQuotaUnitError).code === 'UNKNOWN_QUOTA_UNIT');
    }
  });
});

describe('quotaLimitFor', () => {
  const plan = { keyword_limit: 100, prompt_limit: 50, content_limit: 10 };
  it('reads the matching plan column', () => {
    assert.equal(quotaLimitFor('keyword_create', plan), 100);
    assert.equal(quotaLimitFor('prompt_create', plan), 50);
    assert.equal(quotaLimitFor('content_gen', plan), 10);
  });
  it('falls back to defaults when the plan or column is missing', () => {
    assert.equal(quotaLimitFor('keyword_create', undefined), 20);
    assert.equal(quotaLimitFor('content_gen', {}), 5);
    assert.equal(quotaLimitFor('site_audit_scan', plan), 20);
  });
});

describe('reserve_unit_with_bypass with original arguments', () => {
  it('reserves using _-prefixed argument names and stores the original unit key', () => {
    const db = new HaloXDatabase();
    const res = db.callRpc('reserve_unit_with_bypass', {
      _workspace_id: DEFAULT_WORKSPACE_ID,
      _unit_key: 'keyword_create',
      _amount: 1,
      _idempotency_key: 'orig-kw-1',
    }, DEFAULT_USER_ID) as { status: string; reservation_id: string };
    assert.equal(res.status, 'reserved');
    const row = db.queryTable('usage_reservations', {}, DEFAULT_USER_ID).data
      .find(r => r.id === res.reservation_id);
    assert.equal(row?.unit_key, 'keyword_create');
    assert.equal(row?.amount, 1);
    assert.equal(row?.idempotency_key, 'orig-kw-1');
  });

  it('counts legacy and original keys against the same keyword limit', () => {
    const db = new HaloXDatabase();
    const summary = () => (db.callRpc('get_workspace_quota_summary', { _workspace_id: DEFAULT_WORKSPACE_ID }, DEFAULT_USER_ID) as
      Array<{ unit_key: string; plan_used: number; plan_limit: number }>).find(u => u.unit_key === 'keyword_create');
    const before = summary();
    assert.ok(before, 'summary must expose keyword_create');
    db.callRpc('reserve_unit_with_bypass', { _workspace_id: DEFAULT_WORKSPACE_ID, _unit_key: 'keyword_create', _amount: 1, _idempotency_key: 'mix-1' }, DEFAULT_USER_ID);
    db.callRpc('reserve_unit_with_bypass', { p_workspace_id: DEFAULT_WORKSPACE_ID, p_unit_key: 'keywords', p_amount: 1, p_idempotency_key: 'mix-2' }, DEFAULT_USER_ID);
    assert.equal(summary()!.plan_used, before.plan_used + 2);
  });

  it('enforces the keyword limit, not the content limit, for keyword_create', () => {
    const db = new HaloXDatabase();
    const kw = (db.callRpc('get_workspace_quota_summary', { _workspace_id: DEFAULT_WORKSPACE_ID }, DEFAULT_USER_ID) as
      Array<{ unit_key: string; plan_remaining: number }>).find(u => u.unit_key === 'keyword_create')!;
    assert.ok(kw.plan_remaining > 5, 'precondition: keyword headroom larger than content limit');
    const ok = db.callRpc('reserve_unit_with_bypass', { _workspace_id: DEFAULT_WORKSPACE_ID, _unit_key: 'keyword_create', _amount: kw.plan_remaining, _idempotency_key: 'fill' }, DEFAULT_USER_ID) as { status: string };
    assert.equal(ok.status, 'reserved');
    assert.throws(() => db.callRpc('reserve_unit_with_bypass', { _workspace_id: DEFAULT_WORKSPACE_ID, _unit_key: 'keyword_create', _amount: 1, _idempotency_key: 'over' }, DEFAULT_USER_ID),
      (err: unknown) => err instanceof QuotaExceededError && err.code === 'QUOTA_EXCEEDED');
  });

  it('rejects unknown unit keys instead of charging a default bucket', () => {
    const db = new HaloXDatabase();
    assert.throws(() => db.callRpc('reserve_unit_with_bypass', { _workspace_id: DEFAULT_WORKSPACE_ID, _unit_key: 'credits', _amount: 1, _idempotency_key: 'bad' }, DEFAULT_USER_ID),
      (err: unknown) => err instanceof UnknownQuotaUnitError);
  });

  it('summary lists the four original units', () => {
    const db = new HaloXDatabase();
    const keys = (db.callRpc('get_workspace_quota_summary', { _workspace_id: DEFAULT_WORKSPACE_ID }, DEFAULT_USER_ID) as Array<{ unit_key: string }>).map(u => u.unit_key);
    assert.deepEqual(keys, ['keyword_create', 'prompt_create', 'content_gen', 'site_audit_scan']);
  });
});
