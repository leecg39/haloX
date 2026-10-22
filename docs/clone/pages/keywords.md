# keywords — `/app/keywords`

> 메뉴 그룹: 분석 · 라우트 컴포넌트 청크: `KeywordsPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/keywords.png`

## 목적

추적 키워드 목록과 SERP 순위·AI 요약 인용·검색량·의도 등 키워드 단위 상태를 관리한다. 세트/태그/네트워크/아이디어 뷰 제공.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_keywords.json`, `tab-keywords-0.json`, `tab-keywords-1.json`, `tab-keywords-2.json`, `tab-keywords-3.json`, `tab-keywords-4.json`

- 탭: 리스트, 세트, 태그, 네트워크, 아이디어, 상태, 내 순위, 인텐트, 끔, 주제 그룹, 1차, 2차, 상세, 설명
- 주요 액션 버튼: 전체 세트, Raw, 키워드 추가, Top 10 비율 info, AI 요약 인용 분포 info, 자사 1, 경합 0, 경쟁사 0, 미점유 8, AIO 없음 1, 자사 순위 info, 우위 0, 뒤처짐 0, 미점유 10, 평균 순위 info, 리스트 (10), 세트 (1), 태그, 네트워크, 아이디어, 전체 언어, 자사·경쟁사, 인텐트, 진행상태, 최신 등록순
- 테이블 컬럼: 세트 · 키워드, 태그, 순위, AI, 검색량, 트렌드, 의도, PAA, 연관 검색어, 추천 프롬프트, TTR, 진행, 세트명, 키워드, Top10, AIO, 평균순위, 자사 분포
- 입력/필터: button, 키워드 검색, checkbox, 태그 검색, 후보 검색...

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

### 스크린샷 관찰 [관찰 · 2026-10-22 캡처]

- 상단 KPI 4카드: Top10 키워드(도넛), AI 요약 인용(자사/경합/경쟁사/미점유/AIO 없음), 자사 순위(우위/경합/뒤처짐/미점유), 평균 순위(Top3/Top10/Top30/31+ 분포 막대).
- 우상단: 세트 선택, Raw 다운로드, 키워드 추가(주 CTA, 검정 버튼).

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| GET | `/rest/v1/earned_publications` | order, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/geo_prompt_candidates` | select, source_keyword_id, source_type, status | ['<empty>'] |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| HEAD | `/rest/v1/keyword_serp_jobs` | select, status, workspace_id | <unavailable> |
| GET | `/rest/v1/keyword_sets` | order, select, workspace_id | [ id, workspace_id, name, description, is_active, target_domain, competitor_domains, language ] |
| GET | `/rest/v1/keyword_tag_assignments` | keyword_id, limit, offset, select | ['<empty>'] |
| GET | `/rest/v1/keywords` | deleted_at, is_active, keyword_set_id, limit, offset, order | [ id, keyword, search_volume, keyword_difficulty ] |
| HEAD | `/rest/v1/keywords` | is_active, select, workspace_id | <unavailable> |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| POST | `/rest/v1/rpc/get_latest_serp_snapshots` |  | [ id, keyword_id, captured_at, provider, country, language, engine, serp_analysis_json ] |
| POST | `/rest/v1/rpc/get_serp_brand_presence_window` |  | [ keyword_id, captured_at, ai_overview_detected, brand_presence ] |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/system_settings` | key, select | ['<empty>'] |
| GET | `/rest/v1/workspace_mirrors` | is_active, mirror_workspace_id, select | ['<empty>'] |
| GET | `/rest/v1/workspace_tag_groups` | order, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/workspace_tags` | order, select, workspace_id | ['<empty>'] |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (42): content_compositions, content_drafts, content_jobs, earned_publications, evidence_contexts, geo_answers_raw, geo_citations, geo_fan_out_queries, geo_prompt_candidates, geo_prompt_runs, geo_prompt_sets, geo_prompt_tag_assignments, geo_prompts, geo_run_metrics, geo_sources, keyword_cluster_members, keyword_clusters, keyword_expansion_candidates, keyword_knowledge_entities, keyword_prompt_links, keyword_serp_jobs, keyword_sets, keyword_strategy, keywords, knowledge_claim_stats, knowledge_entities, naver_seed_lookups, plan_templates, profiles, serp_snapshots, site_audit_issues, site_audit_pages, site_audit_scans, site_audit_scores, system_settings, workspace_brand_domains, workspace_plans, workspace_tag_groups, workspace_tags, workspaces, writing_style_profiles, writing_style_samples
- RPC (15): commit_reservation, delete_geo_prompt, delete_keyword, delete_keywords_bulk, find_keyword_id_canonical, get_keyword_network, get_keywords_with_gsc_stats, get_latest_naver_snapshots, get_latest_serp_snapshots, get_serp_brand_presence_window, is_platform_admin, release_reservation, reserve_unit_with_bypass, set_prompt_paused, strategy_map_effective_state
- Edge Functions (19): analyze-keyword-strategy, analyze-writing-style, bulk-collect-keyword-data, dataforseo-keyword-difficulty, dataforseo-keywords-for-keywords, dataforseo-keywords-for-site, fetch-serp-snapshot, fetch-url-content, geo-run-prompts-fanout, intent-batch-scheduler, naver-related-keywords, naver-serp-scheduler, rpc-cache, seo-backfill-brand-presence, serp-job-worker, strategy-map-link-prompts, suggest-keyword-prompts, trigger-onboarding-async, volume-batch-scheduler

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/keyword-status (SUP).
