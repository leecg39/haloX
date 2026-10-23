# Raw 데이터 조회·가져오기 CRUD

2026-10-23. 전체 메뉴 작업표 P16 범위. `/app/raw-data`는 선택한 워크스페이스의 SQLite 저장 자료를 조회하고, 가져오기 묶음의 이름·메모를 수정하거나 삭제한다. 전체 메뉴 완료를 뜻하지 않는다.

## 화면과 저장 모델

| 탭 | 원본·연결 자료 | 동작 |
|---|---|---|
| 키워드 Raw | keywords, serp_snapshots, 검색 결과·AI 요약·PAA·연관 검색어 | 기간/검색/엔진/언어/국가/출처/묶음/최신 조건, 상세 JSON, CSV ZIP, JSON 가져오기 |
| 프롬프트 Raw | geo_prompts, geo_prompt_runs, geo_answers_raw, geo_citations, geo_run_metrics | 같은 필터·상세·다운로드, 원문/인용/지표 가져오기 |
| 사이트 진단 Raw | site_audit_targets/scans/pages/issues | 대상 범위 내 진단 기록 가져오기, 페이지/이슈 상세와 ZIP |
| 모니터링 Raw | gsc_daily_totals, gsc_daily_keywords, gsc_daily_pages, ga4_page_stats | 저장 자료 읽기·필터·상세·ZIP. 가져오기는 미지원 |
| 가져오기 내역 | raw_import_batches, 비공개 raw_import_files/raw_import_requests | 원본 파일 재다운로드, 제목·메모 수정, 묶음 삭제, 보관 기록 수·파일 해시·출처 확인 |

날짜는 UTC이며 기본 최근 7일, 한 번에 1~90일이다. 기간·검색 조건을 먼저 적용하고 같은 항목/엔진/언어/국가의 최신 기록을 고른다. 모니터링은 테이블·페이지/검색어·기기·검색 종류도 구분한다. 테이블 간 ID가 같아도 필터와 상세에 다른 테이블의 기록이 섞이지 않는다. 날짜 미기록 자료는 제외 건수를 표시한다.

필터를 적용하는 동안 이전 조건의 목록을 숨긴다. 조회 오류는 재시도할 수 있고, 저장 실패는 이름·메모·선택 파일을 보존한다. 파일을 빠르게 바꾸어도 이전 읽기 완료가 새 파일을 덮지 않는다. 다운로드 실패는 같은 화면에 표시한다. 모바일은 필터·목록 영역에서 실제 스크롤할 수 있다.

## 가져오기 형식

UI에서 기존 키워드·프롬프트·진단 대상을 선택하여 JSON 양식을 받는다. 양식의 `replace-with-...` 출처와 원본 식별자는 실제 값으로 바꿔야 한다. 다운로드한 분석용 ZIP/상세 JSON은 가져오기 파일 형식과 다르다.

```json
{
  "schema_version": 1,
  "kind": "seo",
  "source": { "provider": "your-provider", "url": "https://example.com/export" },
  "records": [{
    "source_id": "original-record-123",
    "keyword_id": "현재 워크스페이스의 실제 키워드 ID",
    "keyword_text": "측정 당시 문구",
    "language": "ko",
    "country": "KR",
    "engine": "google",
    "captured_at": "2026-10-22T10:00:00Z",
    "search_volume": 100,
    "keyword_difficulty": null,
    "top_results": [{ "url": "https://example.com/page", "rank": 3, "title": "결과 제목" }],
    "ai_overview_detected": null,
    "ai_overview": null,
    "paa_questions": [],
    "related_searches": []
  }]
}
```

