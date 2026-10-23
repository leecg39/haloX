# Google 연동·수집 구현 및 검증

2026-10-24. S09 `/app/settings?tab=integrations`를 현재 선택한 워크스페이스의 서버 저장 화면으로 전환했다. OpenAI 번역과 SOLAPI는 기존 구현을 유지하며, 이번 Google 연동과 별개의 환경변수를 사용한다. 전체 메뉴의 남은 작업은 [작업표](full-crud-tasks.md)를 따른다.

## 화면과 저장 모델

- Google 계정 연결, 상태 조회, 연결 이름·Search Console 사이트·GA4 속성 변경, 일일 자동 동기화 설정, 연결 시도 취소·해제.
- 접근 가능한 사이트·속성을 서버에서 조회하고 관리자가 선택한다. 사이트·속성 전체 목록은 비공개 저장소에 보관하며 관리 권한이 있는 사용자에게만 반환한다. 다른 멤버에게는 선택한 수집 대상만 보여 준다.
- 수동 동기화는 오늘 이전 최대 31일이다. 자동 동기화는 명시적으로 켠 경우 하루마다 2일 전까지 최근 7일을 수집한다. 서버 프로세스가 실행 중이어야 한다.
- 실행 대기·진행·완료·실패·취소, 기간·행 수·수집 근거 조회, 완료 이력의 메모 수정·삭제. 화면에는 최근 50개 실행을 표시한다.
- 설정·메모의 버전 충돌과 실패 입력을 보존한다. 소유자·관리자 역할 및 `other`·`analysis` 쓰기 권한이 모두 있어야 연결·수집·해제할 수 있다.

공개 모델은 `workspace_google_connections`, `google_sync_jobs`, `gsc_daily_totals`, `gsc_daily_keywords`, `gsc_daily_pages`, `ga4_page_stats`다. 비공개 모델은 `google_credentials`, `google_resources`, `google_oauth_states`, `google_sync_work`, `google_sync_requests`다. 토큰은 AES-256-GCM으로 암호화하며 워크스페이스·연결 ID를 인증 데이터로 묶는다. 모든 Google 테이블의 공개 REST 쓰기를 막고 기존 `gsc-sync-enqueue`·`sync-ga4-data`의 예시 수치 생성 경로도 거절한다.

## OAuth와 환경변수

