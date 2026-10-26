# 실제 기능 실행

앱 화면은 기본적으로 실제 데이터 조회·저장 화면을 사용한다. 예전 `halox_display=original` 쿠키와 `HALOX_DEFAULT_DISPLAY_MODE=original` 설정은 일반 실행에 영향을 주지 않는다. 캡처 비교가 필요할 때만 `HALOX_ENABLE_CAPTURE_PREVIEW=1`을 설정한다.

## 서버 설정

`.env.example`을 참고해 `.env.local`에 다음 값을 직접 설정한 후 서버를 재시작한다. 비밀값을 저장소에 커밋하거나 `NEXT_PUBLIC_` 변수로 노출하지 않는다.

| 기능 | 필요한 설정 |
|---|---|
| AI 콘텐츠 생성, 최적화 변경안, AI 상담 | `OPENAI_API_KEY`, 선택: `OPENAI_CONTENT_MODEL` |
| GEO 답변·웹 인용 수집 | `OPENAI_API_KEY`, 선택: `OPENAI_GEO_MODEL` |
| 콘텐츠 자동 번역 | `OPENAI_API_KEY`, 선택: `OPENAI_TRANSLATION_MODEL` |
| Google 검색 결과 수집 | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| 가입 인증·알림 문자 | 기존 `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER` |
| 알림 이메일 | 기존 SMTP 서버·계정 환경변수 |

OpenAI 모델 기본값은 `gpt-4.1-mini`다. 계정에서 사용할 수 있는 Responses API 및 웹 검색 지원 모델로 변경할 수 있다. 키 설정 여부는 로그인한 화면에 표시되며, 값 자체는 API에 반환하지 않는다. 설정됨 표시는 자격증명 존재 여부이며 실제 접속 성공을 보증하지 않는다.

## 동작과 데이터

- 콘텐츠 생성은 선택한 페르소나·지식 자료를 OpenAI에 보내고 본문·검색 메타 정보·응답 식별자·모델·토큰 사용량을 저장한다.
- GEO는 OpenAI 웹 검색을 사용하고 응답의 실제 URL 인용만 저장한다. 추적 브랜드는 질문에 주입하지 않고 수집 후 분류한다. Claude·Gemini·Perplexity 실수집은 아직 지원하지 않으며 실행 전에 오류로 안내한다.
- 검색 수집은 선택한 국가·언어의 Google 상위 10개 결과를 요청한다. 별도 검색량·난이도 API는 호출하지 않으므로 해당 값은 `null`이다.
- 최적화는 원문과 검색 참고를 바탕으로 변경안을 생성한다. 사용자가 선택한 제안만 기존 버전 검사 후 새 버전으로 적용한다. 원문·이전 버전은 보존한다.
- 키 누락·인증 실패·거절·불완전 응답 시 모의 성공으로 대체하지 않는다. 유료 요청을 자동 재시도하지 않는다. 생성 실패 시 로컬 콘텐츠와 사용량 변경은 트랜잭션으로 취소된다. 외부 서비스에서 이미 처리한 요청의 비용까지 취소되지는 않는다.
- 기존 데모 기록은 삭제하지 않는다. `deterministic`, `dataforseo-mock` 출처는 모의 자료다. 새 기록은 `openai`, `dataforseo` 및 응답 식별자로 구분한다.
- OpenAI 생성 자체를 SEO/AIO 성과 측정으로 간주하지 않으며 생성 점수는 비워 둔다.

현재 로컬 SQLite 저장소는 외부 요청을 포함한 쓰기 작업을 순차 처리한다. 외부 요청은 최대 60초이며 그동안 다른 쓰기는 일시적으로 저장소 사용 중 오류를 받을 수 있다. 여러 사용자의 장시간 동시 생성에는 별도 작업 큐 전환이 필요하다. AI 상담 API는 응답 완료 후 SSE를 반환하며 실시간 토큰 스트리밍은 아니다.

## 검증

오프라인 테스트에서만 `HALOX_PROVIDER_MODE=demo`를 명시한다. Playwright 기본 설정은 격리된 테스트 DB와 데모 어댑터를 사용한다. 실수집 모드의 키 누락 경로는 아래 명령으로 별도로 검증한다.

```sh
npm run test:unit
npm run build
npx playwright test e2e/display-mode.spec.ts e2e/content.spec.ts e2e/optimization.spec.ts
HALOX_E2E_PROVIDER_MODE=live npx playwright test e2e/runtime-providers.spec.ts e2e/display-mode.spec.ts
```

외부 API는 주입한 전송 어댑터와 공식 응답 형식의 테스트 자료로 검증한다. 실제 계정의 유료 API 성공 호출은 키 설정 후 확인해야 한다.

2026-10-26 검증: 단위 테스트 384개, 기능 브라우저 테스트 6개, 실수집 모드 키 누락·인증·기본 화면 브라우저 테스트 4개 통과. 프로덕션 빌드 성공. 3001번 서버를 재시작하고 관리자 로그인 HTTP 200, 실제 기능 모드, 이전 캡처 쿠키를 포함한 제작소 HTTP 200을 확인했다. 점검용 로그인 세션은 로그아웃 처리했다.

구현 기준: [OpenAI Responses 웹 검색](https://developers.openai.com/api/docs/guides/tools-web-search), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [DataForSEO Google Organic Live Advanced](https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/).
