# 전체 메뉴 풀스택 CRUD 실행 작업표

기준: 2026-10-23. 기존 `implementation-plan.md`의 S1~S9 완료는 수집 화면·메모리 도메인 엔진·결정적 외부 Provider 계약 검증 범위였다. **전체 메뉴의 영속 CRUD 화면 완료와는 다르다.** 이 문서가 후속 실행 상태의 기준이다.

## 완료 판정

각 메뉴는 모델·입력 검증·권한·API·화면·회귀 테스트가 연결되어야 완료다. 생성 → 목록/상세 조회 → 수정 → 새로고침 및 다른 세션에서 조회 → 삭제 → 관련 데이터 정리를 확인한다. 실패 시 성공 알림을 내지 않고 입력을 유지한다. 사용자는 자신이 속한 워크스페이스만 접근한다. 계정 소유 기능인 추천·피드백은 선택 워크스페이스와 독립적으로 본인 자료를 관리하며, 피드백은 별도 서비스 운영자에게도 열람을 허용한다. 작업 대상은 현재 선택한 워크스페이스 ID이며 기본 데모 UUID를 강제하지 않는다.

집계/분석 페이지는 원본 측정값을 직접 수정하는 대신 그 페이지의 설정·저장된 분석·메모를 CRUD하고 원본 데이터 변경을 집계에 반영한다. 결제/사용량 원장은 서버 작업으로만 생성하고 취소·환불·예약 해제도 별도 명령으로 처리한다.

## 0. 공통 기반 및 현재 증거

- [x] F01 영속 저장: 기존 REST/RPC/함수/로그인 모두 `PersistentHaloXStore` 사용. SQLite WAL 파일 기본 경로 `data/halox.sqlite`, 환경변수 `HALOX_DATABASE_PATH`로 지정. 변경은 트랜잭션 단위로 반영한다.
- [x] F02 재시작·동시성·원자성: 별도 Node 프로세스에서 읽기/삭제, 동시 비동기 작업의 갱신 유실 방지, 실패 시 롤백, 시드 삭제 유지, 손상 저장소의 자동 초기화 금지 테스트.
- [x] F03 비공개 인증 자료: OTP·인증 토큰 해시·비밀번호 해시를 REST 테이블 목록 밖에 저장. 신규 가입자의 비밀번호는 scrypt. 시드 계정은 기존 환경변수 자격증명 사용.
- [x] F04 공개 REST의 인증/플랜 변경 제한, 멤버 자기 권한 상승 방지, 워크스페이스 소유자 보호, API 키 전체 비밀값 검증. 서버 도메인 작업과 공개 REST 권한을 분리한다.
- [x] F05 E2E는 실행마다 별도 SQLite 파일 사용. 개발 DB를 건드리지 않으며 테스트가 종료되면 파일을 정리한다.
- [x] F06 워크스페이스 목록/선택을 서버 ID 기준으로 전환. 임의 기본 항목 및 localStorage 레코드 병합 제거.
- [ ] F07 나머지 페이지의 localStorage 레코드·성공 먼저 알림·비동기 백엔드 동기화를 제거. **워크스페이스·키워드·GEO 프롬프트·페르소나·지식허브·콘텐츠 제작소·최적화·파일 내보내기/번역문/파일 설정·사이트 진단(관련 탭/상세/개요)·전략맵(목록/상세/관계/이력)·SEO/GEO 분석·갭 후보/판단 기록·대시보드·모니터링·리포트·Raw 데이터/가져오기·추천 프로그램·피드백은 전환 완료**. 나머지 메뉴는 미완료.
- [ ] F08 공통 `WorkspaceProvider` 구현, 선택 ID 재검증·탭 간 전환·오류 재시도 및 키워드/GEO 프롬프트/페르소나/지식허브/콘텐츠 제작소/최적화/파일 내보내기/번역문/파일 설정/사이트 진단/전략맵/분석/갭/Raw 데이터 조회·쓰기에 적용. 세션/플랜은 한 번 조회하여 공통 헤더와 공유하고 각 CRUD 화면은 집계 API 사용. 추천·피드백은 공통 인증 상태를 사용하되 계정 소유 모델이므로 워크스페이스 전환과 독립적으로 조회·저장한다. **다른 메뉴의 `DEFAULT_WORKSPACE_UUID` 의존 제거는 남음**.
- [ ] F09 키워드·GEO 프롬프트·세트·태그/그룹·연결·아이디어·페르소나/예문·지식 자료/출처/근거·콘텐츠/버전·최적화/제안/내보내기 파일/번역문/다운로드 설정/사이트 진단 대상·범위·실행·조치 메모/전략맵 그룹·구성·관계·집계 이력/분석 조건/갭 후보·판단 이력/Raw 가져오기 파일·출처·측정 기록의 필수값/길이/언어·국가/URL/외래키/중복 검증, 삭제 정책 적용. 추천 연락처/코드/초대·실제 가입 연결·피드백/답변/상태 이력의 입력·소유권·자기 추천·중복·삭제 정책도 적용. REST 측정값·생성 시 참조 스냅샷 및 비공개 포털 자료 직접 변경 차단. **다른 도메인의 검증은 남음**.
- [ ] F10 GEO 일일 예약 실행기·저장 커서·복수 실행기 중복 방지 구현. 공개 사용량 예약 변경 및 rpc-cache 우회 차단, 프롬프트/콘텐츠 생성 키 재사용 차단. 사이트 진단의 영속 작업 큐·취소·작업 점유/재시작 복구·출처별 수집 간격·요청 중복 차단 구현. 전략맵 자동 분류의 원본 버전 확인·원자적 적용·재시작 후 중복 요청 차단 구현. 갭 후보의 원자적 채택·중복 등록/과금 차단 구현. 감시 알림·주간/월간 리포트 실행 커서·원자적 전환·재시작 중복 방지 구현. Raw 가져오기의 전체 파일 검증·원자적 저장·원본 보존·재요청 중복 방지 구현. 추천 코드/초대/글/답변 생성의 영속 요청 중복 방지와 삭제 후 재생성 차단 구현. **다른 도메인의 장기 작업 큐·취소·범용 요청 중복 처리, 조회 RPC 읽기 전용 분류, 백업/복원 도구는 남음**.

