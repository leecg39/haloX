# 재구성 원장 (Reconstruction Ledger)

> 결론 먼저: **핵심 질문 5개 영역 중 라우팅·디자인은 답변됨, API·데이터모델·여정은 부분 답변됨**이며 모든 부분/미해결 항목이 아래에 명시되어 있다 → **P6-3 검증 관문 통과, Phase 7 진입 가능**(단, Phase 7은 별도 승인).
>
> REA 원장: `docs/rea/evidence/p6-obligation-ledger.json` · evidence `ev_acf7404de421d92d…` · ledger `rol_8c51204a…` · closure digest `69e174d4…` · 재생성: `python3 scripts/rea-build-ledger-input.py docs/rea/evidence <out>` → `rea build-reconstruction-obligation-ledger <out>` (결정적 재현 확인됨).

비유: 이 원장은 "이사 전 짐 목록"입니다. 무엇을 옮겨야 하는지(의무), 그 물건이 실제로 있었다는 사진(Evidence ID), 아직 상자에 안 담긴 것(미충족)을 한 장에 적어 둡니다. 지금은 새 집(클론 코드)이 없으니 모든 상자가 "미포장" 상태인 게 정상입니다.

## 1. REA 의무 목록 (fail-closed 상태)

| obligation_id | 대상 | REA 상태 | 진단 | Phase 7에서 닫는 방법 |
|---|---|---|---|---|
| halox.routing.app-shell | `/app` 46 라우트·인증 게이트 | unowned | missing-owner, missing-original-case, static-only | 라우터 모듈 바인딩 + 라우트 존재 통합 테스트 |
| halox.api.postgrest-tables | 테이블 읽기 68종 | unowned | missing-owner, missing-original-case | 클론 스키마 + zod 파서 + 응답 shape 계약 테스트 |
| halox.api.rpc | RPC 36종(런타임) | unowned | + static-only | RPC 마이그레이션 + shape 테스트 |
| halox.api.edge-functions | Edge 131종 | unowned | + static-only | 핵심 5종만 재구성, 나머지 out-of-scope 처리 |
| halox.persistence.data-model | 13 엔티티 | unowned | missing-owner | 마이그레이션 + RLS 테스트 |
| halox.metrics.geo-score | GEO 4×0.25 | unowned | static-only | `packages/metrics` 단위 테스트(실측 60 재현) |
| halox.metrics.seo-score | SEO 0.4/0.3/0.3 | unowned | static-only | 단위 테스트(실측 3 재현) |
| halox.metrics.avi-composite | 종합 가중 4분기 | unowned | static-only | 단위 테스트(실측 47 재현) |
| halox.metrics.avi-server | 서버 AVI | **unknown** | unavailable-authority | 문서 5요소 공식으로 재정의 → out-of-scope(원본 동등성 불가) 표기 |
| halox.ui.design-tokens | 토큰·셸 | unowned | static-only | 스토리북/스냅샷 렌더 테스트 |
| halox.jobs.async-pipelines | 서버 파이프라인 | **unknown** | unavailable-authority | Provider 목업 기반 통합 테스트, 원본 동등성은 out-of-scope |

요약(REA): total 11 · required 11 · verified 0 · required_open 11 · unowned 9 · unknown 2.

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
