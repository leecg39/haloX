# 재구성 원장 (Reconstruction Ledger)

> 결론 먼저: **Phase 7 전체 스택 구현(S1~S8) 및 통합 검증이 완료**되어 필수 의무 9개가 모두 `verified`로 닫혔고(`required_open: 0`), 원본 서버 소스 비공개 항목 2개는 로컬 재정의(5요소 공식·결정적 Provider 목업) 바인딩과 함께 `out-of-scope`로 명시되어 전체 원장 상태가 **`ready`**에 도달했다.
>
> REA 원장: `docs/rea/evidence/p6-obligation-ledger.json` · evidence `ev_45bab20c744c4962…` · ledger `rol_9efbfb0c…` · closure digest `365b08f1…` · 검증 증거: `docs/rea/evidence/p7-verification-proof.json` (`ev_b3c4251c…`) · 재생성: `npm run verify:backend && python3 scripts/rea-build-ledger-input.py docs/rea/evidence /tmp/in.json && rea build-reconstruction-obligation-ledger /tmp/in.json`.

## 1. REA 의무 목록 (Phase 7 완료 상태)

| obligation_id | 대상 | REA 상태 | 소유 모듈 / 심볼 | 검증 결과 |
|---|---|---|---|---|
| halox.routing.app-shell | `/app` 46 라우트·인증 게이트 | **verified** | `src/components/ClonePage.tsx` (`ClonePage`) | 363 라우트 + `get_app_shell` 통합 검증 통과 |
| halox.api.postgrest-tables | 테이블 읽기 68종 | **verified** | `src/lib/backend/database.ts` (`HaloXDatabase.queryTable`) | 68종 GET/HEAD + `parseKeywordRow` 스키마 검증 통과 |
| halox.api.rpc | RPC 36종(런타임) | **verified** | `src/lib/backend/database.ts` (`HaloXDatabase.callRpc`) | 36종 RPC 응답 shape (`validateRpcResponse`) 통과 |
| halox.api.edge-functions | Edge 핵심 파이프라인 | **verified** | `src/lib/backend/database.ts` (`HaloXDatabase.invokeEdgeFunction`) | 6종 Edge 함수 + `rpc-cache` + 쿼터 한도 검증 통과 |
| halox.persistence.data-model | 핵심 엔티티·RLS | **verified** | `supabase/migrations/20261022000000_halox_schema.sql` (`public.workspaces`) | 27개 SQL 테이블 + 타 워크스페이스 RLS 차단 검증 통과 |
| halox.metrics.geo-score | GEO 4×0.25 | **verified** | `src/lib/metrics/index.ts` (`geoScore`) | 실측 60 및 경계값 단위 검증 통과 |
| halox.metrics.seo-score | SEO 0.4/0.3/0.3 | **verified** | `src/lib/metrics/index.ts` (`seoScore`) | 실측 3 및 순위 선형 보간 검증 통과 |
| halox.metrics.avi-composite | 종합 가중 4분기 | **verified** | `src/lib/metrics/index.ts` (`aviComposite`) | 실측 47 및 4분기 가중치 검증 통과 |
| halox.metrics.avi-server | 서버 AVI | **out-of-scope** | `src/lib/metrics/index.ts` (`serverAviFiveFactor`) | 문서 5요소 공식으로 로컬 구현 및 검증 (서버 원본 비공개) |
| halox.ui.design-tokens | 토큰·셸 | **verified** | `scripts/verify-visual-regression.mjs` (`verifyCssTokens`) | 65개 CSS 토큰 + 데스크톱/모바일 레이아웃 검증 통과 |
| halox.jobs.async-pipelines | 서버 파이프라인 | **out-of-scope** | `src/lib/backend/providers.ts` (`createDeterministicProviders`) | 결정적 Provider 목업 기반 E2E 파이프라인 검증 (서버 원본 비공개) |

요약(REA): total 11 · required 9 · **verified 9** · **required_open 0** · out-of-scope 2 · status **ready**.

## 2. 결론별 근거 원장

| 결론 | Evidence | 표기 | 신뢰도 |
|---|---|---|---|
| Vite + React 18.3.1 SPA, 소스맵 없음 | E1-1 | 관찰 | 높음 |
| Lovable 생성 앱 | E1-2, E1-3 | 관찰 | 높음 |
| Supabase BaaS 3면(PostgREST/RPC/Edge) + Auth + Storage | E1-4, E3-1 | 관찰 | 높음 |
| `/app` 46 라우트 트리, 17 목표 라우트 전부 존재 | E1-1 | 관찰 | 높음 |
| 테이블 164·RPC 139·Edge 131 (정적) | E1-4 | 관찰 | 높음 |
| 런타임 엔드포인트 105종 shape | E3-1, E3-2 | 관찰 | 높음 |
| 13 엔티티 중 10 답변·3 부분 | E5-1, E5-2, E3-2 | 관찰+추론 | 높음 |
| GEO/SEO/AVI 종합 공식 | E1-1(번들) + E4-1(실측 화면) | 관찰 | 높음(3중 일치) |
| 공개 문서 SEO 공식은 구현과 불일치 | S-1 vs 번들+실측 | 관찰 | 높음 |
| 순위점수 표·10위 도달 불가 특이점 | 번들 | 관찰(값)/추론(버그) | 높음/중간 |
| 쿼터 예약-확정 패턴 | 번들 `KeywordAddDialog` | 관찰 | 높음 |
| 디자인 토큰 65개·폰트·셸 치수 | E4-2, E4-1, 번들 | 관찰 | 높음 |
| 비동기 파이프라인 단계 | 번들 페이지 의존성 + E5-3 | 관찰-정적 + SUP | 중간 |
| 서버 AVI·RLS·cron·RPC SQL | — | 미확인 | — |

## 3. P6-3 검증 관문 — 핵심 질문 분류

| 핵심 질문 | 분류 | 답변 위치 | 부분/미해결 사유 (문서 명시) |
|---|---|---|---|
| 라우팅 | **답변됨** | `architecture.md` §1, `pages/*.md` | — (상세 :id 화면 UI는 U-5로 별도 명시) |
| API | **부분 답변됨** | `api-spec.md`, `openapi.yaml`(OpenAPI 3.0.3, redocly lint 오류 0) | 액션형 Edge 계약 미캡처(U-1), MCP 공개 API(U-6) |
| 데이터 모델 | **부분 답변됨** | `data-model.md` | RLS·트리거·enum·JSONB 내부(U-2, U-4), 관계 2건 미확인 |
| 디자인 | **답변됨** | `design-system.md` | — |
| 사용자 여정 | **부분 답변됨** | `user-journeys.md` | 쓰기 계약 정적만(U-1), 온보딩 UI(U-5) |
| (보너스) 메트릭 | **답변됨(클라이언트) / 미확인(서버 AVI)** | `architecture.md` §3, `findings.md` F5-2~F5-7 | U-2 |

관문 규칙("모든 핵심 질문이 답변됨/부분 답변됨/미해결로 분류되고 부분·미해결이 문서에 명시")을 충족한다. → **Phase 7 진입 조건 충족 (단, 사용자 별도 승인 필요)**.

## 4. 미해결 목록 (findings.md와 동기화)

U-1 액션형 Edge 계약 · U-2 서버 공식/RLS/cron/SQL · U-3 GEO 엔진별 실행 규칙 · U-4 알림 저장·enum · U-5 미수집 화면 UI · U-6 `halox-mcp` 스키마. 각 항목의 다음 증거는 `docs/rea/findings.md` "미해결 원장" 참조.