현재 SQLite는 기존 도메인 엔진의 전체 상태를 버전 있는 JSON 스냅샷으로 트랜잭션 저장한다. 로컬/단일 서버에서 실제 영속성을 제공하지만 정규화된 Postgres 구현은 아니다. Supabase SQL 마이그레이션은 별도 검증 자산으로 남아 있으며 이 런타임과 연결하지 않았다. 여러 서버가 파일을 공유하는 배포나 대규모 데이터에는 DB 어댑터 교체가 필요하다. 런타임 저장 파일과 비밀키는 Git에 포함하지 않는다.

최근 검증(2026-10-23): 추천·피드백 CRUD까지 **단위 208/208, E2E 68/68, 백엔드 22/22**, 타입 검사·프로덕션 빌드 통과. 경로 검증은 실행 중인 3000 포트에서 363개 항목 누락/실패/중복/누락 자산 0개(기존 원본 404 항목 73개는 기능 완료로 세지 않음). 추천 가입의 실제 인증/계정 생성 연결, 작성자/운영자 별도 세션, 다른 계정 접근 차단, 실패 입력 보존과 모바일 스크롤을 검증했다. Ego Lite와 별도 SQLite에서 코드 편집·운영자 답변/상태 이력·검색·서버 재시작 후 보존을 확인했다. 최종 화면 안내/제목 보정 후 추천·가입 E2E 7/7도 재통과했다. 실제 OpenAI/SOLAPI/이메일/결제 요청은 수행하지 않았다. [추천·피드백 구현·검증](referral-feedback-crud.md).

## 1. 계정 및 워크스페이스

| ID | 화면 | 모델·작업 | 상태 / 완료 증거 |
|---|---|---|---|
| A01 | `/app/login` | profiles, 비공개 account_credentials, 서명 세션. 관리자/신규 가입자 로그인, 오류 및 로그아웃 | 구현·auth E2E |
| A02 | `/app/signup` | SOLAPI 발송, 비공개 phone_verification. 60초 재발송, 5분 만료, 5회 실패, 전화번호/클라이언트/전체 발송 제한. 10분 단회 인증 증표로 계정+워크스페이스 생성 | 구현·signup E2E(문자 전송만 fixture). **실발송은 SOLAPI 환경변수 설정 및 본인 수신번호 검증 필요** |
| A03 | `/app/forgot-password` 및 복구 경로 | 단회 복구 토큰, 만료/재사용 차단, 기존 세션 무효화, 실제 복구 메시지 발송 | 미완료: 현재 데모 안내 |
| W01 | `/app/workspaces` | 이름·도메인·설명 CRUD, 소유자·관리자 수정/소유자 삭제, 연관 데이터 삭제, 실제 항목 수 | 구현·workspaces E2E |
| W02 | 워크스페이스 전환 | 전체 데이터 조회와 쓰기, 대시보드, 상세 페이지에 선택 ID 전파 | 메뉴 및 키워드/GEO 프롬프트 목록·상세·모든 쓰기 적용·격리 E2E. 다른 페이지 전파는 F08에서 진행 |

