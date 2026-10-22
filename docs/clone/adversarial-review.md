# 적대적 검토 결과

검토일: 2026-10-22. 범위: `page.md` 기반 HaloX 로컬 프런트엔드 클론과 콘텐츠 생성·검증 스크립트.

## 판정

- 스펙 준수: 통과. 필수 주소 322개가 manifest에 모두 포함되고, 추가 탭·메뉴를 포함한 363개 화면 상태가 프로덕션 서버에서 렌더링된다.
- 코드 품질: 수정 후 승인. 1차 검토에서 Important 4건을 발견해 수정했고, 재검토·빌드·브라우저 QA를 통과했다.
- 보안·공급망: `npm audit` 취약점 0건. 생성 콘텐츠에서 위험 프로토콜, inline event handler, 원격 미디어·스타일을 검사한다.
- 최종 판정: main 브랜치 푸시 가능.

변경량이 큰 생성형 클론이므로 Deep 수준으로 스펙, 실패 경로, 보안 경계, 재현성을 나누어 검토했다. 독립 Gemini 리뷰 도구는 현재 환경에 제공되지 않아 교차 모델 표결 대신 각 관점을 분리한 4회 자체 검토와 실제 브라우저 반례 검증을 수행했다.

## 발견 사항과 조치

| 심각도 | 발견 사항 | 영향 | 조치 | 재검증 |
|---|---|---|---|---|
| Important | 경로 검사가 기본 페이지 HTML만 검사 | 동적으로 주입되는 FAQ·메뉴·대화상자의 누락 자산과 외부 의존성을 놓침 | 동적 조각, CSS, manifest 중복·형식, 위험 URL까지 검사하도록 `verify-routes.mjs` 확장 | 외부 국기 URL 1건을 실제로 탐지한 뒤 로컬 치환, 최종 0건 |
| Important | 설정 localStorage JSON 파싱과 저장 오류 미처리 | 손상 값이나 저장 차단 시 전체 클릭 이벤트 초기화가 중단될 수 있음 | 읽기·쓰기 모두 예외 격리하고 사용자 상태 메시지 제공 | 의도적으로 깨진 JSON을 넣고 설정 탭 이동 성공 |
| Important | 일괄 추가 완료 이벤트가 첫 레코드만 전달 | 저장소에는 여러 건이 있으나 현재 표에는 첫 항목만 보임 | `DialogResult.records`와 다건 삽입 처리 추가 | 키워드 2건이 제출 직후 모두 표와 저장소에 표시 |
| Important | 자산 다운로드 스크립트의 초기 캡처 파일명이 실제 파일과 다름 | 재수집 시 시작 즉시 실패 | 존재하는 `home-initial.json` fallback과 HTTP 상태·시간 제한 추가 | 구문 검사와 입력·스타일 URL 존재 확인 |
| Minor | API 키 데모값을 레코드 생성 뒤에 추가 | 결과 응답에는 있으나 저장 레코드에는 누락 | ID를 먼저 만들고 키를 생성한 다음 레코드 구성 | TypeScript·빌드 통과 |
| Minor | 동적 라우팅 함수가 임의 문자열을 직접 받을 수 있음 | 향후 수집 데이터 오염 시 안전하지 않은 스킴 전달 가능 | 로컬·HaloX HTTP(S) URL만 내부 경로로 정규화 | 위험 URL 정적 검사 0건 |

## 재검토 증거

- `npm run typecheck`: 통과.
- `npm run build`: Next.js 프로덕션 빌드 통과.
- `npm run verify:routes`: 363/363 응답·렌더링 통과, 필수 322개 누락 0, 중복·잘못된 manifest 0, 누락 자산 0, 원격 리소스·스타일 0, 위험 URL 0.
- `npm audit --json`: Critical/High/Moderate/Low 모두 0.
- Ego Lite: 일괄 키워드 2건 즉시 표시·저장 확인 후 QA 데이터 삭제.
- Ego Lite: 손상된 설정 JSON 상태에서 결제 탭 이동 확인 후 QA 저장값 삭제.

## 남는 한계

실제 인증·결제·분석 백엔드는 1차 프런트엔드 클론 이후 2차(P1/P2) 및 3차 사이클에서 단계별로 확장·검증한다. Canvas 차트는 수집 시점 PNG이고, 원본 404 73개는 원본 상태대로 보존한다. 이 항목들은 결함 은폐가 아니라 [실행·구현 안내](README.md)에 명시된 제품 범위다.

---

## 2차 적대적 검토 (P1 매니페스트 Diff·시각 회귀 & P2 백엔드/DB S1–S8)

검토일: 2026-10-23. 범위: `scripts/diff-manifest.mjs`, `scripts/verify-visual-regression.mjs`, `src/lib/metrics/index.ts`, `src/lib/backend/database.ts`, `src/app/api/v1/rest/[table]/route.ts`, `src/lib/api/client.ts`.

### 발견 사항과 조치

| 심각도 | 발견 사항 | 영향 | 조치 | 재검증 |
|---|---|---|---|---|
| Important | PostgREST 테이블 엔드포인트에서 미등록 테이블명을 허용 | 임의 테이블명·`__proto__` 삽입 시 메모리 누적 및 프로토타입 오염 위험 | `UnknownTableError`(`404 TABLE_NOT_FOUND`) 및 `assertKnownTable` 화이트리스트 검증 추가 | `__proto__` 및 미존재 테이블 요청 시 404 거부 검증 통과 |
| Important | `workspace_api_keys` 조회·생성 시 `key_hash`가 클라이언트 응답에 노출 | `data-model.md` §3 보안 규칙(`key_hash` 클라이언트 노출 금지) 위반 | 서버 측 SHA-256 해시 저장 후 모든 클라이언트 응답(`queryTable`/`insertTable`/`updateTable`)에서 `key_hash` 제거 | `key_hash` 미포함 단언 및 `verifyWorkspaceApiKey` 검증 통과 |
| Important | PostgREST 라우트에 `PATCH`·`DELETE` 핸들러 및 `?select=` 컬럼 투영 미구현 | 행 수정·삭제 REST 호출 및 특정 컬럼 선택 쿼리가 전체 행만 반환 | `updateTable`·`deleteTable`(RLS 강제)과 `projectSelectColumns` 및 `PATCH`/`DELETE` 라우트 핸들러 구현 | `select=id,keyword`, 중첩 조인, 교차 테넌트 수정·삭제 차단 검증 통과 |
| Important | `syncDialogActionToBackend`에서 삭제(`deletedId`) 액션 미동기화 | 로컬 스토리지에서만 삭제되고 백엔드 DB에는 레코드가 남음 | `result.values.deletedId` 감지 시 라우트별 테이블에 `DELETE` 요청 전송 | `client.ts` 타입체크 및 빌드 통과 |
| Minor | `reserve_unit_with_bypass`에서 0·음수·비정수 예약 수량 허용 및 `released` 예약의 멱등성 충돌 | 잘못된 수량으로 한도 우회 가능, 취소된 예약 키 재시도 불가 | 양의 정수(`Number.isInteger(amount) && amount > 0`) 검증 및 활성 상태(`reserved`/`committed`)만 멱등 히트로 인정 | 0·음수 거부 및 `release_reservation` 후 동일 키 재예약 검증 통과 |