- 공통: `schema_version: 1`, `kind: seo|geo|audit`, `source.provider`(영문 소문자·숫자·점·밑줄·하이픈, 80자), 선택 `source.url`, `records` 배열. `source_id`는 종류/출처 안에서 고유해야 한다. 등록한 파일과 중복 식별자는 다른 이름/요청 키로도 중복 등록할 수 없다.
- SEO: `keyword_id`, 측정 당시 `keyword_text/language/country`, `engine: google|naver`, UTC `captured_at`. 검색량·난이도·검색 결과·AI 요약 감지는 없으면 null이다. 검색 결과는 URL/순위와 선택 제목/설명, AI 요약은 text/cited_domains다. PAA/연관 검색은 문자열 배열이다.
- GEO: `prompt_id`, `prompt_text/language_code/location_code`, 지원 엔진(openai/claude/gemini/perplexity), UTC `finished_at`, `answer_text`, 선택 `brand_domain`. `metrics`는 brand_mentioned/is_cited 및 citation_rank_score/mention_rank_score. `citations`는 url/position/is_ours/is_competitor다. 원문 줄바꿈·유니코드를 보존한다.
- 진단: `target_id`, UTC `completed_at`, `pages` 배열. 각 페이지는 url/status_code 및 선택 title/meta_description/language/html_score/issues. 이슈는 code/severity/title/description/fix_recommendation. URL은 현재 대상의 포함/제외 범위 안이어야 한다. HTTP 400 이상은 실패이며 점수는 null이어야 한다.
- 지원하지 않는 필드, 다른 워크스페이스 참조, 삭제한 대상, 잘못된 URL/숫자/언어·국가/날짜, 미래 측정, 중복 원본 식별자는 전체 파일을 거절한다. 출처 URL은 HTTP(S)·인증정보 없는 값만 허용하며 가져오기 과정에서 외부 URL을 요청하지 않는다.
- 측정 숫자와 boolean은 null/0/false를 구분한다. 진단 파일에 없는 이미지/alt/JSON-LD/링크 수와 깊이는 화면에서 ‘미측정’으로 표시한다.

전체 파일을 검증한 뒤 한 트랜잭션으로 저장한다. 한 파일 2 MiB·500개 측정 기록, 한 워크스페이스 50개 묶음·원본 20 MiB가 한도다. SEO 결과 1,000개/기록, GEO 인용 500개/기록, 진단 페이지 100개/기록과 이슈 100개/페이지 제한이 있다. 원본 UTF-8 문자열(BOM·공백·줄바꿈 포함)을 별도로 보관하고 SHA-256을 표시한다. 업로드 단계에서 잘못된 UTF-8을 거절한다.

## 출처·집계·삭제 정책

가져온 측정값은 기존 정규화 테이블에 저장하며 `provider=import:<출처>`, `import_batch_id`, `source_id`, `source_url`을 유지한다. 파일 제공자가 적은 출처의 진위를 서버가 독립 검증하는 기능은 없다. 앱 데모 수집과 가져온 자료를 화면에서 구분한다.

현재 문구·언어·국가와 맞는 검색/GEO 자료는 기존 분석·감시·리포트 계산에 반영된다. Raw 조회는 과거 문구의 원본도 보관한다. 가져온 진단은 숫자가 있는 정상 수집 페이지의 점수를 평균하고, 해당 출처의 점수 기준을 확인하도록 표시한다. 대시보드/리포트 근거에도 진단의 Provider·가져오기 묶음·출처 식별자를 남긴다. 실패 페이지와 미측정 점수는 평균에서 제외한다. HTML 수집 실행이나 사용량 차감은 발생하지 않는다.

묶음을 삭제하면 그 묶음으로 생성한 스냅샷/실행/진단과 연결 답변·인용·지표·페이지·이슈, 보관 원본 파일만 삭제한다. 키워드/프롬프트/진단 대상, 다른 수집 기록과 이미 생성한 리포트는 유지한다. 이후 분석은 남은 자료로 재계산한다. 연결 엔티티를 먼저 삭제해 측정이 사라진 경우에도 묶음의 원본 파일과 기록 수를 확인할 수 있다.

동일 요청 키/동일 파일·메타는 재시작 후에도 기존 묶음을 반환한다. 같은 키의 입력 변경은 409다. 묶음을 삭제한 요청 키를 다시 보내도 재생성하지 않는다. 워크스페이스 삭제 시 비공개 파일과 요청 기록도 정리한다.

## API·권한·다운로드

- `GET /api/v1/raw-data?workspace_id=...&kind=seo|geo|audit|monitoring`
- `mode=list`: `filters` JSON(start/end/query/engine/language/country/latest/origin/batch_id). 목록·파일별 행 수·가져오기 내역·연결 가능 항목 반환.
- `mode=detail`: record_id와 record_table. format=json이면 첨부 파일.
- `mode=template`: entity_id에 연결한 가져오기 양식.
- `mode=source`: batch_id의 원본 파일.
- `mode=download`: 필터에 해당하는 측정값과 연결 자료의 CSV ZIP.
- `POST /api/v1/functions/raw-import-create|update|delete`: workspace_id 필수. 생성은 title/notes/filename/contents/idempotency_key, 수정은 batch_id/expected_revision/title/notes, 삭제는 batch_id/expected_revision.

