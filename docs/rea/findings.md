# HaloX REA 증거 원장 (findings)

2026-10-22 후속 공개 사이트 분석과 현재 프로젝트 반영 결과는 [공개 사이트 REA 보고서](public-site/README.md)에 기록했다. 아래 Phase 6의 재구성 미존재 판정은 최초 분석 시점의 기록이며, 현재 로컬 프런트엔드 구현 상태를 뜻하지 않는다.

> 대상: `https://haloxlabs.ai/app` · 작성: 2026-10-22 · 방법론: REA CLI v6.1.0 (+ 보완 출처 명시)
> 결론 먼저: 원본은 **Lovable로 생성된 Vite + React 18 SPA + Supabase BaaS** 구조이며, 라우팅·데이터 계약·데이터 모델·디자인 토큰·점수 공식 3종은 **답변됨**, 서버 측 파이프라인과 액션 계약은 **부분 답변/미확인**으로 남는다.

## 표기 규칙 (P0-3)

| 표기 | 의미 | 허용 근거 |
|---|---|---|
| **[관찰]** observation | 캡처 산출물에 문자 그대로 존재 | REA Evidence ID 또는 보완 출처 파일 |
| **[추론]** inference | 관찰 조합으로 도출, 직접 확인 아님 | 근거 관찰 + 추론 논리 |
| **[미확인]** unknown | 증거 없음 / 서버 측이라 도달 불가 | 검색 경계 명시 |

신뢰도: 높음(독립 증거 2개 이상 일치) / 중간(단일 정적 증거) / 낮음(간접 단서).
출처: `REA` = REA Evidence 봉투(evidence_id 보유), `DER` = REA 산출물에서 스크립트로 파생(식별자만), `SUP` = 보완 출처(공개 문서·기존 스크레이프·번들 동봉 내부 문서).

## 증거 목록 (Evidence Registry)

| ID | 파일 (`docs/rea/evidence/`) | 출처 | evidence_id / 생성 방법 |
|---|---|---|---|
| E0-1 | `p0-cli-signatures.txt` | REA | `--help` 출력 (v6.1.0) |
| E0-2 | `p0-browser-targets.json` | REA | `ev_d2766a40c06a4b03…` list_browser_targets (격리 헤드리스 Chrome, CDP 9333) |
| E1-1 | `p1-web-bundle.json` | REA | `ev_a81541fdad6392c9…` analyze_web_bundle — 356 스크립트, 파싱 실패 0, AST 노드 2,377,643, routes 207·endpoints 1,147 원시 관찰 |
| E1-2 | `p1-inspect-web-page.json` | REA | `ev_bdde7cadf5a6c023…` inspect_web_page (스크립트 소스 미포함, 스토리지 키 이름만) |
| E1-3 | `p1-export-web-scripts.json` | REA | `ev_a546e25e2a0eda9c…` export_web_scripts — 원본 소스는 저장소 밖 스크래치패드에만 보관 |
| E1-4 | `p1-api-inventory.json` | DER | `scripts/rea-inventory.py` — 1,094 청크(캡처 354 + 공개 lazy 청크 740) 식별자 인벤토리 |
| E3-1 | `p3-network-capture.json` | REA | `ev_97890c9fc4b13b80…` inspect_web_network_capture — 정제 HAR 1,534 레코드 |
| E3-2 | `p3-api-shapes.json` | DER | 런타임 캡처에서 엔드포인트 105종 키·타입 shape (값·헤더·토큰 미기록) |
| E4-1 | `p4-screenshot-login.json` + `docs/design-references/haloxlabs.ai/routes/*.png` 18장 | REA + SUP | `ev_3db97694fa9c9a0a…` capture_web_screenshot (로그인 뷰포트) + 로그인 세션 라우트 스크린샷 |
| E4-2 | `p4-css-tokens.json` | DER | `index-BjzOpcfp.css` 431,073B sha256 기록, `:root` 토큰 65개 |
| E5-1 | `p5-table-columns.json` | DER | `scripts/rea-columns.py` — 테이블 164개 정적 컬럼 × 런타임 키 |
| E5-2 | `p5-bundled-erd-edges.json` | SUP | 공개 청크에 동봉된 내부 ERD v1.1(2026-02-23) 관계 22개만 추출 |
| E5-3 | `p5-bundled-edge-catalog.json` | SUP | 공개 청크에 동봉된 내부 Edge Function 카탈로그 v1.9(2026-03-15) 91행 |
| E6-1 | `p6-obligation-ledger.json` | REA | `ev_acf7404de421d92d…` build_reconstruction_obligation_ledger, ledger `rol_8c51204a…`, closure digest `69e174d4…` |
| S-1 | 스크래치패드 `docsite/llms-full.txt` (저장소 미포함) | SUP | `docs.haloxlabs.ai/llms-full.txt` 695,571B — 기능 19종·용어집 |
| S-2 | `docs/sources/*.json` 77개 (firecrawl 2개 포함) | SUP | 기존 UI 스크레이프 — `docs/page.md` 기준 사이드바 15 + 분석 탭 40 + 설정 12 + 추가 화면 |

