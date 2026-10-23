# API 스펙 (역공학 확정본)

> 생성: `scripts/build-api-spec.py` · 근거: E3-1(런타임 shape, REA `inspect_web_network_capture`), E1-4(정적 인벤토리), E5-3(번들 동봉 Edge Function 카탈로그). 값은 기록하지 않고 키·타입만 기록.

> 런타임 변경(2026-10-24): 아래 `cancel_account_deletion`의 boolean은 원본 관측 계약이다. 현재 구현은 재인증 없는 취소 RPC를 403으로 거절하며, `/api/v1/account/deletion`과 `/api/v1/auth/restore`를 사용한다. [계정 탈퇴·복원 계약](account-deletion-crud.md).

## 1. 전송 계층 [관찰]

원본은 자체 REST 서버가 없고 **Supabase 3면 구조**를 브라우저에서 직접 호출한다.

| 면 | 베이스 경로 | 인증 | 용도 |
|---|---|---|---|
| PostgREST 테이블 | `{SUPABASE_URL}/rest/v1/{table}` | `apikey`(publishable) + `Authorization: Bearer <user JWT>` | CRUD, RLS로 워크스페이스 격리 |
| PostgREST RPC | `{SUPABASE_URL}/rest/v1/rpc/{fn}` (POST) | 동일 | 집계·KPI·트랜잭션성 작업 |
| Edge Functions | `{SUPABASE_URL}/functions/v1/{name}` (POST JSON) | 동일, 만료 30초 전 세션 갱신 후 호출, 기본 타임아웃 60초 | 외부 API·LLM·크롤·배치 |
| Auth | `{SUPABASE_URL}/auth/v1/*` | — | 이메일/비밀번호, Google·Kakao OAuth (+ Firebase 휴대폰 인증) |
| Storage | `storage.from(bucket)` | 동일 | 버킷 4종: article-images, changelog-images, generated-images, knowledge-hub-files |

- 에러 형태 [관찰]: Edge 래퍼는 비 2xx 시 본문 JSON의 `error` 필드를 메시지로 사용, 타임아웃 시 한국어 안내 오류를 던짐. `strategy_map_temporarily_stopped` 같은 코드 문자열을 `code` 또는 `payload.error`로 판별.
- 캐시 프록시 [관찰]: `POST /functions/v1/rpc-cache` `{rpc_name, args}` → `{data, error_fallback, reason}`. 무거운 RPC를 서버 캐시 경유로 호출하고 실패 시 클라이언트가 직접 RPC로 폴백.
- 스트리밍 [관찰]: `POST /functions/v1/agent-chat` `{message, conversation_id?, workspace_id, context.currentPage}` → SSE(status/chunk/done).
- 공개 API [SUP]: `app.haloxlabs.ai/functions/v1/halox-mcp` — 워크스페이스 API 키(`workspace_api_keys`: key_prefix, scopes, expires_at) 기반 MCP 엔드포인트. 스키마 비공개 → [미확인].

## 2. RPC 계약 — 런타임 관찰 36종 [관찰]

