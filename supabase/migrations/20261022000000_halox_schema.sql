-- HaloX Reconstructed Schema (S2: 21+ Core Tables, RLS Policies, and RPC Contracts)
-- Derived from REA Evidence E5-1 (p5-table-columns.json), E5-2 (p5-bundled-erd-edges.json), and E3-1 (p3-api-shapes.json).

create extension if not exists "pgcrypto";

-- 1. Profiles & Workspaces
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null default '',
  phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  auto_generate_prompts boolean not null default true,
  default_brand_filter text,
  sitemap_url text,
  robots_txt_url text,
  llms_txt_url text,
  site_audit_scope_rules jsonb not null default '{}'::jsonb,
  strategy_map_status text not null default 'ready',
  strategy_map_scanned_at timestamptz,
  product_lineup_hints jsonb not null default '[]'::jsonb,
  schema_classification_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'editor', 'viewer')),
  allowed_sections jsonb not null default '["all"]'::jsonb,
  joined_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'editor',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  allowed_sections jsonb not null default '["all"]'::jsonb,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

-- 2. Brands & Keyword Domain
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_name text not null,
  target_domain text not null,
  competitor_domains jsonb not null default '[]'::jsonb,
  self_roots jsonb not null default '[]'::jsonb,
  industry text,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keyword_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  brand_name text not null default '',
  target_domain text not null default '',
  competitor_domains jsonb not null default '[]'::jsonb,
  industry text,
  industry_tags jsonb not null default '[]'::jsonb,
  language text not null default 'ko',
  country text not null default 'KR',
  journey_stage text not null default 'awareness',
  is_default boolean not null default false,
  is_active boolean not null default true,
  mirror_of_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keywords (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  keyword_set_id uuid references public.keyword_sets(id) on delete set null,
  keyword text not null,
  language text not null default 'ko',
  country text not null default 'KR',
  search_volume integer not null default 0,
  search_volume_google_ads integer not null default 0,
  keyword_difficulty numeric(5,2) not null default 0,
  competition numeric(5,4) not null default 0,
  cpc_min numeric(10,2),
  cpc_max numeric(10,2),
  intent text not null default 'informational',
  intent_probability numeric(5,4) not null default 0.85,
  trends_json jsonb not null default '[]'::jsonb,
  status text not null default 'completed',
  origin_type text not null default 'manual',
  geo_cluster_id uuid,
  geo_prompt_id uuid,
  source_prompt_id uuid,
  is_active boolean not null default true,
  is_paused boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.serp_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  engine text not null default 'google' check (engine in ('google', 'naver')),
  provider text not null default 'dataforseo-mock',
  country text not null default 'KR',
  language text not null default 'ko',
  captured_at timestamptz not null default now(),
  ai_overview_detected boolean not null default false,
  ai_overview_json jsonb not null default '{}'::jsonb,
  top_results_json jsonb not null default '[]'::jsonb,
  paa_questions_json jsonb not null default '[]'::jsonb,
  related_searches_json jsonb not null default '[]'::jsonb,
  featured_snippet_json jsonb,
  serp_analysis_json jsonb not null default '{}'::jsonb,
  gap_summary jsonb not null default '{}'::jsonb
);

-- 3. GEO Prompt & Run Domain
create table if not exists public.geo_prompt_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  default_engine text not null default 'openai',
  schedule_enabled boolean not null default true,
  schedule_hour integer not null default 9,
  is_active boolean not null default true,
  mirror_of_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.geo_prompts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  prompt_set_id uuid not null references public.geo_prompt_sets(id) on delete cascade,
  prompt_text text not null,
  prompt_category text not null default 'comparison',
  language_code text not null default 'ko',
  location_code text not null default 'KR',
  search_volume integer not null default 0,
  cm_brand text,
  cm_industry text,
  cm_question_type text,
  is_active boolean not null default true,
  is_paused boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.geo_prompt_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  prompt_id uuid not null references public.geo_prompts(id) on delete cascade,
  engine text not null default 'openai',
  model_name text not null default 'gpt-4o',
  mode text not null default 'search',
  status text not null default 'completed' check (status in ('queued', 'running', 'completed', 'failed')),
  answer_text text not null default '',
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  cost_usd numeric(10,6) not null default 0.0025
);

