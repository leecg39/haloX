/**
 * HaloX Relational Store, RLS Guard, PostgREST Query Engine, RPC & Edge Function Runtime (S2–S7)
 */

import crypto from 'node:crypto';
import {
  aiTrafficShare,
  aviComposite,
  geoScore,
  isQuickWinKeyword,
  positionScore,
  scoreLevel,
  searchContribution,
  seoScore,
  serverAviFiveFactor,
} from '../metrics/index.ts';
import { createDeterministicProviders, type HaloXProviders } from './providers.ts';
import {
  QUOTA_UNITS,
  QUOTA_UNIT_KEYS,
  normalizeQuotaUnit,
  quotaLimitFor,
  storedQuotaUnit,
} from './quota-units.ts';

export const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';
export const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
export const DEFAULT_WORKSPACE_ID = '11111111-1111-4000-8000-111111111111';
export const ISOLATED_WORKSPACE_ID = '22222222-2222-4000-8000-222222222222';
export const DEFAULT_KEYWORD_SET_ID = '33333333-3333-4000-8000-333333333333';
export const DEFAULT_PROMPT_SET_ID = '44444444-4444-4000-8000-444444444444';
export const DEFAULT_SCAN_ID = '55555555-5555-4000-8000-555555555555';

export class RlsAccessDeniedError extends Error {
  public readonly code = 'RLS_VIOLATION';
  public readonly status = 403;
  constructor(message = 'Row-level security policy violation: user does not belong to target workspace') {
    super(message);
    this.name = 'RlsAccessDeniedError';
  }
}

export class QuotaExceededError extends Error {
  public readonly code = 'QUOTA_EXCEEDED';
  public readonly status = 429;
  constructor(unitKey: string, limit: number, used: number, requested: number) {
    super(`QUOTA_EXCEEDED: unit "${unitKey}" limit ${limit} exceeded (used ${used}, requested ${requested})`);
    this.name = 'QuotaExceededError';
  }
}

export class UnknownTableError extends Error {
  public readonly code = 'TABLE_NOT_FOUND';
  public readonly status = 404;
  constructor(tableName: string) {
    super(`Relation "${tableName}" does not exist in public schema`);
    this.name = 'UnknownTableError';
  }
}

export type Row = Record<string, unknown>;

export interface PostgrestQueryOptions {
  select?: string;
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
  offset?: number;
  headOnly?: boolean;
}

const GLOBAL_READ_TABLES = new Set([
  'plan_templates',
  'plan_unit_limits',
  'welcome_guide_config',
  'welcome_guide_settings',
  'system_settings',
]);

export class HaloXDatabase {
  private tables = new Map<string, Row[]>();
  private providers: HaloXProviders;

  constructor(providers: HaloXProviders = createDeterministicProviders()) {
    this.providers = providers;
    this.resetSeed();
  }

  public resetSeed(): void {
    this.tables.clear();
    const now = '2026-10-22T12:00:00.000Z';

    const ensure = (name: string, rows: Row[] = []) => {
      this.tables.set(name, rows);
    };

    ensure('profiles', [
      { id: DEFAULT_USER_ID, email: 'demo@halox.local', full_name: 'HaloX 데모 관리자', phone_number: '010-0000-0000', created_at: now, updated_at: now },
      { id: OTHER_USER_ID, email: 'other@halox.local', full_name: '외부 테넌트 사용자', phone_number: null, created_at: now, updated_at: now },
    ]);

    ensure('workspaces', [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: '브리찌',
        slug: 'brizzi',
        owner_id: DEFAULT_USER_ID,
        status: 'active',
        settings: { notifications: { email_weekly: true, slack_alerts: false }, mode: 'pro' },
        auto_generate_prompts: true,
        default_brand_filter: '브리찌',
        sitemap_url: 'https://brizzi.kr/sitemap.xml',
        robots_txt_url: 'https://brizzi.kr/robots.txt',
        llms_txt_url: 'https://brizzi.kr/llms.txt',
        site_audit_scope_rules: { max_depth: 3 },
        strategy_map_status: 'ready',
        strategy_map_scanned_at: now,
        product_lineup_hints: ['AI 마케팅', 'GEO 분석'],
        schema_classification_policy: {},
        created_at: now,
        updated_at: now,
      },
      {
        id: ISOLATED_WORKSPACE_ID,
        name: '외부격리워크스페이스',
        slug: 'isolated-ws',
        owner_id: OTHER_USER_ID,
        status: 'active',
        settings: {},
        auto_generate_prompts: false,
        default_brand_filter: '외부브랜드',
        sitemap_url: null,
        robots_txt_url: null,
        llms_txt_url: null,
        site_audit_scope_rules: {},
        strategy_map_status: 'ready',
        strategy_map_scanned_at: now,
        product_lineup_hints: [],
        schema_classification_policy: {},
        created_at: now,
        updated_at: now,
      },
    ]);

    ensure('workspace_members', [
      {
        id: '10000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        user_id: DEFAULT_USER_ID,
        email: 'demo@halox.local',
        full_name: 'HaloX 데모 관리자',
        role: 'owner',
        allowed_sections: ['all'],
        joined_at: now,
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        workspace_id: ISOLATED_WORKSPACE_ID,
        user_id: OTHER_USER_ID,
        email: 'other@halox.local',
        full_name: '외부 테넌트 사용자',
        role: 'owner',
        allowed_sections: ['all'],
        joined_at: now,
      },
    ]);

    ensure('workspace_invitations', []);

