# reports-weekly — `/app/reports/weekly`

> 메뉴 그룹: 모니터링 · 라우트 컴포넌트 청크: `WeeklyReportPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/reports-weekly.png`

## 목적

주 단위 KPI 변화와 다음 액션을 리포트 스냅샷(report_snapshots)으로 정리한다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_reports.json`, `_app_reports_weekly.json`

- 탭: —
- 주요 액션 버튼: 내보내기, 이전 주차, 다음 주차, AI 대화 모니터링 시작하기
- 테이블 컬럼: —
- 입력/필터: —

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| GET | `/rest/v1/geo_prompts` | deleted_at, is_active, limit, offset, prompt_set_id, select | [ id ] |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| GET | `/rest/v1/report_snapshots` | order, period_key, period_type, prompt_set_id, select, workspace_id | ['<empty>'] |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (7): geo_prompt_runs, geo_prompt_sets, geo_prompts, keyword_tag_assignments, keywords, report_action_items, report_snapshots
- RPC (6): get_avi_daily_components, get_avi_overview, get_geo_citation_rank_range, get_geo_prompt_status_kpi_range, get_serp_brand_presence_slim, get_serp_brand_presence_window
- Edge Functions (3): generate-report-summary, generate-weekly-snapshot, rpc-cache

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/weekly-report (SUP).
