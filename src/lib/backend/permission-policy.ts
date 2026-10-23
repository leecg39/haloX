import type { Section } from '../permissions/workspace.ts';

// A table belongs to the menu that owns its records, regardless of the API used.
const groups: Record<Section, string[]> = {
  dashboard: ['dashboard_preferences'],
  analysis: ['brands', 'keyword_sets', 'keywords', 'serp_snapshots', 'keyword_serp_jobs', 'keyword_tag_assignments', 'keyword_ideas', 'keyword_prompt_links', 'geo_prompt_sets', 'geo_prompts', 'geo_prompt_runs', 'geo_citations', 'geo_run_metrics', 'geo_answers_raw', 'geo_discover_runs', 'geo_prompt_tag_assignments', 'gsc_daily_totals', 'gsc_daily_keywords', 'gsc_daily_pages', 'gsc_sync_state', 'ga4_page_stats', 'saved_analyses', 'brand_reclassify_jobs'],
  strategy: ['site_audit_targets', 'site_audit_scans', 'site_audit_pages', 'site_audit_issues', 'keyword_clusters', 'keyword_cluster_links', 'keyword_cluster_members', 'cluster_stats_history', 'cluster_batch_runs', 'geo_prompt_candidates', 'opportunity_decisions'],
  execution: ['content_jobs', 'content_drafts', 'content_compositions', 'content_review_runs', 'content_change_items', 'export_history', 'export_destinations', 'export_publications', 'translation_runs', 'articles', 'article_translations', 'agent_conversations', 'agent_messages'],
  monitoring: ['monitor_rules', 'geo_alerts', 'workspace_events', 'report_snapshots', 'report_summaries', 'report_action_items', 'report_preferences', 'notifications'],
  other: ['writing_style_profiles', 'writing_style_samples', 'knowledge_entities', 'knowledge_claim_stats', 'knowledge_entity_sources', 'keyword_knowledge_entities', 'evidence_contexts', 'evidence_claims', 'raw_import_batches', 'workspace_api_keys', 'workspace_google_connections', 'workspace_mirrors', 'workspace_tag_groups', 'workspace_tags', 'workspace_billing_overrides', 'earned_publications', 'orders', 'subscriptions', 'vw_gsc_connection_health', 'onboarding_jobs'],
};
const shared = new Set(['workspaces', 'workspace_members', 'workspace_invitations', 'workspace_plans', 'workspace_usage', 'usage_reservations', 'profiles', 'plan_templates', 'plan_unit_limits', 'welcome_guide_config', 'welcome_guide_settings', 'system_settings', 'client_web_vitals', 'platform_admins']);
export function tableSection(table: string): Section | undefined {
  for (const section of Object.keys(groups) as Section[]) if (groups[section].includes(table)) return section;
  if (shared.has(table)) return undefined;
  throw new Error(`메뉴 권한이 정의되지 않은 테이블: ${table}`);
}
export function rpcSection(name: string): Section | undefined {
  if (['record_auth_login', 'cancel_account_deletion', 'get_app_shell', 'get_billing_period_range', 'get_workspace_quota_summary', 'get_paused_summary', 'reserve_unit_with_bypass', 'commit_reservation', 'release_reservation'].includes(name)) return undefined;
  if (['get_workspace_members', 'get_user_activity_snapshot', 'get_workspace_activity_snapshot', 'revoke_workspace_api_key'].includes(name)) return 'other';
  if (['get_light_dashboard_overview', 'get_pro_dashboard_kpi', 'get_full_funnel_stats', 'get_avi_daily_components', 'get_avi_overview'].includes(name)) return 'dashboard';
  if (['site_audit_links_summary', 'strategy_map_effective_state', 'get_gap_overview_light', 'get_web_health_sparkline'].includes(name)) return 'strategy';
  if (/^get_(ga4_|gsc_|geo_|page_ga4_|keywords_|latest_serp_|light_prompt_|seo_|serp_)/.test(name)) return 'analysis';
  throw new Error(`Unsupported RPC function: ${name}`);
}
