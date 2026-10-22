# HaloX 클론 검증 기록

검증일: 2026-10-22. 브라우저: Ego Lite. 로컬 서버: `http://localhost:3001`.

## 빌드와 경로

- `npm run build`: 성공. Next.js 프로덕션 빌드 및 TypeScript 검사 통과.
- `npm run verify:routes`: 363개 화면 상태가 HTTP 200과 `.clone-surface` 렌더링 검사를 통과.
- `docs/page.md`의 필수 주소 322개 중 누락 0개.
- manifest 주소·파일 중복 및 잘못된 항목 0개.
- 기본 페이지와 동적 FAQ·탭·메뉴·대화상자에서 로컬 자산 누락 0개, 원격 미디어·스타일 0개, 위험 URL 0개.
- 원본 404 상태 73개는 의도적으로 원본 404 화면을 렌더링하므로 경로 검사 실패로 처리하지 않음.
- 자세한 결과: [route-verification.json](route-verification.json).

## 브라우저에서 확인한 동작

| 흐름 | 확인 내용 | 결과 |
|---|---|---|
| 키워드 추가 | 원본 형태의 대화상자에서 QA 키워드 입력·제출 | 통과 |
| 검색 | 추가한 키워드 이름으로 검색 후 해당 행 표시 | 통과 |
| 새로고침 | 로컬 추가 항목 유지 | 통과 |
| 설정 | 구독/결제에서 멤버 탭 이동, URL과 화면 전환 | 통과 |
| 요금 안내 | 월간·연간 전환 및 수집한 가격 표시 | 통과 |
| FAQ | 질문 펼침과 `aria-expanded` 갱신 | 통과 |
| 앱 모바일 메뉴 | 사이드바 열림 및 내부 탐색 링크 표시 | 통과 |
| 공개 모바일 메뉴 | 우측 서랍 열림, 제품 하위 목록 펼침 | 통과 |
| 영문 메뉴 | Product 드롭다운, 모바일 Resources 하위 목록 | 통과 |
| 로컬 로그인 | 이메일·비밀번호 입력 후 로컬 대시보드 이동 | 통과 |
| 일괄 키워드 추가 | 2건 제출 후 표와 localStorage에 모두 즉시 반영 | 통과 |
| 손상된 설정 저장값 | 잘못된 JSON이 있어도 결제 탭으로 이동 | 통과 |

QA용 키워드는 검사 후 삭제했습니다. 실제 원본에 폼 제출·데이터 변경·결제·진단 실행을 하지 않았습니다.

표 동작 모듈은 검색·검색 결과 없음·초기화·선택·정렬·필터·CSV 생성·수식 문자열 이스케이프·로컬 저장을 별도로 확인했습니다. 이 검증은 백엔드 서비스나 원본의 전체 데이터셋에 대한 검증이 아닙니다.

## 반응형과 화면 비교

- 데스크톱: 1440×1000에서 원본과 클론 대시보드·공개 홈 비교.
- 모바일: 390×844에서 앱과 공개 홈·메뉴 확인. 문서 폭이 390px이며 페이지 전체의 가로 넘침 없음.
- 대화상자: 원본의 576px 폭, 가운데 정렬, 입력·버튼 배치를 확인. Tailwind 버전 간 변환 유틸리티 충돌을 제거한 후 재검증.
- 프로덕션 모드에서 개발 도구 배지가 없고, 대표 공개 홈의 깨진 이미지가 없음을 확인.

대표 증거:

- [최종 앱 데스크톱](../design-references/haloxlabs.ai/clone-app-desktop-final.png)
- [원본 앱 데스크톱](../design-references/haloxlabs.ai/app-desktop.png)
- [클론 앱 모바일](../design-references/haloxlabs.ai/clone-app-mobile-final.png)
- [원본 앱 모바일](../design-references/haloxlabs.ai/source-app-mobile-final.png)
- [공개 모바일 메뉴](../design-references/haloxlabs.ai/clone-public-mobile-menu-final.png)
- [영문 모바일 메뉴](../design-references/haloxlabs.ai/clone-en-mobile-menu-final.png)
- [키워드 대화상자](../design-references/haloxlabs.ai/clone-keyword-dialog-fixed.png)
- [홈 데스크톱 비교 — 원본](../design-references/haloxlabs.ai/source-home-1440.png)
- [홈 데스크톱 비교 — 클론](../design-references/haloxlabs.ai/clone-home-desktop-final.png)

전체 주소의 로드는 자동 검사했고, 시각 비교·상호작용은 위 대표 화면에서 확인했습니다. 원본과 클론 사이에는 수집 시점, 데모 계정 문구, 애니메이션 단계 차이가 있습니다.

## 다시 확인하는 순서

1. `/app/keywords`에서 키워드 추가 → 이름 입력 → 제출 → 검색 → 새로고침.
2. `/app/settings?tab=billing`에서 멤버를 선택해 `?tab=members`로 이동하는지 확인.
3. `/ko/pricing`에서 연간·월간 전환 후 FAQ를 펼침.
4. 모바일 폭에서 `/app` 사이드바와 `/ko` 메뉴를 열고 제품 하위 목록 확인.
5. `/app/login`에 테스트용 이메일과 임의의 비밀번호를 입력해 로컬 `/app` 이동 확인.
6. `npm run verify:routes`를 실행해 JSON 결과의 `missing`, `failed`, `duplicateRoutes`, `duplicateFiles`, `invalidEntries`, `assetMissing`, `remoteResources`, `remoteStyles`, `dangerousUrls`가 모두 빈 배열인지 확인.

적대적 검토의 발견 사항과 수정 근거는 [adversarial-review.md](adversarial-review.md)에 기록했습니다.

## REA 공개 사이트 후속 검증 (2026-10-22)

- 홈페이지 별칭 FAQ·탭, 페이지 내부 링크 73개, 독립 FAQ 검색·분류, 용어사전 검색·분류, 가격 계산기를 보완했다.
- 원본·로컬 REA 증거 의미 대조 9개 및 전체 363개 경로 검증 통과.
- 한국어·영어 및 390px 모바일 확인. 상세 시나리오와 증거는 [REA 공개 사이트 보고서](../rea/public-site/README.md)를 참조한다.
