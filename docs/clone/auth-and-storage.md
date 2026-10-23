# 로그인·SOLAPI 문자 인증·로컬 저장소

## 실행 설정

Node.js **22.13 이상**을 사용한다(현재 검증 버전 22.23.1). `.env.example`을 참고해 `.env.local`에 설정하고 서버를 재시작한다. `.env.local`과 `data/`는 Git 제외 대상이다.

| 환경변수 | 용도 |
|---|---|
| `HALOX_SESSION_SECRET` | 최소 32자 난수. 로그인 서명 및 휴대폰 인증 정보 HMAC |
| `HALOX_DEMO_PASSWORD` | 로컬 시드 계정 `admin@halox.local`, `demo@halox.local`, `other@halox.local` 로그인 비밀번호 |
| `SOLAPI_API_KEY` | SOLAPI API Key |
| `SOLAPI_API_SECRET` | SOLAPI API Secret. 브라우저로 전달하지 않음 |
| `SOLAPI_SENDER` | SOLAPI에 사전 등록한 발신번호 |
| `HALOX_DATABASE_PATH` | 선택. 기본값 `<프로젝트>/data/halox.sqlite` |
| `HALOX_TRUST_PROXY` | 신뢰하는 프록시가 X-Forwarded-For를 덮어쓸 때만 `1`. 미설정 시 SMS/가입의 클라이언트 발송 제한은 공유 |

관리자는 `/app/login`에서 로그인한다. `admin@halox.local`은 기본 워크스페이스의 **admin** 역할이며 플랫폼 전체 데이터를 우회 조회하는 계정이 아니다. 기본 워크스페이스의 소유자는 `demo@halox.local`이다. 신규 가입 계정은 개인 비밀번호를 사용하고 자동 생성한 자신의 워크스페이스만 볼 수 있다.

## 문자 인증 흐름

1. `/api/v1/auth/phone`에 `{ action: "send", phone }`을 POST한다. 국내 010 번호와 +82 형식을 지원한다.
2. 서버에서 암호학적 난수로 6자리 코드를 만들고 HMAC 해시 및 발송 예약을 저장한다. SOLAPI의 접수 성공을 확인한 후에만 challenge ID와 만료 시각을 반환한다. 코드·비밀키·제공자 원본 응답은 반환하지 않는다.
3. 같은 API에 `{ action: "verify", phone, challengeId, code }`를 보내면 서버가 검증한다. 성공 시 전화번호에 묶인 10분 유효 단회 증표를 반환한다.
4. `/api/v1/auth/signup`이 증표 소비·계정·scrypt 비밀번호 해시·워크스페이스·소유자 멤버십을 한 트랜잭션으로 저장한다. 중복 이메일/전화번호 등 실패 시 전체를 롤백한다. 가입 후 로그인 페이지로 이동한다.

제한: 코드 5분, 오입력 5회, 재발송 60초, 전화번호당 시간당 5회, 클라이언트당 시간당 20회, 전체 시간당 100회. 발송 실패/타임아웃도 예약을 유지하여 불확실한 결과를 자동 재발송하지 않는다. 새 코드가 접수되면 이전 코드는 무효다. 번호 변경 시 화면의 인증 상태를 지운다.

SOLAPI 설정이 없으면 HTTP 503 `SMS_NOT_CONFIGURED`, 접수 실패/타임아웃은 HTTP 502 `SMS_SEND_FAILED`다. 접수 성공은 단말 수신 확인을 의미하지 않는다. **실제 발송은 API Key/Secret·등록 발신번호와 사용자가 지정한 수신번호로 별도 확인해야 한다. 자동 테스트는 실제 문자를 보내지 않는다.**

구현 근거: [SOLAPI HMAC 인증](https://solapi.com/developers/api/authentication-api-key), [메시지 발송 API](https://solapi.com/developers/api/messages). `POST /messages/v4/send-many/detail`의 `failedMessageList`와 `groupInfo.count.registeredSuccess/registeredFailed`를 확인한다.

## 저장 및 운영 범위

REST/RPC/함수/인증은 동일 SQLite 파일의 최신 상태를 사용한다. 기존 메모리 엔진은 요청별 작업 엔진으로 남아 있지만 상태는 WAL 파일에 저장한다. 비동기 작업도 작성 잠금 아래에서 최신 상태를 읽고 원자적으로 커밋하며 실패하면 롤백한다. 읽기는 마지막 커밋 상태를 반환한다. 잠금 대기는 이벤트 루프를 막지 않는다.

초기 시드는 빈 DB에서만 저장한다. 재시작 시 삭제된 레코드를 다시 만들지 않는다. 파일이 손상되면 503 오류를 내며 조용히 초기화하지 않는다. 파일 접근권한은 0600, 생성 디렉터리는 0700이다. 백업은 서버를 정상 종료한 다음 SQLite 파일과 존재하는 WAL/SHM을 함께 보존하거나 SQLite 백업 기능을 사용한다. 데이터 파일을 삭제하는 것은 초기화이므로 정상 운영 절차가 아니다.

전체 스냅샷을 저장하는 로컬 구현이므로 대규모 데이터·분산 배포에는 적합하지 않다. 서버리스 임시 파일시스템에는 배포하지 말고 영속 디스크를 사용한다. 기존 Supabase 마이그레이션과 이 런타임은 자동 동기화되지 않는다. 외부 분석/콘텐츠/결제 Provider는 아직 결정적 데모 구현이다. 전체 메뉴 진행 상태는 [작업표](full-crud-tasks.md)를 참조한다.

## 검증

2026-10-23 사이트 진단 반영 후 실행: 단위 **138/138**, E2E **47/47**, 백엔드 검사 **22/22**, Next.js 빌드 및 타입 검사 통과. E2E의 SMS 전송은 fixture이며 실제 인증 검증·가입·개인 비밀번호 로그인·워크스페이스/키워드/프롬프트/페르소나/자료/콘텐츠/최적화/내보내기/번역문/사이트 진단 CRUD·버전 관리·파일 저장과 예약 실행은 HTTP API 및 독립 SQLite DB를 사용한다. 실발송 성공을 의미하지 않는다. WordPress/DeepL 원격 요청도 테스트 대역으로 검증하며 실 사이트 게시·유료 번역 성공을 의미하지 않는다. 사이트 진단은 자동 검사에서는 공개 응답 fixture를 사용하고, Ego Lite에서 별도로 실제 공개 HTML 수집과 서버 재시작 후 재개를 확인했다. [진단 검증](site-audit-crud.md).

- `npm run test:unit`: 저장소 프로세스 재시작·롤백·동시성·격리, SOLAPI 요청 서명/응답 실패, OTP 만료/시도 제한/재사용, 가입/개인 비밀번호, REST 권한.
- `npm run build`, `npm run typecheck`: 빌드 및 타입 검사.
- `npm run test:e2e`: 기존 로그인/업무 흐름과 신규 회원가입·비밀번호 표시·문자 오류·워크스페이스 CRUD/저장 실패. 실행마다 독립 DB 생성 및 정리.
- `npm run verify:backend`: 기존 도메인 계약 22개 검사. 이 결과만으로 모든 메뉴 CRUD 완료를 주장하지 않는다.
- Ego Lite 화면 확인: [문자 설정 누락 안내](evidence/2026-10-23-signup-sms.png).
