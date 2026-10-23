# 콘텐츠 파일·번역문 CRUD

2026-10-23. `/app/exports`, `/app/exports?job=:id`, `/app/settings?tab=export`를 영속 API와 연결했다. **P11/S08의 파일 및 직접 입력 번역문 범위 구현**이다. 자동 번역 Provider, WordPress 등 외부 배포 대상·비공개 자격증명·연결 검증·명시적 게시 작업은 후속 작업으로 남아 있다.

## 화면

- 파일 이력: 제작소의 현재 선택 버전 또는 검토를 마친 번역문으로 파일 생성, 목록·검색·형식 필터·페이지네이션, 실제 다운로드, 이름/메모 수정, 이력 및 파일 삭제.
- 번역문 관리: 원문 콘텐츠/언어와 번역 언어 선택, 직접 번역한 제목·본문·검색 메타 정보·검토 상태·메모 등록/조회/수정/삭제. 한국어·영어·일본어·중국어·스페인어를 지원한다. 원문 버전별 같은 언어는 하나만 등록한다.
- 파일 설정: 이름·출력 형식·파일명 접두어·메타 정보 포함 여부 CRUD. 설정 탭과 내보내기에서 같은 데이터를 사용한다.
- 제작소 편집기의 `파일 내보내기`가 해당 콘텐츠를 선택한 생성 창을 연다. 새로고침, 워크스페이스 전환, 조회/저장 실패, 동시 수정 충돌을 처리한다.

## 파일과 보존 정책

| 형식 | 실제 파일 내용 |
|---|---|
| Markdown | 본문 원문. 메타 정보 선택 시 JSON으로 인용한 YAML frontmatter 추가 |
| TXT | 본문 원문. 메타 정보 선택 시 제목/검색 제목/검색 설명 추가 |
| HTML | 독립 HTML 문서. 제목과 공백을 보존한 본문을 안전한 텍스트로 출력. Markdown을 HTML 요소로 변환하지 않음 |
| JSON | 제목·본문, 선택 시 검색 메타 정보 |

파일 바이트는 비공개 `serverRecords.export_files`에 base64로, 메타 정보는 `export_history`에 저장한다. 파일명·크기·SHA-256·원문 버전·번역 revision·설정 스냅샷은 생성 당시 값이다. 이름/메모를 수정해도 파일 내용과 파일명은 바뀌지 않는다. 파일 보관 한도는 워크스페이스당 50MiB다.

원문/원문 버전/번역문/설정을 삭제하면 이력의 해당 참조만 해제한다. 번역문은 참조 원문을 별도 스냅샷으로 보존한다. 이미 만든 파일은 원문 편집·삭제 이후와 서버 재시작 후에도 동일한 바이트로 내려받는다. 파일 이력을 삭제하면 비공개 바이트도 삭제하며, 워크스페이스 삭제 시 전부 정리한다.

## 서버 계약

- `GET /api/v1/exports?workspace_id=...`: 한 저장소 스냅샷에서 콘텐츠·버전·번역·이력·설정 조회. 인증 및 멤버십 필수.
- `POST /api/v1/functions/export-create`: 콘텐츠 ID/expected_content_revision 또는 번역 ID/expected_translation_revision, 형식/메타 포함 여부 또는 설정 ID/expected_destination_revision, idempotency_key. 파일과 이력을 한 트랜잭션에 저장한다. 같은 사용자/워크스페이스/키의 동일 요청은 기존 파일을 반환하며, 다른 요청에 키를 재사용하면 거절한다.
- `export-update/delete`: export_id와 expected_revision. update는 이름·메모만 허용한다.
- `export-destination-create/update/delete`: 다운로드 설정 전용. update/delete는 destination_id와 expected_revision 필수.
- `translation-create/update/delete`: 실제 번역문 전용. create는 현재 원문 revision, update/delete는 번역 revision 필수. 검토 상태가 `ready`인 실제 번역문만 파일로 만들 수 있다.
- `GET /api/v1/exports/files/:id`: 인증 및 워크스페이스 격리, attachment/UTF-8 파일명/private no-store/nosniff/CSP sandbox. 다른 워크스페이스 또는 없는 파일은 404.
- 세 공개 테이블의 REST 쓰기를 차단한다. 원문/설정/번역의 타 워크스페이스 ID를 연결할 수 없고, 미지원 형식·언어·잘못된 파일 접두어를 거절한다.

기존 `translate-content-v2`의 고정 접두어/가짜 번역 본문/즉시 published 처리는 제거했다. 이제 연결되지 않은 자동 번역 요청은 명확한 오류를 반환한다. 과거 데모 번역은 삭제할 수 있지만 파일 생성 대상에서는 제외한다. 직접 번역문 등록은 외부 번역 호출이나 게시를 수행하지 않는다.

## 검증

최종 검사: 단위 **112/112**, E2E **39/39**, 백엔드 **22/22**, 타입 검사·Next.js 프로덕션 빌드 통과.

- `export.test.ts`: 정확한 파일 바이트·4가지 형식·HTML 이스케이프·안전한 파일명·재시도·revision 충돌·재시작·관계 삭제·한도 초과 롤백·교차 테넌트·REST 차단 6개.
- `exports.spec.ts`: 설정/번역/이력 CRUD와 새로고침, 실제 다운로드 및 원문/번역/설정 삭제 후 동일 바이트, 실패 입력 보존·다운로드 오류·충돌 409·권한·모바일.
- E2E 내보내기는 분리된 actor의 로그인 세션을 테스트 시작 시 발급한다. 인증 잠금 테스트와 요청 예산을 공유하는 문제를 피하며 실제 서버 제한을 변경하지 않는다.
- Ego Lite: HTML 설정 등록 → 원문 선택 → 파일 생성 → 실제 다운로드 및 390px 화면 확인. 전용 검증 워크스페이스는 확인 후 삭제한다.
- [데스크톱 화면](evidence/2026-10-23-exports.png), [모바일 화면](evidence/2026-10-23-exports-mobile.png), [실제 생성 HTML](evidence/2026-10-23-export-sample.html).

자동 번역과 외부 배포는 아직 미완료다. 전체 메뉴 작업의 완료 여부는 [전체 작업표](full-crud-tasks.md)를 따른다.
