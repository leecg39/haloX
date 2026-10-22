# 원본 서비스 전체 스택 확장안 (P7-1 — S1~S8 구현 및 검증 완료)

> 상태: **완료 (2026-10-23)**. S1 메트릭 엔진(`src/lib/metrics/index.ts`), S2 Supabase SQL 마이그레이션(27개 테이블 + RLS + RPC, `supabase/migrations/20261022000000_halox_schema.sql`), S3~S7 Next.js 백엔드 런타임(`src/lib/backend/`, `src/app/api/v1/*`) 및 클라이언트 연동(`src/lib/api/`), S8 통합 검증(`scripts/verify-backend.mjs`)과 REA 원장 갱신(`verified: 9`, `required_open: 0`, `status: ready`)까지 모두 반영되었다.
> 입력: `architecture.md`, `api-spec.md`/`openapi.yaml`, `data-model.md`, `design-system.md`, `pages/*.md`, `user-journeys.md`, `reconstruction-ledger.md`.
> 비유: 설계도(스펙)는 완성됐고, 이 문서는 "어느 방부터 어떤 순서로 짓고, 각 방이 완성됐는지 무엇으로 검사할지"를 적은 시공 계획서입니다.

## 1. 스택 확정안

| 계층 | 선택 | 근거 |
|---|---|---|
| 프론트 | Vite + React 18 + TypeScript + React Router + TanStack Query + Tailwind + shadcn/ui + Recharts | 원본 동일 구조(F1-1~F1-6) → 스펙 1:1 대응 |
| 백엔드 | Supabase (Postgres + RLS + RPC + Edge Functions, Deno) | 원본 계약 그대로 재현(F1-8) |
| 검증 | zod (입력·외부 응답), Vitest(단위), Playwright(E2E) | 사용자 규칙: 경계 검증·TDD 80%+ |
| 외부 연동 | `Provider` 인터페이스 + 결정적 목업 (SERP, LLM, Lighthouse) | 키/비용 없이 E2E 가능, 실제 연동은 후속 |
| 브랜딩 | 자체 이름·로고·팔레트·문구 | 컴플라이언스 원칙 |

## 2. 디렉터리 구조 (feature 단위, 파일 200–400줄 목표)

```
apps/web/src/
  app/            라우터·레이아웃 셸(사이드바, 상단바, 인증 게이트)
  features/       dashboard · keywords · seo-insights · geo-prompts · geo-analysis · gap
                  strategy-map · site-audit · factory · optimize · exports · monitoring
                  reports · personas · knowledgehub · raw-data · settings
  lib/api/        supabase 클라이언트, zod 스키마(openapi.yaml 파생), rpc/edge 래퍼
  components/ui/  shadcn 컴포넌트 + KpiCard, StatusBadge, DataTable
packages/metrics/ geoScore, seoScore, positionScore, aviComposite, level (순수 함수)
supabase/
  migrations/     19 테이블 + RLS + RPC
  functions/      keywords-collect, geo-run, site-audit, content-draft, report-snapshot, rpc-cache
```

## 3. 단계별 실행 (각 단계 = 테스트 RED → GREEN → 리팩터)

| 단계 | 범위 | 완료 증거(검증 명령) | 닫는 REA 의무 |
|---|---|---|---|
| S1 | `packages/metrics` — GEO/SEO/순위점수/종합/레벨 | `vitest run packages/metrics` — 실측 재현 케이스(60·3·47) + 경계값(순위 0, 1, 9.5, 10, 11, null) 포함 | metrics.geo-score, seo-score, avi-composite |
| S2 | DB 마이그레이션 + RLS + 시드 | `supabase db reset` 성공, RLS 테스트(타 워크스페이스 접근 거부) | persistence.data-model |
| S3 | 앱 셸·인증·라우터(17 라우트 + 상세) + 디자인 토큰 | `vitest` 라우트 렌더 테스트, `vite build` exit 0 | routing.app-shell, ui.design-tokens |
| S4 | 읽기 계약: 테이블·RPC (대시보드, 키워드, GEO, 진단 우선) | 계약 테스트: 응답을 zod 스키마로 파싱 성공/실패 케이스 | api.postgrest-tables, api.rpc |
| S5 | 쓰기 흐름: 키워드 추가(쿼터 예약-확정), 프롬프트 세트, 진단 시작 | Playwright J1·J2·J3 시나리오 통과 | api.edge-functions(핵심 5) |
| S6 | 콘텐츠 제작·내보내기·리포트 | Playwright J4·J5 통과 | jobs.async-pipelines(목업 기준) |
| S7 | 설정 12탭 중 워크스페이스·멤버·사용량·API 키 | Playwright J6 일부 | — |
| S8 | 원장 갱신: manifest bindings 채워 REA 원장 재생성 | `rea build-reconstruction-obligation-ledger` → required_open 감소 확인 | 전체 |

범위 밖(1차): 결제(NicePay), GSC/GA4 실연동, 다국어 번역 발행, 관리자(`/admin/*`), 마케팅 사이트, 에이전트 채팅 SSE(후순위).

## 4. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| 액션형 Edge 계약 미캡처(U-1) | 쓰기 API가 원본과 다를 수 있음 | 결과 테이블 shape를 계약으로 삼아 재정의, 필요 시 승인 하 HAR 추가 수집 |
| 서버 AVI 공식 미확인(U-2) | 프로 모드 AVI 값 불일치 | 문서 5요소 공식으로 구현하고 "원본 동등성 미보장" 표기 |
| 외부 API 비용 | 실연동 시 과금 | Provider 목업 기본, 실연동은 환경변수(`process.env`, 미설정 시 즉시 throw) |
| 범위 과대(테이블 164) | 일정 초과 | 핵심 19 테이블로 압축(`data-model.md` §4) |

## 5. 승인 요청 사항

1. 위 스택·범위(S1–S8, 1차 범위 밖 목록)로 진행해도 되는지.
2. 클론 자체 브랜드명.
3. U-1 해소를 위한 액션 포함 HAR 추가 수집 여부(쿼터 소모 발생).
