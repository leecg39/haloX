/**
 * Quota units — aligned with the original HaloX contract.
 *
 * Original bundle evidence (REA E1-4, `KeywordAddDialog` and related chunks):
 * `reserve_unit_with_bypass({ _workspace_id, _unit_key, _amount, _idempotency_key })`
 * with unit keys keyword_create · prompt_create · content_gen · site_audit_scan.
 * Earlier clone builds used keywords · prompts · contents; those stay accepted as aliases.
 */

export const QUOTA_UNIT_KEYS = ['keyword_create', 'prompt_create', 'content_gen', 'site_audit_scan'] as const;

export type QuotaUnitKey = (typeof QUOTA_UNIT_KEYS)[number];

interface QuotaUnitDefinition {
  label: string;
  planField: 'keyword_limit' | 'prompt_limit' | 'content_limit' | null;
  fallbackLimit: number;
}

export const QUOTA_UNITS: Readonly<Record<QuotaUnitKey, QuotaUnitDefinition>> = Object.freeze({
  keyword_create: { label: '키워드', planField: 'keyword_limit', fallbackLimit: 20 },
  prompt_create: { label: 'AI 질문 (GEO)', planField: 'prompt_limit', fallbackLimit: 20 },
  content_gen: { label: '콘텐츠 생성', planField: 'content_limit', fallbackLimit: 5 },
  // No plan column was observed for site audits; the limit is an inferred default.
  site_audit_scan: { label: '사이트 진단', planField: null, fallbackLimit: 20 },
});

const LEGACY_ALIASES: Readonly<Record<string, QuotaUnitKey>> = Object.freeze({
  keywords: 'keyword_create',
  prompts: 'prompt_create',
  contents: 'content_gen',
  content: 'content_gen',
});

export class UnknownQuotaUnitError extends Error {
  public readonly code = 'UNKNOWN_QUOTA_UNIT';
  public readonly status = 400;
  constructor(unitKey: unknown) {
    super(`UNKNOWN_QUOTA_UNIT: "${String(unitKey)}" is not one of ${QUOTA_UNIT_KEYS.join(', ')}`);
    this.name = 'UnknownQuotaUnitError';
  }
}

function isQuotaUnitKey(value: string): value is QuotaUnitKey {
  return (QUOTA_UNIT_KEYS as readonly string[]).includes(value);
}

/** Validate a unit key from an RPC caller and return its original (canonical) name. */
export function normalizeQuotaUnit(raw: unknown): QuotaUnitKey {
  if (typeof raw !== 'string') throw new UnknownQuotaUnitError(raw);
  const key = raw.trim().toLowerCase();
  if (isQuotaUnitKey(key)) return key;
  const alias = LEGACY_ALIASES[key];
  if (alias) return alias;
  throw new UnknownQuotaUnitError(raw);
}

/** Monthly limit for a unit from a workspace plan row, falling back to the unit default. */
export function quotaLimitFor(unit: QuotaUnitKey, plan: Record<string, unknown> | undefined): number {
  const { planField, fallbackLimit } = QUOTA_UNITS[unit];
  const value = planField && plan ? Number(plan[planField]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallbackLimit;
}

/** Unit key of a stored reservation row, tolerating legacy names; null if unrecognized. */
export function storedQuotaUnit(raw: unknown): QuotaUnitKey | null {
  try {
    return normalizeQuotaUnit(raw);
  } catch {
    return null;
  }
}
