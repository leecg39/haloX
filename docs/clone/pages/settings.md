# settings — `/app/settings`

> 메뉴 그룹: 계정 · 라우트 컴포넌트 청크: `SettingsPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/settings.png`

## 목적

워크스페이스·멤버·일반·사용량·결제·연동·브랜드 트래킹·태그·등록 URL·내보내기·알림·API&MCP 12개 탭 설정.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `settings-0.json`, `settings-1.json`, `settings-10.json`, `settings-11.json`, `settings-2.json`, `settings-3.json`, `settings-4.json`, `settings-5.json`, `settings-6.json`, `settings-7.json`, `settings-8.json`, `settings-9.json`

- 탭: 키 관리, 사용량, 한도, Claude Code, Claude 앱, REST API
- 주요 액션 버튼: 워크스페이스, 멤버, 일반, 사용량, 구독/결제, 연동, 브랜드 트래킹, 태그, 등록 URL, 내보내기, 알림, API & MCP, 결제 도움이 필요하신가요?, Close, 한국어, English, 대한민국, 저장, 계정 탈퇴 요청, 키 관리, 한도, 90일 후 만료, 키 발급, 전체 선택, Claude Code (CLI)
- 테이블 컬럼: 권한, 소유자 내 역할, 관리자, 편집자, 뷰어
- 입력/필터: 검색, button, 워크스페이스 이름, https://example.com/robots.txt, https://example.com/sitemap.xml, https://example.com/llms.txt, 예: Claude Code, 멘션 입력 후 Enter (예: KB국민은행), 도메인 입력 후 Enter (예: kbstar.com), 상품 이름 입력 후 Enter, 멘션 입력 후 Enter (예: 신한은행), 도메인 입력 후 Enter (예: shinhan.com), 원본 도메인 (old-brand.com), 매핑 별칭 도메인 (new-brand.com), 예: My Company Inc.

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| GET | `/rest/v1/brand_reclassify_jobs` | limit, order, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/earned_publications` | order, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/ga4_page_stats` | date, limit, order, select, workspace_id | ['<empty>'] |
| HEAD | `/rest/v1/ga4_page_stats` | select, workspace_id | <unavailable> |
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| HEAD | `/rest/v1/gsc_daily_keywords` | select, workspace_id | <unavailable> |
| HEAD | `/rest/v1/gsc_daily_pages` | select, workspace_id | <unavailable> |
| GET | `/rest/v1/gsc_daily_totals` | limit, order, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/gsc_sync_state` | select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/keywords` | deleted_at, is_active, keyword_set_id, limit, offset, order | [ id, keyword, search_volume, keyword_difficulty ] |
| GET | `/rest/v1/plan_unit_limits` | plan_key, select | [ unit_key, monthly_limit ] |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| POST | `/rest/v1/rpc/get_geo_ws_mention_terms` |  | { our_terms, our_total, comp_terms, comp_total, our_unique, runs_total, both_unique, comp_unique } |
| POST | `/rest/v1/rpc/get_workspace_members` |  | [ user_id, email, full_name, role, allowed_sections, joined_at ] |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| GET | `/rest/v1/serp_snapshots` | captured_at, engine, keyword_id, keywords.deleted_at, limit, offset | [ keyword_id, captured_at, serp_analysis_json ] |
| GET | `/rest/v1/usage_reservations` | limit, order, select, status, workspace_id | [ id, unit_key, amount, status, idempotency_key, created_at ] |
| GET | `/rest/v1/workspace_api_keys` | order, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/workspace_events` | created_at, event_type, limit, order, select, workspace_id | [ id, event_type, metadata, created_at ] |
| GET | `/rest/v1/workspace_google_connections` | select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/workspace_invitations` | expires_at, order, select, status, workspace_id | ['<empty>'] |
| GET | `/rest/v1/workspace_tag_groups` | order, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/workspace_tags` | order, select, workspace_id | ['<empty>'] |
| GET | `/rest/v1/workspaces` | id, select | { strategy_map_status } |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (22): brand_reclassify_jobs, earned_cannibal_dismissals, earned_publications, ga4_page_stats, gsc_daily_keywords, gsc_daily_pages, gsc_daily_totals, gsc_sync_state, keywords, plan_templates, plan_unit_limits, serp_snapshots, usage_reservations, vw_gsc_connection_health, workspace_api_keys, workspace_events, workspace_google_connections, workspace_invitations, workspace_plans, workspace_tag_groups, workspace_tags, workspaces
- RPC (10): delete_gsc_property_stats, get_api_key_usage_stats, get_api_limit_status, get_workspace_members, remove_workspace_member, revoke_workspace_api_key, transfer_workspace_ownership, update_workspace_api_key_limits, update_workspace_api_limits, update_workspace_member
- Edge Functions (19): account-deletion-precheck, account-deletion-request, backfill-site-audit-sitemap-stats, billing-inquiry, ga4-list-properties, geo-backfill-mentions, google-oauth-init, gsc-list-properties, gsc-sync-enqueue, nicepay-cancel, nicepay-cancel-pending-change, nicepay-create-auth-order, nicepay-create-order, nicepay-get-order-meta, nicepay-retry-charge, nicepay-undo-cancel, seo-backfill-brand-presence, sync-ga4-data, workspace-invite

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: 해당 기능 문서 없음 (SUP).
