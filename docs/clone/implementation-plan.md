# 원본 서비스 스택 구현 기록 및 전체 CRUD 후속 작업

> **현재 전체 CRUD 상태: 진행 중.** S1~S9의 아래 완료 기록은 수집 화면과 도메인 계약 검증 범위다. 메뉴별 영속 CRUD 완료 상태는 [full-crud-tasks.md](full-crud-tasks.md)가 기준이다. 2026-10-23 후속 구현으로 SQLite 영속 저장·SOLAPI 인증/가입·워크스페이스 CRUD를 추가했다. 설정/검증은 [auth-and-storage.md](auth-and-storage.md)를 참조한다.

> 상태: **완료 (2026-10-23)**. S1 메트릭 엔진(`src/lib/metrics/index.ts`), S2 Supabase SQL 마이그레이션(27개 테이블 + RLS + RPC, `supabase/migrations/20261022000000_halox_schema.sql`), S3~S7 Next.js 백엔드 런타임(`src/lib/backend/`, `src/app/api/v1/*`) 및 클라이언트 연동(`src/lib/api/`), S8 통합 검증(`scripts/verify-backend.mjs`)과 REA 원장 갱신(`verified: 9`, `required_open: 0`, `status: ready`)까지 모두 반영되었다.
> 입력: `architecture.md`, `api-spec.md`/`openapi.yaml`, `data-model.md`, `design-system.md`, `pages/*.md`, `user-journeys.md`, `reconstruction-ledger.md`.
> 비유: 설계도(스펙)는 완성됐고, 이 문서는 "어느 방부터 어떤 순서로 짓고, 각 방이 완성됐는지 무엇으로 검사할지"를 적은 시공 계획서입니다.

## 1. 스택 (구현 기준으로 확정, 2026-10-23)

처음 계획은 원본과 같은 Vite·Vitest·zod였지만, 실제 구현은 Next.js 기반으로 진행됐고 사용자 결정에 따라 이를 공식 스택으로 확정한다(Vite로 재구현하지 않음).

| 계층 | 확정 | 처음 계획 | 비고 |
|---|---|---|---|
| 프론트 | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui 패턴 | Vite + React 18 + React Router + TanStack Query | 수집 화면을 `html-react-parser`로 재생, 상호작용은 클라이언트 모듈 |
| API | Next.js Route Handlers `/api/v1/{auth,rest,rpc,functions}` + 메모리 DB 런타임(`src/lib/backend/database.ts`) | Supabase 직접 호출 | 원본의 PostgREST/RPC/Edge 경로 모양을 그대로 유지 |
| DB 스키마 | Supabase Postgres 마이그레이션(`supabase/migrations/`) + RLS | 동일 | 실제 Postgres 17로 검증(`npm run verify:sql`) |
| 인증 | HMAC-SHA256 서명 세션(쿠키 `halox_session` / Bearer), `.env.local`의 `HALOX_SESSION_SECRET`·`HALOX_DEMO_PASSWORD` | Supabase Auth | 클라이언트가 보낸 사용자 ID 헤더는 신뢰하지 않음 |
| 검증 | `node:test`(단위) + 수작성 검증기 `src/lib/api/schemas.ts` + Playwright(E2E, 설치된 Chrome) | Vitest + zod + Playwright | 의존성 최소화 |
| 외부 연동 | `Provider` 인터페이스 + 결정적 목업 | 동일 | 키·비용 없이 E2E 가능 |
| 브랜딩 | 자체 이름·로고·팔레트·문구 | 동일 | 컴플라이언스 원칙 |

## 2. 디렉터리 구조 (실제)

```
src/
  app/[[...slug]]/        수집 화면 재생 라우트
  app/api/v1/             auth · rest/[table] · rpc/[fn] · functions/[name]
  components/             ClonePage(셸·상호작용), DemoDialog, usage-live 등
  lib/api/                client.ts(대화상자→백엔드 연동), schemas.ts(계약 검증), route-auth.ts
  lib/backend/            database.ts(RLS·PostgREST·RPC·Edge 런타임), session.ts, quota-units.ts, providers.ts
  lib/metrics/            GEO·SEO·순위점수·AVI 종합·레벨 (순수 함수)
supabase/
  migrations/             스키마 + 보안 수정 + 쿼터 단위 + 원본 RPC 시그니처
  tests/                  security · quota-units · original-rpc-contract (*.test.sql)
e2e/                      auth · journeys · settings (*.spec.ts), global-setup.ts
scripts/                  verify-backend, verify-routes, verify-supabase-sql.sh, REA 스크립트
```

## 3. 단계별 실행과 완료 기준 (구현 도구 기준)

