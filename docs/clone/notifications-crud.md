# 알림 설정·알림함·SMTP/SOLAPI 전달 (S10)

2026-10-24 구현. `/app/settings?tab=notifications`의 준비 중 화면을 실제 사용자별 설정과 알림함으로 교체했다. 사용자가 선택한 기존 SMTP 이메일과 SOLAPI 문자만 사용한다. 기존 샘플 `workspace.settings.notifications` 값은 구독으로 전환하지 않으며 모든 채널은 기본 꺼짐이다.

## 화면과 모델

- 사용자·워크스페이스별 알림함/이메일/문자 수신 설정 생성·조회·수정·삭제. revision 충돌 시 입력을 유지한다. 설정 삭제는 버전 tombstone을 남겨 이전 저장 요청의 재생을 막는다.
- 유형: 감시 조건 충족, 실제 정상 범위 복구, 측정 자료 부족, 보고서 생성. 감시 규칙 전체/지정 선택. 설정을 켠 이후의 새 이벤트만 받는다.
- 알림함 읽음/읽지 않음, 개별 삭제. 보고서/감시 화면 링크, 읽지 않은 개수, 10개씩 페이지 이동.
- 외부 발송 대기·설정 대기·접수·전달 확인·실패·결과 불명·취소 이력, 대기 취소와 완료 이력 삭제. 확실히 접수 거절된 건만 24시간 내 최대 3회 수동 시도한다.
- `notification_preferences`, `notification_inbox`, `notification_deliveries`, `notification_email_checks`, `notification_email_verified`, `notification_email_attempts`는 SQLite 상태의 비공개 serverRecords이며 공개 REST/RPC 테이블이 아니다.
- 개인 설정은 뷰어도 변경할 수 있다. 해당 워크스페이스의 설정/모니터링 접근 권한과 감시 원본 지표의 분석/전략 권한은 조회·이벤트 생성·실제 발송 직전에 재검사한다. 다른 사용자의 설정이나 연락처는 반환하지 않는다.

## 실제 이벤트와 영속 작업

`monitor-service`의 상태 전이와 `report-service`의 실제 생성 트랜잭션 안에서 수신자별 알림·발송 요청을 함께 저장한다. 규칙 수정·비활성화에 따른 경보 종료는 정상 복구 메일로 발송하지 않는다. 보고서 생성 요청 재실행은 기존 receipt를 사용하므로 알림을 다시 만들지 않는다.

Node 서버 워커는 5초마다 한 건씩 처리한다. 요청 전에 영속 claim과 60초 lease를 저장하며, 제공사 호출 직전의 권한 확인과 호출·결과 저장은 설정 변경/삭제와 같은 SQLite writer lock 안에서 직렬화한다. 도중 서버 종료나 결과 저장 실패가 생기면 이후 `unknown`으로 기록하고 재발송하지 않는다. 이는 중복 방지를 우선하는 정책이며, 중단 시 발송되지 않은 알림도 자동 재시도하지 않을 수 있다.

- SMTP: Nodemailer 10.2.1, 465 포트 즉시 TLS / 그 외 포트 STARTTLS 필수, 인증서 검증 유지. 파일·URL 내용 읽기와 디버그 로깅 차단. 연결/DNS/인사/유휴 제한 각 5초. `Message-ID`를 저장하지만 SMTP의 중복 제거 기능으로 취급하지 않는다.
- SMTP 성공 표시는 **서버 접수**다. 최종 메일함 도착/반송을 확인하는 DSN·IMAP 수집은 제공하지 않는다.
- SOLAPI: HMAC-SHA256 인증, 고정 HTTPS 발송/그룹 조회 URL, 리다이렉트 금지, 8초 제한과 512KiB 응답 제한. 알림은 LMS로 발송한다. 접수 응답의 성공·실패 수를 검증하고, 30초 뒤부터 5분 간격으로 최대 24시간 그룹 전달 상태를 조회한다. OTP SMS 발송 코드는 변경하지 않았다.
- 서버 설정 누락은 `blocked`. 설정이 완료되면 대기를 처리하지만 24시간 지난 요청은 취소한다. 상태 조회 설정이 사라져도 24시간 후 조회를 끝내며 미확인 상태를 표시한다.
- 사용자·워크스페이스별 최근 24시간 외부 요청은 이메일/문자 합쳐 최대 100건. 초과 요청은 취소 이력에 사유를 남긴다. 삭제된 이력도 짧은 tombstone으로 이 한도에 포함한다.
- 알림과 이력은 최근 30일, 각 최대 500건을 보관한다. 아직 처리 중인 요청은 개수 정리에서 우선 보존한다. 원본 삭제/멤버 제거/권한 축소/휴대전화 변경은 다음 발송을 막는다. 계정 탈퇴 시 구독·연락처 인증·알림 자료를 지우고, 소유 워크스페이스 삭제에도 관련 자료를 정리한다. 계정을 복원해도 알림 구독과 이메일 인증은 다시 설정해야 한다. 이미 외부 제공사가 접수한 메시지는 회수하지 않는다.

