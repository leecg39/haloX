# gap — `/app/gap`

> 메뉴 그룹: 분석(기회) · 라우트 컴포넌트 청크: `GapIntelligencePage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/gap.png`

## 목적

SEO 강도와 GEO 인용을 교차해 키워드·프롬프트·경쟁사·콘텐츠 공백을 찾는다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_gap.json`, `tab-gap-0.json`, `tab-gap-1.json`, `tab-gap-2.json`, `tab-gap-3.json`, `tab-gap-4.json`, `tab-gap-5.json`, `tab-gap-6.json`

- 탭: 개요, 매트릭스, 키워드, 프롬프트, 경쟁사, 콘텐츠, 트렌드
- 주요 액션 버튼: 전체 언어, 전체 국가, 지난 90일, 개요, 매트릭스, 키워드, 프롬프트, 경쟁사, 콘텐츠, 트렌드, 기회 점수 info, 검색 + AI 모두 강한 비율 info, Quick Wins info, 검색과 AI 모두 약함 info, 전체 갭 info, AI만 강함 (검색 약함) info, 검색만 강함 (AI 약함) info, 검색 + AI 모두 강함 info, dashboard.gap.geoGap_label info, dashboard.gap.seoGap_label info, 둘 다 약함 info, 0 검색 + AI 모두 강함 SEO ✓ GEO ✓, 0 검색만 강함 SEO ✓ GEO ✗, 1 AI만 강함 SEO ✗ GEO ✓, 9 둘 다 약함 SEO ✗ GEO ✗
- 테이블 컬럼: 키워드, Gap 유형, 검색량, 기회 점수, Quick Win, 난이도, 자사 순위, 상태
- 입력/필터: button

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| POST | `/functions/v1/rpc-cache` |  | { error_fallback, reason, data } |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| GET | `/rest/v1/keywords` | deleted_at, is_active, keyword_set_id, limit, offset, order | [ id, keyword, search_volume, keyword_difficulty ] |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| POST | `/rest/v1/rpc/get_gap_overview_light` |  | [ id, keyword_id, captured_at, brand_presence ] |
| POST | `/rest/v1/rpc/get_keywords_with_gsc_stats` |  | [ keyword_id, keyword_text, gsc_clicks, gsc_impressions, gsc_ctr, gsc_avg_position, gsc_insight_type ] |
| POST | `/rest/v1/rpc/get_serp_brand_presence_trend` |  | [ keyword_id, captured_at, ai_overview_detected, brand_presence ] |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/serp_snapshots` | captured_at, engine, keyword_id, keywords.deleted_at, limit, offset | [ keyword_id, captured_at, serp_analysis_json ] |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (7): articles, geo_prompt_runs, geo_prompt_sets, geo_prompts, keyword_tag_assignments, keywords, serp_snapshots
- RPC (4): get_full_funnel_stats, get_keyword_ga4_evidence, get_serp_brand_presence_slim, get_serp_brand_presence_window
- Edge Functions (1): rpc-cache

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/geo-dashboard (SUP).