### 수집 경계와 안전 조치

- 런타임 캡처(E3-1, E4-1 라우트 스크린샷)는 사용자의 Ego Lite 로그인 세션에서 **페이지 이동만** 수행(34개 URL). 클릭·입력·생성·실행·결제 액션 없음. 앱이 페이지 로드 시 스스로 보내는 호출(`rpc/record_auth_login`, `rpc/cancel_account_deletion`, `client_web_vitals` insert)은 그대로 발생함.
- 응답 본문은 키·타입 골격만 저장. 헤더·쿠키·JWT·사용자 데이터 UUID·이메일 미기록. 저장소 증거 14개 파일 패턴 검사 결과: 이메일 0건, JWT 형태 1건(PNG base64 내부 우연 일치 — 오탐), UUID 형태 10건(세션 스크래치패드 경로 9건 + 격리 헤드리스 프로필의 Amplitude device_id가 들어간 스토리지 키 이름 1건 — 사용자 계정과 무관, Evidence 무결성 유지를 위해 원본 그대로 둠).
- 번들 내 Supabase publishable key와 Firebase 웹 설정 값은 문서에 기록하지 않음.
- 라우트 스크린샷(PNG)에는 사용자 본인 Trial 워크스페이스 화면이 담겨 있으므로 외부 공유 금지.
- 경고: E1-3의 subject는 소스 포함 캡처(sha256 `bdc6dfb1…`)를 가리키며, 저장소의 `p1-inspect-web-page.json`(E1-2)은 소스를 뺀 재캡처본이다. 원본 캡처는 스크래치패드에만 있음.

---

## Phase 0 — CLI 검증

| # | 결론 | 표기 | 근거 | 신뢰도 |
|---|---|---|---|---|
| F0-1 | 계획 명령 4종(`analyze-web-bundle`, `inspect-web-network-capture`, `capture-web-screenshot`, `build-reconstruction-obligation-ledger`)은 v6.1.0에 존재 | 관찰 | E0-1 | 높음 |
| F0-2 | 스킬 문서의 `inspect-analysis-view`는 v6.1.0에 없음 → 대용량 결과는 `--format json` 리다이렉트 + 스크립트 요약으로 대체 | 관찰 | E0-1 | 높음 |
| F0-3 | Ego Lite(9222)는 표준 CDP HTTP(`/json/version` 404)를 제공하지 않아 REA 직접 연결 불가 → 격리 헤드리스 Chrome(9333)으로 정적 캡처, 로그인 화면은 ego-browser로 보완 | 관찰 | E0-2 | 높음 |
| F0-4 | `build-reconstruction-obligation-ledger` 입력 bundle은 정규형 필요: providers/environments/artifacts는 레코드에서 도출, captures는 비움 (`rea evidence-export`로 검증) | 관찰 | E6-1 | 높음 |

## Phase 1 — 정적 번들