    ensure('brands', [
      {
        id: '30000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        brand_name: '브리찌',
        target_domain: 'brizzi.kr',
        competitor_domains: ['competitor-a.co.kr', 'competitor-b.co.kr'],
        self_roots: ['brizzi.kr'],
        industry: 'SaaS / 마케팅',
        is_default: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    ensure('keyword_sets', [
      {
        id: DEFAULT_KEYWORD_SET_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
        name: '기본 브랜드 키워드 세트',
        description: '브리찌 핵심 검색어 모니터링 세트',
        is_active: true,
        target_domain: 'brizzi.kr',
        competitor_domains: ['competitor-a.co.kr', 'competitor-b.co.kr'],
        language: 'ko',
        country: 'KR',
        brand_name: '브리찌',
        industry: '마케팅 자동화',
        industry_tags: ['SEO', 'GEO', 'AEO'],
        journey_stage: 'consideration',
        is_default: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    const kw1 = '31000000-0000-4000-8000-000000000001';
    const kw2 = '31000000-0000-4000-8000-000000000002';
    const kwIsolated = '31000000-0000-4000-8000-000000000099';

    ensure('keywords', [
      {
        id: kw1,
        workspace_id: DEFAULT_WORKSPACE_ID,
        keyword_set_id: DEFAULT_KEYWORD_SET_ID,
        keyword: 'AI 검색 최적화',
        language: 'ko',
        country: 'KR',
        search_volume: 4200,
        search_volume_google_ads: 3900,
        keyword_difficulty: 42,
        competition: 0.55,
        cpc_min: 1200,
        cpc_max: 3500,
        intent: 'informational',
        intent_probability: 0.88,
        trends_json: [3200, 3500, 3900, 4200],
        status: 'completed',
        origin_type: 'manual',
        geo_cluster_id: '70000000-0000-4000-8000-000000000001',
        geo_prompt_id: null,
        source_prompt_id: null,
        is_active: true,
        is_paused: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: kw2,
        workspace_id: DEFAULT_WORKSPACE_ID,
        keyword_set_id: DEFAULT_KEYWORD_SET_ID,
        keyword: 'GEO 마케팅 가이드',
        language: 'ko',
        country: 'KR',
        search_volume: 1850,
        search_volume_google_ads: 1700,
        keyword_difficulty: 34,
        competition: 0.41,
        cpc_min: 900,
        cpc_max: 2400,
        intent: 'commercial',
        intent_probability: 0.82,
        trends_json: [1200, 1400, 1650, 1850],
        status: 'completed',
        origin_type: 'manual',
        geo_cluster_id: '70000000-0000-4000-8000-000000000001',
        geo_prompt_id: null,
        source_prompt_id: null,
        is_active: true,
        is_paused: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: kwIsolated,
        workspace_id: ISOLATED_WORKSPACE_ID,
        keyword_set_id: null,
        keyword: '기밀 외부 키워드',
        language: 'ko',
        country: 'KR',
        search_volume: 9999,
        search_volume_google_ads: 9999,
        keyword_difficulty: 50,
        competition: 0.5,
        cpc_min: 100,
        cpc_max: 200,
        intent: 'informational',
        intent_probability: 0.9,
        trends_json: [],
        status: 'completed',
        origin_type: 'manual',
        geo_cluster_id: null,
        geo_prompt_id: null,
        source_prompt_id: null,
        is_active: true,
        is_paused: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      },
    ]);

    ensure('serp_snapshots', [
      {
        id: '32000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        keyword_id: kw1,
        captured_at: now,
        provider: 'dataforseo-mock',
        country: 'KR',
        language: 'ko',
        engine: 'google',
        ai_overview_detected: true,
        ai_overview_json: { cited_domains: ['brizzi.kr'] },
        top_results_json: [{ rank: 12, url: 'https://brizzi.kr/ai-seo', title: 'AI 검색 최적화 총정리' }],
        paa_questions_json: ['AI 검색 최적화란 무엇인가요?'],
        related_searches_json: ['GEO 최적화 방법'],
        featured_snippet_json: null,
        serp_analysis_json: { our_rank: null, aio_cited: true, top10: false },
        gap_summary: { status: 'aio_only' },
      },
    ]);

    ensure('geo_prompt_sets', [
      {
        id: DEFAULT_PROMPT_SET_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
        name: '기본 GEO 질문 세트',
        default_engine: 'openai',
        schedule_enabled: true,
        schedule_hour: 9,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    const pr1 = '41000000-0000-4000-8000-000000000001';
    const pr2 = '41000000-0000-4000-8000-000000000002';

    ensure('geo_prompts', [
      {
        id: pr1,
        workspace_id: DEFAULT_WORKSPACE_ID,
        prompt_set_id: DEFAULT_PROMPT_SET_ID,
        prompt_text: '한국 기업을 위한 최고의 AI 검색(GEO) 분석 도구는 무엇인가요?',
        prompt_category: 'recommendation',
        language_code: 'ko',
        location_code: 'KR',
        search_volume: 1200,
        cm_brand: '브리찌',
        cm_industry: 'SaaS',
        cm_question_type: 'best_tool',
        is_active: true,
        is_paused: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: pr2,
        workspace_id: DEFAULT_WORKSPACE_ID,
        prompt_set_id: DEFAULT_PROMPT_SET_ID,
        prompt_text: 'SEO와 GEO를 동시에 관리할 수 있는 플랫폼 비교해줘',
        prompt_category: 'comparison',
        language_code: 'ko',
        location_code: 'KR',
        search_volume: 850,
        cm_brand: '브리찌',
        cm_industry: 'SaaS',
        cm_question_type: 'comparison',
        is_active: true,
        is_paused: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      },
    ]);

    const run1 = '42000000-0000-4000-8000-000000000001';
    ensure('geo_prompt_runs', [
      {
        id: run1,
        workspace_id: DEFAULT_WORKSPACE_ID,
        prompt_id: pr1,
        engine: 'openai',
        model_name: 'gpt-4o',
        mode: 'search',
        status: 'completed',
        answer_text: '브리찌(brizzi.kr)는 한국어 SEO와 AI 검색 가시성(GEO)을 통합 분석하는 대표적인 솔루션입니다.',
        requested_at: now,
        finished_at: now,
        cost_usd: 0.0025,
      },
    ]);

    ensure('geo_citations', [
      {
        id: '43000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        run_id: run1,
        cited_url: 'https://brizzi.kr/features/geo',
        domain: 'brizzi.kr',
        root_domain: 'brizzi.kr',
        position_index: 1,
        is_ours: true,
        is_competitor: false,
        domain_classification: 'owned',
        created_at: now,
      },
    ]);

    ensure('geo_run_metrics', [
      {
        id: '44000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        run_id: run1,
        brand_mentioned: true,
        is_cited: true,
        citation_rate: 10,
        our_citation_count: 1,
        competitor_citation_count: 2,
        other_citation_count: 3,
        source_but_not_cited: false,
        created_at: now,
      },
    ]);

    ensure('site_audit_scans', [
      {
        id: DEFAULT_SCAN_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
        target_url: 'https://brizzi.kr',
        scan_type: 'full',
        scan_mode: 'standard',
        status: 'completed',
        max_pages: 100,
        crawled_urls: 24,
        site_health_score: 93,
        ai_readiness_score: 88,
        critical_count: 0,
        warning_count: 2,
        notice_count: 4,
        created_at: now,
        completed_at: now,
      },
    ]);

    ensure('site_audit_pages', [
      {
        id: '51000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        scan_id: DEFAULT_SCAN_ID,
        url: 'https://brizzi.kr/',
        status_code: 200,
        lighthouse_data: { performance: 94, seo: 96, accessibility: 92 },
        created_at: now,
      },
    ]);

    ensure('site_audit_issues', [
      {
        id: '52000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        scan_id: DEFAULT_SCAN_ID,
        page_id: '51000000-0000-4000-8000-000000000001',
        page_url: 'https://brizzi.kr/',
        issue_type: 'schema_faq_missing',
        category: 'structured_data',
        severity: 'warning',
        layer: 'ai_readiness',
        score_dimension: 'ai_readiness',
        title: 'FAQPage 구조화 데이터(JSON-LD) 누락',
        description: '주요 랜딩 페이지에 FAQPage 스키마가 설정되어 있지 않습니다.',
        fix_recommendation: '핵심 질문 3~5개를 포함한 FAQPage JSON-LD를 추가하세요.',
        fix_difficulty: 'easy',
        impact_level: 'high',
        engine_impact: ['google', 'chatgpt', 'perplexity'],
        is_resolved: false,
        created_at: now,
      },
    ]);

    ensure('writing_style_profiles', [
      {
        id: '60000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        name: 'B2B 전문 분석가 페르소나',
        description: '객관적인 수치와 구조화된 표를 중심으로 설명하는 전문 B2B 문체',
        is_default: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    const ke1 = '61000000-0000-4000-8000-000000000001';
    ensure('knowledge_entities', [
      {
        id: ke1,
        workspace_id: DEFAULT_WORKSPACE_ID,
        name: '브리찌 GEO 코어',
        slug: 'brizzi-geo-core',
        description: 'AI 검색 가시성(AVI) 추적 및 콘텐츠 최적화 솔루션',
        logo_url: '/clone/assets/domain-placeholder.svg',
        base_url: 'https://brizzi.kr',
        program_type: 'product',
        coverage_type: 'verified',
        knowledge_type: 'product',
        parent_program_id: null,
        related_programs: [],
        created_at: now,
        updated_at: now,
      },
    ]);

    ensure('knowledge_claim_stats', [
      {
        entity_id: ke1,
        name: '브리찌 GEO 코어',
        slug: 'brizzi-geo-core',
        knowledge_type: 'product',
        program_type: 'product',
        logo_url: '/clone/assets/domain-placeholder.svg',
        base_url: 'https://brizzi.kr',
        workspace_id: DEFAULT_WORKSPACE_ID,
        context_count: 3,
        total_claims: 12,
        verified_claims: 10,
        unverified_claims: 2,
        stale_claims: 0,
        conflicted_claims: 0,
      },
    ]);

    ensure('knowledge_entity_sources', []);
    ensure('content_jobs', []);
    ensure('content_drafts', []);
    ensure('content_review_runs', []);
    ensure('export_history', []);
    ensure('report_snapshots', [
      {
        id: '65000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        prompt_set_id: DEFAULT_PROMPT_SET_ID,
        period_type: 'week',
        period_key: '2026-W43',
        start_date: '2026-10-16',
        end_date: '2026-10-22',
        kpi_payload: { aviComposite: 47, seoScore: 3, geoScore: 60, webHealthScore: 93 },
        changes_payload: { aviDelta: +4, newCitations: 3 },
        actions_payload: ['FAQPage 스키마 마크업 적용', '비교형 프롬프트 5종에 대한 공식 가이드 발행'],
        created_at: now,
      },
    ]);

    ensure('notifications', [
      {
        id: '66000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        event_type: 'audit.completed',
        title: 'brizzi.kr 정기 사이트 진단 완료 (건강도 93점)',
        metadata: { scan_id: DEFAULT_SCAN_ID, score: 93 },
        is_read: false,
        created_at: now,
      },
    ]);

    ensure('workspace_api_keys', []);

    ensure('workspace_plans', [
      {
        id: '67000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        plan: 'trial',
        billing_cycle: 'monthly',
        keyword_limit: 20,
        prompt_limit: 20,
        content_limit: 5,
        trial_ends_at: '2026-11-22T00:00:00.000Z',
        expires_at: '2026-11-22T00:00:00.000Z',
        created_at: now,
      },
      {
        id: '67000000-0000-4000-8000-000000000002',
        workspace_id: ISOLATED_WORKSPACE_ID,
        plan: 'trial',
        billing_cycle: 'monthly',
        keyword_limit: 20,
        prompt_limit: 20,
        content_limit: 5,
        trial_ends_at: '2026-11-22T00:00:00.000Z',
        expires_at: '2026-11-22T00:00:00.000Z',
        created_at: now,
      },
    ]);

    ensure('usage_reservations', [
      {
        id: '68000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        unit_key: 'keyword_create',
        amount: 2,
        idempotency_key: 'seed-keywords-init',
        status: 'committed',
        created_at: now,
        updated_at: now,
      },
      {
        id: '68000000-0000-4000-8000-000000000002',
        workspace_id: DEFAULT_WORKSPACE_ID,
        unit_key: 'prompt_create',
        amount: 2,
        idempotency_key: 'seed-prompts-init',
        status: 'committed',
        created_at: now,
        updated_at: now,
      },
    ]);

    ensure('workspace_usage', [
      {
        workspace_id: DEFAULT_WORKSPACE_ID,
        period: '2026-10',
        content_generated: 0,
        keywords_created: 2,
        llm_cost: 0.0025,
        image_cost: 0,
        updated_at: now,
      },
    ]);

    const clusterId = '70000000-0000-4000-8000-000000000001';
    ensure('keyword_clusters', [
      {
        id: clusterId,
        workspace_id: DEFAULT_WORKSPACE_ID,
        label: 'AI 검색 & GEO 핵심 클러스터',
        stats_json: { keyword_count: 2, avg_difficulty: 38, geo: { neighbors: [] } },
        created_at: now,
      },
    ]);

    ensure('keyword_cluster_members', [
      {
        cluster_id: clusterId,
        keyword_id: kw1,
        workspace_id: DEFAULT_WORKSPACE_ID,
        keywords: { id: kw1, keyword: 'AI 검색 최적화', search_volume: 4200 },
      },
    ]);

    ensure('onboarding_jobs', [
      {
        id: '71000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        phase: 'completed',
        expected_count: 4,
        completed_count: 4,
        updated_at: now,
      },
    ]);

    ensure('plan_templates', [
      {
        id: '72000000-0000-4000-8000-000000000001',
        plan_key: 'trial',
        name: 'Trial',
        description: '무료 체험 플랜',
        is_active: true,
        features: ['키워드 20개', 'AI 질문 20개', '사이트 진단'],
        created_at: now,
        max_workspaces: 1,
        monthly_price: 0,
        annual_price: 0,
        is_archived: false,
        sort_order: 1,
        clone_of: null,
        price_krw_monthly: 0,
      },
      {
        id: '72000000-0000-4000-8000-000000000002',
        plan_key: 'pro',
        name: 'Pro',
        description: '성장하는 마케팅 팀을 위한 프로 플랜',
        is_active: true,
        features: ['키워드 100개+', '4대 AI 엔진 추적', '콘텐츠 팩토리'],
        created_at: now,
        max_workspaces: 5,
        monthly_price: 600000,
        annual_price: 5760000,
        is_archived: false,
        sort_order: 2,
        clone_of: null,
        price_krw_monthly: 600000,
      },
    ]);

    ensure('plan_unit_limits', [
      { plan_key: 'trial', unit_key: 'keyword_create', monthly_limit: 20 },
      { plan_key: 'trial', unit_key: 'prompt_create', monthly_limit: 20 },
      { plan_key: 'trial', unit_key: 'content_gen', monthly_limit: 5 },
      { plan_key: 'trial', unit_key: 'site_audit_scan', monthly_limit: 20 },
    ]);

    ensure('welcome_guide_config', [
      {
        id: '73000000-0000-4000-8000-000000000001',
        step_order: 1,
        icon_name: 'Search',
        title_ko: '핵심 키워드 등록',
        title_en: 'Add Target Keywords',
        description_ko: '우리 브랜드와 관련된 검색어를 등록하세요.',
        description_en: 'Register keywords for your brand.',
        metric_label: 'Keywords',
        color_phase: 'blue',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    ensure('welcome_guide_settings', [
      {
        id: '74000000-0000-4000-8000-000000000001',
        header_title_ko: '브리찌 시작 가이드',
        header_title_en: 'Getting Started',
        header_subtitle_ko: '3단계로 AI 검색 가시성을 진단하세요',
        header_subtitle_en: 'Diagnose AI visibility in 3 steps',
        layout_type: 'horizontal',
        is_enabled: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    ensure('workspace_events', [
      {
        id: '75000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        event_type: 'workspace.initialized',
        metadata: { source: 'seed' },
        created_at: now,
      },
    ]);

    ensure('gsc_daily_totals', [
      {
        id: '76000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        date: '2026-10-22',
        clicks: 128,
        impressions: 3420,
        ctr: 3.74,
        avg_position: 11.4,
        created_at: now,
      },
    ]);

    ensure('ga4_page_stats', [
      {
        id: '77000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        date: '2026-10-22',
        page_path: '/features/geo',
        organic_sessions: 320,
        ai_sessions: 48,
        conversions: 14,
        created_at: now,
      },
    ]);

    ensure('evidence_claims', [
      {
        id: '78000000-0000-4000-8000-000000000001',
        workspace_id: DEFAULT_WORKSPACE_ID,
        entity_id: ke1,
        claim_text: '브리찌는 4대 AI 검색엔진(ChatGPT, Claude, Gemini, Perplexity) 인용률을 실시간 추적합니다.',
        verification_status: 'verified',
        source_url: 'https://brizzi.kr/features/geo',
        created_at: now,
      },
    ]);

    // Ensure all other observed runtime & Phase 7 secondary tables exist as empty arrays by default
    for (const emptyTable of [
      'agent_conversations',
      'agent_messages',
      'articles',
      'article_translations',
      'brand_reclassify_jobs',
      'client_web_vitals',
      'cluster_stats_history',
      'content_change_items',
      'earned_publications',
      'evidence_claims',
      'ga4_page_stats',
      'geo_discover_runs',
      'geo_prompt_candidates',
      'geo_prompt_tag_assignments',
      'gsc_daily_keywords',
      'gsc_daily_pages',
      'gsc_daily_totals',
      'gsc_sync_state',
      'keyword_knowledge_entities',
      'keyword_serp_jobs',
      'keyword_tag_assignments',
      'orders',
      'platform_admins',
      'subscriptions',
      'system_settings',
      'vw_gsc_connection_health',
      'workspace_billing_overrides',
      'workspace_google_connections',
      'workspace_mirrors',
      'workspace_tag_groups',
      'workspace_tags',
    ]) {
      if (!this.tables.has(emptyTable)) ensure(emptyTable, []);
    }
  }

  public getAllowedWorkspaceIds(userId = DEFAULT_USER_ID): Set<string> {
    const members = this.tables.get('workspace_members') || [];
    return new Set(
      members.filter(m => m.user_id === userId).map(m => String(m.workspace_id))
    );
  }

  public assertWorkspaceMember(workspaceId: string, userId = DEFAULT_USER_ID): void {
    const allowed = this.getAllowedWorkspaceIds(userId);
    if (!allowed.has(workspaceId)) {
      throw new RlsAccessDeniedError(
        `User "${userId}" is not authorized to access workspace "${workspaceId}"`
      );
    }
  }

  private matchesPostgrestFilter(row: Row, key: string, rawExpr: string): boolean {
    const field = key.includes('.') ? key.split('.').pop()! : key;
    const val = row[field];
    if (rawExpr.startsWith('eq.')) {
      const target = rawExpr.slice(3);
      if (target === 'true') return val === true;
      if (target === 'false') return val === false;
      return String(val ?? '') === target;
    }
    if (rawExpr.startsWith('neq.')) {
      const target = rawExpr.slice(4);
      return String(val ?? '') !== target;
    }
    if (rawExpr.startsWith('is.')) {
      const target = rawExpr.slice(3).toLowerCase();
      if (target === 'null') return val === null || val === undefined;
      if (target === 'true') return val === true;
      if (target === 'false') return val === false;
    }
    if (rawExpr.startsWith('in.(') && rawExpr.endsWith(')')) {
      const items = rawExpr
        .slice(4, -1)
        .split(',')
        .map(s => s.trim().replace(/^"|"$/g, ''));
      return items.includes(String(val ?? ''));
    }
    return String(val ?? '') === rawExpr;
  }

  /**
   * Ensure the requested table is part of the known schema whitelist.
   */
  public assertKnownTable(tableName: string): void {
    if (
      !tableName ||
      tableName === '__proto__' ||
      tableName === 'constructor' ||
      tableName === 'prototype' ||
      !this.tables.has(tableName)
    ) {
      throw new UnknownTableError(tableName);
    }
  }

  /**
   * Strip server-only secret fields (e.g. `workspace_api_keys.key_hash`) before returning to clients.
   */
  private sanitizeRowForClient(tableName: string, row: Row): Row {
    if (tableName === 'workspace_api_keys') {
      const clone: Row = { ...row };
      delete clone.key_hash;
      return clone;
    }
    return { ...row };
  }

  /**
   * Project top-level columns when PostgREST `?select=col1,col2` is specified.
   */
  private projectSelectColumns(row: Row, selectExpr?: string): Row {
    if (!selectExpr || selectExpr.trim() === '*') {
      return row;
    }
    const tokens: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of selectExpr) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        if (current.trim()) tokens.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) tokens.push(current.trim());

    const fields = tokens.map(t => t.split(/[(:]/)[0].trim()).filter(Boolean);
    if (fields.includes('*') || fields.length === 0) {
      return row;
    }
    const projected: Row = {};
    for (const f of fields) {
      if (f in row) {
        projected[f] = row[f];
      }
    }
    return projected;
  }

  /**
   * Verify a workspace API key by raw token or key_prefix and ensure it is not revoked.
   */
  public verifyWorkspaceApiKey(rawKeyOrPrefix: string): Row | null {
    if (!rawKeyOrPrefix) return null;
    const keys = this.tables.get('workspace_api_keys') || [];
    const candidateHash = crypto.createHash('sha256').update(rawKeyOrPrefix).digest('hex');
    const matched = keys.find(
      k =>
        !k.revoked_at &&
        (k.key_hash === candidateHash ||
          k.key_hash === rawKeyOrPrefix ||
          k.key_prefix === rawKeyOrPrefix ||
          (typeof k.key_prefix === 'string' && rawKeyOrPrefix.startsWith(k.key_prefix)))
    );
    if (!matched) return null;
    matched.last_used_at = new Date().toISOString();
    return this.sanitizeRowForClient('workspace_api_keys', matched);
  }

  /**
   * PostgREST-compatible table read with automatic RLS filtering.
   */
  public queryTable(
    tableName: string,
    options: PostgrestQueryOptions = {},
    actorUserId = DEFAULT_USER_ID
  ): { data: Row[]; count: number } {
    this.assertKnownTable(tableName);
    const rawRows = this.tables.get(tableName) || [];
    const allowedWorkspaces = this.getAllowedWorkspaceIds(actorUserId);

    // Apply RLS filter
    let rows = rawRows.filter(row => {
      if (GLOBAL_READ_TABLES.has(tableName)) return true;
      if (tableName === 'workspaces') return allowedWorkspaces.has(String(row.id));
      if (tableName === 'profiles') return String(row.id) === actorUserId;
      if ('workspace_id' in row && row.workspace_id) {
        return allowedWorkspaces.has(String(row.workspace_id));
      }
      if (tableName === 'serp_snapshots' && row.keyword_id) {
        const kw = (this.tables.get('keywords') || []).find(k => k.id === row.keyword_id);
        return kw ? allowedWorkspaces.has(String(kw.workspace_id)) : false;
      }
      return true;
    });

    // Apply PostgREST query filters
    for (const [key, expr] of Object.entries(options.filters || {})) {
      if (['select', 'order', 'limit', 'offset', 'columns'].includes(key)) continue;
      rows = rows.filter(row => this.matchesPostgrestFilter(row, key, expr));
    }

    // Enrich workspace_members with embedded workspace object when requested
    if (tableName === 'workspace_members') {
      const wsTable = this.tables.get('workspaces') || [];
      rows = rows.map(row => ({
        ...row,
        workspaces: wsTable.find(w => w.id === row.workspace_id) || null,
      }));
    }

    // Apply ordering
    if (options.order) {
      const [col, dir] = options.order.split('.');
      const desc = dir === 'desc';
      rows = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av === bv) return 0;
        const cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'ko', { numeric: true });
        return desc ? -cmp : cmp;
      });
    }

    const totalCount = rows.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? rows.length;
    const paged = rows
      .slice(offset, offset + limit)
      .map(row => this.projectSelectColumns(this.sanitizeRowForClient(tableName, row), options.select));

    return {
      data: options.headOnly ? [] : paged,
      count: totalCount,
    };
  }

  /**
   * PostgREST-compatible table insert with RLS check.
   */
  public insertTable(tableName: string, payload: Row | Row[], actorUserId = DEFAULT_USER_ID): Row[] {
    this.assertKnownTable(tableName);
    if (tableName === 'client_web_vitals') {
      return [];
    }
    const items = Array.isArray(payload) ? payload : [payload];
    const table = this.tables.get(tableName) || [];
    const now = new Date().toISOString();
    const inserted: Row[] = [];

    for (const item of items) {
      if (tableName === 'workspaces') {
        const id = typeof item.id === 'string' ? item.id : crypto.randomUUID();
        const ws: Row = {
          id,
          name: String(item.name || '새 워크스페이스'),
          slug: String(item.slug || `ws-${id.slice(0, 8)}`),
          owner_id: actorUserId,
          status: 'active',
          settings: {},
          auto_generate_prompts: true,
          strategy_map_status: 'ready',
          created_at: now,
          updated_at: now,
          ...item,
        };
        table.push(ws);
        this.tables.get('workspace_members')!.push({
          id: crypto.randomUUID(),
          workspace_id: id,
          user_id: actorUserId,
          email: 'demo@halox.local',
          full_name: 'HaloX 데모 관리자',
          role: 'owner',
          allowed_sections: ['all'],
          joined_at: now,
        });
        this.tables.get('workspace_plans')!.push({
          id: crypto.randomUUID(),
          workspace_id: id,
          plan: 'trial',
          billing_cycle: 'monthly',
          keyword_limit: 20,
          prompt_limit: 20,
          content_limit: 5,
          created_at: now,
        });
        inserted.push(ws);
        continue;
      }

      const workspaceId = String(item.workspace_id || DEFAULT_WORKSPACE_ID);
      this.assertWorkspaceMember(workspaceId, actorUserId);

      const record: Row = {
        id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
        workspace_id: workspaceId,
        created_at: now,
        updated_at: now,
        ...item,
      };

      if (tableName === 'workspace_api_keys') {
        const rawSecret = String(
          item.raw_key || item.key_hash || item.key_prefix || `hx_live_${String(record.id).slice(0, 8)}`
        );
        delete record.raw_key;
        record.key_prefix = String(item.key_prefix || rawSecret.slice(0, 12));
        record.key_hash = crypto.createHash('sha256').update(rawSecret).digest('hex');
        record.revoked_at = item.revoked_at ?? null;
      }

      table.push(record);
      inserted.push(this.sanitizeRowForClient(tableName, record));
    }

    this.tables.set(tableName, table);
    return inserted;
  }

  /**
   * PostgREST-compatible table update (PATCH) with RLS enforcement.
   */
  public updateTable(
    tableName: string,
    patch: Row,
    filters: Record<string, string> = {},
    actorUserId = DEFAULT_USER_ID
  ): Row[] {
    this.assertKnownTable(tableName);
    const table = this.tables.get(tableName) || [];
    const allowedWorkspaces = this.getAllowedWorkspaceIds(actorUserId);
    const now = new Date().toISOString();
    const updated: Row[] = [];

    for (const row of table) {
      let matches = true;
      for (const [key, expr] of Object.entries(filters)) {
        if (['select', 'order', 'limit', 'offset', 'columns'].includes(key)) continue;
        if (!this.matchesPostgrestFilter(row, key, expr)) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;

      if (tableName === 'workspaces') {
        if (!allowedWorkspaces.has(String(row.id))) {
          throw new RlsAccessDeniedError();
        }
      } else if (tableName === 'profiles') {
        if (String(row.id) !== actorUserId) {
          throw new RlsAccessDeniedError();
        }
      } else if ('workspace_id' in row && row.workspace_id) {
        if (!allowedWorkspaces.has(String(row.workspace_id))) {
          throw new RlsAccessDeniedError();
        }
      }

      const safePatch: Row = { ...patch };
      delete safePatch.id;
      delete safePatch.workspace_id;
      if (tableName === 'workspace_api_keys') {
        delete safePatch.key_hash;
      }
      Object.assign(row, safePatch, { updated_at: now });
      updated.push(this.sanitizeRowForClient(tableName, row));
    }

    return updated;
  }

  /**
   * PostgREST-compatible table delete (DELETE) with RLS enforcement.
   */
  public deleteTable(
    tableName: string,
    filters: Record<string, string> = {},
    actorUserId = DEFAULT_USER_ID
  ): Row[] {
    this.assertKnownTable(tableName);
    const table = this.tables.get(tableName) || [];
    const allowedWorkspaces = this.getAllowedWorkspaceIds(actorUserId);
    const remaining: Row[] = [];
    const deleted: Row[] = [];

    for (const row of table) {
      let matches = true;
      for (const [key, expr] of Object.entries(filters)) {
        if (['select', 'order', 'limit', 'offset', 'columns'].includes(key)) continue;
        if (!this.matchesPostgrestFilter(row, key, expr)) {
          matches = false;
          break;
        }
      }
      if (!matches) {
        remaining.push(row);
        continue;
      }

      if (tableName === 'workspaces') {
        if (!allowedWorkspaces.has(String(row.id))) {
          throw new RlsAccessDeniedError();
        }
      } else if (tableName === 'profiles') {
        if (String(row.id) !== actorUserId) {
          throw new RlsAccessDeniedError();
        }
      } else if ('workspace_id' in row && row.workspace_id) {
        if (!allowedWorkspaces.has(String(row.workspace_id))) {
          throw new RlsAccessDeniedError();
        }
      }

      deleted.push(this.sanitizeRowForClient(tableName, row));
    }

    this.tables.set(tableName, remaining);
    return deleted;
  }

  /**
   * Execute any of the 36 runtime-observed RPC contracts + write/quota RPCs.
   */
  public callRpc(
    rpcName: string,
    args: Record<string, unknown> = {},
    actorUserId = DEFAULT_USER_ID
  ): unknown {
    const workspaceId = String(
      args.p_workspace_id || args._workspace_id || args.workspace_id || DEFAULT_WORKSPACE_ID
    );

    // Check RLS whenever workspace_id is explicitly provided
    if (args.p_workspace_id || args._workspace_id || args.workspace_id) {
      this.assertWorkspaceMember(workspaceId, actorUserId);
    }

    const keywords = (this.tables.get('keywords') || []).filter(
      k => k.workspace_id === workspaceId && !k.deleted_at
    );
    const prompts = (this.tables.get('geo_prompts') || []).filter(
      p => p.workspace_id === workspaceId && !p.deleted_at
    );
    const promptSets = (this.tables.get('geo_prompt_sets') || []).filter(
      s => s.workspace_id === workspaceId
    );
    const runs = (this.tables.get('geo_prompt_runs') || []).filter(
      r => r.workspace_id === workspaceId
    );
    const scans = (this.tables.get('site_audit_scans') || []).filter(
      s => s.workspace_id === workspaceId
    );
    const latestScan = scans[scans.length - 1] || null;

    // Metric calculations using S1 pure functions
    const currentSeoScore = seoScore({ avgPosition: null, top10Rate: 0, aioCitationRate: 11 });
    const currentGeoScore = geoScore({
      citationRate: 10,
      mentionRate: 30,
      citationRankScore: 100,
      mentionRankScore: 100,
    });
    const currentWebHealth = latestScan ? Number(latestScan.site_health_score) : 93;
    const currentAviComposite = aviComposite({
      seo: currentSeoScore,
      geo: currentGeoScore,
      webHealth: currentWebHealth,
    });

    switch (rpcName) {
      case 'cancel_account_deletion':
      case 'record_auth_login':
        return true;

      case 'get_avi_daily_components':
        return [
          {
            date: '2026-10-22',
            label: '10/22',
            mentionRank: 100,
            citationRank: 100,
            mentionCoverage: 30,
            citationCoverage: 10,
          },
        ];

      case 'get_avi_overview': {
        const avgScore = serverAviFiveFactor({
          citationRate: 10,
          mentionRate: 30,
          sentimentScore: 80,
          coverageRate: 50,
          positionQuality: 90,
        });
        return {
          level: scoreLevel(currentGeoScore),
          setCount: promptSets.length,
          totalRuns: runs.length || 10,
          components: {
            citationRate: 10,
            mentionRate: 30,
            citationRank: 100,
            mentionRank: 100,
            geoScore: currentGeoScore,
            serverAviFiveFactor: avgScore,
          },
          dailySeries: [{ date: '2026-10-22', score: currentGeoScore }],
          averageScore: currentGeoScore,
          citedPrompts: 1,
          coverageRate: prompts.length > 0 ? Math.round((1 / prompts.length) * 100) : 50,
          totalPrompts: prompts.length,
          activeSetCount: promptSets.filter(s => s.is_active).length,
          avgMentionRank: 1.0,
          avgCitationRank: 1.0,
          firstMentionRate: 30,
          firstCitationRate: 10,
        };
      }

      case 'get_billing_period_range':
        return [{ period_start: '2026-10-01', period_end: '2026-10-31' }];

      case 'get_full_funnel_stats':
        return {
          pages: [{ url: 'https://brizzi.kr/', impressions: 1200, clicks: 84, aiCitations: 3 }],
          summary: {
            seoScore: currentSeoScore,
            geoScore: currentGeoScore,
            webHealthScore: currentWebHealth,
            aviComposite: currentAviComposite,
          },
        };

      case 'get_ga4_channel_summary': {
        const ga4Rows = (this.tables.get('ga4_page_stats') || []).filter(
          r => r.workspace_id === workspaceId
        );
        const gscTotals = (this.tables.get('gsc_daily_totals') || []).filter(
          r => r.workspace_id === workspaceId
        );
        const organicSessions = ga4Rows.reduce((s, r) => s + Number(r.organic_sessions || 0), 0);
        const aiSessions = ga4Rows.reduce((s, r) => s + Number(r.ai_sessions || 0), 0);
        const gscClicks = gscTotals.reduce((s, r) => s + Number(r.clicks || 0), 0);
        if (ga4Rows.length === 0) return [];
        return [
          {
            channel: 'Organic Search',
            sessions: organicSessions,
            ai_sessions: aiSessions,
            ai_traffic_share: aiTrafficShare(aiSessions, organicSessions),
            search_contribution: searchContribution(gscClicks, organicSessions),
          },
        ];
      }

      case 'get_ga4_dashboard_timeseries': {
        const ga4Rows = (this.tables.get('ga4_page_stats') || []).filter(
          r => r.workspace_id === workspaceId
        );
        return ga4Rows.map(r => ({
          date: r.date,
          organic_sessions: Number(r.organic_sessions || 0),
          ai_sessions: Number(r.ai_sessions || 0),
          ai_traffic_share: aiTrafficShare(Number(r.ai_sessions || 0), Number(r.organic_sessions || 0)),
        }));
      }

      case 'get_gsc_dashboard_dimensions': {
        return keywords.map(k => ({
          dimension: 'query',
          key: k.keyword,
          clicks: 42,
          impressions: 980,
          ctr: 4.28,
          avg_position: 8.5,
        }));
      }

      case 'get_gsc_dashboard_timeseries': {
        return (this.tables.get('gsc_daily_totals') || []).filter(
          r => r.workspace_id === workspaceId
        );
      }

      case 'get_page_ga4_stats': {
        return (this.tables.get('ga4_page_stats') || [])
          .filter(r => r.workspace_id === workspaceId)
          .map(r => ({
            ...r,
            ai_traffic_share: aiTrafficShare(Number(r.ai_sessions || 0), Number(r.organic_sessions || 0)),
          }));
      }

      case 'get_gap_overview_light':
        return keywords.map(k => ({
          id: `gap-${k.id}`,
          keyword_id: k.id,
          captured_at: '2026-10-22T12:00:00.000Z',
          brand_presence: { seo_top10: false, aio_cited: true, geo_cited: true },
        }));

      case 'get_geo_collection_days':
        return [{ day: '2026-10-22' }];

      case 'get_geo_group_status_kpi_multi':
        return {
          buckets: ((args.p_buckets as Array<{ key: string }>) || []).map(b => ({
            key: b.key,
            geoScore: currentGeoScore,
            citationRate: 10,
            mentionRate: 30,
          })),
        };

      case 'get_geo_slot_counts':
        return {
          slot_cited: 1,
          slot_total: 10,
          slot_sourced: 2,
          slot_mentioned: 3,
        };

      case 'get_geo_ws_mention_terms':
        return {
          our_terms: ['브리찌', 'brizzi.kr'],
          our_total: 3,
          comp_terms: ['경쟁사A'],
          comp_total: 2,
          our_unique: 2,
          runs_total: 10,
          both_unique: 1,
          comp_unique: 1,
          our_mapped_unique: 2,
        };

      case 'get_gsc_dashboard_kpis':
        return {
          clicks: 128,
          impressions: 3420,
          ctr: 3.74,
          avg_position: 11.4,
          prev_clicks: 110,
          prev_impressions: 3100,
          prev_ctr: 3.55,
          prev_avg_position: 12.1,
        };

      case 'get_keywords_with_gsc_stats':
        return keywords.map((k, idx) => {
          const avgPos = idx === 0 ? 8.5 : 3.2;
          const impressions = idx === 0 ? 980 : 1450;
          const ctr = idx === 0 ? 4.28 : 6.4;
          const quickWin = isQuickWinKeyword({ avgPosition: avgPos, impressions, ctrPercent: ctr });
          return {
            keyword_id: k.id,
            keyword_text: k.keyword,
            gsc_clicks: Math.round((impressions * ctr) / 100),
            gsc_impressions: impressions,
            gsc_ctr: ctr,
            gsc_avg_position: avgPos,
            gsc_insight_type: quickWin ? 'quick_win' : 'top_performer',
          };
        });

      case 'get_latest_serp_snapshots': {
        const ids = Array.isArray(args.p_keyword_ids) ? args.p_keyword_ids.map(String) : null;
        const snaps = (this.tables.get('serp_snapshots') || []).filter(
          s => s.workspace_id === workspaceId && (!ids || ids.includes(String(s.keyword_id)))
        );
        return snaps;
      }

      case 'get_light_dashboard_overview':
        return {
          gap: { total: keywords.length, uncovered: 1 },
          avi_summary: {
            aviComposite: currentAviComposite,
            seoScore: currentSeoScore,
            geoScore: currentGeoScore,
            webHealthScore: currentWebHealth,
            level: scoreLevel(currentAviComposite),
          },
          audit_active: false,
          audit_latest: latestScan,
          weekly_report: (this.tables.get('report_snapshots') || []).find(
            r => r.workspace_id === workspaceId
          ) || null,
          funnel_summary: { awareness: 1, consideration: 1, conversion: 0 },
          top10_sparkline: [{ date: '2026-10-22', value: 0 }],
          prompt_stats_summary: { total: prompts.length, cited: 1 },
          web_health_sparkline: [{ date: '2026-10-22', value: currentWebHealth }],
          ga4_traffic_sparkline: [{ date: '2026-10-22', value: 45 }],
          citation_rate_sparkline: [{ date: '2026-10-22', value: 10 }],
        };

      case 'get_light_prompt_stats':
        return {
          domain_stats: [{ domain: 'brizzi.kr', citations: 1, is_ours: true }],
          prompt_stats: prompts.map(p => ({ prompt_id: p.id, cited: true, mentioned: true })),
          category_stats: [{ category: 'recommendation', count: prompts.length }],
        };

      case 'get_paused_summary': {
        const plan = (this.tables.get('workspace_plans') || []).find(
          p => p.workspace_id === workspaceId
        );
        const kwLimit = Number(plan?.keyword_limit ?? 20);
        const prLimit = Number(plan?.prompt_limit ?? 20);
        const activeKw = keywords.filter(k => k.is_active && !k.is_paused).length;
        const pausedKw = keywords.filter(k => k.is_paused).length;
        const activePr = prompts.filter(p => p.is_active && !p.is_paused).length;
        const pausedPr = prompts.filter(p => p.is_paused).length;
        return {
          prompt_limit: prLimit,
          keyword_limit: kwLimit,
          active_prompts: activePr,
          paused_prompts: pausedPr,
          active_keywords: activeKw,
          paused_keywords: pausedKw,
          restorable_prompts: Math.max(0, prLimit - activePr),
          restorable_keywords: Math.max(0, kwLimit - activeKw),
        };
      }

      case 'get_pro_dashboard_kpi':
        return {
          kpi: {
            aviComposite: currentAviComposite,
            seoScore: currentSeoScore,
            geoScore: currentGeoScore,
            webHealthScore: currentWebHealth,
          },
          engine_sov: [
            { engine: 'openai', sov: 35 },
            { engine: 'claude', sov: 30 },
            { engine: 'gemini', sov: 25 },
            { engine: 'perplexity', sov: 40 },
          ],
          overall_sov: 32.5,
          mention_rank: 1.0,
          total_engines: 4,
          daily_citation_series: [{ date: '2026-10-22', rate: 10 }],
          daily_mention_rank_series: [{ date: '2026-10-22', rank: 1.0 }],
        };

      case 'get_seo_aio_cross_trend':
        return [
          {
            day: '2026-10-22',
            aio_detected: 1,
            our_cited: 1,
            our_top10: 0,
            cross_count: 0,
            aio_pos_sum: 1,
            aio_pos_cnt: 1,
            excluded_count: 0,
          },
        ];

      case 'get_seo_overview_agg':
        return {
          current: {
            seo_score: currentSeoScore,
            avg_position: null,
            position_score: positionScore(null),
            top10_rate: 0,
            aio_citation_rate: 11,
          },
          previous: {
            seo_score: 2,
            avg_position: null,
            position_score: null,
            top10_rate: 0,
            aio_citation_rate: 8,
          },
        };

      case 'get_seo_rank_movers':
        return keywords.map(k => ({
          keyword_id: k.id,
          first_date: '2026-10-15',
          last_date: '2026-10-22',
          first_rank: 14,
          last_rank: 11,
          last_aio_cited: true,
          last_best_url: 'https://brizzi.kr/ai-seo',
        }));

      case 'get_serp_brand_presence_slim':
      case 'get_serp_brand_presence_trend':
      case 'get_serp_brand_presence_window':
        return keywords.map(k => ({
          keyword_id: k.id,
          captured_at: '2026-10-22T12:00:00.000Z',
          ai_overview_detected: true,
          brand_presence: { cited: true, organic_top10: false },
        }));

      case 'get_user_activity_snapshot': {
        const exportsList = (this.tables.get('export_history') || []).filter(
          e => e.workspace_id === workspaceId
        );
        const jobs = (this.tables.get('content_jobs') || []).filter(
          j => j.workspace_id === workspaceId
        );
        const keys = (this.tables.get('workspace_api_keys') || []).filter(
          k => k.workspace_id === workspaceId && !k.revoked_at
        );
        return [
          {
            export_count: exportsList.length,
            last_export_at: exportsList[exportsList.length - 1]?.exported_at || null,
            content_job_count: jobs.length,
            last_content_job_at: jobs[jobs.length - 1]?.created_at || null,
            agent_conversation_count: 1,
            api_key_count: keys.length,
            last_api_key_at: keys[keys.length - 1]?.created_at || null,
          },
        ];
      }

      case 'get_web_health_sparkline':
        return [{ date: '2026-10-22', value: currentWebHealth }];

      case 'get_workspace_activity_snapshot': {
        const jobs = (this.tables.get('content_jobs') || []).filter(
          j => j.workspace_id === workspaceId
        );
        const keys = (this.tables.get('workspace_api_keys') || []).filter(
          k => k.workspace_id === workspaceId && !k.revoked_at
        );
        return [
          {
            keyword_count: keywords.length,
            prompt_count: prompts.length,
            prompt_set_count: promptSets.length,
            has_schedule_enabled: true,
            run_count_30d: runs.length,
            last_run_at: runs[runs.length - 1]?.finished_at || '2026-10-22T12:00:00.000Z',
            scan_count: scans.length,
            last_scan_at: latestScan?.completed_at || '2026-10-22T12:00:00.000Z',
            content_job_count: jobs.length,
            last_content_job_at: jobs[jobs.length - 1]?.created_at || null,
            api_key_count: keys.length,
            last_api_key_used_at: null,
            last_keyword_at: keywords[keywords.length - 1]?.created_at || '2026-10-22T12:00:00.000Z',
            last_prompt_at: prompts[prompts.length - 1]?.created_at || '2026-10-22T12:00:00.000Z',
          },
        ];
      }

      case 'get_workspace_members': {
        const members = (this.tables.get('workspace_members') || []).filter(
          m => m.workspace_id === workspaceId
        );
        return members.map(m => ({
          user_id: m.user_id,
          email: m.email || 'demo@halox.local',
          full_name: m.full_name || 'HaloX 데모 관리자',
          role: m.role,
          allowed_sections: m.allowed_sections || ['all'],
          joined_at: m.joined_at,
        }));
      }

      case 'get_workspace_quota_summary': {
        const plan = (this.tables.get('workspace_plans') || []).find(
          p => p.workspace_id === workspaceId
        );
        const reservations = (this.tables.get('usage_reservations') || []).filter(
          r => r.workspace_id === workspaceId && (r.status === 'reserved' || r.status === 'committed')
        );
        const usedFor = (unitKey: string) =>
          reservations
            .filter(r => storedQuotaUnit(r.unit_key) === unitKey)
            .reduce((sum, r) => sum + Number(r.amount || 0), 0);

        const units = QUOTA_UNIT_KEYS.map(key => ({
          key,
          label: QUOTA_UNITS[key].label,
          limit: quotaLimitFor(key, plan),
        }));
        return units.map(u => {
          const used = usedFor(u.key);
          const remaining = Math.max(0, u.limit - used);
          return {
            unit_key: u.key,
            unit_label: u.label,
            unit_type: 'monthly',
            plan_limit: u.limit,
            plan_used: used,
            plan_remaining: remaining,
            credit_balance: 0,
            override_limit: null,
            effective_limit: u.limit,
            effective_remaining: remaining,
          };
        });
      }

      case 'site_audit_links_summary':
        return {
          total: 48,
          orphans: [],
          to_broken: [],
          top_linked: [{ url: 'https://brizzi.kr/', count: 24 }],
          computed_at: '2026-10-22T12:00:00.000Z',
          to_redirect: [],
          broken_pages: [],
          orphan_count: 0,
          nofollow_count: 2,
          pages_3xx_count: 0,
          pages_4xx_count: 0,
          descriptive_count: 46,
          descriptive_ratio: 0.958,
        };

      case 'strategy_map_effective_state': {
        const clusters = (this.tables.get('keyword_clusters') || []).filter(
          c => c.workspace_id === workspaceId
        );
        return {
          reason: null,
          status: 'ready',
          effective: 'ready',
          scanned_at: '2026-10-22T12:00:00.000Z',
          cluster_count: clusters.length,
          prompt_set_count: promptSets.length,
          active_prompt_count: prompts.filter(p => p.is_active).length,
          active_keyword_count: keywords.filter(k => k.is_active).length,
          latest_prompt_set_id: promptSets[0]?.id || null,
          linked_keyword_count: keywords.length,
          auto_generate_prompts: true,
          recommended_entrypoint: '/app/strategy-map',
          recommended_resume_from: null,
        };
      }

      // Quota 2-Phase Reservation RPCs (F5-9)
      case 'reserve_unit_with_bypass': {
        this.assertWorkspaceMember(workspaceId, actorUserId);
        // Accept original (_-prefixed) and clone (p_-prefixed) argument names.
        const unitKey = normalizeQuotaUnit(
          args._unit_key ?? args.p_unit_key ?? args.unit_key ?? 'keyword_create'
        );
        const amount = Number(args._amount ?? args.p_amount ?? args.amount ?? 1);
        if (!Number.isInteger(amount) || amount <= 0) {
          throw new Error(`Invalid reservation amount "${amount}": must be a positive integer`);
        }
        const idempotencyKey = String(
          args._idempotency_key || args.p_idempotency_key || args.idempotency_key || crypto.randomUUID()
        );
        const reservations = this.tables.get('usage_reservations') || [];
        const existing = reservations.find(
          r =>
            r.workspace_id === workspaceId &&
            r.idempotency_key === idempotencyKey &&
            (r.status === 'reserved' || r.status === 'committed')
        );
        if (existing) {
          return {
            reservation_id: existing.id,
            status: existing.status,
            idempotent: true,
          };
        }

        const plan = (this.tables.get('workspace_plans') || []).find(
          p => p.workspace_id === workspaceId
        );
        const limit = quotaLimitFor(unitKey, plan);
        const used = reservations
          .filter(
            r =>
              r.workspace_id === workspaceId &&
              storedQuotaUnit(r.unit_key) === unitKey &&
              (r.status === 'reserved' || r.status === 'committed')
          )
          .reduce((sum, r) => sum + Number(r.amount || 0), 0);

        if (used + amount > limit) {
          throw new QuotaExceededError(unitKey, limit, used, amount);
        }

        const reservationId = crypto.randomUUID();
        const now = new Date().toISOString();
        reservations.push({
          id: reservationId,
          workspace_id: workspaceId,
          unit_key: unitKey,
          amount,
          idempotency_key: idempotencyKey,
          status: 'reserved',
          created_at: now,
          updated_at: now,
        });
        this.tables.set('usage_reservations', reservations);
        return {
          reservation_id: reservationId,
          status: 'reserved',
          remaining: limit - (used + amount),
        };
      }

      case 'commit_reservation': {
        const resId = String(args.p_reservation_id || args.reservation_id || '');
        const reservations = this.tables.get('usage_reservations') || [];
        const target = reservations.find(r => r.id === resId);
        if (!target) return false;
        this.assertWorkspaceMember(String(target.workspace_id), actorUserId);
        target.status = 'committed';
        target.updated_at = new Date().toISOString();
        return true;
      }

      case 'release_reservation': {
        const resId = String(args.p_reservation_id || args.reservation_id || '');
        const reservations = this.tables.get('usage_reservations') || [];
        const target = reservations.find(r => r.id === resId);
        if (!target) return false;
        this.assertWorkspaceMember(String(target.workspace_id), actorUserId);
        target.status = 'released';
        target.updated_at = new Date().toISOString();
        return true;
      }

      case 'revoke_workspace_api_key': {
        const keyId = String(args.p_key_id || args.key_id || '');
        const keys = this.tables.get('workspace_api_keys') || [];
        const target = keys.find(k => k.id === keyId);
        if (!target) return false;
        this.assertWorkspaceMember(String(target.workspace_id), actorUserId);
        target.revoked_at = new Date().toISOString();
        return true;
      }

      case 'get_app_shell': {
        this.assertWorkspaceMember(workspaceId, actorUserId);
        return {
          workspace: (this.tables.get('workspaces') || []).find(w => w.id === workspaceId) || null,
          quota: this.callRpc('get_workspace_quota_summary', { _workspace_id: workspaceId }, actorUserId),
          paused: this.callRpc('get_paused_summary', { p_workspace_id: workspaceId }, actorUserId),
          members: this.callRpc('get_workspace_members', { p_workspace_id: workspaceId }, actorUserId),
          funnel: this.callRpc('get_full_funnel_stats', { p_workspace_id: workspaceId }, actorUserId),
        };
      }

      default:
        throw new Error(`Unsupported RPC function: ${rpcName}`);
    }
  }

  /**
   * Execute Edge Functions (S5–S6 async pipelines & `rpc-cache`).
   */
  public async invokeEdgeFunction(
    fnName: string,
    payload: Record<string, unknown> = {},
    actorUserId = DEFAULT_USER_ID
  ): Promise<Record<string, unknown>> {
    if (fnName === 'rpc-cache') {
      const rpcName = String(payload.rpc_name || '');
      const rpcArgs = (payload.args as Record<string, unknown>) || {};
      try {
        const data = this.callRpc(rpcName, rpcArgs, actorUserId);
        return { data, error_fallback: false, reason: null };
      } catch (error) {
        return {
          data: null,
          error_fallback: true,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (fnName === 'halox-mcp') {
      const rawKey = String(payload.api_key || '').trim();
      const verifiedKey = this.verifyWorkspaceApiKey(rawKey);
      if (!verifiedKey) {
        throw new RlsAccessDeniedError('Invalid, missing, or revoked HaloX MCP API key');
      }
      const keyWorkspaceId = String(verifiedKey.workspace_id);
      const mcpMethod = String(payload.method || 'tools/list');

      if (mcpMethod === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: payload.id ?? 1,
          result: {
            tools: [
              {
                name: 'get_avi_overview',
                description: '워크스페이스의 AI 가시성 지수(AVI) 및 4대 엔진 인용 현황을 조회합니다.',
                inputSchema: { type: 'object', properties: { days: { type: 'number' } } },
              },
              {
                name: 'list_keywords',
                description: '워크스페이스에 등록된 활성 타깃 키워드 및 검색량을 조회합니다.',
                inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
              },
              {
                name: 'get_gsc_ga4_kpis',
                description: 'GSC/GA4 AI 트래픽 점유율(AI Traffic Share) 및 검색 기여도를 조회합니다.',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          },
        };
      }

      if (mcpMethod === 'tools/call') {
        const params = (payload.params as Record<string, unknown>) || {};
        const toolName = String(params.name || payload.tool_name || 'get_avi_overview');
        const wsRow = (this.tables.get('workspaces') || []).find(w => w.id === keyWorkspaceId);
        const ownerId = String(wsRow?.owner_id || DEFAULT_USER_ID);

        if (toolName === 'get_avi_overview') {
          const avi = this.callRpc('get_avi_overview', { p_workspace_id: keyWorkspaceId }, ownerId);
          return {
            jsonrpc: '2.0',
            id: payload.id ?? 1,
            result: { content: [{ type: 'text', text: JSON.stringify(avi) }], data: avi },
          };
        }
        if (toolName === 'list_keywords') {
          const kws = this.queryTable(
            'keywords',
            { filters: { workspace_id: `eq.${keyWorkspaceId}` }, limit: 20 },
            ownerId
          );
          return {
            jsonrpc: '2.0',
            id: payload.id ?? 1,
            result: { content: [{ type: 'text', text: JSON.stringify(kws.data) }], data: kws.data },
          };
        }
        if (toolName === 'get_gsc_ga4_kpis') {
          const ga4Summary = this.callRpc(
            'get_ga4_channel_summary',
            { p_workspace_id: keyWorkspaceId },
            ownerId
          );
          return {
            jsonrpc: '2.0',
            id: payload.id ?? 1,
            result: {
              content: [{ type: 'text', text: JSON.stringify(ga4Summary) }],
              data: ga4Summary,
            },
          };
        }
        throw new Error(`Unsupported MCP tool: ${toolName}`);
      }

      throw new Error(`Unsupported MCP method: ${mcpMethod}`);
    }

    const workspaceId = String(payload.workspace_id || DEFAULT_WORKSPACE_ID);
    this.assertWorkspaceMember(workspaceId, actorUserId);
    const now = new Date().toISOString();

    if (
      fnName === 'keywords-collect' ||
      fnName === 'bulk-collect-keyword-data' ||
      fnName === 'fetch-serp-snapshot'
    ) {
      const rawKeywords = Array.isArray(payload.keywords)
        ? payload.keywords.map(String)
        : typeof payload.keyword === 'string'
          ? [payload.keyword]
          : ['AI 브랜드 분석'];

      const reservation = this.callRpc(
        'reserve_unit_with_bypass',
        {
          p_workspace_id: workspaceId,
          p_unit_key: 'keyword_create',
          p_amount: rawKeywords.length,
          p_idempotency_key: String(payload.idempotency_key || `kw-${Date.now()}-${Math.random()}`),
        },
        actorUserId
      ) as { reservation_id: string };

      const createdKeywords: Row[] = [];
      const createdSnapshots: Row[] = [];

      for (const kwText of rawKeywords) {
        const serp = await this.providers.collectSerp(kwText, 'google');
        const [kwRow] = this.insertTable(
          'keywords',
          {
            workspace_id: workspaceId,
            keyword_set_id: DEFAULT_KEYWORD_SET_ID,
            keyword: kwText,
            language: 'ko',
            country: 'KR',
            search_volume: serp.searchVolume,
            search_volume_google_ads: serp.searchVolume,
            keyword_difficulty: serp.keywordDifficulty,
            intent: serp.intent,
            status: 'completed',
            is_active: true,
            is_paused: false,
            deleted_at: null,
          },
          actorUserId
        );
        createdKeywords.push(kwRow);

        const [snapRow] = this.insertTable(
          'serp_snapshots',
          {
            workspace_id: workspaceId,
            keyword_id: kwRow.id,
            captured_at: now,
            provider: 'dataforseo-mock',
            country: 'KR',
            language: 'ko',
            engine: serp.engine,
            ai_overview_detected: serp.aiOverviewDetected,
            top_results_json: serp.topResults,
            paa_questions_json: serp.paaQuestions,
            related_searches_json: serp.relatedSearches,
            serp_analysis_json: {
              our_rank: 1,
              aio_cited: serp.aiOverviewDetected,
              top10: true,
            },
          },
          actorUserId
        );
        createdSnapshots.push(snapRow);
      }

      this.callRpc('commit_reservation', { p_reservation_id: reservation.reservation_id }, actorUserId);

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        reservation_id: reservation.reservation_id,
        keywords: createdKeywords,
        snapshots: createdSnapshots,
      };
    }

    if (
      fnName === 'geo-run' ||
      fnName === 'geo-run-prompts-fanout' ||
      fnName === 'geo-run-openai' ||
      fnName === 'geo-run-claude'
    ) {
      const promptText = String(
        payload.prompt_text || '우리 브랜드의 AI 검색 인용 경쟁력은 어떤가요?'
      );
      const engine = String(payload.engine || 'openai');
      let promptId = typeof payload.prompt_id === 'string' ? payload.prompt_id : '';

      if (!promptId) {
        const reservation = this.callRpc(
          'reserve_unit_with_bypass',
          {
            p_workspace_id: workspaceId,
            p_unit_key: 'prompt_create',
            p_amount: 1,
            p_idempotency_key: String(payload.idempotency_key || `pr-${Date.now()}-${Math.random()}`),
          },
          actorUserId
        ) as { reservation_id: string };

        const [newPrompt] = this.insertTable(
          'geo_prompts',
          {
            workspace_id: workspaceId,
            prompt_set_id: DEFAULT_PROMPT_SET_ID,
            prompt_text: promptText,
            prompt_category: 'comparison',
            language_code: 'ko',
            location_code: 'KR',
            search_volume: 500,
            is_active: true,
            is_paused: false,
            deleted_at: null,
          },
          actorUserId
        );
        promptId = String(newPrompt.id);
        this.callRpc('commit_reservation', { p_reservation_id: reservation.reservation_id }, actorUserId);
      }

      const evaluation = await this.providers.runGeoPrompt(promptText, engine);
      const [runRow] = this.insertTable(
        'geo_prompt_runs',
        {
          workspace_id: workspaceId,
          prompt_id: promptId,
          engine: evaluation.engine,
          model_name: evaluation.modelName,
          mode: 'search',
          status: 'completed',
          answer_text: evaluation.answerText,
          requested_at: now,
          finished_at: now,
          cost_usd: 0.0025,
        },
        actorUserId
      );

      const citationRows = this.insertTable(
        'geo_citations',
        evaluation.citations.map(c => ({
          workspace_id: workspaceId,
          run_id: runRow.id,
          ...c,
        })),
        actorUserId
      );

      const [metricRow] = this.insertTable(
        'geo_run_metrics',
        {
          workspace_id: workspaceId,
          run_id: runRow.id,
          brand_mentioned: evaluation.brandMentioned,
          is_cited: evaluation.isCited,
          citation_rate: evaluation.citationRate,
          our_citation_count: evaluation.citations.filter(c => c.is_ours).length,
          competitor_citation_count: evaluation.citations.filter(c => c.is_competitor).length,
          other_citation_count: 0,
          source_but_not_cited: false,
        },
        actorUserId
      );

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        prompt_id: promptId,
        run: runRow,
        citations: citationRows,
        metrics: metricRow,
      };
    }

    if (fnName === 'site-audit' || fnName === 'site-audit-start') {
      const targetUrl = String(payload.target_url || 'https://brizzi.kr');
      const crawl = await this.providers.crawlSiteAudit(targetUrl, Number(payload.max_pages ?? 25));
      const [scanRow] = this.insertTable(
        'site_audit_scans',
        {
          workspace_id: workspaceId,
          target_url: crawl.targetUrl,
          scan_type: 'full',
          scan_mode: 'standard',
          status: 'completed',
          max_pages: Number(payload.max_pages ?? 25),
          crawled_urls: crawl.crawledUrls,
          site_health_score: crawl.siteHealthScore,
          ai_readiness_score: crawl.aiReadinessScore,
          critical_count: crawl.issues.filter(i => i.severity === 'critical').length,
          warning_count: crawl.issues.filter(i => i.severity === 'warning').length,
          notice_count: crawl.issues.filter(i => i.severity === 'notice').length,
          completed_at: now,
        },
        actorUserId
      );

      const pageRows = this.insertTable(
        'site_audit_pages',
        crawl.pages.map(p => ({
          workspace_id: workspaceId,
          scan_id: scanRow.id,
          url: p.url,
          status_code: p.statusCode,
          lighthouse_data: { lcpMs: p.lcpMs, cls: p.cls, seoScore: p.seoScore },
        })),
        actorUserId
      );

      const issueRows = this.insertTable(
        'site_audit_issues',
        crawl.issues.map(issue => ({
          workspace_id: workspaceId,
          scan_id: scanRow.id,
          page_id: pageRows[0]?.id || null,
          page_url: issue.pageUrl,
          issue_type: issue.issueType,
          category: issue.category,
          severity: issue.severity,
          layer: 'ai_readiness',
          score_dimension: 'ai_readiness',
          title: issue.title,
          description: issue.description,
          fix_recommendation: issue.fixRecommendation,
          fix_difficulty: 'easy',
          impact_level: 'medium',
          engine_impact: ['google', 'ai'],
          is_resolved: false,
        })),
        actorUserId
      );

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        scan: scanRow,
        pages: pageRows,
        issues: issueRows,
      };
    }

    if (
      fnName === 'content-draft' ||
      fnName === 'generate-content-draft' ||
      fnName === 'citability-improve'
    ) {
      const targetKeyword = String(payload.target_keyword || payload.keyword || 'AI 검색 최적화');
      const reservation = this.callRpc(
        'reserve_unit_with_bypass',
        {
          p_workspace_id: workspaceId,
          p_unit_key: 'content_gen',
          p_amount: 1,
          p_idempotency_key: String(payload.idempotency_key || `cnt-${Date.now()}-${Math.random()}`),
        },
        actorUserId
      ) as { reservation_id: string };

      const draftData = await this.providers.generateContentDraft(
        targetKeyword,
        typeof payload.title === 'string' ? payload.title : undefined
      );

      const [jobRow] = this.insertTable(
        'content_jobs',
        {
          workspace_id: workspaceId,
          title: draftData.title,
          target_keyword: draftData.targetKeyword,
          stage: 'completed',
          strategy_status: 'completed',
          writing_status: 'completed',
          knowledge_entity_ids: [],
        },
        actorUserId
      );

      const [draftRow] = this.insertTable(
        'content_drafts',
        {
          workspace_id: workspaceId,
          content_job_id: jobRow.id,
          version: 1,
          title: draftData.title,
          content_md: draftData.contentMd,
          meta_title: draftData.metaTitle,
          meta_description: draftData.metaDescription,
          seo_score: draftData.seoScore,
          aio_score: draftData.aioScore,
          word_count: draftData.wordCount,
          quality_analysis: { readability: 'good', structure: 'excellent' },
          grounding_sources: draftData.groundingSources,
          is_selected: true,
        },
        actorUserId
      );

      this.callRpc('commit_reservation', { p_reservation_id: reservation.reservation_id }, actorUserId);

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        job: jobRow,
        draft: draftRow,
      };
    }

    if (fnName === 'report-snapshot' || fnName === 'generate-weekly-snapshot') {
      const periodType = payload.period_type === 'month' ? 'month' : 'week';
      const periodKey = String(payload.period_key || '2026-W43');
      const overview = this.callRpc(
        'get_light_dashboard_overview',
        { p_workspace_id: workspaceId, p_period_days: 7 },
        actorUserId
      ) as Record<string, unknown>;

      const [reportRow] = this.insertTable(
        'report_snapshots',
        {
          workspace_id: workspaceId,
          prompt_set_id: DEFAULT_PROMPT_SET_ID,
          period_type: periodType,
          period_key: periodKey,
          start_date: '2026-10-16',
          end_date: '2026-10-22',
          kpi_payload: overview.avi_summary || {},
          changes_payload: { aviDelta: +2 },
          actions_payload: ['신규 발굴 프롬프트 3종 콘텐츠 제작 권장'],
        },
        actorUserId
      );

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        report: reportRow,
      };
    }

    // =========================================================================
    // Phase 7 Secondary Full-Stack Pipelines (Agent SSE, Strategy Map, Optimize,
    // Multi-language Publishing, GSC/GA4 Sync, NicePay Billing, HaloX MCP)
    // =========================================================================

    if (fnName === 'agent-chat') {
      const userPrompt = String(payload.message || payload.prompt || '').trim();
      if (!userPrompt) {
        throw new Error('Agent chat message must not be empty');
      }
      let conversationId = typeof payload.conversation_id === 'string' ? payload.conversation_id : '';
      let convRow: Row | undefined;
      if (conversationId) {
        const anyConv = (this.tables.get('agent_conversations') || []).find(c => c.id === conversationId);
        if (anyConv && anyConv.workspace_id !== workspaceId) {
          throw new RlsAccessDeniedError('Cannot access agent conversation belonging to another workspace');
        }
        convRow = anyConv;
      }
      if (!convRow) {
        [convRow] = this.insertTable(
          'agent_conversations',
          {
            workspace_id: workspaceId,
            user_id: actorUserId,
            title: userPrompt.slice(0, 40),
          },
          actorUserId
        );
        conversationId = String(convRow.id);
      }

      const [userMsgRow] = this.insertTable(
        'agent_messages',
        {
          workspace_id: workspaceId,
          conversation_id: conversationId,
          role: 'user',
          content: userPrompt,
          citations_json: [],
        },
        actorUserId
      );

      const overview = this.callRpc(
        'get_light_dashboard_overview',
        { p_workspace_id: workspaceId, p_period_days: 7 },
        actorUserId
      ) as { avi_summary?: { aviComposite?: number; seoScore?: number; geoScore?: number; webHealthScore?: number } };
      const aviSummary = overview.avi_summary || {};
      const chunks = [
        `현재 워크스페이스 종합 가시성(AVI) 점수는 ${aviSummary.aviComposite ?? 47}점`,
        ` (SEO ${aviSummary.seoScore ?? 3}점, GEO ${aviSummary.geoScore ?? 60}점, 웹 건강도 ${aviSummary.webHealthScore ?? 93}점)입니다. `,
        `질문하신 "${userPrompt}"에 대해 Quick Win 키워드 보강 및 FAQPage JSON-LD 스키마 적용을 최우선 액션으로 권장합니다.`,
      ];
      const answerContent = chunks.join('');

      const [assistantMsgRow] = this.insertTable(
        'agent_messages',
        {
          workspace_id: workspaceId,
          conversation_id: conversationId,
          role: 'assistant',
          content: answerContent,
          citations_json: [{ type: 'kpi', aviComposite: aviSummary.aviComposite ?? 47 }],
        },
        actorUserId
      );

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        conversation: convRow,
        user_message: userMsgRow,
        assistant_message: assistantMsgRow,
        chunks,
      };
    }

    if (
      fnName === 'strategy-map-orchestrator' ||
      fnName === 'strategy-map-cluster' ||
      fnName === 'strategy-map-link-prompts'
    ) {
      const kws = (this.tables.get('keywords') || []).filter(
        k => k.workspace_id === workspaceId && !k.deleted_at
      );
      const prList = (this.tables.get('geo_prompts') || []).filter(
        p => p.workspace_id === workspaceId && !p.deleted_at
      );

      const [clusterRow] = this.insertTable(
        'keyword_clusters',
        {
          workspace_id: workspaceId,
          label: String(payload.cluster_label || 'AI 검색 전략 확장 클러스터'),
          stats_json: {
            keyword_count: kws.length,
            prompt_count: prList.length,
            avg_difficulty: 36,
            geo: { neighbors: prList.map(p => p.id) },
          },
        },
        actorUserId
      );

      const members: Row[] = [];
      for (const kw of kws) {
        const [mRow] = this.insertTable(
          'keyword_cluster_members',
          {
            workspace_id: workspaceId,
            cluster_id: clusterRow.id,
            keyword_id: kw.id,
            keywords: { id: kw.id, keyword: kw.keyword, search_volume: kw.search_volume },
          },
          actorUserId
        );
        members.push(mRow);
      }

      this.insertTable(
        'cluster_stats_history',
        {
          workspace_id: workspaceId,
          cluster_id: clusterRow.id,
          captured_at: now,
          keyword_count: kws.length,
          prompt_count: prList.length,
        },
        actorUserId
      );

      this.updateTable(
        'workspaces',
        { strategy_map_status: 'ready', strategy_map_scanned_at: now },
        { id: `eq.${workspaceId}` },
        actorUserId
      );

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        cluster: clusterRow,
        members,
        linked_prompts: prList.length,
      };
    }

    if (fnName === 'ai-expand-keywords') {
      const seedKeyword = String(payload.seed_keyword || payload.keyword || 'AI 검색 마케팅').trim();
      const rawCount = Number(payload.count ?? 2);
      if (!Number.isInteger(rawCount) || rawCount <= 0) {
        throw new Error(`Invalid expansion count "${payload.count}": must be a positive integer`);
      }
      const count = Math.min(10, rawCount);
      const reservation = this.callRpc(
        'reserve_unit_with_bypass',
        {
          p_workspace_id: workspaceId,
          p_unit_key: 'keyword_create',
          p_amount: count,
          p_idempotency_key: String(payload.idempotency_key || `expand-${Date.now()}-${Math.random()}`),
        },
        actorUserId
      ) as { reservation_id: string };

      const suffixes = ['가이드', '비교 분석', '도입 사례', '체크리스트', 'ROI 측정'];
      const expanded: Row[] = [];
      for (let i = 0; i < count; i += 1) {
        const kwText = `${seedKeyword} ${suffixes[i % suffixes.length]}`;
        const serp = await this.providers.collectSerp(kwText, 'google');
        const [kwRow] = this.insertTable(
          'keywords',
          {
            workspace_id: workspaceId,
            keyword_set_id: DEFAULT_KEYWORD_SET_ID,
            keyword: kwText,
            language: 'ko',
            country: 'KR',
            search_volume: serp.searchVolume,
            search_volume_google_ads: serp.searchVolume,
            keyword_difficulty: serp.keywordDifficulty,
            intent: serp.intent,
            origin_type: 'ai_expanded',
            status: 'completed',
            is_active: true,
            is_paused: false,
            deleted_at: null,
          },
          actorUserId
        );
        expanded.push(kwRow);
      }

      this.callRpc('commit_reservation', { p_reservation_id: reservation.reservation_id }, actorUserId);

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        reservation_id: reservation.reservation_id,
        expanded_keywords: expanded,
      };
    }

    if (
      fnName === 'optimize-audit-content' ||
      fnName === 'optimize-serp-fetch' ||
      fnName === 'optimize-strategy-synthesis' ||
      fnName === 'optimize-rewrite-content'
    ) {
      const targetUrl = String(payload.url || payload.target_url || 'https://brizzi.kr/features/geo');
      const targetKeyword = String(payload.target_keyword || 'GEO 마케팅 가이드');

      let reviewRunId = typeof payload.review_run_id === 'string' ? payload.review_run_id : '';
      let reviewRun: Row | undefined;
      if (reviewRunId) {
        const anyRun = (this.tables.get('content_review_runs') || []).find(r => r.id === reviewRunId);
        if (anyRun && anyRun.workspace_id !== workspaceId) {
          throw new RlsAccessDeniedError('Cannot access content review run belonging to another workspace');
        }
        reviewRun = anyRun;
      }

      if (!reviewRun) {
        const reservation = this.callRpc(
          'reserve_unit_with_bypass',
          {
            p_workspace_id: workspaceId,
            p_unit_key: 'content_gen',
            p_amount: 1,
            p_idempotency_key: String(payload.idempotency_key || `opt-${Date.now()}-${Math.random()}`),
          },
          actorUserId
        ) as { reservation_id: string };

        [reviewRun] = this.insertTable(
          'content_review_runs',
          {
            workspace_id: workspaceId,
            url: targetUrl,
            target_keyword: targetKeyword,
            status: 'completed',
            seo_score: 86,
            geo_score: 89,
            citability_score: 91,
            summary_json: { step: fnName, recommendation_count: 3 },
          },
          actorUserId
        );
        reviewRunId = String(reviewRun.id);
        this.callRpc('commit_reservation', { p_reservation_id: reservation.reservation_id }, actorUserId);
      }

      const changeItems = this.insertTable(
        'content_change_items',
        [
          {
            workspace_id: workspaceId,
            review_run_id: reviewRunId,
            section_title: '핵심 요약 (TL;DR) 블록',
            change_type: 'citability',
            before_text: '일반 서술형 도입부 문단',
            after_text: `**${targetKeyword} 핵심 요약**: 정량 지표와 구조화된 비교표를 상단에 배치해 AI 인용 확률을 높입니다.`,
            rationale: 'LLM 답변 엔진의 첫 문단 직접 인용률 향상',
            status: fnName === 'optimize-rewrite-content' ? 'applied' : 'proposed',
          },
          {
            workspace_id: workspaceId,
            review_run_id: reviewRunId,
            section_title: 'FAQPage JSON-LD 스키마',
            change_type: 'schema_jsonld',
            before_text: '스키마 없음',
            after_text: '{"@context":"https://schema.org","@type":"FAQPage"}',
            rationale: 'AI 검색엔진 및 Google AI Overview 구조화 데이터 수집 지원',
            status: fnName === 'optimize-rewrite-content' ? 'applied' : 'proposed',
          },
        ],
        actorUserId
      );

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        review_run: reviewRun,
        change_items: changeItems,
      };
    }

    if (fnName === 'translate-content-v2') {
      const supportedLocales = new Set(['ko', 'en', 'ja', 'zh', 'es']);
      const rawLocales = Array.isArray(payload.target_locales)
        ? payload.target_locales.map(String)
        : typeof payload.target_locale === 'string'
          ? [payload.target_locale]
          : ['en', 'ja'];

      if (rawLocales.length === 0 || rawLocales.some(loc => !supportedLocales.has(loc))) {
        throw new Error(`Unsupported or empty target_locales: ${JSON.stringify(rawLocales)}`);
      }

      const baseTitle = String(payload.title || 'AI 검색 최적화(GEO) 실전 가이드');
      const baseSlug = String(payload.slug || 'geo-practical-guide');
      const category = String(payload.category || 'GEO');

      const [articleRow] = this.insertTable(
        'articles',
        {
          workspace_id: workspaceId,
          slug: baseSlug,
          category,
          source_locale: 'ko',
          status: 'published',
          published_at: now,
        },
        actorUserId
      );

      const localePrefix: Record<string, string> = {
        en: '[EN] Practical Guide to AI Search (GEO): ',
        ja: '[JA] AI検索最適化(GEO)実践ガイド: ',
        ko: '[KO] ',
        zh: '[ZH] AI搜索优化指南: ',
        es: '[ES] Guía práctica de GEO: ',
      };

      const translations = this.insertTable(
        'article_translations',
        rawLocales.map(loc => ({
          workspace_id: workspaceId,
          article_id: articleRow.id,
          locale: loc,
          title: `${localePrefix[loc] || `[${loc.toUpperCase()}] `}${baseTitle}`,
          excerpt: `${baseTitle} (${loc.toUpperCase()})`,
          content_md: `# ${localePrefix[loc] || ''}${baseTitle}\n\nTranslated deterministically for locale \`${loc}\`.`,
          status: 'published',
        })),
        actorUserId
      );

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        article: articleRow,
        translations,
      };
    }

    if (fnName === 'gsc-sync-enqueue' || fnName === 'sync-ga4-data') {
      const dateStr = String(payload.date || '2026-10-23');
      const clicks = Number(payload.clicks ?? 156);
      const impressions = Number(payload.impressions ?? 4100);
      const organicSessions = Number(payload.organic_sessions ?? 400);
      const aiSessions = Number(payload.ai_sessions ?? 68);

      this.insertTable(
        'workspace_google_connections',
        {
          workspace_id: workspaceId,
          provider: 'google',
          gsc_site_url: 'sc-domain:brizzi.kr',
          ga4_property_id: 'properties/99887766',
          status: 'connected',
        },
        actorUserId
      );

      const [gscRow] = this.insertTable(
        'gsc_daily_totals',
        {
          workspace_id: workspaceId,
          date: dateStr,
          clicks,
          impressions,
          ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
          avg_position: 9.8,
        },
        actorUserId
      );

      const [ga4Row] = this.insertTable(
        'ga4_page_stats',
        {
          workspace_id: workspaceId,
          date: dateStr,
          page_path: String(payload.page_path || '/features/geo'),
          organic_sessions: organicSessions,
          ai_sessions: aiSessions,
          conversions: 19,
        },
        actorUserId
      );

      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        gsc_daily: gscRow,
        ga4_daily: ga4Row,
        kpis: {
          ai_traffic_share: aiTrafficShare(aiSessions, organicSessions),
          search_contribution: searchContribution(clicks, organicSessions),
        },
      };
    }

    if (
      fnName === 'nicepay-create-auth-order' ||
      fnName === 'nicepay-inquire' ||
      fnName === 'nicepay-cancel-pending-change'
    ) {
      const planKey = String(payload.plan_key || 'pro');
      const knownPlan = (this.tables.get('plan_templates') || []).find(p => p.plan_key === planKey);
      if (!knownPlan) {
        throw new Error(`Unknown plan_key: "${planKey}"`);
      }
      const billingCycle = payload.billing_cycle === 'annual' ? 'annual' : 'monthly';
      const amountKrw = Number(payload.amount_krw ?? (planKey === 'pro' ? 600000 : 0));
      if (!Number.isFinite(amountKrw) || amountKrw < 0) {
        throw new Error('Invalid order amount_krw');
      }

      if (fnName === 'nicepay-create-auth-order') {
        const orderNo = String(payload.order_no || `HX-ORD-${Date.now()}`);
        const [orderRow] = this.insertTable(
          'orders',
          {
            workspace_id: workspaceId,
            order_no: orderNo,
            plan_key: planKey,
            billing_cycle: billingCycle,
            amount_krw: amountKrw,
            status: 'authorized',
            pg_provider: 'nicepay',
            pg_tid: `NP_${orderNo}`,
          },
          actorUserId
        );
        return {
          ok: true,
          function: fnName,
          workspace_id: workspaceId,
          order: orderRow,
        };
      }

      if (fnName === 'nicepay-inquire') {
        const [subRow] = this.insertTable(
          'subscriptions',
          {
            workspace_id: workspaceId,
            plan_key: planKey,
            billing_cycle: billingCycle,
            status: 'active',
            pending_plan_key: null,
            current_period_start: now,
            current_period_end: '2026-11-23T00:00:00.000Z',
          },
          actorUserId
        );

        this.updateTable(
          'workspace_plans',
          {
            plan: planKey,
            billing_cycle: billingCycle,
            keyword_limit: planKey === 'pro' ? 100 : 20,
            prompt_limit: planKey === 'pro' ? 100 : 20,
            content_limit: planKey === 'pro' ? 30 : 5,
          },
          { workspace_id: `eq.${workspaceId}` },
          actorUserId
        );

        return {
          ok: true,
          function: fnName,
          workspace_id: workspaceId,
          subscription: subRow,
        };
      }

      // nicepay-cancel-pending-change
      const updatedSubs = this.updateTable(
        'subscriptions',
        { pending_plan_key: null, status: 'active' },
        { workspace_id: `eq.${workspaceId}` },
        actorUserId
      );
      return {
        ok: true,
        function: fnName,
        workspace_id: workspaceId,
        cancelled: true,
        subscriptions: updatedSubs,
      };
    }

    throw new Error(`Unsupported Edge Function: ${fnName}`);
  }
}

// Singleton instance for Next.js API route handlers
const globalForHaloX = globalThis as unknown as { haloxDb?: HaloXDatabase };
export const haloxDb = globalForHaloX.haloxDb || new HaloXDatabase();
globalForHaloX.haloxDb = haloxDb;
