# seo-insights — `/app/seo/insights`

> 메뉴 그룹: 분석 · 라우트 컴포넌트 청크: `SEOInsightsPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/seo-insights.png`

## 목적

키워드 묶음의 SEO 성과(점수, 위치 분포, 경쟁사, 기회, AIO, SERP 매트릭스)를 분석한다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_seo_insights.json`, `tab-seo_insights-0.json`, `tab-seo_insights-1.json`, `tab-seo_insights-2.json`, `tab-seo_insights-3.json`, `tab-seo_insights-4.json`, `tab-seo_insights-5.json`

- 탭: 개요, 성과, 경쟁사, 기회, AIO, SERP 매트릭스, 빠른 성과, 미순위, Striking, AI 요약 갭, 고가치
- 주요 액션 버튼: 전체 언어, 전체 국가, 기간 시작 전 생성분만, 기간 시작 전 생성분만 계산, 세트, 태그, 일별 지난 28일, 개요, 성과, 경쟁사, 기회, AIO, SERP 매트릭스, Top 10 비율 info, AI 요약 인용률 info, 자사 순위 info, 평균 순위 info, 검색량순, 순위순, Top 5, Top 10, 전체 0, 상승 0, 하락 0, 성과 상세 보기
- 테이블 컬럼: 검색 엔진, 노출·인용률, 분포, 평균 순위, 교차율, 방향, 키워드, 시작 → 현재, 변동, 이동, 검색량, 난이도, AIO, 순위, 기회 점수, AIO 상태, 이슈 유형, 인용 도메인
- 입력/필터: button, 키워드, 키워드 검색

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| POST | `/functions/v1/rpc-cache` |  | { error_fallback, reason, data } |
| GET | `/rest/v1/ga4_page_stats` | date, limit, order, select, workspace_id | ['<empty>'] |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| GET | `/rest/v1/keyword_sets` | order, select, workspace_id | [ id, workspace_id, name, description, is_active, target_domain, competitor_domains, language ] |
| GET | `/rest/v1/keywords` | deleted_at, is_active, keyword_set_id, limit, offset, order | [ id, keyword, search_volume, keyword_difficulty ] |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| POST | `/rest/v1/rpc/get_seo_aio_cross_trend` |  | [ day, aio_detected, our_cited, our_top10, cross_count, aio_pos_sum, aio_pos_cnt, excluded_count ] |
| POST | `/rest/v1/rpc/get_seo_overview_agg` |  | { current, previous } |
| POST | `/rest/v1/rpc/get_seo_rank_movers` |  | [ keyword_id, first_date, last_date, first_rank, last_rank, last_aio_cited, last_best_url ] |
| POST | `/rest/v1/rpc/get_serp_brand_presence_slim` | limit, offset | [ keyword_id, captured_at, ai_overview_detected, brand_presence ] |
| POST | `/rest/v1/rpc/get_serp_brand_presence_trend` |  | [ keyword_id, captured_at, ai_overview_detected, brand_presence ] |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/serp_snapshots` | captured_at, engine, keyword_id, keywords.deleted_at, limit, offset | [ keyword_id, captured_at, serp_analysis_json ] |
| GET | `/rest/v1/workspace_tags` | order, select, workspace_id | ['<empty>'] |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (10): ga4_page_stats, keyword_sets, keyword_tag_assignments, keywords, plan_templates, serp_snapshots, source_tier_domains, workspace_plans, workspace_tag_groups, workspace_tags
- RPC (6): get_seo_aio_cross_trend, get_seo_rank_movers, get_serp_brand_presence_slim, get_serp_brand_presence_window, get_serp_matrix_data, get_serp_rank_trend
- Edge Functions (1): rpc-cache

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/keyword-analysis (SUP).