| # | 결론 | 표기 | 근거 | 신뢰도 |
|---|---|---|---|---|
| F1-1 | 번들러 Vite, React 18.3.1, 소스맵 미배포 | 관찰 | E1-1 inferences·source_maps | 높음 |
| F1-2 | Lovable 생성 앱 (`__lovableEvents` SDK, `lovable.dev` 문자열) | 관찰 | E1-2 (`/__l5e/events`), E1-3 | 높음 |
| F1-3 | `/app` 라우트 46개(인증 10 + 보호 레이아웃 36), Tasks.md 17개 라우트 전부 존재 + 추가: discover, agent, reports, reports/monthly, keywords/:id, factory/:jobId, factory/compose/:id, optimize/:runId, personas/:id, knowledgehub/:id, geo/sets/:setId, geo/prompts/:promptId, site-audit/diff, site-audit/internal-links, feedback, referral, pricing, usage→settings | 관찰 | E1-1 메인 엔트리 라우트 트리 | 높음 |
| F1-4 | 단일 번들이 호스트로 분기(앱 호스트=`/app` 트리, 그 외=마케팅·`/admin/*`) | 관찰 | E1-1 | 높음 |
| F1-5 | 데이터: TanStack Query + supabase-js 직접 호출, 고유 queryKey 585종 | 관찰 | E1-4 | 높음 |
| F1-6 | UI: Tailwind + shadcn/ui(Radix, vaul, cmdk, sonner), lucide 아이콘, 차트 ECharts + Recharts | 관찰 | E1-4 라이브러리 시그니처 | 높음 |
| F1-7 | i18n은 자체 사전 함수(i18next 미사용) | 관찰 | 번들 문자열 | 중간 |
| F1-8 | API 면: `rest/v1`(테이블 164), `rest/v1/rpc`(139), `functions/v1`(131), Auth, Storage 버킷 4 | 관찰 | E1-4 | 높음 |
| F1-9 | Edge 래퍼: `Authorization: Bearer <JWT>` + `apikey`, 만료 30초 전 세션 갱신, 기본 타임아웃 60초 | 관찰 | 번들 `edge-function` 청크 | 높음 |
| F1-10 | 인증: Supabase(이메일/비번, Google, Kakao) + Firebase 휴대폰 인증 | 관찰 | 번들 | 높음 |
| F1-11 | 분석 도구: `~flock.js`(Parcel 번들, Tinybird 수집), `/__l5e/events`(Lovable), Amplitude, gtag | 관찰 | E1-2, E1-3 | 높음 |
| F1-12 | 스토리지 키: `workspace-mode:last`/`workspace-mode:{id}`(light/pro), `app-sidebar-open`, `kw.groupView.*`, `geo.sets.showEmpty`, `strategy-retry-ts` 등 | 관찰 | E1-4 | 높음 |

## Phase 2 — 보완 출처 통합 (SUP)

| # | 결론 | 표기 | 근거 | 신뢰도 |
|---|---|---|---|---|
| F2-1 | 공개 문서 기능 18종(ko/en) + 용어집 38종(ko, index 포함), Mintlify `llms-full.txt`로 일괄 수집 | 관찰 | S-1 | 높음 |
| F2-2 | 문서상 AVI 5요소(인용률 35/멘션 20/감성 15/커버리지 15/위치품질 15), 레벨 5단계(20 단위) | 관찰(문서) | S-1 | 문서 자체는 높음, 구현 일치는 F5-4 참조 |
| F2-3 | 문서상 SEO 점수 = 순위 40 + 브랜드 SOV 30 + AIO 커버리지 20 + 추세 10 | 관찰(문서) | S-1 | **구현과 불일치** (F5-2) |
| F2-4 | GA4/GSC KPI 정의: AI Traffic Share = AI 세션/오가닉 세션×100, Search Contribution = GSC 클릭/오가닉 세션×100, Quick Win = 5~15위·노출≥100·CTR<5% | 관찰(문서) | S-1 | 중간(구현 미대조) |
| F2-5 | 기존 스크레이프 77개 파일 → 17 라우트 매핑 완료, 미수집 화면: 온보딩·월간 리포트·discover·agent·상세(:id) 대부분 | 관찰 | S-2, `docs/clone/pages/*.md` | 높음 |

## Phase 3 — 런타임 API

| # | 결론 | 표기 | 근거 | 신뢰도 |
|---|---|---|---|---|
| F3-1 | 34개 URL 읽기 전용 이동에서 API 레코드 1,648건(OPTIONS 제외 1,534), 고유 엔드포인트 105종, 상태 200/201만 | 관찰 | E3-1, E3-2 | 높음 |
| F3-2 | 런타임 RPC 36종 요청·응답 shape 확보 (정적 139종 중) — 나머지는 액션 트리거 또는 미방문 화면 | 관찰 | E3-2 | 높음 |
| F3-3 | 모든 라우트에서 반복되는 앱 셸 호출 약 20종(플랜·쿼터·멤버·활동 스냅샷 등) | 관찰 | E3-2 | 높음 |
| F3-4 | 무거운 RPC는 `functions/v1/rpc-cache` `{rpc_name,args}` 경유, 실패 시 `error_fallback:true` → 클라이언트 직접 RPC | 관찰 | E3-2 + 번들 | 높음 |
| F3-5 | 실시간 구독(`.channel`) 미사용 → 진행 상태는 폴링/HEAD count | 관찰 | E1-4 (0건), E3-2 HEAD 다수 | 높음 |
| F3-6 | Edge Function 요청/응답 shape(액션형) | **미확인** | 읽기 전용 경계 | — 다음 증거: 액션 포함 HAR(쿼터 소모, 사용자 승인 필요) |

