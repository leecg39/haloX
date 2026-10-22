/**
 * HaloX API Boundary Schemas & Runtime Validators (S4)
 * Derived from `docs/clone/openapi.yaml`, `docs/clone/api-spec.md`, and `docs/clone/data-model.md`.
 */

export class SchemaValidationError extends Error {
  public readonly code = 'SCHEMA_VALIDATION_ERROR';
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`Validation failed at "${field}": ${message}`);
    this.name = 'SchemaValidationError';
    this.field = field;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertRecord(value: unknown, label = 'payload'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SchemaValidationError(label, 'Expected a JSON object');
  }
  return value as Record<string, unknown>;
}

export function assertString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') {
    throw new SchemaValidationError(field, 'Expected a string');
  }
  if (!allowEmpty && value.trim().length === 0) {
    throw new SchemaValidationError(field, 'String must not be empty');
  }
  return value;
}

export function assertUuid(value: unknown, field: string): string {
  const str = assertString(value, field);
  if (!UUID_REGEX.test(str)) {
    throw new SchemaValidationError(field, `Invalid UUID format: "${str}"`);
  }
  return str;
}

export function assertNumber(value: unknown, field: string, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SchemaValidationError(field, 'Expected a finite number');
  }
  if (min !== undefined && value < min) {
    throw new SchemaValidationError(field, `Number must be >= ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new SchemaValidationError(field, `Number must be <= ${max}`);
  }
  return value;
}

export interface WorkspaceEntity {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  status: string;
  strategy_map_status: string;
  settings: Record<string, unknown>;
  auto_generate_prompts: boolean;
  created_at: string;
  updated_at: string;
}

export interface KeywordEntity {
  id: string;
  workspace_id: string;
  keyword_set_id: string | null;
  keyword: string;
  language: string;
  country: string;
  search_volume: number;
  keyword_difficulty: number;
  intent: string;
  status: string;
  is_active: boolean;
  is_paused: boolean;
  deleted_at: string | null;
  created_at: string;
}

export interface GeoPromptEntity {
  id: string;
  workspace_id: string;
  prompt_set_id: string;
  prompt_text: string;
  prompt_category: string;
  language_code: string;
  location_code: string;
  search_volume: number;
  is_active: boolean;
  is_paused: boolean;
  deleted_at: string | null;
  created_at: string;
}

export function parseKeywordRow(input: unknown): KeywordEntity {
  const obj = assertRecord(input, 'keyword');
  return {
    id: assertUuid(obj.id, 'keyword.id'),
    workspace_id: assertUuid(obj.workspace_id, 'keyword.workspace_id'),
    keyword_set_id: obj.keyword_set_id ? assertUuid(obj.keyword_set_id, 'keyword.keyword_set_id') : null,
    keyword: assertString(obj.keyword, 'keyword.keyword'),
    language: typeof obj.language === 'string' ? obj.language : 'ko',
    country: typeof obj.country === 'string' ? obj.country : 'KR',
    search_volume: assertNumber(obj.search_volume ?? 0, 'keyword.search_volume', 0),
    keyword_difficulty: assertNumber(obj.keyword_difficulty ?? 0, 'keyword.keyword_difficulty', 0, 100),
    intent: typeof obj.intent === 'string' ? obj.intent : 'informational',
    status: typeof obj.status === 'string' ? obj.status : 'completed',
    is_active: Boolean(obj.is_active ?? true),
    is_paused: Boolean(obj.is_paused ?? false),
    deleted_at: typeof obj.deleted_at === 'string' ? obj.deleted_at : null,
    created_at: assertString(obj.created_at, 'keyword.created_at'),
  };
}

/**
 * Required top-level keys observed in runtime RPC captures (`docs/clone/api-spec.md` §2).
 */
export const OBSERVED_RPC_RESPONSE_SHAPES: Record<string, { kind: 'object' | 'array' | 'boolean'; keys?: string[] }> = {
  cancel_account_deletion: { kind: 'boolean' },
  get_avi_daily_components: {
    kind: 'array',
    keys: ['date', 'label', 'mentionRank', 'citationRank', 'mentionCoverage', 'citationCoverage'],
  },
  get_avi_overview: {
    kind: 'object',
    keys: [
      'level',
      'setCount',
      'totalRuns',
      'components',
      'dailySeries',
      'averageScore',
      'citedPrompts',
      'coverageRate',
      'totalPrompts',
      'activeSetCount',
      'avgMentionRank',
      'avgCitationRank',
      'firstMentionRate',
      'firstCitationRate',
    ],
  },
  get_billing_period_range: { kind: 'array', keys: ['period_start', 'period_end'] },
  get_full_funnel_stats: { kind: 'object', keys: ['pages', 'summary'] },
  get_ga4_channel_summary: { kind: 'array' },
  get_ga4_dashboard_timeseries: { kind: 'array' },
  get_gap_overview_light: { kind: 'array', keys: ['id', 'keyword_id', 'captured_at', 'brand_presence'] },
  get_geo_collection_days: { kind: 'array', keys: ['day'] },
  get_geo_group_status_kpi_multi: { kind: 'object', keys: ['buckets'] },
  get_geo_slot_counts: {
    kind: 'object',
    keys: ['slot_cited', 'slot_total', 'slot_sourced', 'slot_mentioned'],
  },
  get_geo_ws_mention_terms: {
    kind: 'object',
    keys: [
      'our_terms',
      'our_total',
      'comp_terms',
      'comp_total',
      'our_unique',
      'runs_total',
      'both_unique',
      'comp_unique',
      'our_mapped_unique',
    ],
  },
  get_gsc_dashboard_dimensions: { kind: 'array' },
  get_gsc_dashboard_kpis: {
    kind: 'object',
    keys: [
      'clicks',
      'impressions',
      'ctr',
      'avg_position',
      'prev_clicks',
      'prev_impressions',
      'prev_ctr',
      'prev_avg_position',
    ],
  },
  get_gsc_dashboard_timeseries: { kind: 'array' },
  get_keywords_with_gsc_stats: {
    kind: 'array',
    keys: [
      'keyword_id',
      'keyword_text',
      'gsc_clicks',
      'gsc_impressions',
      'gsc_ctr',
      'gsc_avg_position',
      'gsc_insight_type',
    ],
  },
  get_latest_serp_snapshots: {
    kind: 'array',
    keys: [
      'id',
      'keyword_id',
      'captured_at',
      'provider',
      'country',
      'language',
      'engine',
      'serp_analysis_json',
      'paa_questions_json',
      'related_searches_json',
    ],
  },
  get_light_dashboard_overview: {
    kind: 'object',
    keys: [
      'gap',
      'avi_summary',
      'audit_active',
      'audit_latest',
      'weekly_report',
      'funnel_summary',
      'top10_sparkline',
      'prompt_stats_summary',
      'web_health_sparkline',
      'ga4_traffic_sparkline',
      'citation_rate_sparkline',
    ],
  },
  get_light_prompt_stats: {
    kind: 'object',
    keys: ['domain_stats', 'prompt_stats', 'category_stats'],
  },
  get_page_ga4_stats: { kind: 'array' },
  get_paused_summary: {
    kind: 'object',
    keys: [
      'prompt_limit',
      'keyword_limit',
      'active_prompts',
      'paused_prompts',
      'active_keywords',
      'paused_keywords',
      'restorable_prompts',
      'restorable_keywords',
    ],
  },
  get_pro_dashboard_kpi: {
    kind: 'object',
    keys: [
      'kpi',
      'engine_sov',
      'overall_sov',
      'mention_rank',
      'total_engines',
      'daily_citation_series',
      'daily_mention_rank_series',
    ],
  },
  get_seo_aio_cross_trend: {
    kind: 'array',
    keys: [
      'day',
      'aio_detected',
      'our_cited',
      'our_top10',
      'cross_count',
      'aio_pos_sum',
      'aio_pos_cnt',
      'excluded_count',
    ],
  },
  get_seo_overview_agg: { kind: 'object', keys: ['current', 'previous'] },
  get_seo_rank_movers: {
    kind: 'array',
    keys: [
      'keyword_id',
      'first_date',
      'last_date',
      'first_rank',
      'last_rank',
      'last_aio_cited',
      'last_best_url',
    ],
  },
  get_serp_brand_presence_slim: {
    kind: 'array',
    keys: ['keyword_id', 'captured_at', 'ai_overview_detected', 'brand_presence'],
  },
  get_serp_brand_presence_trend: {
    kind: 'array',
    keys: ['keyword_id', 'captured_at', 'ai_overview_detected', 'brand_presence'],
  },
  get_serp_brand_presence_window: {
    kind: 'array',
    keys: ['keyword_id', 'captured_at', 'ai_overview_detected', 'brand_presence'],
  },
  get_user_activity_snapshot: {
    kind: 'array',
    keys: [
      'export_count',
      'last_export_at',
      'content_job_count',
      'last_content_job_at',
      'agent_conversation_count',
      'api_key_count',
      'last_api_key_at',
    ],
  },
  get_web_health_sparkline: { kind: 'array', keys: ['date', 'value'] },
  get_workspace_activity_snapshot: {
    kind: 'array',
    keys: [
      'keyword_count',
      'prompt_count',
      'prompt_set_count',
      'has_schedule_enabled',
      'run_count_30d',
      'last_run_at',
      'scan_count',
      'last_scan_at',
      'content_job_count',
      'last_content_job_at',
      'api_key_count',
      'last_api_key_used_at',
      'last_keyword_at',
      'last_prompt_at',
    ],
  },
  get_workspace_members: {
    kind: 'array',
    keys: ['user_id', 'email', 'full_name', 'role', 'allowed_sections', 'joined_at'],
  },
  get_workspace_quota_summary: {
    kind: 'array',
    keys: [
      'unit_key',
      'unit_label',
      'unit_type',
      'plan_limit',
      'plan_used',
      'plan_remaining',
      'credit_balance',
      'override_limit',
      'effective_limit',
      'effective_remaining',
    ],
  },
  record_auth_login: { kind: 'boolean' },
  site_audit_links_summary: {
    kind: 'object',
    keys: [
      'total',
      'orphans',
      'to_broken',
      'top_linked',
      'computed_at',
      'to_redirect',
      'broken_pages',
      'orphan_count',
      'nofollow_count',
      'pages_3xx_count',
      'pages_4xx_count',
      'descriptive_count',
      'descriptive_ratio',
    ],
  },
  strategy_map_effective_state: {
    kind: 'object',
    keys: [
      'reason',
      'status',
      'effective',
      'scanned_at',
      'cluster_count',
      'prompt_set_count',
      'active_prompt_count',
      'active_keyword_count',
      'latest_prompt_set_id',
      'linked_keyword_count',
      'auto_generate_prompts',
      'recommended_entrypoint',
      'recommended_resume_from',
    ],
  },
};

export function validateRpcResponse(rpcName: string, response: unknown): boolean {
  const spec = OBSERVED_RPC_RESPONSE_SHAPES[rpcName];
  if (!spec) {
    throw new SchemaValidationError(rpcName, `Unknown RPC contract "${rpcName}"`);
  }
  if (spec.kind === 'boolean') {
    if (typeof response !== 'boolean') {
      throw new SchemaValidationError(rpcName, 'Expected boolean RPC response');
    }
    return true;
  }
  if (spec.kind === 'array') {
    if (!Array.isArray(response)) {
      throw new SchemaValidationError(rpcName, 'Expected array RPC response');
    }
    if (spec.keys && response.length > 0) {
      const first = assertRecord(response[0], `${rpcName}[0]`);
      for (const key of spec.keys) {
        if (!(key in first)) {
          throw new SchemaValidationError(`${rpcName}[0].${key}`, `Missing required key "${key}"`);
        }
      }
    }
    return true;
  }
  const obj = assertRecord(response, rpcName);
  for (const key of spec.keys || []) {
    if (!(key in obj)) {
      throw new SchemaValidationError(`${rpcName}.${key}`, `Missing required key "${key}"`);
    }
  }
  return true;
}