| RPC | 요청 바디 | 응답 최상위 구조 | 관찰 라우트 수 |
|---|---|---|---|
| `cancel_account_deletion` | `—` | `"boolean"` | 34 |
| `get_avi_daily_components` | `{"p_workspace_id": "string<uuid>", "p_days": "number"}` | [ date, label, mentionRank, citationRank, mentionCoverage, citationCoverage ] | 2 |
| `get_avi_overview` | `{"p_workspace_id": "string<uuid>", "p_days": "number"}` | { level, setCount, totalRuns, components, dailySeries, averageScore, citedPrompts, coverageRate, totalPrompts, activeSetCount, avgMentionRank, avgCitationRank, firstMentionRate, firstCitationRate } | 2 |
| `get_billing_period_range` | `{"_workspace_id": "string<uuid>"}` | [ period_start, period_end ] | 34 |
| `get_full_funnel_stats` | `{"p_workspace_id": "string<uuid>", "p_days": "number", "p_limit": "number"}` | { pages, summary } | 34 |
| `get_ga4_channel_summary` | `{"p_workspace_id": "string<uuid>", "p_start_date": "string<date>", "p_end_date": "string<date>"}` | `["<empty>"]` | 3 |
| `get_ga4_dashboard_timeseries` | `{"p_workspace_id": "string<uuid>", "p_start_date": "string<date>", "p_end_date": "string<date>"}` | `["<empty>"]` | 3 |
| `get_gap_overview_light` | `{"p_workspace_id": "string<uuid>", "p_since": "string<date>"}` | [ id, keyword_id, captured_at, brand_presence ] | 3 |
| `get_geo_collection_days` | `{"p_workspace_id": "string<uuid>", "p_since": "string<datetime>", "p_until": "null", "p_engines": "null", "p_set_id": "n` | [ day ] | 1 |
| `get_geo_group_status_kpi_multi` | `{"p_buckets": [{"key": "string", "prompt_ids": ["string<uuid>"], "engines": "null"}], "p_days": "number"}` | { buckets } | 1 |
| `get_geo_slot_counts` | `{"p_workspace_id": "string<uuid>", "p_set_id": "null", "p_days": "number", "p_engines": "null"}` | { slot_cited, slot_total, slot_sourced, slot_mentioned } | 2 |
| `get_geo_ws_mention_terms` | `{"p_workspace_id": "string<uuid>", "p_since": "string<date>", "p_engines": "null", "p_set_id": "null", "p_prompt_ids": "` | { our_terms, our_total, comp_terms, comp_total, our_unique, runs_total, both_unique, comp_unique, our_mapped_unique } | 1 |
| `get_gsc_dashboard_dimensions` | `{"p_workspace_id": "string<uuid>", "p_start_date": "string<date>", "p_end_date": "string<date>", "p_search_type": "strin` | `["<empty>"]` | 3 |
| `get_gsc_dashboard_kpis` | `{"p_workspace_id": "string<uuid>", "p_start_date": "string<date>", "p_end_date": "string<date>", "p_prev_start_date": "s` | { clicks, impressions, ctr, avg_position, prev_clicks, prev_impressions, prev_ctr, prev_avg_position } | 3 |
| `get_gsc_dashboard_timeseries` | `{"p_workspace_id": "string<uuid>", "p_start_date": "string<date>", "p_end_date": "string<date>", "p_search_type": "strin` | `["<empty>"]` | 3 |
| `get_keywords_with_gsc_stats` | `{"p_days_back": "number", "p_workspace_id": "string<uuid>"}` | [ keyword_id, keyword_text, gsc_clicks, gsc_impressions, gsc_ctr, gsc_avg_position, gsc_insight_type ] | 1 |
| `get_latest_serp_snapshots` | `{"p_keyword_ids": ["string<uuid>"]}` | [ id, keyword_id, captured_at, provider, country, language, engine, serp_analysis_json, paa_questions_json, related_searches_json ] | 1 |
| `get_light_dashboard_overview` | `{"p_workspace_id": "string<uuid>", "p_period_days": "number"}` | { gap, avi_summary, audit_active, audit_latest, weekly_report, funnel_summary, top10_sparkline, prompt_stats_summary, web_health_sparkline, ga4_traffic_sparkline, citation_rate_sparkline } | 2 |
| `get_light_prompt_stats` | `{"p_workspace_id": "string<uuid>", "p_since": "string<date>"}` | { domain_stats, prompt_stats, category_stats } | 2 |
| `get_page_ga4_stats` | `{"p_workspace_id": "string<uuid>", "p_start_date": "string<date>", "p_end_date": "string<date>"}` | `["<empty>"]` | 3 |
| `get_paused_summary` | `{"p_workspace_id": "string<uuid>"}` | { prompt_limit, keyword_limit, active_prompts, paused_prompts, active_keywords, paused_keywords, restorable_prompts, restorable_keywords } | 34 |
| `get_pro_dashboard_kpi` | `{"p_workspace_id": "string<uuid>", "p_days": "number", "p_set_id": "null", "p_engines": "null"}` | { kpi, engine_sov, overall_sov, mention_rank, total_engines, daily_citation_series, daily_mention_rank_series } | 2 |
| `get_seo_aio_cross_trend` | `{"p_workspace_id": "string<uuid>", "p_engine": "string", "p_since": "string<date>", "p_until": "string<date>", "p_keywor` | [ day, aio_detected, our_cited, our_top10, cross_count, aio_pos_sum, aio_pos_cnt, excluded_count ] | 1 |
| `get_seo_overview_agg` | `{"p_workspace_id": "string<uuid>", "p_engine": "string", "p_cur_since": "string<date>", "p_cur_until": "string<date>", "` | { current, previous } | 3 |
| `get_seo_rank_movers` | `{"p_workspace_id": "string<uuid>", "p_engine": "string", "p_since": "string<date>", "p_until": "string<date>"}` | [ keyword_id, first_date, last_date, first_rank, last_rank, last_aio_cited, last_best_url ] | 1 |
| `get_serp_brand_presence_slim` | `{"p_workspace_id": "string<uuid>", "p_engine": "string", "p_since": "string<date>", "p_until": "string<date>"}` | [ keyword_id, captured_at, ai_overview_detected, brand_presence ] | 1 |
| `get_serp_brand_presence_trend` | `{"p_workspace_id": "string<uuid>", "p_engine": "string", "p_since": "string<date>"}` | [ keyword_id, captured_at, ai_overview_detected, brand_presence ] | 4 |
| `get_serp_brand_presence_window` | `{"p_workspace_id": "string<uuid>", "p_engine": "string", "p_since": "string<datetime>", "p_until": "string<datetime>"}` | [ keyword_id, captured_at, ai_overview_detected, brand_presence ] | 1 |
| `get_user_activity_snapshot` | `—` | [ export_count, last_export_at, content_job_count, last_content_job_at, agent_conversation_count, api_key_count, last_api_key_at ] | 34 |
| `get_web_health_sparkline` | `{"p_workspace_id": "string<uuid>", "p_period_days": "number"}` | [ date, value ] | 2 |
| `get_workspace_activity_snapshot` | `{"_workspace_id": "string<uuid>"}` | [ keyword_count, prompt_count, prompt_set_count, has_schedule_enabled, run_count_30d, last_run_at, scan_count, last_scan_at, content_job_count, last_content_job_at, api_key_count, last_api_key_used_at, last_keyword_at, last_prompt_at … ] | 34 |
| `get_workspace_members` | `{"p_workspace_id": "string<uuid>"}` | [ user_id, email, full_name, role, allowed_sections, joined_at ] | 1 |
| `get_workspace_quota_summary` | `{"_workspace_id": "string<uuid>"}` | [ unit_key, unit_label, unit_type, plan_limit, plan_used, plan_remaining, credit_balance, override_limit, effective_limit, effective_remaining ] | 34 |
| `record_auth_login` | `{"p_method": "string", "p_device_id": "null"}` | `"boolean"` | 34 |
| `site_audit_links_summary` | `{"p_scan_id": "string<uuid>"}` | { total, orphans, to_broken, top_linked, computed_at, to_redirect, broken_pages, orphan_count, nofollow_count, pages_3xx_count, pages_4xx_count, descriptive_count, descriptive_ratio } | 3 |
| `strategy_map_effective_state` | `{"p_workspace_id": "string<uuid>"}` | { reason, status, effective, scanned_at, cluster_count, prompt_set_count, active_prompt_count, active_keyword_count, latest_prompt_set_id, linked_keyword_count, auto_generate_prompts, recommended_entrypoint, recommended_resume_from } | 1 |

