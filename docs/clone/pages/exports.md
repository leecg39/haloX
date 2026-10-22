# exports — `/app/exports`

> 메뉴 그룹: 실행 · 라우트 컴포넌트 청크: `ExportsPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/exports.png`

## 목적

완성 콘텐츠와 근거를 외부 전달용으로 내보내고 이력을 관리한다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_exports.json`

- 탭: —
- 주요 액션 버튼: 전체 유형, 일별 기간 선택, 최근 다운로드순
- 테이블 컬럼: —
- 입력/필터: 제목 또는 키워드로 검색..., button

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| GET | `/rest/v1/export_history` | limit, order, select, workspace_id | ['<empty>'] |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (6): content_drafts, content_review_runs, earned_publications, export_history, keywords, serp_snapshots
- RPC (0): —
- Edge Functions (1): seo-backfill-brand-presence

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/content-export (SUP).
