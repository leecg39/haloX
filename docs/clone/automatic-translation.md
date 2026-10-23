# OpenAI 자동 번역과 실행 이력

2026-10-23. 사용자의 서비스 선택에 따라 P11 `/app/exports`의 자동 번역을 OpenAI로 변경했다. 제목·본문·검색 메타 정보를 번역하여 원문 버전과 연결된 `article_translations`에 저장한다. 번역문 편집·검토·삭제와 실행 이력 관리가 가능하며 **사용 준비로 변경한 결과만 파일 생성과 WordPress 게시에 사용**한다. 전체 메뉴 진행 상태는 [작업표](full-crud-tasks.md)를 따른다.

## 설정과 사용

사용자가 서버 `.env.local` 또는 배포 환경에 `OPENAI_API_KEY`를 설정하고 서버를 재시작한다. 기본 모델은 `gpt-4.1-mini`이며 `OPENAI_TRANSLATION_MODEL`로 변경할 수 있다. 변경할 모델은 Responses API와 strict JSON Schema 출력을 지원해야 한다. 키는 서버에서만 읽고 조회 API는 설정 여부만 반환한다. 키가 없거나 설정 형식이 잘못되면 실행 이력/사용량을 만들기 전에 HTTP 503 `TRANSLATION_NOT_CONFIGURED`로 거절한다. 설정 여부 검사는 계정의 모델 접근 권한·잔액을 원격 검증하는 기능이 아니다.

사용자는 키를 직접 설정하기로 했으므로 이번 작업에서 새 키를 발급하거나 비밀 파일을 수정하지 않았다. [.env.example](../../.env.example)에 변수 이름만 추가했다. 기존 DeepL 키는 새 요청에서 사용하지 않는다.

워크스페이스 소유자·관리자가 **자동 번역**에서 콘텐츠/원문 언어/번역 언어와 전송 내용을 확인하고 실행한다. 한국어·영어·일본어·중국어·스페인어를 지원하며 영어는 미국 영어, 중국어는 간체로 요청한다. 원문과 같은 언어는 거절한다.

## 저장과 중복 방지

| 저장 위치 | 내용 |
|---|---|
| `translation_runs` | 원문 스냅샷·고정 원문 ID·언어·상태·revision·진행 횟수·입출력/합계 토큰·응답 ID/모델·부분 결과·메모·사용량 예약·번역문 ID |
| `article_translations` | 신규 `origin=openai`, `status=draft`, 실제 번역 필드와 원문/실행 참조 |
| 비공개 `translation_requests` | 사용자/워크스페이스/요청 키/요청 지문/실행 ID. REST 테이블 밖에 보관 |

외부 통신 전에 실행과 사용량 예약을 원자적으로 저장하고 SQLite 쓰기 잠금 밖에서 OpenAI를 호출한다. 각 응답의 확인된 부분 결과와 토큰 사용량을 저장한다. 같은 요청 키는 재시작 후에도 기존 결과만 반환한다. 다른 내용에 키를 재사용하면 거절하며, 실행 이력을 삭제해도 키 기록은 남아 재전송되지 않는다.

같은 원문 버전/언어에 진행 중·결과 불명 실행 또는 기존 번역문이 있으면 새 번역을 막는다. 원문 변경·삭제 후에도 요청 시점의 스냅샷을 보존한다. 진행 중·결과 불명 실행이 있으면 워크스페이스 삭제를 막는다. 정리된 워크스페이스 삭제 시 요청 키 기록을 포함하여 삭제한다.

**과거 DeepL 실행/번역문은 출처와 문자 과금 기록을 그대로 보존한다.** 기존 이력 메모·삭제·편집·검토·내보내기는 계속 사용할 수 있고, 과거 요청 키를 재사용해 OpenAI 요청을 새로 보내지 않는다.

## 응답·사용량·실패 처리

자동 번역 1회에 내부 콘텐츠 생성 사용량 1회를 예약한다. 첫 요청의 명확한 HTTP 4xx 거절은 반환한다. 부분 성공, 결과 불명, 또는 모델이 응답을 생성한 뒤 거절/출력 한도로 끝난 경우는 1회를 확정한다. OpenAI 비용은 별도다. API가 반환한 `input_tokens`, `output_tokens`, `total_tokens`를 합산하며 누락/잘못된 사용량은 미확인으로 표시한다. 임의 환산한 비용이나 최종 청구액을 표시하지 않는다.

