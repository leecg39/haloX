# strategy-map — `/app/strategy-map`

> 메뉴 그룹: 전략 · 라우트 컴포넌트 청크: `StrategyMapPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/strategy-map.png`

## 목적

키워드를 클러스터로 묶어 리스트/포트폴리오/네트워크로 보여주고 우선순위를 정한다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_strategy-map.json`, `tab-strategy-map-0.json`, `tab-strategy-map-1.json`, `tab-strategy-map-2.json`

- 탭: 리스트, 포트폴리오, 네트워크
- 주요 액션 버튼: AI 전략 리포트, 클러스터링 재실행, 빈틈 찾아보기, Close, 리스트, 포트폴리오, 네트워크, 최근 등록순, Gap 유형 전체, 측정 상태 전체, 클러스터명 수정, 확대 초기화
- 테이블 컬럼: —
- 입력/필터: button, 클러스터·키워드 검색

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| GET | `/rest/v1/cluster_stats_history` | order, select, workspace_id | ['<empty>'] |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| GET | `/rest/v1/geo_prompts` | deleted_at, is_active, limit, offset, prompt_set_id, select | [ id ] |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| GET | `/rest/v1/keyword_cluster_members` | cluster_id, select | [ cluster_id, keyword_id, keywords ] |
| GET | `/rest/v1/keyword_clusters` | order, select, workspace_id | [ id, stats_json ] |
| HEAD | `/rest/v1/keyword_clusters` | select, workspace_id | <unavailable> |
| GET | `/rest/v1/onboarding_jobs` | limit, order, select, workspace_id | [ phase, expected_count, completed_count, updated_at ] |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| POST | `/rest/v1/rpc/strategy_map_effective_state` |  | { reason, status, effective, scanned_at, cluster_count, prompt_set_count, active_prompt_count, active_keyword_count } |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/workspace_events` | created_at, event_type, limit, order, select, workspace_id | [ id, event_type, metadata, created_at ] |
| GET | `/rest/v1/workspaces` | id, select | { strategy_map_status } |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (15): ai_keyword_expansion_logs, cluster_batch_runs, cluster_stats_history, geo_discover_runs, geo_prompt_candidates, geo_prompt_runs, geo_prompt_sets, geo_prompts, keyword_cluster_members, keyword_clusters, keyword_prompt_links, keywords, onboarding_jobs, workspace_events, workspaces
- RPC (5): commit_reservation, get_keywords_with_gsc_stats, release_reservation, reserve_unit_with_bypass, strategy_map_effective_state
- Edge Functions (9): ai-expand-keywords, backfill-keyword-prompt-links, cluster-keywords, run-cluster-batch, strategy-map-cluster, strategy-map-control, strategy-map-orchestrator, trigger-onboarding-async, update-cluster-geo

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/strategy-map (SUP).