멤버는 조회·다운로드할 수 있고 소유자/관리자만 가져오기·수정·삭제할 수 있다. 다른 워크스페이스의 목록/원본/다운로드는 403이다. 공개 REST에서 가져오기 메타와 측정 자료를 직접 변경할 수 없다. 원본 파일과 요청 기록은 공개 REST 목록 밖에 저장한다. 낡은 수정 버전은 409다.

ZIP은 최대 100,000 CSV 행·20 MiB, 서버 고정 파일명, UTF-8 BOM CSV·CRLF와 README를 포함한다. 필터에 속한 부모 기록을 기준으로 연결 자료를 선택한다. 중첩 객체는 JSON 셀, null은 빈 셀로 보존하고 수식으로 해석될 수 있는 셀에는 작은따옴표를 붙인다. 빈 테이블은 id 헤더만 둔다. 첨부 응답은 `private, no-store`, `nosniff`, sandbox CSP를 사용한다. 원본 JSON 다운로드는 가져온 UTF-8 바이트를 그대로 반환한다.

## 검증

전체 단위 **194/194**, E2E **64/64**, 백엔드 **22/22**, 타입 검사·프로덕션 빌드 통과. 경로 363개에서 누락/실패/중복/누락 자산 0개이며 기존 원본 404 항목 73개는 기능 완료로 세지 않는다.

- Raw 단위 14개: 실제 날짜/필터, 전체 파일 검증과 원자성, 중복 파일/식별자/요청 키, 바이트·BOM·출처 보존, 버전 충돌, 재시작, 권한/REST 차단, 연결 삭제, 분석 재집계, 미측정, 유효 ZIP/CSV 수식 보호, 테이블 간 ID 충돌 격리.
- Raw E2E 4개: SEO/GEO/진단의 가져오기·조회·수정·삭제, 실제 파일 업로드/JSON 다운로드/ZIP 해제와 내용, 필터·빈 상태, 권한/충돌, 오류 시 입력/파일 보존과 재시도, 모바일 스크롤. SEO 자료 가져오기 후 분석 평균 순위가 바뀌고 묶음 삭제 후 이전 집계로 돌아오는 것도 확인한다.
- 전체 E2E 첫 실행에서 같은 계정에 요청이 집중되어 마지막 WordPress 테스트 두 건이 429로 실패했다. Raw 테스트 세션을 별도 시드 계정으로 분리한 뒤 전체 64개를 통과했다. 운영 API 제한은 변경하지 않았다.
- Ego Lite에서 파일 업로드 → 메타 편집 → 새로고침 → 원본 재다운로드의 바이트 일치, ZIP 실제 CSV 내용, 상세 원문, 묶음 삭제 후 수집 자료 보존을 확인했다. 데스크톱 1428px 및 모바일 390px에서 필터 배치/가로 넘침/실제 휠 스크롤을 검증했다. QA 워크스페이스와 TaskSpace 46은 정리했다.
- 화면 증거: [데스크톱](evidence/2026-10-23-raw-desktop.png), [가져오기 내역](evidence/2026-10-23-raw-imports.png), [상세 원문](evidence/2026-10-23-raw-detail.png), [모바일 필터](evidence/2026-10-23-raw-mobile-filters.png), [모바일 다운로드](evidence/2026-10-23-raw-mobile.png).

## 남은 연동

모니터링 Raw는 이미 저장된 GSC/GA4 시드·데모 기록만 읽는다. Provider 미기록 자료는 `legacy-unverified`로 표시한다. 실제 OAuth 동기화는 S09 작업에 남아 있다. 이번 기능은 외부 검색·LLM·진단 Provider를 호출하여 새 실측을 만드는 기능이 아니다. OpenAI 번역 키는 사용자가 서버에 설정하며, 이번 검증에서 실제 OpenAI/SOLAPI 유료 요청은 하지 않았다.