### 정적으로만 확인된 RPC 108종 [관찰-정적, shape 미확인]

`accept_workspace_invitation`, `admin_workspace_list`, `admin_workspace_summary`, `calculate_prorated_refund`, `commit_reservation`, `delete_geo_prompt`, `delete_gsc_property_stats`, `delete_keyword`, `delete_keywords_bulk`, `expire_stale_pending_orders`, `find_keyword_id_canonical`, `get_admin_login_report`, `get_admin_monthly_activity_report`, `get_api_cost_breakdown`, `get_api_key_usage_stats`, `get_api_limit_status`, `get_category_cost`, `get_citation_match_summary`, `get_citation_stability_full`, `get_citation_stability_summary`, `get_cost_summary`, `get_daily_api_cost`, `get_daily_citation_stats`, `get_daily_cost`, `get_domain_citation_rankings`, `get_domain_classification_stats`, `get_domain_classification_summary`, `get_domain_cross_analytics`, `get_domain_tier_stats`, `get_domain_trace_count`, `get_domain_trace_list`, `get_fan_out_hub_data`, `get_ga4_source_summary`, `get_geo_citation_rank_range`, `get_geo_domain_citations`, `get_geo_domain_detail`, `get_geo_group_status_kpi`, `get_geo_poller_status`, `get_geo_product_engines`, `get_geo_product_metrics`, `get_geo_product_prompts`, `get_geo_product_trend`, `get_geo_prompt_rows_v2`, `get_geo_prompt_status_kpi_range`, `get_geo_scope_prompt_ids`, `get_geo_ws_mention_term_prompts`, `get_gsc_cannibalizations`, `get_gsc_dimension_timeseries`, `get_gsc_page_query_counts`, `get_gsc_query_page_cross`, `get_gsc_ranking_timeseries`, `get_keyword_ga4_evidence`, `get_keyword_network`, `get_latest_naver_snapshots`, `get_matrix_cell_detail`, `get_page_top_queries`, `get_pages_top_keywords`, `get_partner_proposal_link`, `get_paused_preview`, `get_payment_ops_summary`, `get_pipeline_cost`, `get_platform_users_with_workspaces`, `get_registry_domains`, `get_registry_domains_count`, `get_serp_cron_status`, `get_serp_decision_health_stats`, `get_serp_decision_throughput`, `get_serp_matrix_data`, `get_serp_rank_trend`, `get_source_type_breakdown`, `get_tier_promotion_candidates`, `get_workspace_billing_timeline`, `grant_credit`, `is_platform_admin`, `mirror_pending_geo_run_counts`, `mirror_pending_serp_counts`, `mirror_unparsed_run_counts`, `ops_global_search`, `peek_workspace_invitation`, `referral_admin_list_partners`, `referral_admin_list_payouts`, `referral_admin_set_partner_status`, `referral_admin_set_payout_status`, `referral_apply`, `referral_attribute`, `referral_code_available`, `referral_create_code`, `referral_my_codes`, `referral_my_referrals`, `referral_my_summary`, `referral_my_timeseries`, `referral_request_payout`, `referral_track_click`, `referral_update_code`, `refresh_citation_stability_mv_admin`, `release_reservation`, `remove_workspace_member`, `reserve_unit_with_bypass`, `restore_paused_for_downgrade`, `resume_site_audit_scan`, `revoke_trial_extension`, `revoke_workspace_api_key`, `set_keyword_paused`, `set_prompt_paused`, `transfer_workspace_ownership`, `update_workspace_api_key_limits`, `update_workspace_api_limits`, `update_workspace_member`