## Phase 4 — 화면·디자인

| # | 결론 | 표기 | 근거 | 신뢰도 |
|---|---|---|---|---|
| F4-1 | shadcn 토큰 65개, 다크 모드 없음, 사이드바 16rem/18rem/3rem, 브레이크포인트 7종(1380·1400 커스텀) | 관찰 | E4-2, 번들 상수 | 높음 |
| F4-2 | Pretendard(자체 호스팅 서브셋) + Geist Mono, clamp 유체 타입 스케일 | 관찰 | E4-2 | 높음 |
| F4-3 | 레이아웃 셸·KPI 카드·밑줄 탭·필터 툴바·정렬 테이블·FAB 패턴 | 관찰 | E4-1 스크린샷 | 높음 |

## Phase 5 — 데이터 모델·메트릭 삼각검증

| # | 결론 | 표기 | 근거 | 신뢰도 |
|---|---|---|---|---|
| F5-1 | Tasks.md 13개 엔티티 중 10개 답변됨, Brand·Export·Notification 3개 부분 답변 (`data-model.md` §3) | 관찰+추론 | E5-1, E5-2, E3-2 | 높음 |
| F5-2 | **SEO 점수 = 순위점수×0.4 + Top10비율×0.3 + AIO인용률×0.3** | 관찰 | 번들 상수 + 실측(대시보드 SEO 3 = 0×0.4+0×0.3+11×0.3=3.3→3) · 문서 공식은 2.2로 불일치 | 높음 |
| F5-3 | **GEO 점수 = 인용률·멘션율·인용순위·멘션순위 각 0.25** | 관찰 | 번들 상수 + 실측(10·30·100·100 → 60) + 화면 라벨 "25%" | 높음 |
| F5-4 | **대시보드 AVI 종합 = SEO×0.4 + GEO×0.3 + 웹 건강도×0.3** (데이터 유무별 4분기) | 관찰 | 번들 함수 + 실측(3·60·93 → 47.1→47) | 높음 |
| F5-5 | 순위점수 표 1~10위 `[100,85,70,55,45,37,30,24,19,15]` 선형 보간, ≥10위→10 (10위 값 15 도달 불가: 원본 버그 후보) | 관찰 | 번들 상수 | 높음(값), 버그 판단은 추론 |
| F5-6 | 라이트 모드 GEO 입력: 인용률=인용 프롬프트/전체 프롬프트, 멘션율=멘션 실행/전체 실행, 인용순위=위치품질 정규화 합/위치 있는 인용 실행 수, 멘션순위=0 | 관찰 | `AppOverview` 청크 + `get_light_dashboard_overview.avi_summary` shape | 높음 |
| F5-7 | 서버 AVI(`get_avi_overview`) 계산식 | **미확인** | 응답 키만 관찰. 문서 5요소 공식이 후보 | 낮음 |
| F5-8 | 내부 ERD 22엣지 중 20개 코드로 재확인, 2개(content_change_items, evidence_claims 관계) 미확인 | 관찰 | E5-2 × E5-1 스크립트 검증 | 높음 |
| F5-9 | 쿼터: `reserve_unit_with_bypass`(unit_key·amount·idempotency_key) → insert → `commit_reservation` / 실패 시 `release_reservation`, 한도 초과 코드 `QUOTA_EXCEEDED` | 관찰 | `KeywordAddDialog` 청크 | 높음 |

## Phase 6 — 재구성 원장

| # | 결론 | 표기 | 근거 |
|---|---|---|---|
| F6-1 | REA 원장: 의무 11개 모두 required_open (unowned 9, unknown 2) — 재구성 코드 미존재(Phase 7 전)로 **fail-closed가 정상** | 관찰 | E6-1 |
| F6-2 | unknown 2개는 서버 권한 부재(`halox.jobs.async-pipelines`, `halox.metrics.avi-server`) | 관찰 | E6-1 diagnostics `unavailable-authority` |
| F6-3 | 스크립트로 재실행 시 동일 evidence_id·closure digest 재현 (결정성 확인) | 관찰 | `scripts/rea-build-ledger-input.py` |

