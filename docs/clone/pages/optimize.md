# optimize — `/app/optimize`

> 메뉴 그룹: 실행 · 라우트 컴포넌트 청크: `OptimizePage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/optimize.png`

## 목적

기존 콘텐츠를 진단(audit)하고 SERP·전략을 반영해 개선본을 만든다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_optimize.json`

- 탭: —
- 주요 액션 버튼: 채점하기, 텍스트로 붙여넣기, 채점 기준 보기
- 테이블 컬럼: —
- 입력/필터: https://blog.example.com/post

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| GET | `/rest/v1/content_review_runs` | limit, order, select, workspace_id | ['<empty>'] |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (1): content_review_runs
- RPC (0): —
- Edge Functions (2): citability-fetch-url, citability-improve

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/content-factory (SUP).