## 2. 분석·전략·실행 메뉴

아래 상태는 화면 기준이다. 기존 도메인 함수의 존재만으로 완료 처리하지 않는다.

| ID / 메뉴 | 모델 및 API 작업 | 구현할 화면 | 남은 작업 |
|---|---|---|---|
| P01 `/app` | 기존 KPI RPC, 새 dashboard_preferences(기간·패널·정렬) | 실제 KPI/빈 상태, 기간 저장·수정·초기화, 하위 페이지 이동 | 구현·개인별 기간/패널/순서/정렬 설정 CRUD·원본 변경 후 집계·미측정 구분·워크스페이스/사용자 격리·모바일 검증. [구현 내역](observability-crud.md) |
| P02 `/app/keywords`, `/app/keywords/:id` | keyword_sets, keywords, serp_snapshots, tags/groups/assignments, keyword_prompt_links, keyword_ideas | 실제 목록/상세, 세트/키워드/태그/연결/아이디어 CRUD, 일시정지·재수집, 검색/정렬/페이지네이션·선택 삭제·CSV | 구현. 실패 입력 보존·새로고침·워크스페이스 전환·모바일·관계 삭제 회귀 검증. 수집은 데모 Provider이며 화면에 명시. 세부 증거: [키워드 CRUD](keyword-crud.md) |
| P03 `/app/seo/insights` | keywords/serp 읽기 + saved_analyses(조건·메모) | 분석 조건 저장·조회·수정·삭제, 실제 순위/기회 집계 | 구현·기간/엔진/세트/태그/언어·국가 필터·순위/AIO/출처 집계·저장 조건 CRUD·충돌/격리/모바일 검증. [구현 내역](analysis-gap-crud.md) |
| P04 `/app/geo`, `/app/geo/prompts`, `/app/geo/prompts/:id` | geo_prompt_sets, geo_prompts, geo_prompt_runs/answers/citations/metrics, tags | 프롬프트 세트/질문/태그 CRUD, 다중 엔진·일일 예약, 실행·이력·원문 상세 | 구현·CRUD/실패/격리/모바일 E2E 및 실제 서버 예약 실행 검증. 외부 LLM은 데모 Provider. 상세 범위와 운영 조건: [프롬프트 CRUD](prompt-crud.md) |
| P05 `/app/geo/analysis` | GEO 집계 + saved_analyses | 엔진/기간 비교, 저장 분석 CRUD, 근거 출처 표시 | 구현·엔진/동일 길이 직전 기간 비교·멘션/인용/출처/매트릭스·저장 조건 CRUD·근거/빈 상태/격리 E2E. 제품/Fan-out 별도 측정 자료는 미지원. [구현 내역](analysis-gap-crud.md) |
| P06 `/app/gap` | geo_prompt_candidates, opportunity_decisions | 후보 생성/조회/수정/삭제, 채택 시 키워드·질문 생성 | 구현·저장 SERP 근거 후보 생성·직접 등록/편집/삭제·보류/재개/채택·원자적 중복 방지·판단 메모/삭제·질문/키워드 연결·실패/모바일 E2E. [구현 내역](analysis-gap-crud.md) |
| P07 `/app/strategy-map`, `/app/strategy-map/:id` | keyword_clusters/members/links, cluster_stats_history, cluster_batch_runs, 비공개 요청 기록 | 그룹·구성·관계 CRUD, 현재 집계/스냅샷, 자동 분류 미리보기·적용·이력, 실제 맵 | 구현·규칙 기반 분류/수동 그룹 보존·원본 버전 충돌/재요청 차단·재시작/원자성·검색/필터/CSV·권한/연쇄 삭제·모바일 실제 스크롤 검증. 외부 AI 의미 분류는 아님. [구현 내역](strategy-crud.md) |
| P08 `/app/site-audit`, `/app/site-audit/:id` | site_audit_targets/scans/pages/issues, scope_rules, 비공개 작업 큐/요청 기록 | 대상/범위 CRUD, 진단 실행·취소·재실행, 스캔 상세/삭제 | 구현·실제 공개 HTML 수집·robots/수집 제한·페이지별 근거·조치 메모·이력 CRUD·CSV·권한/충돌/취소/연쇄 삭제 검증. 서버 재시작 후 실제 수집 재개 및 데스크톱/모바일 확인. [구현 내역](site-audit-crud.md) |
| P09 `/app/factory` | content_jobs/drafts/compositions | 작업 생성·목록·본문/메타 편집·버전 선택·삭제, 제작 진행 | 구현·직접 작성/생성·본문/메타/설정·버전 선택/복원/삭제·구성 파생 저장·충돌/격리/모바일 검증. 작업 큐는 F10에서 진행. [구현 내역](content-crud.md) |
| P10 `/app/optimize` | content_review_runs/change_items | URL/본문 등록·조회, 제안 편집·적용·제외·삭제, 버전 되돌리기 | 구현·실제 공개 URL/본문/기존 초안 등록, 4단계 저장, 제안 편집/제외/삭제/선택 적용·원본 복원·충돌/격리/모바일 검증. 검색/제안은 데모 Provider. [구현 내역](optimization-crud.md) |
| P11 `/app/exports` | export_history, export_destinations, article_translations, translation_runs | 내보내기 설정 CRUD, 실제 파일 생성·이력 조회·재다운로드·삭제 | 파일 생성/이력/재다운로드/삭제·수동 번역 CRUD·다운로드 설정 구현 및 검증. **WordPress 연결/암호화/검증/명시적 게시·원격 결과 복구 구현**. **OpenAI 자동 번역·검토·토큰 사용량/부분 결과/실패 이력·중복 요청 차단 구현** (사용자 선택 반영; 과거 DeepL 이력 유지). 외부 통신은 테스트 대역으로 검증했으며 실번역은 서버 키 필요. [자동 번역 구현](automatic-translation.md). [WordPress 구현](wordpress-crud.md). [파일·번역문 구현](export-crud.md) |
| P12 `/app/monitoring` | monitor_rules, geo_alerts, workspace_events | 감시 규칙 CRUD, 켜기/끄기, 발생 이벤트 조회·확인 | 구현·관리자 규칙 CRUD/켜기/끄기·주기/즉시 평가·임계값/표본 검증·알림 확인/메모/종료 삭제·재시작/중복 방지·연쇄 삭제·실제 서버 실행/모바일 검증. 앱 내 알림이며 외부 전달은 S10. [구현 내역](observability-crud.md) |
| P13 `/app/reports`, `/app/reports/weekly` | report_snapshots/summaries/action_items | 주간/월간 생성·상세·메모/액션 수정·삭제·내보내기 | 구현·주간/월간 생성/버전/목록/상세·생성 당시 근거 보존·메모/요약/액션 CRUD·JSON/Markdown·관리자 예약/초기화·원자성/재시작/실제 서버 자동 생성 검증. [구현 내역](observability-crud.md) |
| P14 `/app/personas`, `/app/personas/:id` | writing_style_profiles, writing_style_samples | 이름/대상/문체/금지어/예문 CRUD, 기본 페르소나 선택, 콘텐츠 생성 참조 | 구현·CRUD/새로고침/실패/격리 E2E. 삭제 시 연결 해제 및 생성 당시 내용 보존. [구현 내역](library-crud.md) |
| P15 `/app/knowledgehub`, `/app/knowledgehub/:id` | knowledge_entities/sources/evidence_contexts, keyword_knowledge_entities, 비공개 파일 | 자료/출처/근거 CRUD, 본문·파일 저장/다운로드, 유형 검색, 키워드 연결, 콘텐츠 참조 | 구현·파일 바이트/권한/제한/연쇄 삭제·모바일 E2E. PDF는 원본 보관, TXT/MD는 본문 읽기. [구현 내역](library-crud.md) |
| P16 `/app/raw-data` | SERP/GEO/진단 원본 읽기, raw_import_batches | 필터/상세/다운로드, 가져오기 등록·메타 수정·삭제 | 구현·기간/엔진/언어/국가/출처 필터·상세 JSON·실제 CSV ZIP·원본 JSON 가져오기/메타 수정/삭제·바이트/출처 보존·재집계/재시작/중복 방지·권한/실패/모바일 검증. GSC/GA4는 기존 저장 자료 읽기이며 실 동기화는 S09. [구현 내역](raw-data-crud.md) |
| P17 `/app/referral` | 비공개 referral_partners/codes/invites/rewards | 연락처·추천 코드·가입 전 초대 CRUD, 링크 복사, 가입/보상 내역 | 구현·계정 격리·전역 코드 유일성/영구 폐기·실제 인증 가입 귀속/자기추천 차단/마스킹·연락처 철회·원장 서버 전용/잔액·재시작/모바일 검증. 실제 결제·현금 정산은 S06/S07 연동 전이며 화면에 명시. [구현 내역](referral-feedback-crud.md) |
| P18 `/app/feedback`, `/app/feedback/:id` | 비공개 feedback_threads/replies/events | 글/답변 CRUD, 내 글/운영자 접수함, 처리 상태·사유 이력 | 구현·작성자/서비스 운영자만 열람·워크스페이스 관리자 승격 차단·검색/필터/정렬/상세·버전/중복 요청·연쇄 삭제·별도 계정/실패/재시작/모바일 검증. 체험 기간 자동 보상 없음. [구현 내역](referral-feedback-crud.md) |

