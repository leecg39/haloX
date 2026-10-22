# dashboard — `/app`

> 메뉴 그룹: 공통 · 라우트 컴포넌트 청크: `AppOverview` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/dashboard.png`

## 목적

워크스페이스 전체의 AVI·GEO·SEO·웹 건강도 점수를 한 화면에 요약하고, 키워드/질문/진단 하위 표로 다음 작업을 안내한다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `app-dashboard.json`, `quick-navigation.json`

- 탭: —
- 주요 액션 버튼: —
- 테이블 컬럼: —
- 입력/필터: —

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

### 스크린샷 관찰 [관찰 · 2026-10-22 캡처]

- 상단 배너: 분석 범위 진행률(현재/한도)과 기회 탐색 CTA, 닫기 버튼.
- 인사 헤더 + 부제(오늘의 검색·AI 가시성 현황).
- 좌측 큰 카드: AVI 종합 점수 반원 게이지(0~100), 28일 대비 증감, 레벨 배지, 최근 28일 추이 스파크라인.
- KPI 카드 2행: 1행 GEO 점수 + 구성 4종(인용률/멘션율/인용 순위/멘션 순위, 각 가중치 25% 표기), 2행 SEO 점수 + 구성 3종(평균 순위 40%/Top10 비율 30%/AIO 인용률 30%) + 웹 건강도.
- 하단 탭 표: 키워드 상위 / AI 질문 상위 / 사이트 진단 / 주요 변화 Top 4 / 키워드 상태 현황, 우측 '전체 보기' 링크.
- 키워드 표 컬럼: 키워드, 순위, 월 검색량, 상태(취약 등 배지), AIO.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| POST | `/functions/v1/rpc-cache` |  | { error_fallback, reason, data } |
| GET | `/rest/v1/ga4_page_stats` | date, limit, order, select, workspace_id | ['<empty>'] |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| GET | `/rest/v1/geo_prompts` | deleted_at, is_active, limit, offset, prompt_set_id, select | [ id ] |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| GET | `/rest/v1/gsc_daily_pages` | date, search_type, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/keyword_clusters` | order, select, workspace_id | [ id, stats_json ] |
| GET | `/rest/v1/keywords` | deleted_at, is_active, keyword_set_id, limit, offset, order | [ id, keyword, search_volume, keyword_difficulty ] |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| GET | `/rest/v1/report_snapshots` | order, period_key, period_type, prompt_set_id, select, workspace_id | ['<empty>'] |
| POST | `/rest/v1/rpc/get_avi_daily_components` |  | [ date, label, mentionRank, citationRank, mentionCoverage, citationCoverage ] |
| POST | `/rest/v1/rpc/get_avi_overview` |  | { level, setCount, totalRuns, components, dailySeries, averageScore, citedPrompts, coverageRate } |
| POST | `/rest/v1/rpc/get_gap_overview_light` |  | [ id, keyword_id, captured_at, brand_presence ] |
| POST | `/rest/v1/rpc/get_geo_slot_counts` |  | { slot_cited, slot_total, slot_sourced, slot_mentioned } |
| POST | `/rest/v1/rpc/get_light_dashboard_overview` |  | { gap, avi_summary, audit_active, audit_latest, weekly_report, funnel_summary, top10_sparkline, prompt_stats_summary } |
| POST | `/rest/v1/rpc/get_light_prompt_stats` |  | { domain_stats, prompt_stats, category_stats } |
| POST | `/rest/v1/rpc/get_pro_dashboard_kpi` |  | { kpi, engine_sov, overall_sov, mention_rank, total_engines, daily_citation_series, daily_mention_rank_series } |
| POST | `/rest/v1/rpc/get_seo_overview_agg` |  | { current, previous } |
| POST | `/rest/v1/rpc/get_serp_brand_presence_trend` |  | [ keyword_id, captured_at, ai_overview_detected, brand_presence ] |
| POST | `/rest/v1/rpc/get_web_health_sparkline` |  | [ date, value ] |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/workspace_mirrors` | is_active, mirror_workspace_id, select | ['<empty>'] |
| GET | `/rest/v1/workspaces` | id, select | { strategy_map_status } |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (12): ga4_page_stats, geo_prompt_runs, geo_prompt_sets, geo_prompts, gsc_daily_pages, keyword_clusters, keyword_tag_assignments, keywords, report_snapshots, site_audit_issues, site_audit_pages, workspaces
- RPC (10): get_avi_daily_components, get_avi_overview, get_full_funnel_stats, get_geo_slot_counts, get_keyword_ga4_evidence, get_light_dashboard_overview, get_pro_dashboard_kpi, get_serp_brand_presence_slim, get_serp_brand_presence_window, get_web_health_sparkline
- Edge Functions (1): rpc-cache

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/overview (SUP).
