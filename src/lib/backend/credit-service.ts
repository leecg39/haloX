import crypto from 'node:crypto';
import type { HaloXDatabase, Row } from './database.ts';
import { contentText } from './content-model.ts';
import { normalizeQuotaUnit, QUOTA_UNIT_KEYS, QUOTA_UNITS, type QuotaUnitKey } from './quota-units.ts';

export const CREDIT_KINDS = ['grant', 'consume', 'revoke', 'restore'] as const;
export const CREDIT_SOURCES = ['billing', 'referral', 'support', 'usage', 'migration'] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];
export type CreditSource = (typeof CREDIT_SOURCES)[number];

export type CreditInput = {
  event_id: string;
  workspace_id: string;
  unit_key: QuotaUnitKey;
  kind: CreditKind;
  amount: number;
  source_type: CreditSource;
  source_id: string;
  reference_id?: string;
  memo?: string;
};

function owner(db: HaloXDatabase, workspace: string) {
  const row = db.exportState().tables.workspaces.find(item => item.id === workspace);
  if (!row?.owner_id) throw new Error('크레딧을 적용할 워크스페이스를 찾을 수 없습니다.');
  return String(row.owner_id);
}

const rows = (db: HaloXDatabase, table: 'workspace_credit_balances' | 'workspace_credit_ledger') => db.exportState().tables[table] || [];
const signature = (input: CreditInput) => crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');

export function workspaceCreditBalance(db: HaloXDatabase, workspace: string, unit: QuotaUnitKey) {
  const row = rows(db, 'workspace_credit_balances').find(item => item.workspace_id === workspace && item.unit_key === unit);
  const value = Number(row?.balance || 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Trusted server adapter. Credits are immutable; corrections are new revoke/restore rows. */
export function recordWorkspaceCredit(db: HaloXDatabase, raw: CreditInput, now = Date.now()) {
  const input: CreditInput = {
    event_id: contentText(raw.event_id, '크레딧 이벤트', 200, true),
    workspace_id: contentText(raw.workspace_id, '워크스페이스', 100, true),
    unit_key: normalizeQuotaUnit(raw.unit_key),
    kind: raw.kind,
    amount: Number(raw.amount),
    source_type: raw.source_type,
    source_id: contentText(raw.source_id, '원본 이벤트', 200, true),
    ...(raw.reference_id ? { reference_id: contentText(raw.reference_id, '참조 원장', 100, true) } : {}),
    ...(raw.memo ? { memo: contentText(raw.memo, '크레딧 메모', 500) } : {}),
  };
  if (!(CREDIT_KINDS as readonly string[]).includes(input.kind) || !(CREDIT_SOURCES as readonly string[]).includes(input.source_type) || !Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1_000_000) throw new Error('크레딧 원장 입력을 확인해 주세요.');
  const all = rows(db, 'workspace_credit_ledger'), existing = all.find(row => row.event_id === input.event_id), proof = signature(input);
  if (existing) { if (existing.signature !== proof) throw new Error('같은 크레딧 이벤트의 내용이 일치하지 않습니다.'); return existing; }
  const positive = input.kind === 'grant' || input.kind === 'restore';
  if ((input.kind === 'grant' && input.reference_id) || (input.kind !== 'grant' && input.kind !== 'consume' && !input.reference_id)) throw new Error('크레딧 원장 참조를 확인해 주세요.');
  if (input.reference_id) {
    const reference = all.find(row => row.id === input.reference_id && row.workspace_id === input.workspace_id && row.unit_key === input.unit_key);
    if (!reference) throw new Error('같은 워크스페이스·단위의 원장만 참조할 수 있습니다.');
    const allowed = input.kind === 'restore' ? Number(reference.delta) < 0 : input.kind === 'revoke' ? Number(reference.delta) > 0 : false;
    if (!allowed) throw new Error('크레딧 회수·복원 참조를 확인해 주세요.');
    const applied = all.filter(row => row.reference_id === reference.id && row.kind === input.kind).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (applied + input.amount > Math.abs(Number(reference.delta))) throw new Error('참조한 원장 금액을 초과할 수 없습니다.');
  }
  const current = workspaceCreditBalance(db, input.workspace_id, input.unit_key), delta = positive ? input.amount : -input.amount, next = current + delta;
  if (next < 0) throw new Error('사용 가능한 크레딧보다 많이 사용하거나 회수할 수 없습니다.');
  const actor = owner(db, input.workspace_id), stamp = new Date(now).toISOString();
  const balance = rows(db, 'workspace_credit_balances').find(row => row.workspace_id === input.workspace_id && row.unit_key === input.unit_key);
  if (balance) db.updateTable('workspace_credit_balances', { balance: next, revision: Number(balance.revision || 0) + 1, updated_at: stamp }, { id: `eq.${balance.id}` }, actor);
  else db.insertTable('workspace_credit_balances', { workspace_id: input.workspace_id, unit_key: input.unit_key, balance: next, revision: 1, updated_at: stamp }, actor);
  return db.insertTable('workspace_credit_ledger', { ...input, reference_id: input.reference_id || null, memo: input.memo || '', delta, balance_after: next, signature: proof, created_at: stamp }, actor)[0];
}

export function creditView(db: HaloXDatabase, workspace: string, actor: string) {
  db.assertWorkspaceAccess(workspace, actor, 'other');
  const balances = QUOTA_UNIT_KEYS.map(unit_key => ({ unit_key, unit_label: QUOTA_UNITS[unit_key].label, balance: workspaceCreditBalance(db, workspace, unit_key) }));
  const ledger = db.queryTable('workspace_credit_ledger', { filters: { workspace_id: `eq.${workspace}` }, order: 'created_at.desc', limit: 200 }, actor).data.map(({ signature: _signature, ...row }) => row);
  const rewards = db.getServerRecords('referral_rewards').filter(row => row.owner_id === actor).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(({ event_id: _event, ...row }) => row);
  const reward_totals: Record<string, { earned: number; reversed: number; paid: number; balance: number }> = {};
  for (const row of rewards) { const currency = String(row.currency), total = reward_totals[currency] ||= { earned: 0, reversed: 0, paid: 0, balance: 0 }; if (row.kind === 'earned') total.earned += Number(row.amount); if (row.kind === 'reversed') total.reversed += Number(row.amount); if (row.kind === 'paid') total.paid += Number(row.amount); total.balance = total.earned - total.reversed - total.paid; }
  return { balances, ledger, quota: db.callRpc('get_workspace_quota_summary', { _workspace_id: workspace }, actor) as Row[], rewards, reward_totals, mutations: 'server_only' as const };
}
