# HaloX 클론 실행·구현 안내

기준일: 2026-10-22. 원본: [haloxlabs.ai](https://haloxlabs.ai/app).

## 구현 범위

| 항목 | 수량 |
|---|---:|
| `docs/page.md`의 고유 주소 | 322 |
| 앱 주소 | 62 |
| 공개 사이트 주소 | 260 |
| URL을 바꾸지 않는 앱 탭의 추가 상태 | 21 |
| 실제 헤더 메뉴에서 추가로 발견한 주소 | 20 |
| 로컬에서 제공하는 전체 화면 상태 | 363 |
| 수집 당시 원본이 404인 주소 | 73 |
| 로컬 이미지·SVG·폰트·차트 파일 | 368 |

322개는 주소 기준이며, 363개는 쿼리와 탭 상태를 포함한 수량입니다. 같은 내용을 표시하는 원본 별칭·이동 경로도 포함되어 있습니다. 각 주소와 원본 상태는 [coverage.md](coverage.md), 자동 검사 결과는 [route-verification.json](route-verification.json)에서 확인할 수 있습니다.

추가 검토 자료는 [적대적 검토 결과](adversarial-review.md)와 [후속 계획](next-plan.md)에 정리했습니다.

## 시작하기

작업 폴더: `/Users/user01/Desktop/haloX`

```bash
cd /Users/user01/Desktop/haloX
npm ci
npm run build
npm run start -- -p 3001
```

- [대시보드](http://localhost:3001/app)
- [키워드](http://localhost:3001/app/keywords)
- [설정](http://localhost:3001/app/settings)
- [한국어 홈](http://localhost:3001/ko)
- [영어 홈](http://localhost:3001/en)
- [요금 안내](http://localhost:3001/ko/pricing)

개발 서버는 `npm run dev -- -p 3001`로 실행합니다. 현재 실행에 사용한 포트는 3001이며, 기존 3000 포트 프로세스는 변경하지 않았습니다.

## 구성

- Next.js 16.4.2, React 19, TypeScript, Tailwind CSS 4, shadcn 방식의 공통 Button을 사용합니다.
- 수집한 의미 있는 HTML 구조를 React 요소로 변환합니다. 전체 페이지 스크린샷을 배경으로 붙인 형태가 아닙니다.
- 원본 스타일시트·SVG·이미지·폰트를 로컬 파일로 제공하고, 공통 탐색·대화상자·표·공개 페이지의 상호작용을 React에서 처리합니다.
- 앱 사이드바, 계정·워크스페이스 메뉴, 빠른 탐색, 모바일 메뉴, 설정 12개 탭, 수집된 앱 탭을 제공합니다.
- 키워드 등 로컬 항목 추가, 검색, 정렬, 필터, 선택, CSV 내려받기, 로컬 설정 저장을 제공합니다. 없는 데이터를 추가 페이지로 만들어 표시하지 않습니다.
- 공개 사이트에서 수집한 FAQ 답변, 요금 주기 전환, 기능 미리보기 탭, 데스크톱·모바일 메뉴를 제공합니다.
- 로그인·회원가입 폼은 입력 형식을 확인한 후 로컬 대시보드로 이동합니다. 실제 계정이 생성되거나 비밀번호가 저장되지 않습니다.

## 주요 파일

| 경로 | 용도 |
|---|---|
| `src/app/[[...slug]]/page.tsx` | 전체 주소와 쿼리 라우팅 |
| `src/lib/content.ts` | 수집 데이터 로딩과 경로 선택 |
| `src/components/ClonePage.tsx` | 페이지 렌더링과 이벤트 연결 |
| `src/components/CloneNavigation.tsx` | 메뉴·사이드바·빠른 탐색 |
| `src/components/DemoDialog.tsx` | 원본 대화상자와 로컬 폼 |
| `src/components/data-controls.ts` | 검색·정렬·필터·CSV·로컬 항목 |
| `src/components/public-controls.ts` | 공개 페이지 FAQ와 탭 |
| `src/components/Workspaces.tsx` | 워크스페이스 선택 화면 |
| `public/clone/manifest.json` | 전체 363개 상태의 인덱스 |
| `public/clone/pages/` | 정리된 페이지 DOM·상호작용 데이터 |
| `public/clone/assets/` | 로컬 이미지·폰트·차트 |
| `docs/research/components/` | 공통 구성요소 7종의 명세 |
| `docs/design-references/haloxlabs.ai/` | 원본·클론 비교 이미지 |

## 데이터 준비와 검사

실행에 필요한 정리된 콘텐츠는 이미 포함되어 있습니다. 원본 수집 결과를 수정한 뒤 다시 생성할 때만 아래 명령을 사용하세요.

```bash
npm run prepare:content
npm run build
```

서버 실행 후 전체 주소를 검사합니다.

```bash
npm run verify:routes
# 다른 포트의 서버를 검사할 경우
node scripts/verify-routes.mjs http://localhost:3002

# 공개 사이트 REA 의미 검증, 매니페스트 Diff, 시각 회귀, 전체 스택 백엔드/DB 검증
npm run verify:public
npm run diff:manifest -- --fail-on-drift
npm run verify:visual
npm run verify:backend
```

자동 검사는 322개 필수 주소의 포함 여부, 363개 상태의 HTTP 응답과 페이지 렌더링, manifest 무결성, 기본·동적 콘텐츠와 CSS의 로컬 자산, 원격 리소스와 위험 URL을 검사합니다. 모든 버튼의 실제 서비스 결과나 모든 화면의 픽셀 일치를 판정하는 검사는 아닙니다.

## 로컬 저장

추가한 데이터와 설정은 브라우저의 `localStorage`에 `halox-clone:` 접두사로 저장됩니다. 새로고침 후에도 유지되며 브라우저 간에 공유되지 않습니다. 개발자 도구에서 해당 접두사 항목만 삭제하면 로컬 입력 데이터를 초기화할 수 있습니다.

## 재현의 한계

- 인증, 결제, 크레딧 차감, 이메일 발송, 외부 연동, 실제 크롤링·SEO/AI 분석·콘텐츠 생성은 연결하지 않았습니다. 원본 서비스로 데이터를 전송하지 않는 로컬 데모입니다.
- 수집 시점의 Canvas 차트는 PNG로 변환했습니다. 차트 수치의 실시간 갱신, 확대·툴팁 등 Canvas 내부 동작은 재현하지 않았습니다. SVG 차트와 일반 UI는 DOM 형태를 유지합니다.
- 원본 404 73개는 그대로 표시합니다. 원본에서 다른 주소로 이동한 경로는 이동 후에 관찰한 화면을 보존합니다.
- `/app/workspaces`는 현재 원본이 대시보드로 이동하므로, 기존 수집 문구·항목과 공통 디자인을 기준으로 선택 화면을 구성했습니다. 이 화면의 세부 배치는 추정이 포함됩니다.
- 직접 수집한 대화상자·탭은 해당 구조를 사용합니다. 수집하지 못한 세부 액션은 공통 로컬 입력 대화상자로 처리합니다.
- 타이핑·배경 애니메이션의 정확한 타이밍, 모든 포인터·포커스 상태, 전체 주소의 픽셀 단위 일치는 보장하지 않습니다. 검증한 대표 화면과 동작은 [QA.md](QA.md)에 기록했습니다.