| 단계 | 범위 | 완료 기준(검증 명령) | 닫는 REA 의무 |
|---|---|---|---|
| S1 | 메트릭 엔진 | `npm run test:unit` 중 metrics — 실측 60·3·47 + 원본 번들 함수 오라클 비교 | metrics.geo-score, seo-score, avi-composite |
| S2 | DB 마이그레이션 + RLS + 시드 | `npm run verify:sql` — 임시 Postgres에 전체 적용, 테넌트 격리·쿼터·원본 RPC 계약 SQL 테스트 | persistence.data-model |
| S3 | 앱 셸·라우터·디자인 토큰 | `npm run build` exit 0 + `node scripts/verify-routes.mjs <base>` 화면 상태 전수 렌더 | routing.app-shell, ui.design-tokens |
| S4 | 읽기 계약(테이블·RPC) | `npm run verify:backend` — `schemas.ts` 성공/실패 케이스 | api.postgrest-tables, api.rpc |
| S5 | 쓰기 흐름(키워드·프롬프트·진단) | `npm run test:e2e` J1·J2·J3 | api.edge-functions(핵심 5) |
| S6 | 콘텐츠·리포트 | `npm run test:e2e` J4·J5 | jobs.async-pipelines(목업 기준) |
| S7 | 설정(멤버·사용량·API 키) + 인증 | `npm run test:e2e` J6(초대·실시간 사용량·API 키·격리) + auth 스펙 | — |
| S8 | REA 원장 재생성 | `rea build-reconstruction-obligation-ledger` → required_open 0 | 전체 |
| S9 (2차 확장) | 에이전트 채팅 SSE(`agent-chat`), 전략맵 클러스터링·키워드 확장(`strategy-map-*`, `ai-expand-keywords`), 콘텐츠 최적화 4단계(`optimize-*`), 다국어 번역 발행(`translate-content-v2`), GSC/GA4 동기화·KPI(`aiTrafficShare`, `searchContribution`, `isQuickWinKeyword`), NicePay 결제(`nicepay-*`), `halox-mcp` 공개 API 도구 | `npm run verify:backend` — 양/음성 케이스 및 교차 테넌트 RLS·API 키 폐기 검증 통과 | api.edge-functions, jobs.async-pipelines, metrics.avi-server |

1차 범위 밖이었던 결제(NicePay), GSC/GA4 동기화 및 KPI, 다국어 번역 발행(`translate-content-v2`), 에이전트 채팅 SSE(`agent-chat`), `halox-mcp`까지 S9(2차 확장)에서 결정적 로컬 백엔드 파이프라인으로 모두 구현·검증 완료했다.

## 4. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| 액션형 Edge 계약 미캡처(U-1) | 쓰기 API가 원본과 다를 수 있음 | 결과 테이블 shape를 계약으로 삼아 재정의, 필요 시 승인 하 HAR 추가 수집 |
| 서버 AVI 공식 미확인(U-2) | 프로 모드 AVI 값 불일치 | 문서 5요소 공식으로 구현하고 "원본 동등성 미보장" 표기 |
| 외부 API 비용 | 실연동 시 과금 | Provider 목업 기본, 실연동은 환경변수(`process.env`, 미설정 시 즉시 throw) |
| 범위 과대(테이블 164) | 일정 초과 | 핵심 19 테이블로 압축(`data-model.md` §4) |

## 5. 결정 기록

| 일자 | 결정 | 출처 |
|---|---|---|
| 2026-10-23 | Phase 7은 S1부터 단계적으로 진행 | 사용자 선택 "S1만 먼저 진행" |
| 2026-10-23 | Playwright E2E 추가, 쿼터 단위를 원본 이름으로 통일 | 사용자 선택 "둘 다 진행" |
| 2026-10-23 | 실제 인증 교체, SQL RPC 원본 시그니처, S7 나머지 E2E, 계획서를 현재 구현 기준으로 갱신 | 사용자 선택(4개 모두) |

## 6. 완료 기준 대비 실제 증거 (2026-10-23, 커밋 `493270a`)

> 아래 수치는 모두 커밋 `493270a`만 꺼낸 별도 worktree에서 다시 실행한 결과다(다른 세션의 미커밋 변경 제외).

| 단계 | 판정 | 증거 (명령 → 결과) |
|---|---|---|
| S1 | 충족 | `npm run test:unit` → 45/45 (metrics 17, quota 10, session 12, invite 6). metrics 커버리지 줄 100%·분기 95.77%·함수 100% |
| S2 | 충족 | `npm run verify:sql` → 마이그레이션 4 + 시드 적용, `security`·`quota-units`·`original-rpc-contract` 3/3 PASS, RLS 39/39 |
| S3 | 충족 | `next build` exit 0, `verify-routes` → 363 상태 렌더, failed 0·missing 0 |
| S4 | 충족 | `npm run verify:backend` → 22 checks 통과 (RPC 36종 응답 계약 + 실패 케이스) |
| S5 | 충족 | `npm run test:e2e` → J1·J2·J3 통과 |
| S6 | 충족 | J4·J5 통과 |
| S7 | 충족 | 멤버 초대·실시간 사용량·API 키·테넌트 격리 + 인증 6종(헤더 위장·위조 토큰·잘못된 비밀번호·사용자별 격리·로그인/로그아웃) → E2E 15/15 |
| S8 | 충족 | `p6-obligation-ledger.json` → status ready, verified 9, required_open 0 |
| 타입 | 충족 | `npx tsc --noEmit` exit 0 |

### 알려진 한계

1. ~~로그인 시도 횟수 제한 없음~~ → 해결(커밋 `5145396`): 로그인 실패는 클라이언트+이메일 5회·이메일 10회·클라이언트 20회/15분, 데이터 API는 사용자당 300회/분. 단일 프로세스 메모리 저장이라 다중 인스턴스 배포 시 공유 저장소(예: Redis)로 교체 필요.
2. 서버 재시작 시 초기화 문제는 SQLite 영속 저장으로 해결했다. 현재 파일에 전체 상태 스냅샷을 저장하며 Supabase 연결은 아직 구현하지 않았다. 대규모/분산 환경용 DB 전환은 후속 작업이다.
3. 수집 화면 재생 구조상, E2E로 확인하지 않은 다른 대화상자에도 제출 버튼이 비활성으로 고정된 경우가 남아 있을 수 있다.
4. 메모리 런타임의 `reserve_unit_with_bypass`는 객체를 돌려주고 쿼터 초과 시 오류를 던진다. 원본과 같은 결과 행 형식은 SQL 쪽에만 적용했다.
