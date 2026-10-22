# 공개 사이트 REA 역공학과 프로젝트 반영

기준일: 2026-10-22 · 대상: [HaloX 공개 사이트](https://haloxlabs.ai/) · 프로젝트: `/Users/user01/Desktop/haloX`

기존 363개 화면과 앱 분석 자료를 재사용하고, 공개 사이트에서 실제로 관찰한 동작을 현재 Next.js 구현에 반영했다. 이번 조사는 홈페이지, 한국어·영어 FAQ, 용어사전, 가격 안내의 상호작용에 집중했다. 원본의 서버 구현이나 전체 사이트의 모든 액션을 복원했다는 의미는 아니다.

## 반영한 동작

| 발견한 차이 | 원본 근거 | 프로젝트 반영 |
|---|---|---|
| `/`에는 FAQ·미리보기 데이터가 연결되지 않아 일반 데모 창이 열림 | REA 홈페이지 시나리오 + Ego 원본/로컬 클릭 | 실제 캡처 목적지에 맞춰 `/ko` 상태 연결. 리퍼럴 홈과 영문 홈 별칭도 동일 규칙 적용 |
| 페이지 내 `#matrix`, `#letter-ㄱ` 링크가 `/#...`로 바뀜 | 원본 DOM + REA 가격표 이동 | 10개 경로의 73개 fragment 링크 보존 |
| FAQ가 독립 페이지에서 열리지 않고, 열린 답변 여러 개가 유지됨 | REA FAQ 연속 클릭, Ego `/ko/faq`·`/en/faq` | 한 번에 하나 펼치기, 다시 클릭해 접기, 숨김/아이콘/접근성 상태 동기화 |
| FAQ 검색·분류가 동작하지 않음 | 한국어·영어 17개 질문의 카테고리를 직접 관찰 | 질문·답변 검색과 분류 AND 적용, 결과 번호·빈 상태 갱신 |
| 용어사전 검색·분류가 동작하지 않음 | 원본 `SEO` 검색 결과 10개 및 현재 40개 용어 | 제목·약어·설명 검색, 카테고리, 결과 수·색인 갱신. 번역 대기 필터의 0개 상태 복원 및 `#glossary-search-listbox` 자동완성 키보드 이동(`ArrowDown`/`ArrowUp`/`Enter`/`Escape`) 구현 |
| 블로그 토픽 필터가 동작하지 않고 데모 창을 엶 | `/ko/blog` 5개 토픽(`전체`·`GEO`·`SEO`·`콘텐츠 전략`·`AI 트렌드`) 및 `/en/blog` 토픽 버튼 | `initializeBlog`에서 토픽 선택 상태(`aria-pressed`), 아티클 개수 라벨(`전체 아티클 N` / `Total N articles`), 카드 필터링·페이지네이션 및 빈 상태 토글 처리 |
| 요금 계산기 수치·엔진·슬라이더가 고정됨 | REA 가격 시나리오 + Ego 경계값 관찰 | 수량·엔진에 따른 소계/총액, 키보드·포인터 슬라이더, 0개 엔진 안내 |
| 홈페이지 주요 CTA가 일반 데모 창을 엶 | 비로그인 REA 클릭 결과 `/app/login` | 한국어 주요 CTA를 로컬 로그인으로 연결. 영문 동등 문구 연결은 로컬 설계 선택 |

### 관찰한 계산식

`(ceil(max(0, 키워드) / 100) + ceil(max(0, 프롬프트) / 100)) × 150,000원 × 선택 엔진 수`

- 숫자 입력: 빈값·음수 → 0, 최대 10,000.
- 슬라이더: 0–1,000, 방향키 10, Shift+방향키 100.
- 키워드 101·프롬프트 100·엔진 4개 → 1,800,000원; Claude 해제 → 1,350,000원.
- 모든 엔진 해제 가능. 금액 대신 엔진 선택 안내를 표시한다.

## 증거와 검증

REA `capture_browser_scenario`로 비로그인 원본과 로컬 프로덕션 서버를 각각 실행했다. 브라우저는 REA가 생성·종료했으며 뷰포트 1440×1000, 한국어, Asia/Seoul, reduced motion 조건을 사용했다. Ego는 로그인 여부에 따른 CTA 차이와 한국어·영어 검색, 경계값, 390px 모바일 동작을 보완 확인하는 데 사용했다.

| 관찰 | REA Evidence ID |
|---|---|
| 원본 홈 초기 DOM·스크린샷 | `ev_59146338b853e4421bdf981350cf00c5de9386830f093707f04b282a6cc7bd56` |
| 원본 홈 탭·FAQ | `ev_fba0bcc3c3ef08de41b3bbd7a893199ecb8e460c0f2caa1573f44eeab2090a3a` |
| 로컬 홈 탭·FAQ | `ev_b90be2111ab504697b27184efe34c953fcf434ad96dde6a7f70dcc4bf76032ac` |
| 원본 가격·앵커 | `ev_a280163865f73434ad6cd2cab1651194dae6e9e70e88949544d510fdd28034fa` |
| 로컬 가격·앵커 | `ev_9419702b1907a6ab1267ab9e328312f0fbfeff47341832ffb38983e6eef9643b` |
| 원본 비로그인 CTA | `ev_1eaf2611925456a21ea6e49003aad0bb44c54b5fb4600893f042f1d5a953e205` |

- [압축 원본 증거 번들](evidence-bundle.json.gz): 완전한 REA 레코드 8개. 두 레코드는 초기 검증 선택자가 여러 요소에 매칭되어 실패한 시도이며, 고유 선택자로 수정한 최종 시나리오가 모두 완료됐다. 실패 기록은 삭제하지 않았다.
- [의미 단위 대조 결과](conformance.json): SEO/GEO/Content 전환, FAQ 상태·본문, 계산 결과, 앵커, 불필요한 대화상자 부재 **9개 검증 통과**.
- [요금 관찰](pricing-observations.json), [요금 경계값](pricing-boundaries.json), [FAQ 분류 관찰](faq-observations.json), [용어 검색 관찰](glossary-observations.json), [최종 번역 필터 확인](local-final-checks.json).
- [원본 홈페이지 이미지](source-home.png), [로컬 홈페이지 이미지](local-home.png). 헤더 로그인 상태·타이핑 애니메이션 시점·스크롤바 차이가 있으므로 픽셀 동일성 점수로 사용하지 않는다.
- `npm run typecheck`, `npm run build`, `npm run verify:routes` 통과. 필수 322개 주소를 포함한 363개 상태의 실패·누락·외부 자산·위험 URL은 0건. 원본 404 73개는 유지.
- Ego 확인: 한국어·영어 FAQ 가격 분류 4개, 펼치기·검색 0건 안내, `SEO` 검색 10개, 번역 대기 0개, 요금 엔진 전체 해제/재선택, 슬라이더 100→110→210, 모바일 FAQ·탭·검색 및 가로 넘침 없음, CTA 로그인 이동.

저장된 REA 증거의 의미 대조는 다음 명령으로 재현한다. 이 명령은 저장된 캡처를 읽는 검증이며 현재 브라우저를 새로 실행하는 회귀 테스트는 아니다.

```bash
node scripts/verify-rea-public.mjs
```

이 스크립트는 대상 증거의 완료 상태, DOM byte length와 SHA-256을 확인한다. 원본 번들은 `gzip -dc docs/rea/public-site/evidence-bundle.json.gz > /tmp/halox-rea-evidence.json`으로 풀어 REA에서 검토할 수 있다. 큰 MCP 응답은 전송 한도로 화면에 표시되지 않아 `export_evidence_bundle`로 완전한 결과를 보존했다.

## 관찰·추론·미확인 경계

- **관찰 완료:** 위 표의 공개 UI 상태 전환과 계산 결과. 기존 앱 구조·API 분석은 [기존 원장](../findings.md)을 참조한다.
- **로컬 설계:** DOM 이벤트를 현재 Next.js 렌더러에 연결한 방식, 안정적인 FAQ 패널 ID, 블로그 토픽 필터·페이지네이션, 용어 검색 자동완성(`#glossary-search-listbox`) 키보드 이동, 일부 영어 안내 번역. 원본 내부 컴포넌트 코드를 복구한 것은 아니다.
- **이번에 조사하지 않음:** 개별 정적 아티클 본문 내부의 미세 애니메이션 타이밍.
- **미확인 유지:** 인증 서버·결제·크레딧·크롤링·AI 생성/분석 파이프라인, RPC SQL·RLS·서버 점수 공식. 기존 로컬 데모 범위를 유지한다.
- **화면 데이터:** 수집 당시 콘텐츠다. 라이브 가격·고객 데이터의 자동 동기화를 추가하지 않았다.

## 변경 위치

- `scripts/prepare-content.mjs`: 홈 별칭과 fragment 링크 보존, 404 상호작용 제외.
- `src/components/public-controls.ts`: FAQ와 캡처 기반 탭 전환.
- `src/components/public-pricing.ts`: 가격 계산기.
- `src/components/public-lists.ts`, `src/data/public-faq-categories.json`: 검색·분류.
- `src/components/ClonePage.tsx`: 초기화·정리·CTA 연결.
- `scripts/verify-rea-public.mjs`: 저장된 증거의 의미 대조.

전체 화면 구조의 재수집이나 서버 백엔드 구현 없이, 이번에 증거로 확인한 공개 UI 동작 차이를 반영했다.
