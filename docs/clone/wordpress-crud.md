# WordPress 연결·게시 이력

2026-10-23. `/app/exports`와 `/app/settings?tab=export`에 WordPress 연결 및 게시 이력을 추가했다. 파일·수동 번역 기능은 [내보내기 CRUD](export-crud.md)를 참조한다. 자동 번역은 아직 후속 작업이다.

## 사용자 흐름

1. `WordPress 연결`에서 이름·WordPress 설치 주소·사용자 이름·애플리케이션 비밀번호를 저장한다.
2. `연결 확인`이 서버에서 WordPress `users/me?context=edit`를 조회하고 글 작성 권한을 확인한다. 연결 실패 이유도 저장해 새로고침 후 보여 준다.
3. `게시 이력 → 외부 게시`에서 확인된 사이트와 제작소 원문 또는 검토한 번역문을 선택한다. 제목·본문·검색 설명·대상 사이트를 미리 본다.
4. 기본값은 비공개 초안이다. 공개 게시는 콘텐츠가 `사용 준비` 상태이고 WordPress 계정에 공개 게시 권한이 있어야 한다. 사용자가 전송 확인을 체크하고 실행한 경우에만 실제 API 요청을 보낸다.
5. 결과에는 WordPress 글 ID·주소·실제 원격 상태와 전송 당시 본문을 보관한다. 이력 메모 수정·삭제, 연결 수정·비밀번호 교체·삭제를 지원한다.

연결 관리 및 외부 작업은 워크스페이스 owner/admin만 허용한다. 일반 멤버도 해당 워크스페이스의 이력은 읽을 수 있다. 연결을 수정하면 확인 상태가 초기화된다. 비밀번호를 비워 두면 기존 값을 유지하지만 사이트/사용자 이름 변경 시에는 새 비밀번호가 필요하다.

## 자격증명과 네트워크

- 비밀번호는 `serverRecords.export_credentials`에 AES-256-GCM으로 암호화한다. 워크스페이스 ID와 연결 ID를 인증 부가 데이터로 묶어 다른 연결에 복사한 암호문은 해독되지 않는다. 공개 REST 테이블에는 비밀번호·암호문이 없고 `has_credentials`만 노출한다.
- 선택 환경변수 `HALOX_INTEGRATION_SECRET`(32자 이상 난수)을 사용한다. 없으면 `HALOX_SESSION_SECRET`에서 별도 용도의 HKDF 키를 파생한다. DB 백업과 키를 함께 보존한다. 암호화 키를 교체하면 저장한 비밀번호를 다시 입력해야 한다.
- 표준 포트의 공개 HTTPS 주소만 지원한다. URL 자격증명·내부 IP·사설 DNS 응답을 거절하며, DNS의 모든 응답을 검사한 뒤 연결 IP를 고정한다. TLS 인증서 검증을 유지하고 리디렉션을 따라가지 않는다.
- 요청/응답 최대 2MiB, 헤더 최대 16KiB, DNS를 포함한 요청 시간 최대 10초. 응답 원문이나 비밀값을 오류 메시지에 넣지 않는다.
- WordPress 글에는 이스케이프한 제목·본문·설명을 전송한다. 본문의 제목/줄을 HTML 제목/문단으로 표현하며 원문의 HTML은 실행하지 않는다. 완전한 Markdown 렌더러는 아니다.

## 원격 작업과 복구

`export_publications`에 `sending`을 먼저 커밋하고 SQLite 쓰기 잠금을 해제한 후 원격 요청을 수행한다. 원격 응답을 받은 뒤 별도 트랜잭션에서 결과를 저장한다. 따라서 외부 요청을 기다리는 동안 다른 쓰기가 가능하다.