의존 순서: **F07~F09 → P02 → P04 → P14/P15 → P09/P10/P11 → P08/P07 → P03/P05/P06 → P01/P12/P13 → P16/P17/P18**. 연관 API 계약과 화면을 같은 작업에서 완료하고, 각 행마다 성공/실패/새로고침/교차 테넌트 E2E를 추가한다.

## 3. 설정 전체 탭

| ID / 탭 | 모델·화면·CRUD 범위 | 완료 조건 |
|---|---|---|
| S01 기본 프로필 | profiles 이름 조회/수정, 인증된 전화 변경, 개인 세션 관리 | 새 로그인에도 유지, 다른 계정 수정 불가 |
| S02 workspace | workspaces 브랜드/도메인/진단 범위 설정 | W01과 같은 ID/값, 저장 후 관련 페이지 반영 |
| S03 members | members/invitations 초대 조회·권한 수정·취소/제거 | 기존 초대 기능 확장, 소유자 유지·자기 승격 불가 |
| S04 brand-tracking | keyword_sets/brand_domains 경쟁사·자사 도메인 CRUD | 중복/URL 검증·분석 재분류 |
| S05 tags | workspace_tag_groups/tags/assignments CRUD | 삭제 시 관계 정리·키워드/프롬프트 동기화 |
| S06 plan/billing | plans/subscriptions/orders 조회, 변경/해지/취소 명령 | 실 결제 Provider와 콜백 검증 전에는 데모 상태를 명시; 원장 직접 수정 불가 |
| S07 earned | 적립 크레딧·보상 내역 조회, 서버 적립/사용/회수 | 사용자 잔액 조작 불가·중복 적립 차단 |
| S08 export | export_destinations CRUD, 자격증명 검증 | 다운로드 설정 및 WordPress 연결 CRUD·암호화·비밀번호 교체/삭제·권한 검증·게시 재사용 구현. 원격 성공은 fixture 검증, 실 사이트 확인은 사용자 연결 필요. [WordPress 구현](wordpress-crud.md) |
| S09 integrations | google_connections 등 연결 생성/조회/갱신/해제, 동기화 작업 | 실제 OAuth 토큰 서버 보관·해제 시 토큰 폐기 |
| S10 notifications | notification_preferences CRUD + 알림 읽음/삭제 | 토글 새로고침 유지·규칙별 실제 전달 Provider |
| S11 api | workspace_api_keys 발급/목록/이름·권한·제한 수정/폐기 | 전체 비밀값은 최초 1회, prefix로 인증 불가, 폐기 즉시 차단 |