create table if not exists public.geo_citations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.geo_prompt_runs(id) on delete cascade,
  cited_url text not null,
  domain text not null,
  root_domain text not null,
  position_index integer not null default 1,
  is_ours boolean not null default false,
  is_competitor boolean not null default false,
  domain_classification text not null default 'editorial',
  created_at timestamptz not null default now()
);

create table if not exists public.geo_run_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null unique references public.geo_prompt_runs(id) on delete cascade,
  brand_mentioned boolean not null default false,
  is_cited boolean not null default false,
  citation_rate numeric(5,2) not null default 0,
  our_citation_count integer not null default 0,
  competitor_citation_count integer not null default 0,
  other_citation_count integer not null default 0,
  source_but_not_cited boolean not null default false,
  created_at timestamptz not null default now()
);

-- 4. Site Audit Domain
create table if not exists public.site_audit_scans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  target_url text not null,
  scan_type text not null default 'full',
  scan_mode text not null default 'standard',
  status text not null default 'completed' check (status in ('queued', 'running', 'completed', 'failed')),
  max_pages integer not null default 100,
  crawled_urls integer not null default 0,
  site_health_score numeric(5,2) not null default 93,
  ai_readiness_score numeric(5,2) not null default 88,
  critical_count integer not null default 0,
  warning_count integer not null default 0,
  notice_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.site_audit_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scan_id uuid not null references public.site_audit_scans(id) on delete cascade,
  url text not null,
  status_code integer not null default 200,
  lighthouse_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.site_audit_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scan_id uuid not null references public.site_audit_scans(id) on delete cascade,
  page_id uuid references public.site_audit_pages(id) on delete set null,
  page_url text not null,
  issue_type text not null,
  category text not null default 'technical',
  severity text not null default 'warning' check (severity in ('critical', 'warning', 'notice')),
  layer text not null default 'crawl',
  score_dimension text not null default 'health',
  title text not null,
  description text not null default '',
  fix_recommendation text not null default '',
  fix_difficulty text not null default 'easy',
  impact_level text not null default 'medium',
  engine_impact jsonb not null default '["google", "ai"]'::jsonb,
  is_resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- 5. Content Factory, Personas, Knowledge Hub & Exports
create table if not exists public.writing_style_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  is_default boolean not null default false,
  samples_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  logo_url text,
  base_url text,
  program_type text not null default 'brand',
  coverage_type text not null default 'verified',
  knowledge_type text not null default 'product',
  parent_program_id uuid,
  related_programs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_entity_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  knowledge_entity_id uuid not null references public.knowledge_entities(id) on delete cascade,
  source_url text not null,
  source_type text not null default 'url',
  content_summary text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.content_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  keyword_id uuid references public.keywords(id) on delete set null,
  geo_prompt_id uuid references public.geo_prompts(id) on delete set null,
  writing_style_profile_id uuid references public.writing_style_profiles(id) on delete set null,
  title text not null,
  target_keyword text not null,
  stage text not null default 'draft',
  strategy_status text not null default 'completed',
  writing_status text not null default 'completed',
  knowledge_entity_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_job_id uuid not null references public.content_jobs(id) on delete cascade,
  version integer not null default 1,
  title text not null,
  content_md text not null,
  meta_title text,
  meta_description text,
  seo_score numeric(5,2) not null default 85,
  aio_score numeric(5,2) not null default 82,
  word_count integer not null default 1200,
  quality_analysis jsonb not null default '{}'::jsonb,
  grounding_sources jsonb not null default '[]'::jsonb,
  is_selected boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.export_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_job_id uuid references public.content_jobs(id) on delete set null,
  format text not null default 'markdown',
  destination text not null default 'download',
  exported_at timestamptz not null default now()
);

