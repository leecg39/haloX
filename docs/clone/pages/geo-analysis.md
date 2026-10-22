# geo-analysis — `/app/geo/analysis`

> 메뉴 그룹: 분석 · 라우트 컴포넌트 청크: `GeoInsightsPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/geo-analysis.png`

## 목적

프롬프트 실행 결과를 개요/프롬프트/멘션/인용 소스/상품/인용 매트릭스/경쟁사/플랫폼/검색 패턴 관점으로 분석한다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_geo_analysis.json`, `tab-geo_analysis-0.json`, `tab-geo_analysis-1.json`, `tab-geo_analysis-2.json`, `tab-geo_analysis-3.json`, `tab-geo_analysis-4.json`, `tab-geo_analysis-5.json`, `tab-geo_analysis-6.json`, `tab-geo_analysis-7.json`, `tab-geo_analysis-8.json`

- 탭: 개요, 프롬프트, 멘션, 인용 소스, 상품, 인용 매트릭스, 경쟁사, 플랫폼, 검색 패턴, 리스트, 세트, 태그
- 주요 액션 버튼: 엔진, 세트, 태그, 기간 시작 전 생성분만, 기간 시작 전 생성분만 계산, 일별 지난 28일, 개요, 프롬프트, 멘션, 인용 소스, 상품, 인용 매트릭스, 경쟁사, 플랫폼, 검색 패턴, 프롬프트 분포 info, 멘션 순위 info, 멘션 점유율 info, 소스 점유율 info, 인용 점유율 info, 인용 순위 info, 프롬프트 세트, 소스, 인용, 리스트 (10)
- 테이블 컬럼: 엔진, 프롬프트, 멘션, 소스, 인용, 프롬프트 분포, 멘션 순위, 프롬프트 세트, 태그, 퍼널 현황· 엔진별, 멘션 최근 7일, 소스 최근 7일, 인용 최근 7일
- 입력/필터: 프롬프트 검색, button, 도메인 검색..., 이름·도메인 검색, 서브쿼리 검색...

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| POST | `/functions/v1/rpc-cache` |  | { error_fallback, reason, data } |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| GET | `/rest/v1/geo_prompts` | deleted_at, is_active, limit, offset, prompt_set_id, select | [ id ] |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| POST | `/rest/v1/rpc/get_geo_collection_days` |  | [ day ] |
| POST | `/rest/v1/rpc/get_geo_group_status_kpi_multi` |  | { buckets } |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/workspace_tags` | order, select, workspace_id | ['<empty>'] |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (15): geo_answers_raw, geo_fan_out_queries, geo_prompt_candidates, geo_prompt_runs, geo_prompt_sets, geo_prompt_tag_assignments, geo_prompts, keyword_cluster_members, keyword_clusters, keyword_prompt_links, keywords, plan_templates, workspace_plans, workspace_tag_groups, workspace_tags
- RPC (17): commit_reservation, delete_geo_prompt, get_fan_out_hub_data, get_geo_domain_citations, get_geo_domain_detail, get_geo_group_status_kpi, get_geo_group_status_kpi_multi, get_geo_product_engines, get_geo_product_metrics, get_geo_product_prompts, get_geo_product_trend, get_geo_prompt_rows_v2, get_geo_scope_prompt_ids, get_geo_ws_mention_term_prompts, is_platform_admin, release_reservation, reserve_unit_with_bypass
- Edge Functions (2): geo-run-prompts-fanout, rpc-cache

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/prompt-analysis (SUP).
