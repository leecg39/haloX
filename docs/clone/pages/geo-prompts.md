# geo-prompts — `/app/geo/prompts`

> 메뉴 그룹: 분석 · 라우트 컴포넌트 청크: `GeoPromptSetsPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/geo-prompts.png`

## 목적

AI 엔진에 반복 질의할 프롬프트(질문)와 세트·태그를 관리하고 질문별 인용 상태를 본다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_geo_prompts.json`, `tab-geo_prompts-0.json`, `tab-geo_prompts-1.json`, `tab-geo_prompts-2.json`

- 탭: 리스트, 세트, 태그
- 주요 액션 버튼: 경쟁사 우위 보기, Dismiss, 기간 시작 전 생성분만, 기간 시작 전 생성분만 계산, 세트, 태그, Raw, 설정, 추가, 프롬프트 분포 info, 자사만: 1 (10.0%), 경쟁사만: 1 (10.0%), 미노출: 8 (80.0%), 멘션 순위 info, 멘션 점유율 info, 소스 점유율 info, 인용 점유율 info, 인용 순위 info, 리스트 (10), 세트 (1), 퍼널 현황, 전체 엔진, 경쟁 상태, 자사·경쟁사 범위, 전체 보기
- 테이블 컬럼: 프롬프트, 태그, ChatGPT, Gemini, Pplx, Claude, 프롬프트 분포, 멘션 순위, 세트명, 멘션, 소스, 인용
- 입력/필터: button, 프롬프트 검색..., 세트 검색, 태그 검색

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| POST | `/functions/v1/rpc-cache` |  | { error_fallback, reason, data } |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| GET | `/rest/v1/geo_prompt_tag_assignments` | limit, offset, prompt_id, select | ['<empty>'] |
| GET | `/rest/v1/geo_prompts` | deleted_at, is_active, limit, offset, prompt_set_id, select | [ id ] |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| GET | `/rest/v1/keyword_sets` | order, select, workspace_id | [ id, workspace_id, name, description, is_active, target_domain, competitor_domains, language ] |
| GET | `/rest/v1/keywords` | deleted_at, is_active, keyword_set_id, limit, offset, order | [ id, keyword, search_volume, keyword_difficulty ] |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/system_settings` | key, select | ['<empty>'] |
| GET | `/rest/v1/workspace_mirrors` | is_active, mirror_workspace_id, select | ['<empty>'] |
| GET | `/rest/v1/workspace_tag_groups` | order, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/workspace_tags` | order, select, workspace_id | ['<empty>'] |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (26): content_compositions, content_jobs, geo_answers_raw, geo_citations, geo_fan_out_queries, geo_prompt_candidates, geo_prompt_runs, geo_prompt_sets, geo_prompt_tag_assignments, geo_prompts, geo_run_metrics, geo_sources, keyword_prompt_links, keyword_sets, keywords, plan_templates, serp_snapshots, site_audit_issues, site_audit_pages, site_audit_scans, site_audit_scores, system_settings, workspace_plans, workspace_tag_groups, workspace_tags, workspaces
- RPC (7): commit_reservation, delete_geo_prompt, get_geo_prompt_rows_v2, is_platform_admin, release_reservation, reserve_unit_with_bypass, set_prompt_paused
- Edge Functions (8): analyze-keyword-strategy, dataforseo-keyword-difficulty, dataforseo-search-intent, dataforseo-search-volume, derive-prompt-clusters, extract-clusters-from-prompt-text, geo-run-prompts-fanout, rpc-cache

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/prompt-status (SUP).