- 동일 사용자/워크스페이스/요청 키의 재시도는 같은 이력을 반환한다. 요청 내용이 달라지면 거절한다. 이력 삭제 후에도 비공개 요청 키 기록은 워크스페이스 삭제 전까지 유지해 이전 키의 재전송을 막는다.
- 동일한 본문 버전과 연결의 진행 중/결과 불명/성공 이력이 있으면 다른 요청 키도 중복 전송을 막는다.
- 정상 응답은 `succeeded`, 명확한 4xx 거절은 `failed`, 시간 초과·5xx·리디렉션·읽을 수 없는 응답은 `unknown`이다. 원격 상태가 초안이면 공개 게시 요청이었어도 초안으로 표시한다.
- `원격 상태 확인`은 고유 slug로 WordPress 글을 **조회만** 한다. 재게시하지 않는다. 서버 중단으로 `sending`에 남은 항목도 30초 후 조회할 수 있다.
- 조회로 확인하지 못하면 1분 이후 관리자가 WordPress에서 직접 확인하고 `직접 확인 후 정리`를 실행할 수 있다. 이 경우 `unconfirmed`로 기록하며 게시 성공으로 표시하지 않는다. 다시 게시하면 중복될 수 있음을 화면에서 알린다.
- 미확정 작업이 있는 연결의 수정/삭제, 해당 워크스페이스 삭제를 차단한다. 이력·연결 삭제는 WordPress의 글을 삭제하지 않는다. 원문이나 번역문 삭제 시 전송 스냅샷을 유지한다.
- 요청 중 멤버십이 제거돼 결과 저장이 거절되면 이력을 미확정 상태로 유지한다. 현재 관리자가 원격 상태를 조회해 정리할 수 있다. 자동 작업 재시작은 하지 않는다.

## API

모든 명령은 `POST /api/v1/functions/:name`이며 workspace_id가 필수다.

| 명령 | 주요 입력 / 동작 |
|---|---|
| wordpress-create/update/delete | 연결 CRUD. 수정/삭제에는 destination_id, expected_revision |
| wordpress-verify | destination_id, expected_revision. 읽기 요청으로 권한 확인 |
| wordpress-publish | 확인된 destination_id/revision, job_id/content revision 또는 translation_id/revision, status=draft/publish, confirm=true, idempotency_key |
| wordpress-reconcile | publication_id, expected_revision. 고유 slug로 원격 결과 조회 |
| wordpress-resolve | publication_id, expected_revision, confirm_absent=true. 직접 확인했음을 명시하고 이력 정리 |
| wordpress-history-update/delete | publication_id, expected_revision. 메모 수정 / 로컬 이력 삭제 |

집계 `GET /api/v1/exports`에 `export_publications`, `can_manage_connections`가 추가됐다. 공개 REST의 게시 이력 쓰기, 다운로드 설정 명령을 통한 WordPress 변경을 차단한다.

## 검증과 운영 범위

최종 검사: 단위 **121/121**, E2E **41/41**, 백엔드 **22/22**, 프로덕션 빌드와 타입 검사 통과.

- `wordpress.test.ts`: 암호화·다른 연결/키로 복호화 차단·비밀번호 유지/교체, 멤버/우회 차단, URL/DNS/리디렉션·권한 검증, 게시 전 확인/공개 상태 검증, 중복 요청·재시작·쓰기 잠금 해제, 결과 불명 복구·직접 정리·연쇄 삭제 9개.
- `wordpress.spec.ts`: 실제 연결/자격증명/메모/이력 CRUD, 성공/오류/원격 조회/미리보기/회원 권한/모바일을 검증한다. WordPress 확인·전송·조회 클라이언트만 테스트 대역이며 동일 서버 서비스와 독립 SQLite 저장소를 사용한다.
- Ego Lite에서 연결 생성, 실제 `.invalid` DNS 실패 상태 저장, 빈 비밀번호 수정 창, 390px 화면을 확인했다. 확인용 워크스페이스는 삭제했다. [연결 화면](evidence/2026-10-23-wordpress-connection.png), [모바일](evidence/2026-10-23-wordpress-mobile.png).

사용자의 실제 WordPress 자격증명으로 연결하거나 외부 글을 게시한 결과는 아니다. 운영 사이트에서는 사용자가 연결 정보를 등록하고 확인한 뒤 명시적으로 실행한다. 사이트의 REST API/애플리케이션 비밀번호 지원이 필요하며 사이트 정책과 플러그인에 따라 연결이 거절될 수 있다.

구현 계약: [WordPress 애플리케이션 비밀번호](https://developer.wordpress.org/advanced-administration/security/application-passwords/), [REST Users](https://developer.wordpress.org/rest-api/reference/users/), [REST Posts](https://developer.wordpress.org/rest-api/reference/posts/).