## 3. 테이블 읽기 — 런타임 관찰 68종 [관찰]

PostgREST 규약: `select`(임베드 포함), `eq.`/`is.`/`in.` 필터, `order`, `limit`/`offset`. HEAD 요청은 `Prefer: count=exact` 카운트 전용.

| 메서드 | 테이블 | 쿼리 파라미터 | 응답(요소) 키 |
|---|---|---|---|
| GET | `brand_reclassify_jobs` | limit, order, select, workspace_id | `["<empty>"]` |
| POST | `client_web_vitals` | columns | `null` |
| GET | `cluster_stats_history` | order, select, workspace_id | `["<empty>"]` |
| GET | `content_jobs` | order, select, title, workspace_id | `["<empty>"]` |
| GET | `content_review_runs` | limit, order, select, workspace_id | `["<empty>"]` |
| GET | `earned_publications` | order, select, workspace_id | `["<empty>"]` |
| GET | `export_history` | limit, order, select, workspace_id | `["<empty>"]` |
| GET | `ga4_page_stats` | date, limit, order, select, workspace_id | `["<empty>"]` |
| HEAD | `ga4_page_stats` | select, workspace_id | `"<unavailable>"` |
| GET | `geo_discover_runs` | limit, order, select, workspace_id | `["<empty>"]` |
| GET | `geo_prompt_candidates` | select, source_keyword_id, source_type, status | `["<empty>"]` |
| HEAD | `geo_prompt_candidates` | select, status, workspace_id | `"<unavailable>"` |
| HEAD | `geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | `"<unavailable>"` |
| GET | `geo_prompt_sets` | is_active, limit, order, select, workspace_id | [ id ] |
| GET | `geo_prompt_tag_assignments` | limit, offset, prompt_id, select | `["<empty>"]` |
| GET | `geo_prompts` | deleted_at, is_active, limit, offset, prompt_set_id, select | [ id ] |
| HEAD | `geo_prompts` | is_active, prompt_set_id, select | `"<unavailable>"` |
| HEAD | `gsc_daily_keywords` | select, workspace_id | `"<unavailable>"` |
| GET | `gsc_daily_pages` | date, search_type, select, workspace_id | `["<empty>"]` |
| HEAD | `gsc_daily_pages` | select, workspace_id | `"<unavailable>"` |
| GET | `gsc_daily_totals` | limit, order, select, workspace_id | `["<empty>"]` |
| GET | `gsc_sync_state` | select, workspace_id | `["<empty>"]` |
| GET | `keyword_cluster_members` | cluster_id, select | [ cluster_id, keyword_id, keywords ] |
| GET | `keyword_clusters` | order, select, workspace_id | [ id, stats_json ] |
| HEAD | `keyword_clusters` | select, workspace_id | `"<unavailable>"` |
| GET | `keyword_knowledge_entities` | knowledge_entity_id, select | `["<empty>"]` |
| HEAD | `keyword_serp_jobs` | select, status, workspace_id | `"<unavailable>"` |
| GET | `keyword_sets` | order, select, workspace_id | [ id, workspace_id, name, description, is_active, target_domain, competitor_domains, language, country, brand_name, industry, industry_tags, journey_stage, created_at … ] |
| GET | `keyword_tag_assignments` | keyword_id, limit, offset, select | `["<empty>"]` |
| GET | `keywords` | deleted_at, is_active, keyword_set_id, limit, offset, order, select, workspace_id | [ id, keyword, search_volume, keyword_difficulty ] |
| HEAD | `keywords` | is_active, select, workspace_id | `"<unavailable>"` |
| GET | `knowledge_claim_stats` | order, select, workspace_id | [ entity_id, name, slug, knowledge_type, program_type, logo_url, base_url, workspace_id, context_count, total_claims, verified_claims, unverified_claims, stale_claims, conflicted_claims … ] |
| GET | `knowledge_entities` | order, select, workspace_id | [ id, name, slug, description, logo_url, base_url, created_at, updated_at, program_type, workspace_id, parent_program_id, related_programs, coverage_type, knowledge_type ] |
| GET | `knowledge_entity_sources` | knowledge_entity_id, select | `["<empty>"]` |
| GET | `onboarding_jobs` | limit, order, select, workspace_id | [ phase, expected_count, completed_count, updated_at ] |
| GET | `orders` | limit, order, paid_at, select, workspace_id | `["<empty>"]` |
| GET | `plan_templates` | is_active, order, plan_key, select | [ id, plan_key, name, description, is_active, features, created_at, max_workspaces, monthly_price, annual_price, is_archived, sort_order, clone_of, price_krw_monthly … ] |
| GET | `plan_unit_limits` | plan_key, select | [ unit_key, monthly_limit ] |
| GET | `platform_admins` | select, user_id | `["<empty>"]` |
| GET | `report_snapshots` | order, period_key, period_type, prompt_set_id, select, workspace_id | `["<empty>"]` |
| HEAD | `report_snapshots` | created_at, period_type, select, workspace_id | `"<unavailable>"` |
| GET | `serp_snapshots` | captured_at, engine, keyword_id, keywords.deleted_at, limit, offset, order, select | [ keyword_id, captured_at, serp_analysis_json ] |
| HEAD | `serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | `"<unavailable>"` |
| GET | `site_audit_issues` | limit, offset, order, scan_id, select | [ id, scan_id, page_id, page_url, issue_type, category, severity, layer, score_dimension, title, description, fix_recommendation, fix_difficulty, engine_impact … ] |
| HEAD | `site_audit_issues` | scan_id, select | `"<unavailable>"` |
| GET | `site_audit_pages` | limit, offset, order, scan_id, select | [ url, lighthouse_data ] |
| HEAD | `site_audit_pages` | scan_id, select | `"<unavailable>"` |
| GET | `site_audit_scans` | order, select, status, workspace_id | [ id, workspace_id, status, created_at, completed_at, scan_type, scan_mode, crawled_urls, max_pages, critical_count, warning_count, notice_count, site_health_score, ai_readiness_score … ] |
| GET | `subscriptions` | limit, order, select, status, workspace_id | `["<empty>"]` |
| GET | `system_settings` | key, select | `["<empty>"]` |
| GET | `usage_reservations` | limit, order, select, status, workspace_id | [ id, unit_key, amount, status, idempotency_key, created_at ] |
| GET | `vw_gsc_connection_health` | select, workspace_id | `["<empty>"]` |
| GET | `welcome_guide_config` | is_active, order, select | [ id, step_order, icon_name, title_ko, title_en, description_ko, description_en, metric_label, color_phase, is_active, created_at, updated_at ] |
| GET | `welcome_guide_settings` | limit, select | [ id, header_title_ko, header_title_en, header_subtitle_ko, header_subtitle_en, layout_type, is_enabled, created_at, updated_at ] |
| GET | `workspace_api_keys` | order, select, workspace_id | `["<empty>"]` |
| GET | `workspace_billing_overrides` | select, workspace_id | `["<empty>"]` |
| GET | `workspace_events` | created_at, event_type, limit, order, select, workspace_id | [ id, event_type, metadata, created_at ] |
| GET | `workspace_google_connections` | select, workspace_id | `["<empty>"]` |
| GET | `workspace_invitations` | expires_at, order, select, status, workspace_id | `["<empty>"]` |
| GET | `workspace_members` | role, select, user_id | [ workspace_id, workspaces ] |
| HEAD | `workspace_members` | select, workspace_id | `"<unavailable>"` |
| GET | `workspace_mirrors` | is_active, mirror_workspace_id, select | `["<empty>"]` |
| GET | `workspace_plans` | select, workspace_id | [ plan, workspace_id ] |
| GET | `workspace_tag_groups` | order, select, workspace_id | `["<empty>"]` |
| GET | `workspace_tags` | order, select, workspace_id | `["<empty>"]` |
| GET | `workspace_usage` | period, select, workspace_id | [ workspace_id, period, content_generated, keywords_created, llm_cost, image_cost, updated_at ] |
| GET | `workspaces` | id, select | { strategy_map_status } |
| GET | `writing_style_profiles` | order, select, workspace_id | `["<empty>"]` |

