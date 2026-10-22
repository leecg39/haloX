# site-audit — `/app/site-audit`

> 메뉴 그룹: 전략 · 라우트 컴포넌트 청크: `SiteAuditPage` · 스크린샷: `docs/design-references/haloxlabs.ai/routes/site-audit.png`

## 목적

사이트를 크롤링해 건강도·AI 준비도 점수, 이슈, 페이지, AI 봇 접근성, 엔티티, 내부 링크를 진단한다.

## 화면 구성 [관찰 · SUP 스크레이프]

스크레이프 파일: `_app_site-audit.json`, `tab-site-audit-0.json`, `tab-site-audit-1.json`, `tab-site-audit-2.json`, `tab-site-audit-3.json`, `tab-site-audit-4.json`, `tab-site-audit-5.json`, `tab-site-audit-6.json`

- 탭: 개요, AI 봇 접근성, 이슈, 페이지, 엔티티, 내부 링크, 가이드
- 주요 액션 버튼: 현재 진단, 진단 기록, Raw, 새 진단, 개요, AI 봇 접근성, 이슈, 페이지, 엔티티, 내부 링크, 가이드, 봇 접근성 64, 구조화 데이터 100, 콘텐츠 품질 100, 신뢰도 시그널 100, 기술 건강도 100, 인용 가능성 100, 현재 ecommerce → CollectionPage · Product, 스키마 재분석, coverage definition, 전체 보기, 경고 미사용 JavaScript 코드가 있어요 1p, ✓ 깨진 링크 정상 →, ✓ 중복 콘텐츠 정상 →, ✓ 중복 태그 정상 →
- 테이블 컬럼: 타입 · 페이지, ORGANIZATION, WEBPAGE, BREADCRUMBLIST, COLLECTIONPAGE, ITEMLIST, 경로, 렌더링 케이스, AI 가시성, 서버 / 렌더 본문, 프레임워크, 페이지, 렌더링 · AI 가시성, Meta (T/D/S), 주소 길이, 주소 점검, 중복 주소, 제목, 제목 길이, 설명, 설명 길이, H1, H1 길이, H2, 스키마 종류, 캐노니컬, 색인 가능, 메타 로봇, 메타 키워드, OG 제목 / 이미지
- 입력/필터: URL·제목 검색, button

> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.

## 런타임 데이터 호출 [관찰 · REA E3-1]

공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.

| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |
|---|---|---|---|
| HEAD | `/rest/v1/geo_prompt_runs` | finished_at, prompt.prompt_set.workspace_id, prompt_id, select, status | <unavailable> |
| HEAD | `/rest/v1/geo_prompts` | is_active, prompt_set_id, select | <unavailable> |
| GET | `/rest/v1/keyword_sets` | order, select, workspace_id | [ id, workspace_id, name, description, is_active, target_domain, competitor_domains, language ] |
| GET | `/rest/v1/keywords` | deleted_at, is_active, keyword_set_id, limit, offset, order | [ id, keyword, search_volume, keyword_difficulty ] |
| HEAD | `/rest/v1/report_snapshots` | created_at, period_type, select, workspace_id | <unavailable> |
| POST | `/rest/v1/rpc/site_audit_links_summary` |  | { total, orphans, to_broken, top_linked, computed_at, to_redirect, broken_pages, orphan_count } |
| HEAD | `/rest/v1/serp_snapshots` | captured_at, select, serp_analysis_json, workspace_id | <unavailable> |
| HEAD | `/rest/v1/site_audit_issues` | scan_id, select | <unavailable> |
| GET | `/rest/v1/site_audit_issues` | limit, offset, order, scan_id, select | [ id, scan_id, page_id, page_url, issue_type, category, severity, layer ] |
| HEAD | `/rest/v1/site_audit_pages` | scan_id, select | <unavailable> |
| GET | `/rest/v1/site_audit_pages` | limit, offset, order, scan_id, select | [ url, lighthouse_data ] |
| GET | `/rest/v1/workspaces` | id, select | { strategy_map_status } |

## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]

- 테이블 (19): audit_batch_failures, geo_answers_raw, geo_citations, geo_fan_out_queries, geo_prompt_runs, geo_prompt_tag_assignments, geo_prompts, geo_run_metrics, keyword_sets, keywords, schema_coach_results, serp_snapshots, site_audit_issues, site_audit_links, site_audit_pages, site_audit_reanalyze_jobs, site_audit_scans, site_audit_scores, workspaces
- RPC (2): resume_site_audit_scan, site_audit_links_summary
- Edge Functions (9): schema-coach-suggest, site-audit-backfill-schema, site-audit-diagnose-page, site-audit-finish-crawl, site-audit-reanalyze, site-audit-recheck-url, site-audit-render-samples, site-audit-start, site-audit-worker

## 근거·신뢰도

- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).
- 화면 구성: [관찰] 중간 — 단일 스크레이프 시점.
- 데이터 계약: [관찰] 높음 — 정적+런타임 일치.
- 공개 문서: https://docs.haloxlabs.ai/ko/features/site-audit (SUP).