상태는 `running` → `succeeded`, `failed`, `unknown`이다. 응답의 `completed` 상태, assistant 메시지, 필드 ID/개수/타입/내용을 모두 확인해야 번역문을 생성한다. 거절·미완료 응답은 완성된 번역문으로 저장하지 않는다. 이때 확인된 토큰 사용량과 응답 식별자는 실패 이력에 보존한다.

타임아웃·잘못된 응답·5xx·리디렉션은 결과 불명으로 남기며 자동 재시도하지 않는다. 프로세스 중단 시 `running`이 남을 수 있다. 마지막 진행부터 5분 후 관리자가 과금 가능성을 확인하고 `abandoned`로 종료할 수 있다. 수동 종료는 원격 취소나 환불이 아니다. 완료/실패/정리된 실행은 메모 수정·이력 삭제가 가능하다.

## OpenAI 요청 계약

- 고정 주소 `https://api.openai.com/v1/responses`로 Bearer 인증한다. `OPENAI_BASE_URL` 등의 임의 주소로 키를 전송하지 않는다. 공개 DNS 검증·주소 고정·인증서 검증·리디렉션 차단·60초 제한·2MiB 응답 제한을 적용한다.
- `store: false`, `max_output_tokens: 16384`, strict JSON Schema를 사용한다. 외부 도구는 제공하지 않는다. 원문은 지시가 아닌 번역 대상으로 구분해 전송하고 문구 속 질문에 답하거나 명령을 수행하지 않도록 요청한다.
- Unicode·공백을 유지하며 줄 경계를 우선하여 분할한다. 배치 원문 JSON은 8,000바이트 이하로 제한하여 출력 공간을 확보한다. 필드와 조각 ID를 서버에서 만들고, 응답 키 순서와 무관하게 원래 순서로 재조립한다.
- Markdown·코드·URL·자리표시자 보존을 요청하지만 의미와 서식의 완전성을 보증하는 파서는 아니다. 검토가 필요하다. 긴 문서는 여러 요청으로 처리한다.
- 번역 제목/검색 제목 1,000자, 본문 400,000자, 검색 설명 5,000자 한도를 적용한다. 한도 초과 결과를 자르거나 완성된 결과로 꾸미지 않고 실패 이력에 확인된 부분 결과를 보관한다.

공식 근거: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-4.1 mini 지원 기능](https://developers.openai.com/api/docs/models/gpt-4.1-mini). 외부 오류 원문이나 API 키를 클라이언트 오류·실행 이력에 저장하지 않는다.

## API와 검증

`GET /api/v1/exports?workspace_id=...`는 자료·이력·설정 여부를 반환한다. `translate-content-v2`는 `workspace_id`, `job_id`, `expected_content_revision`, `source_locale`, `locale`, `idempotency_key`, `confirm=true`를 받는다. `translation-run-update/delete/resolve`는 실행 ID와 revision을 검증한다. 명령은 소유자·관리자 전용이며 공개 REST를 통한 번역문/실행/사용량 조작은 차단한다.

단위 테스트는 요청 주소·인증·스키마·Unicode 분할·필드 매칭·응답 거절/미완료·사용량·중복 요청·재시작·이력 호환·권한·검토 후 파일 생성을 확인한다. E2E는 설정 누락과 입력 보존, 모의 번역 응답→실제 저장→검토→다운로드, 토큰 표시, 응답 불명 재전송 차단·수동 종료를 검증한다. 전체 검증 결과는 [작업표](full-crud-tasks.md)에 기록한다.

Ego Lite에서 키 미설정 오류와 선택한 일본어 유지, 390px 화면의 가로 넘침 없음·확인창 휠 스크롤을 확인했다. [데스크톱](evidence/2026-10-23-openai-translation.png), [모바일](evidence/2026-10-23-openai-translation-mobile.png).

실제 유료 API 호출·번역 품질·청구는 검증하지 않았다. 키 설정 후 사용자가 전송 내용을 확인하여 실행해야 한다. 현재 번역은 Node 요청 수명 안에서 수행하며 범용 백그라운드 큐/복구는 F10에 남아 있다.
