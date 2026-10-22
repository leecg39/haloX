# monitoring — `/app/monitoring`

> 메뉴 그룹: 모니터링 · 라우트 컴포넌트 청크: `MonitoringDashboardPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/monitoring.png`

## 목적

GSC·GA4 연동 데이터로 검색/AI 유입 추이를 overview·queries·pages 탭으로 본다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_monitoring.json`

- 탭: —
- 주요 액션 버튼: 연동 설정 열기, 닫기
- 테이블 컬럼: —
- 입력/필터: —

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| POST | `/rest/v1/rpc/get_ga4_channel_summary` |  | ['<empty>'] |
| POST | `/rest/v1/rpc/get_ga4_dashboard_timeseries` |  | ['<empty>'] |
| POST | `/rest/v1/rpc/get_gsc_dashboard_dimensions` |  | ['<empty>'] |
| POST | `/rest/v1/rpc/get_gsc_dashboard_kpis` |  | { clicks, impressions, ctr, avg_position, prev_clicks, prev_impressions, prev_ctr, prev_avg_position } |
| POST | `/rest/v1/rpc/get_gsc_dashboard_timeseries` |  | ['<empty>'] |
| POST | `/rest/v1/rpc/get_page_ga4_stats` |  | ['<empty>'] |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/vw_gsc_connection_health` | select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/workspace_google_connections` | select, workspace_id | ['<empty>'] |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (28): articles, chart_annotations, ga4_page_stats, geo_answers_raw, geo_citations, geo_fan_out_queries, geo_prompt_runs, geo_prompt_tag_assignments, geo_prompts, geo_run_metrics, gsc_daily_keywords, gsc_daily_pages, gsc_daily_totals, keyword_cluster_members, keyword_expansion_candidates, keyword_knowledge_entities, keyword_serp_jobs, keywords, knowledge_entities, plan_templates, serp_snapshots, site_audit_issues, site_audit_pages, site_audit_scans, site_audit_scores, vw_gsc_connection_health, workspace_google_connections, workspace_plans
- RPC (23): commit_reservation, delete_gsc_property_stats, find_keyword_id_canonical, get_full_funnel_stats, get_ga4_channel_summary, get_ga4_dashboard_timeseries, get_ga4_source_summary, get_gsc_cannibalizations, get_gsc_dashboard_dimensions, get_gsc_dashboard_kpis, get_gsc_dashboard_timeseries, get_gsc_dimension_timeseries, get_gsc_page_query_counts, get_gsc_query_page_cross, get_gsc_ranking_timeseries, get_keyword_ga4_evidence, get_keywords_with_gsc_stats, get_page_ga4_stats, get_page_top_queries, get_pages_top_keywords, release_reservation, reserve_unit_with_bypass, strategy_map_effective_state
- Edge Functions (12): bulk-collect-keyword-data, dataforseo-keyword-difficulty, dataforseo-keywords-for-keywords, dataforseo-keywords-for-site, google-oauth-init, gsc-sync-enqueue, intent-batch-scheduler, naver-serp-scheduler, serp-job-worker, strategy-map-link-prompts, trigger-onboarding-async, volume-batch-scheduler

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/monitoring-dashboard (SUP).
