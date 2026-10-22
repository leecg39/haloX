# factory — `/app/factory`

> 메뉴 그룹: 실행 · 라우트 컴포넌트 청크: `FactoryPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/factory.png`

## 목적

키워드/프롬프트 기반 콘텐츠 작업(content_jobs)을 만들고 전략 분석→초안 작성→근거 확인 단계로 진행한다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_factory.json`

- 탭: —
- 주요 액션 버튼: 새 콘텐츠 만들기
- 테이블 컬럼: —
- 입력/필터: —

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| GET | `/rest/v1/content_jobs` | order, select, title, workspace_id | ['<empty>'] |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| GET | `/rest/v1/keywords` | deleted_at, is_active, keyword_set_id, limit, offset, order | [ id, keyword, search_volume, keyword_difficulty ] |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/writing_style_profiles` | order, select, workspace_id | ['<empty>'] |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (12): cluster_batch_runs, content_compositions, content_drafts, content_jobs, keyword_cluster_members, keyword_clusters, keyword_prompt_links, keyword_strategy, keywords, workspaces, writing_style_profiles, writing_style_samples
- RPC (0): —
- Edge Functions (5): analyze-keyword-strategy, analyze-writing-style, cluster-keywords, fetch-url-content, run-cluster-batch

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/content-factory (SUP).