### 정적으로만 확인된 테이블 107종

`admin_user_notes`, `adsense_stats`, `affiliate_clicks`, `affiliate_links`, `agent_classification_logs`, `agent_conversations`, `agent_messages`, `agent_traces`, `ai_keyword_expansion_logs`, `ai_model_candidates`, `ai_model_versions`, `ai_prompts`, `api_call_logs`, `article_categories`, `article_generation_jobs`, `article_tags`, `article_tools`, `article_topics`, `article_translations`, `articles`, `audit_batch_failures`, `authors`, `bot_visits`, `changelog_entries`, `chart_annotations`, `citation_matrix_by_media`, `client_errors`, `cluster_batch_runs`, `contact_submissions`, `content_change_items`, `content_compositions`, `content_drafts`, `custom_offer_items`, `custom_offers`, `doc_sync_versions`, `earned_cannibal_dismissals`, `email_send_log`, `eval_runs`, `evidence_claim_embeddings`, `evidence_claims`, `evidence_context_keywords`, `evidence_contexts`, `evidence_sources`, `feature_request_votes`, `feature_requests`, `feedback_reply_notifications`, `free_tool_results`, `geo_alerts`, `geo_answers_raw`, `geo_batch_jobs`, `geo_citations`, `geo_domain_analyses`, `geo_fan_out_queries`, `geo_run_metrics`, `geo_sources`, `grounding_failure_patterns`, `image_generation_runs`, `keyword_expansion_candidates`, `keyword_prompt_links`, `keyword_strategy`, `knowledge_entity_keywords`, `languages`, `llm_usage_logs`, `n8n_webhooks`, `naver_seed_lookups`, `newsletter_subscribers`, `nicepay_webhook_events`, `ops_job_runs`, `ops_metrics`, `profiles`, `prompt_performance`, `prompt_test_runs`, `qa_checklist_items`, `redirects`, `referral_commissions`, `referral_partners`, `referral_payouts`, `regression_test_runs`, `report_action_items`, `schema_coach_results`, `score_calculation_rules`, `search_console_stats`, `serp_batch_jobs`, `serp_decision_alert_log`, `site_audit_links`, `site_audit_phase_metrics`, `site_audit_reanalyze_jobs`, `site_audit_retry_logs`, `site_audit_scores`, `source_tier_domain_stats`, `source_tier_domains`, `strategy_pipeline_runs`, `subscription_events`, `tags`, `tool_alternatives`, `tool_translations`, `tools`, `topic_tool_curations`, `topic_translations`, `topics`, `translation_jobs`, `translation_runs`, `usage_unit_catalog`, `workspace_brand_domains`, `workspace_credit_balances`, `workspace_credit_ledger`, `writing_style_samples`