## 이메일 인증과 서버 설정

계정의 이메일 주소는 가입 휴대전화 인증만으로 소유를 보장하지 않으므로 별도로 인증한다. 수신자가 임의 주소를 입력하는 API는 없다. 사용자가 인증번호 발송을 눌렀을 때만 계정 이메일로 8자리 코드를 보내며, 저장소에는 일회성 식별자와 해시만 저장한다. 유효기간 10분, 확인 최대 5회, 발송 1분 간격/계정·주소당 시간당 3회, 전체 시간당 100회 제한이다. 이메일 변경 시 기존 인증으로 수신할 수 없다.

다음 값을 서버 `.env.local` 또는 배포 환경변수에 직접 설정한다. 비밀값은 저장소에 커밋하지 않는다.

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
NOTIFICATION_EMAIL_FROM=HaloX <notifications@example.com>
SOLAPI_API_KEY=your-api-key
SOLAPI_API_SECRET=your-api-secret
SOLAPI_SENDER=your-registered-sender-number
```

SMTP 사용자/비밀번호 인증과 유효한 TLS 인증서를 지원하는 기존 서버를 사용한다. 다른 포트를 사용하는 서버도 STARTTLS를 지원해야 한다. 보낸 사람 주소는 해당 서버에서 발송 가능한 주소여야 한다. 서버 재시작 후 알림 화면에서 이메일을 인증하고 각 채널을 켠다. 문자 연락처는 내 프로필에서 인증한 번호를 사용한다. 워커를 끄는 개발/테스트 설정은 `HALOX_DISABLE_NOTIFICATION_WORKER=1`이다. 장기 실행 Node 프로세스와 영속 SQLite 볼륨이 필요하다.

API: `GET /api/v1/notifications?workspace_id=...`, `POST /api/v1/notifications`의 `preferences-save/delete`, `email-send/confirm`, `inbox-read/delete`, `delivery-cancel/delete/retry`. 로그인과 같은 사이트 Origin 검사를 적용하고 캐시하지 않는다.

## 검증

전용 단위 검사: 기본 수신 꺼짐, 영속 설정/버전 충돌/뷰어 개인 설정, 이메일 인증 해시/만료/시도 수/주소 변경, 실제 보고서/감시 상태 전이, 원본·권한·연락처 변경, 복수 워커 중복 방지, 중단 후 결과 불명, 실패 시도 제한, 발송 한도·보관 상한, SMTP TLS/접수/오류 분류, SOLAPI 서명/응답/전달 상태를 검증한다.

E2E: 설정→새로고침, 실제 보고서 알림→읽음→삭제, 문자 큐→테스트 제공사 접수→전달 확인→삭제, 취소, 버전 충돌 입력 보존, 뷰어 개인 설정, 외부 Origin 차단과 390px 화면 스크롤.

외부 SMTP/SOLAPI 실발송은 하지 않았다. API와 SMTP 전송 경계는 주입한 테스트 응답으로 검증했다. 사용자의 서버 자격 증명 설정 후 실환경 전달 확인은 별도로 필요하다.

구현 근거: [Nodemailer SMTP 설정](https://nodemailer.com/smtp), [SOLAPI 메시지 발송](https://solapi.com/developers/api/messages), [SOLAPI 그룹 조회](https://solapi.com/developers/api/msg-groups-getGroupInfo).

Ego Lite 실화면 증거: [데스크톱](evidence/2026-10-24-notifications-desktop.png), [모바일 설정](evidence/2026-10-24-notifications-mobile.png), [모바일 알림함·발송 이력](evidence/2026-10-24-notifications-delivery-mobile.png). 390×600에서 `scrollWidth=390`, 본문 `main.scrollTop=1101`과 전달 확인 표시를 확인했다. 초기 모바일 E2E가 스크롤하지 않는 내부 카드의 `scrollTop`을 검사한 문제는 실제 `main` 스크롤 컨테이너로 수정하고 데이터 렌더링과 스크롤 가능 높이를 기다린 뒤 휠 동작을 실행하도록 했다.

최종 검증: 알림 단위 14/14, 전체 단위 326/326, 백엔드 22/22, 타입 검사·프로덕션 빌드 통과. 경로 363개에서 누락·실패·중복·자산 누락 0개(원본 404 73개 별도). 마지막 전체 E2E는 107/108로 기존 Google 모바일 테스트의 렌더링 대기 문제 1건이 남았다. 해당 테스트에 데이터 표시·스크롤 가능 높이 대기를 추가한 뒤 알림·Google·WordPress E2E 8/8을 통과했다. 이 보완 후 전체 108개를 다시 실행했다고 주장하지 않는다. 중간 전체 실행의 WordPress 저장소 읽기 오류 1회는 다음 전체와 관련 재검사에서 재현되지 않았으며, 원인은 Q03 후속 진단에 남겼다.

[검증 결과 요약 JSON](evidence/2026-10-24-notifications-validation.json)
