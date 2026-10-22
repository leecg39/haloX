# raw-data — `/app/raw-data`

> 메뉴 그룹: 기타 · 라우트 컴포넌트 청크: `RawDataPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/raw-data.png`

## 목적

수집 원본(SERP 스냅샷, 프롬프트 실행, 인용 등)을 표 형태로 조회·다운로드한다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_raw-data.json`

- 탭: —
- 주요 액션 버튼: 키워드 Raw SERP · 순위 · AIO · PAA, 프롬프트 Raw 프롬프트 · 응답 · fan-out, 사이트 진단 Raw 메타 · 페이지 · 이슈 · 점수, 모니터링 Raw GSC · GA4 일별, 10/16 ~ 10/22, 7일, 14일, 28일, 90일, 전체 언어, 전체 국가, 전체 엔진, Zip 다운로드 (정규화 CSV 묶음)
- 테이블 컬럼: —
- 입력/필터: button

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/serp_snapshots` | captured_at, engine, keyword_id, keywords.deleted_at, limit, offset | [ keyword_id, captured_at, serp_analysis_json ] |
| GET | `/rest/v1/workspace_tags` | order, select, workspace_id | ['<empty>'] |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (17): geo_answers_raw, geo_citations, geo_fan_out_queries, geo_prompt_runs, geo_prompt_tag_assignments, geo_prompts, geo_run_metrics, keywords, plan_templates, serp_snapshots, site_audit_issues, site_audit_pages, site_audit_scans, site_audit_scores, workspace_plans, workspace_tag_groups, workspace_tags
- RPC (0): —
- Edge Functions (0): —

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: 해당 기능 문서 없음 (SUP).