## 4. Edge Functions [관찰-정적 + SUP 카탈로그]

코드에서 호출 확인 131종, 번들 동봉 카탈로그 93종, 교집합 60종. 런타임 관찰은 `rpc-cache` 1종(나머지는 사용자 액션 트리거라 읽기 전용 캡처 범위 밖).

| 도메인 | 함수 | 입력 | 출력 | 외부 의존 |
|---|---|---|---|---|
| Content Factory (콘텐츠 생성) | `generate-content-draft` | content_job_id | content_drafts | Gemini |
| Content Factory (콘텐츠 생성) | `analyze-keyword-strategy` | keyword_id | keyword_strategy, evidence_claims | Gemini + Grounding |
| Content Factory (콘텐츠 생성) | `run-grounding-only` | keyword, questions | grounding_results | Gemini Grounding |
| Content Factory (콘텐츠 생성) | `reparse-content-draft` | draft_id | parsed content_md | - |
| Content Factory (콘텐츠 생성) | `calculate-content-scores` | content_md, features | scores | Gemini |
| Content Factory (콘텐츠 생성) | `extract-content-features` | content_md | content_feature_snapshots | - |
| Content Factory (콘텐츠 생성) | `auto-feedback-content` | draft_id | feedback_json | Gemini |
| Content Factory (콘텐츠 생성) | `qa-gate-evaluate` | draft_id | qa_report | Gemini |
| Content Factory (콘텐츠 생성) | `improve-content` | draft_id | improved_md | Gemini |
| Optimize (콘텐츠 개선) | `optimize-audit-content` | run_id, input_md | audit_json, scores_before | gemini-2.5-flash-lite |
| Optimize (콘텐츠 개선) | `optimize-serp-fetch` | run_id, keyword | serp_json | - (DataForSEO) |
| Optimize (콘텐츠 개선) | `optimize-strategy-synthesis` | run_id | strategy_json, change_items | Gemini |
| Optimize (콘텐츠 개선) | `optimize-rewrite-content` | run_id | rewritten_md, scores_after | - |
| Discovery (키워드/SERP) | `analyze-serp-decision` | keyword_id | serp_analysis_json | DataForSEO |
| Discovery (키워드/SERP) | `fetch-serp-snapshot` | keyword_id | serp_snapshots | DataForSEO |
| Discovery (키워드/SERP) | `dataforseo-search-volume` | keywords[] | search_volume 업데이트 | DataForSEO |
| Discovery (키워드/SERP) | `dataforseo-search-intent` | keywords[] | intent 업데이트 | DataForSEO |
| Discovery (키워드/SERP) | `dataforseo-keyword-difficulty` | keywords[] | keyword_difficulty 업데이트 | DataForSEO |
| Discovery (키워드/SERP) | `dataforseo-keywords-for-site` | domain | keyword 후보 | DataForSEO |
| Discovery (키워드/SERP) | `dataforseo-keywords-for-keywords` | seed_keywords[] | 관련 키워드 | DataForSEO |
| GEO (AI 검색 가시성) | `geo-run-openai` | prompt_id, model | geo_run_results | OpenAI |
| GEO (AI 검색 가시성) | `geo-run-claude` | prompt_id, model | geo_run_results | Claude Sonnet 4.6 |
| GEO (AI 검색 가시성) | `geo-run-responses` | prompt_id, model | geo_run_results | OpenAI |
| GEO (AI 검색 가시성) | `geo-run-mentions` | run_result_id | geo_citations | - |
| GEO (AI 검색 가시성) | `geo-parse-results` | raw_response | parsed_results | - |
| GEO (AI 검색 가시성) | `geo-discover-run` | prompt_set_id | geo_prompt_candidates | OpenAI |
| Publishing (발행) | `translate-content-v2` | article_id, target_lang | — | — |
| Publishing (발행) | `auto-publish-scheduled` | - (cron) | — | — |
| Publishing (발행) | `sitemap` | - | — | — |
| Publishing (발행) | `track-link-click` | link_id | — | — |
| Strategy Map (v1.5) | `strategy-map-orchestrator` | workspace_id, domain_url? | steps[] 결과 | - |
| Strategy Map (v1.5) | `strategy-map-cluster` | workspace_id | keyword_clusters 갱신 | - |
| Strategy Map (v1.5) | `strategy-map-link-prompts` | discover_run_id, workspace_id | keyword_prompt_links | - |
| Strategy Map (v1.5) | `update-cluster-geo` | workspace_id | stats_json.geo 업데이트 | - |
| Strategy Map (v1.5) | `ai-expand-keywords` | workspace_id, cluster_ids?, hints? | suggested keywords[] | Gemini |
| Agent (AI 에이전트) | `agent-chat` | message, conversation_id, workspace_id | SSE stream (status/chunk/done) | Gemini Flash Lite |