-- 6. Reports, Notifications, API Keys, Quotas & Clusters
create table if not exists public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  prompt_set_id uuid references public.geo_prompt_sets(id) on delete set null,
  period_type text not null default 'week' check (period_type in ('week', 'month')),
  period_key text not null,
  start_date date not null,
  end_date date not null,
  kpi_payload jsonb not null default '{}'::jsonb,
  changes_payload jsonb not null default '{}'::jsonb,
  actions_payload jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null,
  title text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes jsonb not null default '["workspace:read", "geo:read", "seo:read"]'::jsonb,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  plan text not null default 'trial',
  billing_cycle text not null default 'monthly',
  keyword_limit integer not null default 20,
  prompt_limit integer not null default 20,
  content_limit integer not null default 5,
  trial_ends_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  unit_key text not null,
  amount integer not null check (amount > 0),
  idempotency_key text not null unique,
  status text not null default 'reserved' check (status in ('reserved', 'committed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.keyword_clusters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null,
  stats_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 7. Row Level Security (RLS) Isolation
create or replace function public.user_is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'workspaces', 'workspace_members', 'workspace_invitations', 'brands',
    'keyword_sets', 'keywords', 'serp_snapshots', 'geo_prompt_sets',
    'geo_prompts', 'geo_prompt_runs', 'geo_citations', 'geo_run_metrics',
    'site_audit_scans', 'site_audit_pages', 'site_audit_issues',
    'writing_style_profiles', 'knowledge_entities', 'knowledge_entity_sources',
    'content_jobs', 'content_drafts', 'export_history', 'report_snapshots',
    'notifications', 'workspace_api_keys', 'workspace_plans',
    'usage_reservations', 'keyword_clusters'
  ] loop
    execute format('alter table public.%I enable row level security;', tbl);
  end loop;
end $$;

create policy workspace_isolation_workspaces on public.workspaces
  for all using (public.user_is_workspace_member(id));

-- Standard tenant policy for all workspace-scoped tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'workspace_members', 'workspace_invitations', 'brands',
    'keyword_sets', 'keywords', 'serp_snapshots', 'geo_prompt_sets',
    'geo_prompts', 'geo_prompt_runs', 'geo_citations', 'geo_run_metrics',
    'site_audit_scans', 'site_audit_pages', 'site_audit_issues',
    'writing_style_profiles', 'knowledge_entities', 'knowledge_entity_sources',
    'content_jobs', 'content_drafts', 'export_history', 'report_snapshots',
    'notifications', 'workspace_api_keys', 'workspace_plans',
    'usage_reservations', 'keyword_clusters'
  ] loop
    execute format(
      'create policy workspace_isolation_%I on public.%I for all using (public.user_is_workspace_member(workspace_id)) with check (public.user_is_workspace_member(workspace_id));',
      tbl, tbl
    );
  end loop;
end $$;

-- 8. Core RPC Functions (F3-2, F5-9)
create or replace function public.reserve_unit_with_bypass(
  p_workspace_id uuid,
  p_unit_key text,
  p_amount integer,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_limit integer;
  v_used integer;
  v_existing public.usage_reservations%rowtype;
  v_res_id uuid;
begin
  select * into v_existing from public.usage_reservations where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reservation_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  select case
    when p_unit_key = 'keywords' then keyword_limit
    when p_unit_key = 'prompts' then prompt_limit
    else content_limit
  end into v_limit
  from public.workspace_plans
  where workspace_id = p_workspace_id;

  v_limit := coalesce(v_limit, 20);

  select coalesce(sum(amount), 0) into v_used
  from public.usage_reservations
  where workspace_id = p_workspace_id
    and unit_key = p_unit_key
    and status in ('reserved', 'committed');

  if (v_used + p_amount) > v_limit then
    raise exception 'QUOTA_EXCEEDED: unit % limit % exceeded (used %, requested %)', p_unit_key, v_limit, v_used, p_amount;
  end if;

  insert into public.usage_reservations (workspace_id, unit_key, amount, idempotency_key, status)
  values (p_workspace_id, p_unit_key, p_amount, p_idempotency_key, 'reserved')
  returning id into v_res_id;

  return jsonb_build_object('reservation_id', v_res_id, 'status', 'reserved', 'remaining', v_limit - (v_used + p_amount));
end;
$$;

create or replace function public.commit_reservation(p_reservation_id uuid)
returns boolean
language sql
security definer
as $$
  update public.usage_reservations
  set status = 'committed', updated_at = now()
  where id = p_reservation_id
  returning true;
$$;

create or replace function public.release_reservation(p_reservation_id uuid)
returns boolean
language sql
security definer
as $$
  update public.usage_reservations
  set status = 'released', updated_at = now()
  where id = p_reservation_id
  returning true;
$$;