Google Cloud의 웹 애플리케이션 OAuth 클라이언트에서 Search Console API, Google Analytics Admin API, Google Analytics Data API를 활성화한다. 리디렉션 URI는 실제 배포 주소의 `/api/v1/google/callback`과 정확히 일치해야 한다. HTTPS를 사용하며 로컬 검증용 localhost·127.0.0.1만 HTTP를 허용한다. Google 동의 화면의 사용자 범위·게시/검증 상태도 실제 운영 계정에 맞게 설정해야 한다. [Google 웹 서버 OAuth 문서](https://developers.google.com/identity/protocols/oauth2/web-server)

`.env.local` 또는 배포 서버 환경변수:

```dotenv
GOOGLE_CLIENT_ID=직접_설정
GOOGLE_CLIENT_SECRET=직접_설정
GOOGLE_REDIRECT_URI=https://서비스주소/api/v1/google/callback
HALOX_INTEGRATION_SECRET=32자_이상의_고정_비밀값
```

`HALOX_INTEGRATION_SECRET`이 없으면 기존 `HALOX_SESSION_SECRET`을 사용한다. 암호화 키 변경은 저장된 연결 토큰에 영향을 주므로 운영 중 임의 교체하지 않는다. `HALOX_DISABLE_GOOGLE_WORKER=1`은 격리 검증용이다. 설정 누락 시 연결 가능·수집 성공으로 표시하지 않는다. Google 변수는 클라이언트 번들로 내보내지 않는다.

OAuth state는 32바이트 난수의 해시로 저장하며 사용자·현재 로그인 세션·워크스페이스·연결 버전과 묶고 10분 뒤 만료한다. 코드 교환 전에 한 번만 소비한다. 콜백에서는 세션·관리자 권한과 연결 버전을 다시 검사한다. 동의 거절, 일부 읽기 권한 거절, 로그아웃, 연결 취소, 워크스페이스 삭제 뒤 도착한 응답으로 연결을 되살릴 수 없다. 액세스 토큰이 만료되면 리프레시 토큰으로 갱신하며, 갱신 저장 직전에도 연결 상태를 확인한다. 콜백 리디렉션은 서버 설정 주소로 고정하고 URL의 code/state를 다음 화면으로 전달하지 않는다.

## 실제 수집과 데이터 범위

Search Console에서 날짜별 합계, 날짜·검색어, 날짜·페이지를 수집한다. `web`, `dataState=final`이며 날짜는 미국 태평양 시간 기준이다. API는 상위 행을 제공하므로 검색어 행의 합계가 전체 합계와 같다고 보장하지 않는다. CTR은 기존 앱의 백분율 단위로 변환한다. [사이트 목록](https://developers.google.com/webmaster-tools/v1/sites/list), [Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)

GA4는 날짜·방문 시작 페이지(쿼리 포함)·세션 출처·기본 채널 그룹에 대한 세션과 주요 이벤트 수를 수집한다. 세션을 모든 방문 페이지에 중복 배분하지 않는다. `organic_sessions`는 Organic Search 채널이며, `ai_sessions`는 명시한 ChatGPT·Perplexity·Claude·Gemini·Copilot 도메인의 출처 규칙이다. 누락된 리퍼러나 모든 AI 서비스를 측정한다는 뜻은 아니다. 기존 `conversions` 필드에는 `keyEvents` 값을 저장한다. 속성 시간대, 임계 처리·표본 관련 응답 메타데이터를 이력과 원본에 보존한다. [속성 목록](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list), [runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport), [차원·측정항목](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)

페이지당 1,000행, 표별 최대 20,000행이다. 결과 크기·타임아웃·반복 중단·중복 행·한도 초과 시 실패로 기록하고 이전 자료를 유지한다. 정상적인 빈 결과는 해당 연결·기간의 기존 값을 비운다. 기존 데모 또는 가져오기 자료는 실제 Google 자료로 바꾸어 표시하지 않는다.

모든 외부 요청은 고정 Google HTTPS 호스트로만 전송하고 리디렉션을 따라가지 않는다. 사이트 URL을 외부 요청 목적지로 사용하지 않으며 Search Console 리소스 경로로 인코딩한다. 요청 시간은 15초, 응답은 최대 4MB로 제한한다. Google의 원문 오류·토큰을 사용자 오류나 로그에 복사하지 않는다.

## 큐, 갱신과 삭제

실행 요청·중복 요청 키·페이지 진행·임시 결과를 SQLite에 저장한다. 페이지 점유는 45초이며 복수 작업자가 같은 페이지를 동시에 커밋하지 못하도록 점유 토큰을 확인한다. 서버 중단 후 마지막 저장 페이지부터 재개하며, 반복 중단은 3회에서 실패로 정리한다. 외부 요청은 DB 쓰기 잠금 밖에서 수행한다.

네 표 수집이 모두 끝났을 때 한 트랜잭션에서 해당 연결·기간의 측정값을 교체한다. 재수집해도 같은 기간이 중복 누적되지 않는다. 취소·설정 변경·관리자 권한 철회·연결 해제 뒤 도착한 페이지는 반영하지 않는다. 이력을 삭제해도 요청 키의 처리 기록을 남겨 오래된 요청이 다시 실행되지 않게 한다.

대상을 변경하면 명시적 확인을 거쳐 해당 연결의 이전 측정값을 삭제한다. 연결 해제는 로컬 토큰·접근 가능 목록·진행 작업·수집 측정값을 삭제하고 실행 이력을 남긴다. **Google 계정 자체에 부여된 앱 권한을 원격 폐기하는 기능은 아니다.** 화면에서 Google 계정의 앱 권한 관리로 이동할 수 있다. 원격 Google 데이터는 변경하지 않는다.

계정 탈퇴 시 소유 워크스페이스 또는 본인이 연결한 Google 토큰과 비공개 속성 목록을 삭제하고 연결·예약을 중지한다. 공유 워크스페이스의 업무 자료는 유지한다. 워크스페이스 삭제 시 관련 공개·비공개 자료를 정리한다. 복원 뒤 토큰과 예약이 자동으로 되살아나지 않는다.

수집 자료는 Raw 데이터의 모니터링 원본과 기존 Google 조회 RPC에서 읽는다. 고정 Google KPI·검색어 예시 값을 제거했고 실제 합계·노출 가중 순위·날짜별/페이지별 GA4 합계를 계산한다. 자료가 없으면 CTR·평균 순위는 미측정으로 반환한다. 전략맵·사이트 진단에 새로운 자동 의사결정 기능을 추가한 것은 아니다.

## 검증 기록

외부 Google OAuth·리포트·SOLAPI·OpenAI 실호출은 하지 않았다. OAuth 코드 교환과 리포트 전송은 주입한 테스트 Provider를 사용했다. 실제 계정 동의·속성 접근은 운영 OAuth 설정 후 별도 확인이 필요하다.

- 단위: OAuth 세션/만료/재사용/부분 동의, 암호화·비공개 목록, REST 우회, 권한 철회, 갱신/취소 경합, 페이지 중단·재개·원자적 반영·중복 방지, 자동 실행 점유, 삭제/탈퇴 정리, 실제 RPC 집계.
- E2E: 설정 저장→다른 세션 조회→큐 생성→동기화 반영→메모 수정/삭제→연결 해제, 충돌 입력 보존, 취소, 설정 누락·읽기 전용 권한·모바일.
- Ego Lite, 별도 SQLite: 설정 수정/새로고침, 수동 큐/테스트 Provider 반영, 실행 메모 저장/재조회. 모바일 390×600에서 `scrollWidth=390`, 스크롤 1205px 확인. TaskSpace 58은 종료했다. QA 저장소는 실제 개발 DB와 분리했다.
- 증거: [데스크톱](evidence/2026-10-24-google-integrations-desktop.png), [모바일 연동](evidence/2026-10-24-google-integrations-mobile.png), [모바일 이력](evidence/2026-10-24-google-sync-history-mobile.png). 화면의 Google 계정과 리포트는 검증용 fixture다.

최종 검사: 단위 312/312, 전체 E2E 105/105, 백엔드 22/22, 타입 검사·프로덕션 빌드 통과. 경로 363개의 누락·실패·중복·자산 누락은 0개다. 초기 전체 E2E의 Raw/WordPress 3건은 공유 테스트 계정의 요청 한도로 실패했다. 운영 한도를 낮추거나 우회하지 않고 각 시나리오의 계정을 분리한 뒤 전체 재실행에서 통과했다. 전체 상태는 [작업표](full-crud-tasks.md)에 기록했다.