S03 초대, 사용량 실조회, S11 일부 API는 존재하나 전체 탭 CRUD 완료는 아니다. 현재 settings의 인덱스 기반 localStorage 저장도 F07에서 제거해야 한다.

## 4. 공개 사이트 콘텐츠와 최종 인수

- [ ] C01 블로그·용어사전·업데이트·기능/가격/문의 페이지의 콘텐츠 모델(`site_pages`, `site_posts`, `site_taxonomies`, `site_translations`, `contact_requests`)과 로케일/slug 유일키.
- [ ] C02 관리자 권한의 작성·미리보기·수정·삭제/게시 명령, 공개 사이트는 게시 버전 조회. 현재 수집 HTML과 콘텐츠를 분리한다.
- [ ] C03 문의 양식은 실제 접수 저장과 접수 내역 조회/상태 변경·삭제. 이메일/슬랙 통지는 별도 명시적 연동 범위.
- [ ] Q01 매니페스트의 메뉴·탭·동적 상세 라우트별 실제 모델/API/테스트 매핑. 원본 404·리디렉션을 기능 완료 수에 포함하지 않는다.
- [ ] Q02 모든 페이지의 API 실패·빈 데이터·권한 없음·로딩·모바일·키보드 접근을 점검.
- [ ] Q03 전체 메뉴 CRUD 및 분석 재집계, 서버 재시작, 다른 사용자 격리, 저장 데이터 백업/복구를 검증하고 증거 기록.
- [ ] Q04 타입 검사·빌드·단위/통합/E2E·경로 검증 후 커밋/푸시. 전체 완료 표시는 위 작업표가 충족될 때만 한다.