## 미해결 원장 (Open Unknowns)

| ID | 질문 | 심각도 | 필요한 다음 증거 |
|---|---|---|---|
| U-1 | 액션형 Edge Function 요청/응답 계약 (생성·실행·결제) | 높음 | 사용자 승인 하 액션 포함 HAR, 또는 클론에서 계약 재정의 |
| U-2 | 서버 AVI 공식, RPC SQL 본문, RLS·트리거·cron | 중간 | 서버 소스 접근 불가 → 클론에서 관찰 shape 기준 재설계 |
| U-3 | GEO 실행 엔진별 프롬프트·파싱 규칙 | 중간 | 서버 측 — 결과 테이블 shape로만 재현 |
| U-4 | 알림 설정 저장 위치, enum 값 전체 | 낮음 | 설정 변경 HAR |
| U-5 | 온보딩·월간 리포트·discover·agent·상세 화면 UI 구조 | 낮음 | 해당 화면 스크레이프 (`docs/sources/extract-ui.mjs` 재사용) |
| U-6 | `halox-mcp` 공개 API 도구 스키마 | 낮음 | API 키 발급 후 MCP `tools/list` (사용자 승인 필요) |

---

## 2026-10-25 재검증 부록 (배포 드리프트 검증)

> 본 절은 10-22 스냅샷 이후 원본 사이트가 재배포되어, 기존 분석·스펙의 유효 범위를 확인한 후속 검증 기록이다. 클론 스펙(`docs/clone/`)은 10-22 스냅샷 기준임이 이 확인으로 명시되었다.

### E-25 증거

| ID | 파일 | 출처 | 설명 |
|---|---|---|---|
| E25-1 | `docs/rea/bundle/` (gitignore, 약 19MB, 707 파일) | 웹 (curl) | 10-25 배포의 전 공개 청크 다운로드 — 진입 `index-Dkac1sNp.js`, CSS `index-DRXMNVP7.css`, chunk-list.txt 705항 |
| E25-2 | `docs/rea/evidence/static-bundle-analysis.json` (gitignore, 928MB) | REA | `rea analyze-javascript-application` 완전 Evidence (v6.1.0, 719단계 완료, `data/halox.sqlite` 세션 DB 동반) |

### 관찰 (F25 시리즈)

| # | 결론 | 표기 | 근거 |
|---|---|---|---|
| F25-1 | 10-22 → 10-25 사이 재배포 발생: deployment-id `psr2.479b4c08…` → `psr2.534e5cd0…`, 모든 청크 콘텐츠 해시 교체(의미론적 이름 126/126 페이지 청크 전부 존재 유지) | 관찰 | E25-1 vs E1-1 |
| F25-2 | 페이지 파생 식별자 안정: 테이블 131/131 · 엣지 함수 104/104 현재 번들에 존재 | 관찰 | E25-1 × E1-4 |
| F25-3 | **제거된 RPC 11종**: `get_fan_out_hub_data`, `get_geo_domain_citations`, `get_geo_product_{engines,metrics,prompts,trend}`, `get_geo_ws_mention_term_prompts` (GeoAnalysis·GeoInsights), `get_page_top_queries`, `get_pages_top_keywords` (MonitoringDashboard), `get_serp_matrix_data`, `get_serp_rank_trend` (SEOInsights) — 현재 번들 텍스트에 부재, 대체명 미발견 | 관찰 | E25-1 × E1-4 페이지별 비교 |
| F25-4 | **신규 엣지 함수 1종**: `run-classification-eval` (기존 카탈로그 E5-3·인벤토리 E1-4 부재 → AgentEval 관련 추가 추정) | 관찰+추론 | E25-1 × E5-3, E1-4 |
| F25-5 | `agent-chat`, `site-audit-og`, `get_matrix_cell_detail` 등 유사 신규 후보는 기존 증거에 존재 — 신규 아님 | 관찰 | E5-3, E1-4 |

### 클론 영향

- 4개 분석 화면(Geo 분석/인사이트, 모니터링, SEO 인사이트)의 데이터 계약이 원본에서 변경됨. 클론은 10-22 계약 기준으로 유효하며, 이후 원본 추적 시 `docs/clone/pages/{geo-analysis,geo-prompts,monitoring,seo-insights}.md`와 F25-3 목록을 대조할 것.
- 나머지 122개 페이지 청크와 131 테이블·104 엣지 식별자는 드리프트 없음 → 아키텍처·데이터 모델 스펙 영향 없음.