### 카탈로그에 입출력 미기재·코드에서만 확인된 함수

`account-deletion-precheck`, `account-deletion-request`, `admin-impersonation-log`, `admin-suggest-domain-tier`, `app-deleted`, `backfill-keyword-prompt-links`, `backfill-site-audit-sitemap-stats`, `bad-app-name`, `billing-inquiry`, `bulk-collect-keyword-data`, `citability-fetch-url`, `citability-improve`, `derive-prompt-clusters`, `duplicate-app`, `embed-claims`, `evidence-reclassify-brand-role`, `extract-claims-from-pdf`, `extract-clusters-from-prompt-text`, `finalization-registry-not-supported`, `ga4-list-properties`, `geo-backfill-mentions`, `geo-run-perplexity`, `geo-run-prompts-fanout`, `google-oauth-init`, `gsc-list-properties`, `gsc-sync-enqueue`, `idb-get`, `idb-open`, `idb-set`, `intent-batch-scheduler`, `login-blocked`, `mirror-geo-fanout`, `mirror-geo-reparse-drain`, `mirror-serp-fanout`, `mirror-sync`, `naver-related-keywords`, `naver-serp-scheduler`, `nicepay-cancel-pending-change`, `nicepay-create-auth-order`, `nicepay-get-order-meta`, `nicepay-inquire`, `nicepay-retry-charge`, `nicepay-undo-cancel`, `no-app`, `notify-feedback`, `notify-feedback-reply`, `preview-blueprint-body`, `rpc-cache`, `run-blueprint-body-tests`, `run-blueprint-exposure-tests`, `run-blueprint-llm-sample`, `run-regression-tests`, `run-response-eval`, `schema-coach-suggest`, `send-contact-email`, `seo-backfill-brand-presence`, `serp-job-worker`, `site-audit-backfill-schema`, `site-audit-backfill-v2`, `site-audit-diagnose-page`, `site-audit-finish-crawl`, `site-audit-reanalyze`, `site-audit-recheck-url`, `site-audit-render-samples`, `site-audit-worker`, `strategy-map-control`, `suggest-keyword-prompts`, `sync-ga4-data`, `unsupported-password-policy-schema-version`, `volume-batch-scheduler`, `workspace-invite`

## 5. 미해결 [미확인]

- Edge Function 요청/응답 바디의 정확한 shape (액션 트리거 함수는 런타임 미캡처). 다음 증거: 사용자 협조 HAR(생성 액션 포함) 또는 클론에서 계약 재정의.
- RLS 정책 내용, DB 트리거, cron 스케줄(서버 측) — 정적·런타임 모두 도달 불가.
- `halox-mcp` 공개 API 도구 스키마.
- 빈 응답(`<empty>`)으로만 관찰된 테이블의 요소 shape — 정적 select 컬럼(`data-model.md`)으로 대체.
