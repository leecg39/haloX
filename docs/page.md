# HaloX 페이지 및 메뉴 항목 목록

> 기준 사이트: [HaloX 앱](https://haloxlabs.ai/app) · 확인일: 2026-10-22 (한국 시간)

## 수집 범위와 읽는 방법

Firecrawl로 공개 URL과 인증 화면을 수집하고, Ego Lite의 기존 로그인 세션으로 앱 메뉴·설정·탭을 확인했습니다. 페이지명은 실제 화면의 표시를 기준으로 적었습니다. 앱의 업무 데이터 값 대신 화면 구성과 탐색 항목을 정리했습니다.

- 사이드바 주요 페이지: **15개**.
- 추가 확인: AI 대화 개요, 기회 분석, 추천 프로그램, 피드백, 워크스페이스 관리, 키워드 상세.
- 설정 메뉴: **12개**.
- 주요 분석·전략 화면의 탭 전환: **40개**. 대시보드 탭과 키워드 상세 탭은 별도로 기재.
- Firecrawl Map 공개 URL: **258개**. 홈에서 추가 발견한 도입 문의 주소는 별도 기재.
- 공개 URL 목록은 발견 목록이며, 258개 각각의 본문과 현재 응답을 모두 검증한 것은 아닙니다.
- 앱 범위는 현재 로그인한 계정에서 보이는 메뉴입니다. 권한·플랜·연동·데이터 유무에 따라 추가 화면이 있을 수 있습니다. 데이터별 상세 화면은 대표 유형으로 정리했습니다.

## 1. 앱 메뉴 구조

```text
HaloX
├─ 대시보드
├─ 분석
│  ├─ 키워드 현황
│  ├─ 키워드 분석
│  ├─ 프롬프트 현황
│  └─ 프롬프트 분석
├─ 전략
│  ├─ 전략맵
│  └─ 사이트 진단
├─ 실행
│  ├─ 콘텐츠 제작소
│  ├─ 콘텐츠 최적화
│  └─ 콘텐츠 내보내기
├─ 모니터링
│  ├─ 모니터링 대시보드
│  └─ 주간 리포트
├─ 기타
│  ├─ 페르소나
│  ├─ 자료실
│  └─ Raw 데이터
├─ 계정 메뉴
│  ├─ Pro로 업그레이드
│  ├─ 설정
│  ├─ 결제
│  ├─ 알림
│  ├─ 추천 프로그램
│  ├─ 피드백
│  ├─ 문서 ↗
│  └─ 로그아웃
└─ 워크스페이스 메뉴
   ├─ 내 워크스페이스 목록
   ├─ 워크스페이스 관리
   └─ 새 워크스페이스 만들기
```

## 2. 주요 페이지 빠른 목록

| 번호 | 메뉴 그룹 | 페이지 | 실제 URL |
| --- | --- | --- | --- |
| 1 | 공통 | 대시보드 | [/app](https://haloxlabs.ai/app) |
| 2 | 분석 | 키워드 현황 | [/app/keywords](https://haloxlabs.ai/app/keywords) |
| 3 | 분석 | 키워드 분석 | [/app/seo/insights](https://haloxlabs.ai/app/seo/insights) |
| 4 | 분석 | 프롬프트 현황 | [/app/geo/prompts](https://haloxlabs.ai/app/geo/prompts) |
| 5 | 분석 | 프롬프트 분석 | [/app/geo/analysis](https://haloxlabs.ai/app/geo/analysis) |
| 6 | 전략 | 전략맵 | [/app/strategy-map](https://haloxlabs.ai/app/strategy-map) |
| 7 | 전략 | 사이트 진단 | [/app/site-audit](https://haloxlabs.ai/app/site-audit) |
| 8 | 실행 | 콘텐츠 제작소 | [/app/factory](https://haloxlabs.ai/app/factory) |
| 9 | 실행 | 콘텐츠 최적화 | [/app/optimize](https://haloxlabs.ai/app/optimize) |
| 10 | 실행 | 콘텐츠 내보내기 | [/app/exports](https://haloxlabs.ai/app/exports) |
| 11 | 모니터링 | 모니터링 대시보드 | [/app/monitoring](https://haloxlabs.ai/app/monitoring) |
| 12 | 모니터링 | 주간 리포트 | [/app/reports/weekly](https://haloxlabs.ai/app/reports/weekly) |
| 13 | 기타 | 페르소나 | [/app/personas](https://haloxlabs.ai/app/personas) |
| 14 | 기타 | 자료실 | [/app/knowledgehub](https://haloxlabs.ai/app/knowledgehub) |
| 15 | 기타 | Raw 데이터 | [/app/raw-data](https://haloxlabs.ai/app/raw-data) |

## 3. 주요 페이지별 항목

### 3.1. 대시보드

- 메뉴 위치: 공통 → 대시보드
- URL: [/app](https://haloxlabs.ai/app)
- 용도: 검색과 AI 가시성의 종합 현황을 확인하는 시작 화면.

- 종합 지표: AVI 종합 점수, GEO 점수, SEO 점수, 웹 건강도.
- GEO 세부 지표: 인용률, 멘션율, 인용 순위, 멘션 순위.
- SEO 세부 지표: 평균 순위, Top10 비율, AIO 인용률.
- 현황 탭: 키워드 상위, AI 질문 상위, 사이트 진단, 주요 변화 Top 4, 키워드 상태 현황.
- 바로가기: 검색 성과 분석, AI 대화 분석, 기회 분석, 리포트.

### 3.2. 키워드 현황

- 메뉴 위치: 분석 → 키워드 현황
- URL: [/app/keywords](https://haloxlabs.ai/app/keywords)
- 용도: 등록된 SEO 키워드를 확인하고 관리하는 화면.

- 현황 카드: Top 10 키워드, AI 요약 인용, 자사 순위, 평균 순위.
- 필터·보기: 세트, 언어, 자사·경쟁사, 인텐트, 진행상태, 정렬, 세트별 묶기.
- 주요 기능: 키워드 추가, Raw 데이터, 태그, 행 액션, 키워드 검색.
- 네트워크 내부 선택 항목: 상태·내 순위·인텐트, 그룹 표시(끔·주제 그룹·인텐트), 1차·2차, 리스트·상세·설명.
- 아이디어 탭의 화면 제목: 키워드 발굴.

| 탭 | 실제 전환 URL | 화면에서 추가 확인한 제목 |
| --- | --- | --- |
| 리스트 | [/app/keywords](https://haloxlabs.ai/app/keywords) | 탭 이름·주소 확인 |
| 세트 | [/app/keywords?view=sets](https://haloxlabs.ai/app/keywords?view=sets) | 탭 이름·주소 확인 |
| 태그 | [/app/keywords?view=tags](https://haloxlabs.ai/app/keywords?view=tags) | 탭 이름·주소 확인 |
| 네트워크 | [/app/keywords?view=network](https://haloxlabs.ai/app/keywords?view=network) | 탭 이름·주소 확인 |
| 아이디어 | [/app/keywords?view=ideas](https://haloxlabs.ai/app/keywords?view=ideas) | 키워드 발굴 |

기본 화면 표의 열: 세트 · 키워드, 태그, 순위, AI, 검색량, 트렌드, 의도, PAA, 연관 검색어, 추천 프롬프트, TTR, 진행.

### 3.3. 키워드 분석

- 메뉴 위치: 분석 → 키워드 분석
- URL: [/app/seo/insights](https://haloxlabs.ai/app/seo/insights)
- 용도: 검색 순위, AI 요약 인용, 자사 점유율을 분석하는 화면.

- 개요: 검색 엔진 노출 비교, 검색 엔진별 추이, Top 키워드 순위 흐름, 키워드 순위 요약, 순위 변동 TOP.
- 비교 엔진: Google SERP, Google AIO.
- 필터: 언어, 국가, 기간 시작 전 생성분, 세트, 태그, 집계 주기와 기간.
- 성과 탭에서 개별 키워드 상세 페이지로 이동 가능.

| 탭 | 실제 전환 URL | 화면에서 추가 확인한 제목 |
| --- | --- | --- |
| 개요 | [/app/seo/insights](https://haloxlabs.ai/app/seo/insights) | 검색 엔진 노출 비교 · Top 키워드 순위 흐름 · 키워드 순위 요약 · 순위 변동 TOP (28D) |
| 성과 | [/app/seo/insights?tab=performance](https://haloxlabs.ai/app/seo/insights?tab=performance) | 순위 변동 TOP |
| 경쟁사 | [/app/seo/insights?tab=competitors](https://haloxlabs.ai/app/seo/insights?tab=competitors) | 탭 이름·주소 확인 |
| 기회 | [/app/seo/insights?tab=opportunities](https://haloxlabs.ai/app/seo/insights?tab=opportunities) | 탭 이름·주소 확인 |
| AIO | [/app/seo/insights?tab=aio](https://haloxlabs.ai/app/seo/insights?tab=aio) | AIO 인용 분석 · AIO 요약 · AIO 추이 · AIO × Organic 교차 분석 · Volume × Gap Type · AIO 최적화 팁 |
| SERP 매트릭스 | [/app/seo/insights?tab=serp-matrix](https://haloxlabs.ai/app/seo/insights?tab=serp-matrix) | 탭 이름·주소 확인 |

기본 화면 표의 열: 검색 엔진, 노출·인용률, 분포, 평균 순위, 교차율.

### 3.4. 프롬프트 현황

- 메뉴 위치: 분석 → 프롬프트 현황
- URL: [/app/geo/prompts](https://haloxlabs.ai/app/geo/prompts)
- 용도: AI 응답에서 브랜드 노출을 확인하고 프롬프트를 관리하는 화면.

- 지표: 멘션율, 소스율, 인용률, 멘션 순위, 멘션 점유율, 소스 점유율, 인용 점유율, 인용 순위.
- 엔진 열: ChatGPT, Gemini, Pplx(Perplexity), Claude.
- 필터·보기: 기간 시작 전 생성분, 세트, 태그, 전체 엔진, 경쟁 상태, 자사·경쟁사 범위, 세트별 묶기.
- 주요 기능: Raw, 설정, 추가, 퍼널 현황.

| 탭 | 실제 전환 URL | 화면에서 추가 확인한 제목 |
| --- | --- | --- |
| 리스트 | [/app/geo/prompts](https://haloxlabs.ai/app/geo/prompts) | 탭 이름·주소 확인 |
| 세트 | [/app/geo/prompts?view=sets](https://haloxlabs.ai/app/geo/prompts?view=sets) | 탭 이름·주소 확인 |
| 태그 | [/app/geo/prompts?view=tags](https://haloxlabs.ai/app/geo/prompts?view=tags) | 탭 이름·주소 확인 |

기본 화면 표의 열: 프롬프트, 태그, ChatGPT, Gemini, Pplx, Claude, 프롬프트 분포, 멘션 순위.

### 3.5. 프롬프트 분석

- 메뉴 위치: 분석 → 프롬프트 분석
- URL: [/app/geo/analysis](https://haloxlabs.ai/app/geo/analysis)
- 용도: AI 답변의 자사 노출도와 경쟁사를 비교하는 화면.

- 개요: 엔진별 노출 비교, 세트·태그별 노출 비교와 추이.
- 인용 소스: 도메인 등장(Unique), 인용 건수(Total), 인용 상세, 인용 상위 도메인; 인용·소스와 율·점유율 기준 선택.
- 플랫폼: 엔진별 자사 인용률 추이, 인용 매체 비율 추이, 매체 안정성 분석, 엔진별 노출 매트릭스, 코어 매체 포트폴리오, 축별 매체 심층 분석.
- 공통 필터: 엔진, 세트, 태그, 기간 시작 전 생성분, 집계 주기와 기간.

| 탭 | 실제 전환 URL | 화면에서 추가 확인한 제목 |
| --- | --- | --- |
| 개요 | [/app/geo/analysis](https://haloxlabs.ai/app/geo/analysis) | 엔진별 노출 비교 · 세트/태그별 노출 비교 |
| 프롬프트 | [/app/geo/analysis?tab=prompts](https://haloxlabs.ai/app/geo/analysis?tab=prompts) | 탭 이름·주소 확인 |
| 멘션 | [/app/geo/analysis?tab=mentions](https://haloxlabs.ai/app/geo/analysis?tab=mentions) | 브랜드별 등장 (Unique) · 브랜드별 등장 (Total) · 멘션율 추이 · 멘션 상세 · 엔진별 멘션 |
| 인용 소스 | [/app/geo/analysis?tab=sources](https://haloxlabs.ai/app/geo/analysis?tab=sources) | 도메인 등장 (Unique) · 인용 건수 (Total) · 인용률 추이 · 인용 상위 도메인 |
| 상품 | [/app/geo/analysis?tab=products](https://haloxlabs.ai/app/geo/analysis?tab=products) | 탭 이름·주소 확인 |
| 인용 매트릭스 | [/app/geo/analysis?tab=matrix](https://haloxlabs.ai/app/geo/analysis?tab=matrix) | 탭 이름·주소 확인 |
| 경쟁사 | [/app/geo/analysis?tab=competitors](https://haloxlabs.ai/app/geo/analysis?tab=competitors) | 멘션율 추이 · 소스율 추이 · 인용률 추이 · 멘션 순위 분포 · 인용 순위 분포 |
| 플랫폼 | [/app/geo/analysis?tab=platforms](https://haloxlabs.ai/app/geo/analysis?tab=platforms) | 엔진별 자사 인용률 추이 · 엔진별 인용 매체 비율 추이 · 매체 안정성 분석 · 엔진별 노출 매트릭스 · 코어 매체 포트폴리오 · 축별 매체 심층 분석 |
| 검색 패턴 | [/app/geo/analysis?tab=fan-out](https://haloxlabs.ai/app/geo/analysis?tab=fan-out) | 전체 서브쿼리 탐색 0 |

기본 화면 표의 열: 엔진, 프롬프트, 멘션, 소스, 인용, 프롬프트 분포, 멘션 순위, 프롬프트 세트.

### 3.6. 전략맵

- 메뉴 위치: 전략 → 전략맵
- URL: [/app/strategy-map](https://haloxlabs.ai/app/strategy-map)
- 용도: 키워드 클러스터의 기회와 우선순위를 파악하는 화면.

- 요약: 전체 클러스터, 긴급, 기회, 유지.
- 리스트 항목: 클러스터, 키워드, 검색량, SEO, AIO, GEO, Gap 유형.
- 검색·필터: 클러스터·키워드 검색, 정렬, Gap 유형, 측정 상태.
- 주요 기능: AI 전략 리포트, 클러스터링 재실행, 클러스터명 수정.

| 탭 | 실제 전환 URL | 화면에서 추가 확인한 제목 |
| --- | --- | --- |
| 리스트 | [/app/strategy-map](https://haloxlabs.ai/app/strategy-map) | 탭 이름·주소 확인 |
| 포트폴리오 | [/app/strategy-map](https://haloxlabs.ai/app/strategy-map) | 탭 이름·주소 확인 |
| 네트워크 | [/app/strategy-map](https://haloxlabs.ai/app/strategy-map) | 탭 이름·주소 확인 |

탭을 전환해도 URL은 동일합니다. 해당 화면 안에서 탭을 선택해야 합니다.

### 3.7. 사이트 진단

- 메뉴 위치: 전략 → 사이트 진단
- URL: [/app/site-audit](https://haloxlabs.ai/app/site-audit)
- 용도: 검색과 AI 가시성을 저해하는 사이트의 기술적 문제를 확인하는 화면.

- 상단 항목: 진단 도메인·상태, 마지막 분석, 진단 페이지 수, 현재 진단, 진단 기록, Raw, 새 진단.
- 개요: SEO 분석, GEO 분석, 구조화 데이터, 테크니컬 SEO, 사이트 건강 진단.
- 구조화 데이터: Schema 분류 정책, 보유 비율, 누락 항목, 페이지 타입별 커버리지, 필수 스키마 매트릭스.
- 건강 진단: 깨진 링크, 중복 콘텐츠, 중복 태그, 리다이렉트 체인, 비인덱서블, 에러 페이지.
- AI 봇 접근성: robots.txt·llms.txt·sitemap.xml 정책 파일, 봇 접근성 매트릭스, 렌더링 방식, 페이지별 가시성, Core Web Vitals, 권장 액션.
- 페이지 탭: URL·메타·제목·설명·헤딩·스키마·캐노니컬·색인·링크·이미지·성능·HTTP·이슈 등 페이지별 진단 열.
- 가이드: AI 봇 정책, 검색 엔진, AI 검색·에이전트, 플랫폼 AI, robots.txt 템플릿과 작성 규칙.

| 탭 | 실제 전환 URL | 화면에서 추가 확인한 제목 |
| --- | --- | --- |
| 개요 | [/app/site-audit](https://haloxlabs.ai/app/site-audit) | SEO 분석 · GEO 분석 · 구조화 데이터 · 테크니컬 SEO · 사이트 건강 진단 · 봇 접근성 · 정책 파일 · 렌더링 진단 · AI 전략 리포트로 이어가기 |
| AI 봇 접근성 | [/app/site-audit?tab=bot-access](https://haloxlabs.ai/app/site-audit?tab=bot-access) | 정책 파일 · 등록 · 생성 · 검증 왕복 흐름 · 봇 접근성 매트릭스 · 렌더링 진단 측정 차단 · 렌더링 방식 진단 · 페이지별 가시성 · 성능 (Core Web Vitals) · 단계별 권장 액션 · 현황 확인 · 즉시 조치 · 검증 · 모니터링 |
| 이슈 | [/app/site-audit?tab=issues](https://haloxlabs.ai/app/site-audit?tab=issues) | 탭 이름·주소 확인 |
| 페이지 | [/app/site-audit?tab=pages](https://haloxlabs.ai/app/site-audit?tab=pages) | 탭 이름·주소 확인 |
| 엔티티 | [/app/site-audit?tab=entities](https://haloxlabs.ai/app/site-audit?tab=entities) | 탭 이름·주소 확인 |
| 내부 링크 | [/app/site-audit?tab=internal-links](https://haloxlabs.ai/app/site-audit?tab=internal-links) | 탭 이름·주소 확인 |
| 가이드 | [/app/site-audit?tab=guide](https://haloxlabs.ai/app/site-audit?tab=guide) | AI 봇 정책 · AI 봇 접근 정책 · 검색 엔진 · AI 검색 · 에이전트 · 플랫폼 AI · 권장 robots.txt 템플릿 · robots.txt 작성 규칙 |

기본 화면 표의 열: 타입 · 페이지, ORGANIZATION, WEBPAGE, BREADCRUMBLIST, COLLECTIONPAGE, ITEMLIST.

### 3.8. 콘텐츠 제작소

- 메뉴 위치: 실행 → 콘텐츠 제작소
- URL: [/app/factory](https://haloxlabs.ai/app/factory)
- 용도: 키워드 기반 콘텐츠를 생성·관리하는 화면.

- 화면 제목은 “콘텐츠 제작”.
- 주요 진입 항목: 새 콘텐츠 만들기.
- 관찰 상태: 생성된 콘텐츠가 없는 빈 화면. 콘텐츠가 있을 때의 편집·상세 화면은 미확인.

### 3.9. 콘텐츠 최적화

- 메뉴 위치: 실행 → 콘텐츠 최적화
- URL: [/app/optimize](https://haloxlabs.ai/app/optimize)
- 용도: 글이 AI에 인용되기 좋은 구조인지 채점하는 화면.

- 입력 방식: URL, 텍스트로 붙여넣기.
- 항목: 채점하기, 채점 기준 보기, 최근 채점.
- 핵심 조건: 결론 먼저 쓰기, 수치 근거, 출처 인용, 섹션 청킹.
- 주요 조건: FAQ, 핵심 요약, 표·리스트, 연도·기준 시점.
- 보조 조건: 최종 업데이트일, 저자·전문가 정보.

### 3.10. 콘텐츠 내보내기

- 메뉴 위치: 실행 → 콘텐츠 내보내기
- URL: [/app/exports](https://haloxlabs.ai/app/exports)
- 용도: 완료된 콘텐츠를 다운로드하는 화면.

- 필터: 유형, 기간, 정렬.
- 연결 항목: 콘텐츠 제작소로 이동.
- 관찰 상태: 내보낼 콘텐츠가 없는 빈 화면.

### 3.11. 모니터링 대시보드

- 메뉴 위치: 모니터링 → 모니터링 대시보드
- URL: [/app/monitoring](https://haloxlabs.ai/app/monitoring)
- 용도: GSC 검색 성과와 GA4 트래픽을 확인하는 화면.

- 연동 데이터: Google Search Console(검색 노출·클릭·순위), Google Analytics 4(오가닉·AI 트래픽·전환).
- 연결 항목: 연동 설정 열기, 연동 설정으로 이동.
- 관찰 상태: GSC·GA4 미연결 안내. 연동 후 차트와 세부 항목은 미확인.

### 3.12. 주간 리포트

- 메뉴 위치: 모니터링 → 주간 리포트
- URL: [/app/reports/weekly](https://haloxlabs.ai/app/reports/weekly)
- 용도: AI 가시성의 주간 진단과 우선순위를 확인하는 화면.

- 항목: 주차·기간, 이전 주차, 다음 주차, 내보내기.
- 연결 항목: AI 대화 모니터링 시작하기.
- 관찰 상태: 선택 주차에 생성된 리포트 없음.

### 3.13. 페르소나

- 메뉴 위치: 기타 → 페르소나
- URL: [/app/personas](https://haloxlabs.ai/app/personas)
- 용도: AI 글쓰기 스타일 프로필을 관리하는 화면.

- 기본 프로필 항목: 역할, 톤, 스타일; 시스템 기본 스타일은 수정 불가·기본 적용으로 표시.
- 주요 기능: 새 페르소나, 커스텀 페르소나 만들기.
- 커스텀 스타일은 글쓰기 샘플 분석을 통한 생성 안내.

### 3.14. 자료실

- 메뉴 위치: 기타 → 자료실
- URL: [/app/knowledgehub](https://haloxlabs.ai/app/knowledgehub)
- 용도: 제품과 토픽 엔티티를 관리하는 화면.

- 현황: 제품, 토픽, 클레임, 키워드.
- 분류·필터: 전체, 제품, 토픽, 수집 대기, 정렬.
- 주요 기능: 엔티티 추가.

기본 화면 표의 열: 이름, 유형, 클레임, 소스, 키워드, 수정일.

### 3.15. Raw 데이터

- 메뉴 위치: 기타 → Raw 데이터
- URL: [/app/raw-data](https://haloxlabs.ai/app/raw-data)
- 용도: 수집 원본을 CSV 묶음으로 다운로드하는 화면.

- 데이터 구분: 키워드 Raw(SERP·순위·AIO·PAA), 프롬프트 Raw(프롬프트·응답·fan-out), 사이트 진단 Raw(메타·페이지·이슈·점수), 모니터링 Raw(GSC·GA4 일별).
- 필터: 기간(7일·14일·28일·90일), 언어, 국가, 엔진, 동일 항목 최신 1건만.
- 출력 항목: 예상 다운로드 행 수, 정규화 CSV 묶음 ZIP, README.txt.
- 기타: 유의사항·데이터 정책.

## 4. 추가 페이지와 상세 화면

| 진입 위치 | 페이지 | URL / 경로 | 주요 항목 |
| --- | --- | --- | --- |
| 공개 홈의 GEO 대시보드 링크 | AI 대화 개요 | [/app/geo](https://haloxlabs.ai/app/geo) | AI 노출 종합점수, 멘션율·인용률·멘션 순위·인용 순위, 질문 세트, 인용 점유율, 경쟁사 점유율 요약, 상세 분석 보기 |
| 대시보드 바로가기 | 기회 분석 | [/app/gap](https://haloxlabs.ai/app/gap) | 기회 점수, 키워드 건강 분포, 우선 조치, 검색 × AI 매트릭스, 경쟁사 맵, 콘텐츠·트렌드 |
| 계정 메뉴 | 추천 프로그램 | [/app/referral](https://haloxlabs.ai/app/referral) | 파트너 신청, 이름/상호, 연락받을 이메일, 휴대폰 번호, 소개 채널, 시작하기 |
| 계정 메뉴 | 피드백 | [/app/feedback](https://haloxlabs.ai/app/feedback) | 피드백 보드, 새 피드백, 필터, 정렬, 빈 목록 안내 |
| 워크스페이스 메뉴 | 워크스페이스 관리 | [/app/workspaces](https://haloxlabs.ai/app/workspaces) | 워크스페이스 선택, 플랜·사용량 카드, 상세, 새 워크스페이스 만들기 |
| 키워드 분석의 성과 탭 | 키워드 상세 | `/app/keywords/:keywordId` | 엔진별 현황, 추천 프롬프트, 콘텐츠 전략 추천, 태그 추가, URL 등록 |

`/app/keywords/:keywordId`는 실제 키워드 상세 주소 한 건을 열어 확인한 경로 형식입니다. `:keywordId`는 데이터마다 달라지므로 그대로 접속하는 주소가 아닙니다.

키워드 상세의 탭: **상위 결과, AI 요약, 검색 결과 분석, 트렌드, 아이디어, GEO 연결**. 주요 지표는 자사·경쟁사 순위, AI 인용, SERP 특성, VOL, CPC, KD, COMP입니다.

### 기회 분석 탭

| 탭 | URL | 추가 확인 항목 |
| --- | --- | --- |
| 개요 | [/app/gap](https://haloxlabs.ai/app/gap) | 키워드 건강 분포 · 키워드 건강 현황 · 우선 조치 항목 Top 5 |
| 매트릭스 | [/app/gap](https://haloxlabs.ai/app/gap) | 검색 × AI 키워드 매트릭스 |
| 키워드 | [/app/gap](https://haloxlabs.ai/app/gap) | 탭 이름·주소 확인 |
| 프롬프트 | [/app/gap](https://haloxlabs.ai/app/gap) | 탭 이름·주소 확인 |
| 경쟁사 | [/app/gap](https://haloxlabs.ai/app/gap) | 위협 순위 · 경쟁사 맵 |
| 콘텐츠 | [/app/gap](https://haloxlabs.ai/app/gap) | 미작성 10 |
| 트렌드 | [/app/gap](https://haloxlabs.ai/app/gap) | 기회 점수 추이 · 분포 추이 · 해결된 Gap 0 · 새로운 Gap 0 |

기회 분석의 탭은 같은 URL 안에서 전환됩니다.

### 주소 이동과 별칭

| 진입 주소 | 관찰된 도착 주소 | 설명 |
| --- | --- | --- |
| [/app/reports](https://haloxlabs.ai/app/reports) | [/app/reports/weekly](https://haloxlabs.ai/app/reports/weekly) | 대시보드 “리포트” 링크의 이동 결과 |
| [/app](https://haloxlabs.ai/app) | [/app/login](https://haloxlabs.ai/app/login) | 비로그인 Firecrawl 요청에서는 로그인 화면으로 이동 |

## 5. 설정 메뉴 12개

설정은 앱 위에 열리는 다이얼로그이며, 왼쪽 메뉴를 선택하면 `tab` 쿼리가 바뀝니다. 기본 진입 주소는 [/app/settings](https://haloxlabs.ai/app/settings)입니다.

| 메뉴 | 실제 URL | 주요 항목 |
| --- | --- | --- |
| 워크스페이스 | [/app/settings?tab=workspace](https://haloxlabs.ai/app/settings?tab=workspace) | 워크스페이스 이름·ID·생성일, robots.txt·sitemap.xml·llms.txt 정책 파일 URL, 저장, 계정 탈퇴 요청 |
| 멤버 | [/app/settings?tab=members](https://haloxlabs.ai/app/settings?tab=members) | 멤버 초대, 멤버 목록, 역할별 권한 매트릭스(소유자·관리자·편집자·뷰어), 섹션별 접근 권한 |
| 일반 | [/app/settings](https://haloxlabs.ai/app/settings) | 인터페이스 언어(한국어·English), 분석 언어, 대상 국가, 프롬프트 자동 생성 |
| 사용량 | [/app/settings?tab=plan](https://haloxlabs.ai/app/settings?tab=plan) | 키워드·AI 프롬프트·콘텐츠·사이트 진단 사용량, 재설정일, 새로고침, 플랜 변경, 최근 활동 |
| 구독/결제 | [/app/settings?tab=billing](https://haloxlabs.ai/app/settings?tab=billing) | 현재 플랜, 플랜 변경, 등록 카드·카드 등록, 결제 내역, 세금계산서 안내, 결제 문의 |
| 연동 | [/app/settings?tab=integrations](https://haloxlabs.ai/app/settings?tab=integrations) | Google 통합 계정 연결, Search Console·Analytics 4; 네이버 서치어드바이저·Bing·Slack은 준비 중 |
| 브랜드 트래킹 | [/app/settings?tab=brand-tracking](https://haloxlabs.ai/app/settings?tab=brand-tracking) | 도메인 매칭 정책(루트·전체), 자사·경쟁사 브랜드, 멘션·도메인·상품, 별칭 매핑, 과거 데이터 재계산, 자사 제품 라인업 |
| 태그 | [/app/settings?tab=tags](https://haloxlabs.ai/app/settings?tab=tags) | 태그 그룹 관리, 새 그룹; 키워드와 프롬프트가 태그를 함께 사용 |
| 등록 URL | [/app/settings?tab=earned](https://haloxlabs.ai/app/settings?tab=earned) | 외부 채널 발행 URL 등록, CSV 업로드, 첫 URL 등록하기 |
| 내보내기 | [/app/settings?tab=export](https://haloxlabs.ai/app/settings?tab=export) | 발행인 이름·URL, 작성자 이름·프로필 URL, 구조화 데이터 미리보기, 스키마 복사, 변경 사항 저장 |
| 알림 | [/app/settings?tab=notifications](https://haloxlabs.ai/app/settings?tab=notifications) | 준비 중 안내 |
| API & MCP | [/app/settings?tab=api](https://haloxlabs.ai/app/settings?tab=api) | 키 관리·사용량·한도 탭, API 키 이름·만료·발급·권한 범위, 외부 도구 연결 방법 |

API & MCP 연결 방법 탭: **Claude Code (CLI), Claude 앱 (커스텀 커넥터), REST API**. 실제 키 발급이나 권한 변경은 수행하지 않았습니다.

## 6. 공통 메뉴와 지원 항목

| 영역 | 항목 | 확인 내용 |
| --- | --- | --- |
| 상단 | 사이드바 토글, 경로 표시 | 현재 페이지 위치 및 메뉴 펼침·접힘 |
| 상단 | AI 프롬프트 사용량 | 사용량 비율과 초기화 시점 안내 |
| 계정 | Pro로 업그레이드, 설정, 결제, 알림 | 메뉴 항목 확인; 설정 내 사용량·구독/결제·알림 항목은 별도 확인 |
| 계정 | 추천 프로그램, 피드백 | 4절의 독립 페이지 |
| 계정 | 문서 | [HaloX 문서](https://docs.haloxlabs.ai/)로 연결; 별도 문서 사이트 내부는 수집 범위 밖 |
| 계정 | 로그아웃 | 동작 항목; 별도 콘텐츠 페이지로 세지 않음 |
| 사이드바 하단 | 도움이 필요하신가요? | SEO/GEO 컨설팅, 서비스 개선 피드백 |
| 사이드바 하단 | 체험 잔여 기간, 플랜 보기 | 계정 상태에 따른 표시 |
| 워크스페이스 | 내 워크스페이스, 관리, 새로 만들기 | 작업 공간 선택과 관리 진입 |
| 대시보드 | 빠른 탐색 | 검색 성과 분석·AI 대화 분석·기회 분석·리포트 바로가기 영역 펼침 |

## 7. 로그인·가입·복구 화면

| 페이지 | URL | 입력·동작 항목 |
| --- | --- | --- |
| 로그인 | [/app/login](https://haloxlabs.ai/app/login) | Email, Password, Sign In, Forgot password?, 회원가입하기, 이용약관, 개인정보 처리방침 |
| 회원가입 | [/app/signup](https://haloxlabs.ai/app/signup) | 이름, 휴대폰 번호, 국가번호, 인증번호 발송, 이메일, 비밀번호, 비밀번호 확인, 가입하기, 로그인으로 돌아가기 |
| 비밀번호 재설정 요청 | [/app/forgot-password](https://haloxlabs.ai/app/forgot-password) | Email, Send reset link, Back to sign in |

위 3개 화면은 Firecrawl로 본문을 확인했습니다. 인증번호 발송·가입·재설정 메일 전송은 실행하지 않았습니다.

## 8. 공개 웹사이트 메뉴와 URL 목록

### 공개 홈에서 확인한 메뉴

- 상단: 제품, 리소스, 고객 사례, 가격 안내, 도입 문의, 로그인 / 무료 시작.
- 주요 연결: 기능, 워크플로우, 연동, 무료 도구, 문서, 블로그, 용어 사전, 측정 방식, 리서치, 컨설팅, 도입 문의.
- 회사·지원·정책: 소개, 보안, 파트너 추천, 업데이트 소식, FAQ, 개인정보 처리방침, 이용약관, 환불 정책.

### Firecrawl Map 발견 목록

아래는 Firecrawl Map이 반환한 **258개 URL 전체**입니다. 언어별 경로, 과거 주소, 추천 파라미터가 있는 주소를 원본대로 보존했습니다. 제목이 없는 항목은 임의의 페이지명을 붙이지 않고 경로 식별자를 표시했습니다. 제목은 검색·사이트맵 인덱스의 값이므로 현재 화면 제목과 다를 수 있습니다.

| 언어 / 경로 | 발견 URL 수 |
| --- | --- |
| en | 85 |
| id | 1 |
| ko | 163 |
| vi | 1 |
| zh | 4 |
| 기타 | 4 |

#### ko / authors (3개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 1 | 제목 미제공 · /ko/authors | [/ko/authors](https://haloxlabs.ai/ko/authors) |
| 2 | Author - HaloX | [/ko/authors/jaechullee](https://haloxlabs.ai/ko/authors/jaechullee) |
| 3 | 제목 미제공 · /ko/authors/juny-lee | [/ko/authors/juny-lee](https://haloxlabs.ai/ko/authors/juny-lee) |

#### ko / blog (77개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 4 | 블로그 \| HaloX | [/ko/blog](https://haloxlabs.ai/ko/blog) |
| 5 | 제목 미제공 · /ko/blog/aeo-brand-consensus-ownership | [/ko/blog/aeo-brand-consensus-ownership](https://haloxlabs.ai/ko/blog/aeo-brand-consensus-ownership) |
| 6 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/ko/blog/agentic-commerce-geo](https://haloxlabs.ai/ko/blog/agentic-commerce-geo) |
| 7 | 제목 미제공 · /ko/blog/agentic-workflow-patterns | [/ko/blog/agentic-workflow-patterns](https://haloxlabs.ai/ko/blog/agentic-workflow-patterns) |
| 8 | 제목 미제공 · /ko/blog/ai-content-pipeline | [/ko/blog/ai-content-pipeline](https://haloxlabs.ai/ko/blog/ai-content-pipeline) |
| 9 | 제목 미제공 · /ko/blog/ai-crawler-observability | [/ko/blog/ai-crawler-observability](https://haloxlabs.ai/ko/blog/ai-crawler-observability) |
| 10 | 제목 미제공 · /ko/blog/ai-customer-product-info-structure | [/ko/blog/ai-customer-product-info-structure](https://haloxlabs.ai/ko/blog/ai-customer-product-info-structure) |
| 11 | 제목 미제공 · /ko/blog/ai-kpi | [/ko/blog/ai-kpi](https://haloxlabs.ai/ko/blog/ai-kpi) |
| 12 | 제목 미제공 · /ko/blog/ai-platform-citation-comparison-data | [/ko/blog/ai-platform-citation-comparison-data](https://haloxlabs.ai/ko/blog/ai-platform-citation-comparison-data) |
| 13 | 제목 미제공 · /ko/blog/ai-search-10-gate-diagnostic-checklist | [/ko/blog/ai-search-10-gate-diagnostic-checklist](https://haloxlabs.ai/ko/blog/ai-search-10-gate-diagnostic-checklist) |
| 14 | 제목 미제공 · /ko/blog/ai-search-attribution-gap-reporting-framework | [/ko/blog/ai-search-attribution-gap-reporting-framework](https://haloxlabs.ai/ko/blog/ai-search-attribution-gap-reporting-framework) |
| 15 | 제목 미제공 · /ko/blog/ai-search-citation-count-before-diagnosis | [/ko/blog/ai-search-citation-count-before-diagnosis](https://haloxlabs.ai/ko/blog/ai-search-citation-count-before-diagnosis) |
| 16 | 제목 미제공 · /ko/blog/ai-search-delegation-recommendation-action-path | [/ko/blog/ai-search-delegation-recommendation-action-path](https://haloxlabs.ai/ko/blog/ai-search-delegation-recommendation-action-path) |
| 17 | 제목 미제공 · /ko/blog/ai-search-fake-brand-entity-coherence | [/ko/blog/ai-search-fake-brand-entity-coherence](https://haloxlabs.ai/ko/blog/ai-search-fake-brand-entity-coherence) |
| 18 | 제목 미제공 · /ko/blog/ai-search-fan-out-market-landscape | [/ko/blog/ai-search-fan-out-market-landscape](https://haloxlabs.ai/ko/blog/ai-search-fan-out-market-landscape) |
| 19 | 제목 미제공 · /ko/blog/ai-search-location-service-page-checklist | [/ko/blog/ai-search-location-service-page-checklist](https://haloxlabs.ai/ko/blog/ai-search-location-service-page-checklist) |
| 20 | 제목 미제공 · /ko/blog/ai-search-measurement-framework | [/ko/blog/ai-search-measurement-framework](https://haloxlabs.ai/ko/blog/ai-search-measurement-framework) |
| 21 | 제목 미제공 · /ko/blog/ai-traffic-small-but-strategic | [/ko/blog/ai-traffic-small-but-strategic](https://haloxlabs.ai/ko/blog/ai-traffic-small-but-strategic) |
| 22 | 제목 미제공 · /ko/blog/ai-visibility-metrics-beyond-avi | [/ko/blog/ai-visibility-metrics-beyond-avi](https://haloxlabs.ai/ko/blog/ai-visibility-metrics-beyond-avi) |
| 23 | 제목 미제공 · /ko/blog/ai-visibility-single-score-risk | [/ko/blog/ai-visibility-single-score-risk](https://haloxlabs.ai/ko/blog/ai-visibility-single-score-risk) |
| 24 | 제목 미제공 · /ko/blog/avi-score-explained | [/ko/blog/avi-score-explained](https://haloxlabs.ai/ko/blog/avi-score-explained) |
| 25 | 제목 미제공 · /ko/blog/backlink-strategy-2026 | [/ko/blog/backlink-strategy-2026](https://haloxlabs.ai/ko/blog/backlink-strategy-2026) |
| 26 | 제목 미제공 · /ko/blog/brand-entity-seo-for-ai-search | [/ko/blog/brand-entity-seo-for-ai-search](https://haloxlabs.ai/ko/blog/brand-entity-seo-for-ai-search) |
| 27 | 제목 미제공 · /ko/blog/brand-sov-measurement | [/ko/blog/brand-sov-measurement](https://haloxlabs.ai/ko/blog/brand-sov-measurement) |
| 28 | 제목 미제공 · /ko/blog/chatgpt-citation-retrieval-fit | [/ko/blog/chatgpt-citation-retrieval-fit](https://haloxlabs.ai/ko/blog/chatgpt-citation-retrieval-fit) |
| 29 | 제목 미제공 · /ko/blog/chatgpt-optimization-guide | [/ko/blog/chatgpt-optimization-guide](https://haloxlabs.ai/ko/blog/chatgpt-optimization-guide) |
| 30 | 제목 미제공 · /ko/blog/commerce-geo-google-product-pack-sales-channel | [/ko/blog/commerce-geo-google-product-pack-sales-channel](https://haloxlabs.ai/ko/blog/commerce-geo-google-product-pack-sales-channel) |
| 31 | 제목 미제공 · /ko/blog/competitor-seo-geo-analysis | [/ko/blog/competitor-seo-geo-analysis](https://haloxlabs.ai/ko/blog/competitor-seo-geo-analysis) |
| 32 | 제목 미제공 · /ko/blog/content-dual-optimization | [/ko/blog/content-dual-optimization](https://haloxlabs.ai/ko/blog/content-dual-optimization) |
| 33 | 제목 미제공 · /ko/blog/content-optimization-workflow | [/ko/blog/content-optimization-workflow](https://haloxlabs.ai/ko/blog/content-optimization-workflow) |
| 34 | 제목 미제공 · /ko/blog/eeat-complete-guide | [/ko/blog/eeat-complete-guide](https://haloxlabs.ai/ko/blog/eeat-complete-guide) |
| 35 | 제목 미제공 · /ko/blog/eeat-content-checklist | [/ko/blog/eeat-content-checklist](https://haloxlabs.ai/ko/blog/eeat-content-checklist) |
| 36 | 제목 미제공 · /ko/blog/fan-out-geo-content-strategy | [/ko/blog/fan-out-geo-content-strategy](https://haloxlabs.ai/ko/blog/fan-out-geo-content-strategy) |
| 37 | 제목 미제공 · /ko/blog/faq-rich-results-deprecation-qa-evidence-structure | [/ko/blog/faq-rich-results-deprecation-qa-evidence-structure](https://haloxlabs.ai/ko/blog/faq-rich-results-deprecation-qa-evidence-structure) |
| 38 | 제목 미제공 · /ko/blog/featured-snippet-paa-strategy | [/ko/blog/featured-snippet-paa-strategy](https://haloxlabs.ai/ko/blog/featured-snippet-paa-strategy) |
| 39 | 제목 미제공 · /ko/blog/ga4-ai-assistant-channel-ai-search-measurement | [/ko/blog/ga4-ai-assistant-channel-ai-search-measurement](https://haloxlabs.ai/ko/blog/ga4-ai-assistant-channel-ai-search-measurement) |
| 40 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/ko/blog/geo-content-structure](https://haloxlabs.ai/ko/blog/geo-content-structure) |
| 41 | 제목 미제공 · /ko/blog/geo-reputation-brand-consensus | [/ko/blog/geo-reputation-brand-consensus](https://haloxlabs.ai/ko/blog/geo-reputation-brand-consensus) |
| 42 | 제목 미제공 · /ko/blog/geo-vs-seo-vs-aeo | [/ko/blog/geo-vs-seo-vs-aeo](https://haloxlabs.ai/ko/blog/geo-vs-seo-vs-aeo) |
| 43 | 제목 미제공 · /ko/blog/geocommerce | [/ko/blog/geocommerce](https://haloxlabs.ai/ko/blog/geocommerce) |
| 44 | 제목 미제공 · /ko/blog/google-core-update-geo-analysis | [/ko/blog/google-core-update-geo-analysis](https://haloxlabs.ai/ko/blog/google-core-update-geo-analysis) |
| 45 | 제목 미제공 · /ko/blog/google-geo-aeo-safety-line | [/ko/blog/google-geo-aeo-safety-line](https://haloxlabs.ai/ko/blog/google-geo-aeo-safety-line) |
| 46 | 제목 미제공 · /ko/blog/google-search-console-ai-report-geo-measurement | [/ko/blog/google-search-console-ai-report-geo-measurement](https://haloxlabs.ai/ko/blog/google-search-console-ai-report-geo-measurement) |
| 47 | 제목 미제공 · /ko/blog/gpt-fan-out-search-analysis | [/ko/blog/gpt-fan-out-search-analysis](https://haloxlabs.ai/ko/blog/gpt-fan-out-search-analysis) |
| 48 | 제목 미제공 · /ko/blog/halox-ai-agent-building-story | [/ko/blog/halox-ai-agent-building-story](https://haloxlabs.ai/ko/blog/halox-ai-agent-building-story) |
| 49 | 제목 미제공 · /ko/blog/hierarchical-classification | [/ko/blog/hierarchical-classification](https://haloxlabs.ai/ko/blog/hierarchical-classification) |
| 50 | 제목 미제공 · /ko/blog/how-to-get-cited-by-ai | [/ko/blog/how-to-get-cited-by-ai](https://haloxlabs.ai/ko/blog/how-to-get-cited-by-ai) |
| 51 | 제목 미제공 · /ko/blog/keyword-expansion-5-signal | [/ko/blog/keyword-expansion-5-signal](https://haloxlabs.ai/ko/blog/keyword-expansion-5-signal) |
| 52 | 제목 미제공 · /ko/blog/keyword-research-intent-based | [/ko/blog/keyword-research-intent-based](https://haloxlabs.ai/ko/blog/keyword-research-intent-based) |
| 53 | 제목 미제공 · /ko/blog/korean-seo-geo-differences | [/ko/blog/korean-seo-geo-differences](https://haloxlabs.ai/ko/blog/korean-seo-geo-differences) |
| 54 | 제목 미제공 · /ko/blog/llms-txt-agentic-browsing-readiness | [/ko/blog/llms-txt-agentic-browsing-readiness](https://haloxlabs.ai/ko/blog/llms-txt-agentic-browsing-readiness) |
| 55 | 제목 미제공 · /ko/blog/llms-txt-setup-guide | [/ko/blog/llms-txt-setup-guide](https://haloxlabs.ai/ko/blog/llms-txt-setup-guide) |
| 56 | 제목 미제공 · /ko/blog/naver-ai-briefing-citation-count-geo-kpi | [/ko/blog/naver-ai-briefing-citation-count-geo-kpi](https://haloxlabs.ai/ko/blog/naver-ai-briefing-citation-count-geo-kpi) |
| 57 | 제목 미제공 · /ko/blog/naver-ai-briefing-longtail-query-search-behavior | [/ko/blog/naver-ai-briefing-longtail-query-search-behavior](https://haloxlabs.ai/ko/blog/naver-ai-briefing-longtail-query-search-behavior) |
| 58 | 제목 미제공 · /ko/blog/naver-ai-tab-execution-kpi-action-path | [/ko/blog/naver-ai-tab-execution-kpi-action-path](https://haloxlabs.ai/ko/blog/naver-ai-tab-execution-kpi-action-path) |
| 59 | 제목 미제공 · /ko/blog/naver-geo-guide-ai-briefing-mate | [/ko/blog/naver-geo-guide-ai-briefing-mate](https://haloxlabs.ai/ko/blog/naver-geo-guide-ai-briefing-mate) |
| 60 | 제목 미제공 · /ko/blog/offsite-aeo-moat | [/ko/blog/offsite-aeo-moat](https://haloxlabs.ai/ko/blog/offsite-aeo-moat) |
| 61 | 제목 미제공 · /ko/blog/on-page-seo-checklist-2026 | [/ko/blog/on-page-seo-checklist-2026](https://haloxlabs.ai/ko/blog/on-page-seo-checklist-2026) |
| 62 | 제목 미제공 · /ko/blog/openai-crawl-channel-signal | [/ko/blog/openai-crawl-channel-signal](https://haloxlabs.ai/ko/blog/openai-crawl-channel-signal) |
| 63 | 제목 미제공 · /ko/blog/pev-workflow-case-study | [/ko/blog/pev-workflow-case-study](https://haloxlabs.ai/ko/blog/pev-workflow-case-study) |
| 64 | 제목 미제공 · /ko/blog/prompt-level-ai-search-experiment | [/ko/blog/prompt-level-ai-search-experiment](https://haloxlabs.ai/ko/blog/prompt-level-ai-search-experiment) |
| 65 | 제목 미제공 · /ko/blog/prompt-tracking-monitoring | [/ko/blog/prompt-tracking-monitoring](https://haloxlabs.ai/ko/blog/prompt-tracking-monitoring) |
| 66 | 제목 미제공 · /ko/blog/rag-hallucination-defense | [/ko/blog/rag-hallucination-defense](https://haloxlabs.ai/ko/blog/rag-hallucination-defense) |
| 67 | 제목 미제공 · /ko/blog/schema-ai-citation-hygiene | [/ko/blog/schema-ai-citation-hygiene](https://haloxlabs.ai/ko/blog/schema-ai-citation-hygiene) |
| 68 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/ko/blog/schema-markup-practical](https://haloxlabs.ai/ko/blog/schema-markup-practical) |
| 69 | 제목 미제공 · /ko/blog/seo-fundamentals-ai-era | [/ko/blog/seo-fundamentals-ai-era](https://haloxlabs.ai/ko/blog/seo-fundamentals-ai-era) |
| 70 | 제목 미제공 · /ko/blog/seo-geo-keyword-strategy-framework | [/ko/blog/seo-geo-keyword-strategy-framework](https://haloxlabs.ai/ko/blog/seo-geo-keyword-strategy-framework) |
| 71 | 제목 미제공 · /ko/blog/seo-geo-metrics-guide | [/ko/blog/seo-geo-metrics-guide](https://haloxlabs.ai/ko/blog/seo-geo-metrics-guide) |
| 72 | 제목 미제공 · /ko/blog/seo-geo-top-exposure-strategy | [/ko/blog/seo-geo-top-exposure-strategy](https://haloxlabs.ai/ko/blog/seo-geo-top-exposure-strategy) |
| 73 | 제목 미제공 · /ko/blog/seo-geo-unified-strategy | [/ko/blog/seo-geo-unified-strategy](https://haloxlabs.ai/ko/blog/seo-geo-unified-strategy) |
| 74 | 제목 미제공 · /ko/blog/topical-authority-cluster-design | [/ko/blog/topical-authority-cluster-design](https://haloxlabs.ai/ko/blog/topical-authority-cluster-design) |
| 75 | 토픽 \| HaloX | [/ko/blog/topics](https://haloxlabs.ai/ko/blog/topics) |
| 76 | 제목 미제공 · /ko/blog/topics/ai-trends | [/ko/blog/topics/ai-trends](https://haloxlabs.ai/ko/blog/topics/ai-trends) |
| 77 | geo - HaloX | [/ko/blog/topics/geo](https://haloxlabs.ai/ko/blog/topics/geo) |
| 78 | 제목 미제공 · /ko/blog/what-is-geo-optimization | [/ko/blog/what-is-geo-optimization](https://haloxlabs.ai/ko/blog/what-is-geo-optimization) |
| 79 | 제목 미제공 · /ko/blog/why-chatgpt-cites-listicles | [/ko/blog/why-chatgpt-cites-listicles](https://haloxlabs.ai/ko/blog/why-chatgpt-cites-listicles) |
| 80 | 제목 미제공 · /ko/blog/why-reddit-search-matters-in-ai-search-2026 | [/ko/blog/why-reddit-search-matters-in-ai-search-2026](https://haloxlabs.ai/ko/blog/why-reddit-search-matters-in-ai-search-2026) |

#### ko / compare (4개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 81 | 제목 미제공 · /ko/compare/ahrefs | [/ko/compare/ahrefs](https://haloxlabs.ai/ko/compare/ahrefs) |
| 82 | HaloX vs Otterly: AI 검색 모니터링 비교 (2026) | [/ko/compare/otterly](https://haloxlabs.ai/ko/compare/otterly) |
| 83 | HaloX vs Profound: AI 대화 + SEO 플랫폼 비교 (2026) | [/ko/compare/profound](https://haloxlabs.ai/ko/compare/profound) |
| 84 | 제목 미제공 · /ko/compare/semrush | [/ko/compare/semrush](https://haloxlabs.ai/ko/compare/semrush) |

#### ko / customers (3개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 85 | 고객 사례 \| HaloX | [/ko/customers](https://haloxlabs.ai/ko/customers) |
| 86 | Growthly - 고객 사례 - HaloX | [/ko/customers/growthly](https://haloxlabs.ai/ko/customers/growthly) |
| 87 | ShopNest - 고객 사례 - HaloX | [/ko/customers/shopnest](https://haloxlabs.ai/ko/customers/shopnest) |

#### ko / features (3개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 88 | 제목 미제공 · /ko/features | [/ko/features](https://haloxlabs.ai/ko/features) |
| 89 | GEO Dashboard - HaloX | [/ko/features/analytics](https://haloxlabs.ai/ko/features/analytics) |
| 90 | Content Studio - HaloX | [/ko/features/content](https://haloxlabs.ai/ko/features/content) |

#### ko / glossary (42개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 91 | 제목 미제공 · /ko/glossary | [/ko/glossary](https://haloxlabs.ai/ko/glossary) |
| 92 | 제목 미제공 · /ko/glossary/aeo | [/ko/glossary/aeo](https://haloxlabs.ai/ko/glossary/aeo) |
| 93 | 제목 미제공 · /ko/glossary/ai-brand-mentions | [/ko/glossary/ai-brand-mentions](https://haloxlabs.ai/ko/glossary/ai-brand-mentions) |
| 94 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/ko/glossary/ai-citation](https://haloxlabs.ai/ko/glossary/ai-citation) |
| 95 | 제목 미제공 · /ko/glossary/ai-crawlers | [/ko/glossary/ai-crawlers](https://haloxlabs.ai/ko/glossary/ai-crawlers) |
| 96 | 제목 미제공 · /ko/glossary/ai-overview | [/ko/glossary/ai-overview](https://haloxlabs.ai/ko/glossary/ai-overview) |
| 97 | 제목 미제공 · /ko/glossary/avi | [/ko/glossary/avi](https://haloxlabs.ai/ko/glossary/avi) |
| 98 | 제목 미제공 · /ko/glossary/backlink | [/ko/glossary/backlink](https://haloxlabs.ai/ko/glossary/backlink) |
| 99 | 제목 미제공 · /ko/glossary/brand-sov | [/ko/glossary/brand-sov](https://haloxlabs.ai/ko/glossary/brand-sov) |
| 100 | 제목 미제공 · /ko/glossary/citation-rate | [/ko/glossary/citation-rate](https://haloxlabs.ai/ko/glossary/citation-rate) |
| 101 | 제목 미제공 · /ko/glossary/citation-sov | [/ko/glossary/citation-sov](https://haloxlabs.ai/ko/glossary/citation-sov) |
| 102 | 콘텐츠 클러스터란? - 뜻과 의미 \| Halox 용어 사전 | [/ko/glossary/content-cluster](https://haloxlabs.ai/ko/glossary/content-cluster) |
| 103 | 제목 미제공 · /ko/glossary/content-optimization | [/ko/glossary/content-optimization](https://haloxlabs.ai/ko/glossary/content-optimization) |
| 104 | 제목 미제공 · /ko/glossary/ctr | [/ko/glossary/ctr](https://haloxlabs.ai/ko/glossary/ctr) |
| 105 | 제목 미제공 · /ko/glossary/domain-authority | [/ko/glossary/domain-authority](https://haloxlabs.ai/ko/glossary/domain-authority) |
| 106 | 제목 미제공 · /ko/glossary/e-e-a-t | [/ko/glossary/e-e-a-t](https://haloxlabs.ai/ko/glossary/e-e-a-t) |
| 107 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/ko/glossary/eeat](https://haloxlabs.ai/ko/glossary/eeat) |
| 108 | 추천 스니펫란? - 뜻과 의미 \| Halox 용어 사전 | [/ko/glossary/featured-snippet](https://haloxlabs.ai/ko/glossary/featured-snippet) |
| 109 | 제목 미제공 · /ko/glossary/geo | [/ko/glossary/geo](https://haloxlabs.ai/ko/glossary/geo) |
| 110 | 내부 링크란? - 뜻과 의미 \| Halox 용어 사전 | [/ko/glossary/internal-linking](https://haloxlabs.ai/ko/glossary/internal-linking) |
| 111 | 제목 미제공 · /ko/glossary/json-ld | [/ko/glossary/json-ld](https://haloxlabs.ai/ko/glossary/json-ld) |
| 112 | 제목 미제공 · /ko/glossary/keyword | [/ko/glossary/keyword](https://haloxlabs.ai/ko/glossary/keyword) |
| 113 | 제목 미제공 · /ko/glossary/keyword-difficulty | [/ko/glossary/keyword-difficulty](https://haloxlabs.ai/ko/glossary/keyword-difficulty) |
| 114 | 제목 미제공 · /ko/glossary/llm | [/ko/glossary/llm](https://haloxlabs.ai/ko/glossary/llm) |
| 115 | LLM SEO란? - 뜻과 의미 \| Halox 용어 사전 | [/ko/glossary/llm-seo](https://haloxlabs.ai/ko/glossary/llm-seo) |
| 116 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/ko/glossary/llms-txt](https://haloxlabs.ai/ko/glossary/llms-txt) |
| 117 | 제목 미제공 · /ko/glossary/meta-tags | [/ko/glossary/meta-tags](https://haloxlabs.ai/ko/glossary/meta-tags) |
| 118 | 제목 미제공 · /ko/glossary/on-page-seo | [/ko/glossary/on-page-seo](https://haloxlabs.ai/ko/glossary/on-page-seo) |
| 119 | 제목 미제공 · /ko/glossary/organic-traffic | [/ko/glossary/organic-traffic](https://haloxlabs.ai/ko/glossary/organic-traffic) |
| 120 | PAA (함께 묻는 질문)란? - 뜻과 의미 \| Halox 용어 사전 | [/ko/glossary/paa](https://haloxlabs.ai/ko/glossary/paa) |
| 121 | 제목 미제공 · /ko/glossary/prompt-tracking | [/ko/glossary/prompt-tracking](https://haloxlabs.ai/ko/glossary/prompt-tracking) |
| 122 | 제목 미제공 · /ko/glossary/query-fan-out | [/ko/glossary/query-fan-out](https://haloxlabs.ai/ko/glossary/query-fan-out) |
| 123 | RAG (검색 증강 생성)란? - 뜻과 의미 \| Halox 용어 사전 | [/ko/glossary/rag](https://haloxlabs.ai/ko/glossary/rag) |
| 124 | 제목 미제공 · /ko/glossary/schema-markup | [/ko/glossary/schema-markup](https://haloxlabs.ai/ko/glossary/schema-markup) |
| 125 | 제목 미제공 · /ko/glossary/search-intent | [/ko/glossary/search-intent](https://haloxlabs.ai/ko/glossary/search-intent) |
| 126 | 제목 미제공 · /ko/glossary/search-volume | [/ko/glossary/search-volume](https://haloxlabs.ai/ko/glossary/search-volume) |
| 127 | 제목 미제공 · /ko/glossary/seo | [/ko/glossary/seo](https://haloxlabs.ai/ko/glossary/seo) |
| 128 | 제목 미제공 · /ko/glossary/serp | [/ko/glossary/serp](https://haloxlabs.ai/ko/glossary/serp) |
| 129 | 제목 미제공 · /ko/glossary/technical-seo | [/ko/glossary/technical-seo](https://haloxlabs.ai/ko/glossary/technical-seo) |
| 130 | Top 10 비율란? — 뜻과 의미 \| Halox 용어 사전 | [/ko/glossary/top10-ratio](https://haloxlabs.ai/ko/glossary/top10-ratio) |
| 131 | 제목 미제공 · /ko/glossary/topical-authority | [/ko/glossary/topical-authority](https://haloxlabs.ai/ko/glossary/topical-authority) |
| 132 | 제목 미제공 · /ko/glossary/zero-click-search | [/ko/glossary/zero-click-search](https://haloxlabs.ai/ko/glossary/zero-click-search) |

#### ko / solutions (2개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 133 | 제목 미제공 · /ko/solutions/agency | [/ko/solutions/agency](https://haloxlabs.ai/ko/solutions/agency) |
| 134 | 제목 미제공 · /ko/solutions/in-house | [/ko/solutions/in-house](https://haloxlabs.ai/ko/solutions/in-house) |

#### ko / tag (4개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 135 | Ai Traffic - 태그별 글 \| HaloX | [/ko/tag/ai-traffic](https://haloxlabs.ai/ko/tag/ai-traffic) |
| 136 | Rag - 태그별 글 \| HaloX | [/ko/tag/rag](https://haloxlabs.ai/ko/tag/rag) |
| 137 | Retrieval Fit - 태그별 글 \| HaloX | [/ko/tag/retrieval-fit](https://haloxlabs.ai/ko/tag/retrieval-fit) |
| 138 | Semrush - 태그별 글 \| HaloX | [/ko/tag/semrush](https://haloxlabs.ai/ko/tag/semrush) |

#### ko / tools (3개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 139 | 제목 미제공 · /ko/tools | [/ko/tools](https://haloxlabs.ai/ko/tools) |
| 140 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/ko/tools/ai-questions](https://haloxlabs.ai/ko/tools/ai-questions) |
| 141 | 제목 미제공 · /ko/tools/site-audit | [/ko/tools/site-audit](https://haloxlabs.ai/ko/tools/site-audit) |

#### ko / use-cases (5개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 142 | 제목 미제공 · /ko/use-cases | [/ko/use-cases](https://haloxlabs.ai/ko/use-cases) |
| 143 | 제목 미제공 · /ko/use-cases/brand-monitoring | [/ko/use-cases/brand-monitoring](https://haloxlabs.ai/ko/use-cases/brand-monitoring) |
| 144 | 제목 미제공 · /ko/use-cases/competitor-analysis | [/ko/use-cases/competitor-analysis](https://haloxlabs.ai/ko/use-cases/competitor-analysis) |
| 145 | 제목 미제공 · /ko/use-cases/content-optimization | [/ko/use-cases/content-optimization](https://haloxlabs.ai/ko/use-cases/content-optimization) |
| 146 | 제목 미제공 · /ko/use-cases/seo-geo-integration | [/ko/use-cases/seo-geo-integration](https://haloxlabs.ai/ko/use-cases/seo-geo-integration) |

#### ko / 기본·회사·지원 페이지 (17개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 147 | 제목 미제공 · /ko | [/ko](https://haloxlabs.ai/ko) |
| 148 | HaloX 소개 | [/ko/about](https://haloxlabs.ai/ko/about) |
| 149 | 업데이트 소식 \| HaloX | [/ko/changelog](https://haloxlabs.ai/ko/changelog) |
| 150 | SEO·GEO 컨설팅 - HaloX | [/ko/consulting](https://haloxlabs.ai/ko/consulting) |
| 151 | Ads & Affiliate Disclosure - 헤일로X(haloX) | [/ko/disclosure](https://haloxlabs.ai/ko/disclosure) |
| 152 | FAQ - HaloX | [/ko/faq](https://haloxlabs.ai/ko/faq) |
| 153 | 제목 미제공 · /ko/feedback | [/ko/feedback](https://haloxlabs.ai/ko/feedback) |
| 154 | 연동 — HaloX | [/ko/integrations](https://haloxlabs.ai/ko/integrations) |
| 155 | 우리의 측정 방식 - HaloX가 검색을 보는 법 \| HaloX | [/ko/methodology](https://haloxlabs.ai/ko/methodology) |
| 156 | 파트너 추천 프로그램 - HaloX | [/ko/partners](https://haloxlabs.ai/ko/partners) |
| 157 | 제목 미제공 · /ko/pricing | [/ko/pricing](https://haloxlabs.ai/ko/pricing) |
| 158 | 개인정보처리방침 & 쿠키 설정 - HaloX | [/ko/privacy](https://haloxlabs.ai/ko/privacy) |
| 159 | 제목 미제공 · /ko/refund-policy | [/ko/refund-policy](https://haloxlabs.ai/ko/refund-policy) |
| 160 | 제목 미제공 · /ko/research | [/ko/research](https://haloxlabs.ai/ko/research) |
| 161 | 제목 미제공 · /ko/security | [/ko/security](https://haloxlabs.ai/ko/security) |
| 162 | 제목 미제공 · /ko/terms | [/ko/terms](https://haloxlabs.ai/ko/terms) |
| 163 | 워크플로우 - HaloX | [/ko/workflows](https://haloxlabs.ai/ko/workflows) |

#### en / authors (3개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 164 | 제목 미제공 · /en/authors | [/en/authors](https://haloxlabs.ai/en/authors) |
| 165 | 제목 미제공 · /en/authors/jaechullee | [/en/authors/jaechullee](https://haloxlabs.ai/en/authors/jaechullee) |
| 166 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/en/authors/juny-lee](https://haloxlabs.ai/en/authors/juny-lee) |

#### en / blog (3개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 167 | Blog \| HaloX | [/en/blog](https://haloxlabs.ai/en/blog) |
| 168 | 제목 미제공 · /en/blog/topics | [/en/blog/topics](https://haloxlabs.ai/en/blog/topics) |
| 169 | 제목 미제공 · /en/blog/topics/ai-trends | [/en/blog/topics/ai-trends](https://haloxlabs.ai/en/blog/topics/ai-trends) |

#### en / compare (4개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 170 | 제목 미제공 · /en/compare/ahrefs | [/en/compare/ahrefs](https://haloxlabs.ai/en/compare/ahrefs) |
| 171 | HaloX vs Otterly: AI Search Monitoring Comparison (2026) | [/en/compare/otterly](https://haloxlabs.ai/en/compare/otterly) |
| 172 | 제목 미제공 · /en/compare/profound | [/en/compare/profound](https://haloxlabs.ai/en/compare/profound) |
| 173 | HaloX vs Semrush: AI-Powered SEO Comparison (2026) | [/en/compare/semrush](https://haloxlabs.ai/en/compare/semrush) |

#### en / customers (2개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 174 | 제목 미제공 · /en/customers | [/en/customers](https://haloxlabs.ai/en/customers) |
| 175 | ShopNest - Customer Story \| HaloX | [/en/customers/shopnest](https://haloxlabs.ai/en/customers/shopnest) |

#### en / features (2개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 176 | 제목 미제공 · /en/features | [/en/features](https://haloxlabs.ai/en/features) |
| 177 | GEO Dashboard — HaloX | [/en/features/analytics](https://haloxlabs.ai/en/features/analytics) |

#### en / glossary (41개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 178 | SEO & GEO Glossary - Key Terms Explained \| Halox | [/en/glossary](https://haloxlabs.ai/en/glossary) |
| 179 | 제목 미제공 · /en/glossary/aeo | [/en/glossary/aeo](https://haloxlabs.ai/en/glossary/aeo) |
| 180 | 제목 미제공 · /en/glossary/ai-brand-mentions | [/en/glossary/ai-brand-mentions](https://haloxlabs.ai/en/glossary/ai-brand-mentions) |
| 181 | 제목 미제공 · /en/glossary/ai-citation | [/en/glossary/ai-citation](https://haloxlabs.ai/en/glossary/ai-citation) |
| 182 | 제목 미제공 · /en/glossary/ai-crawlers | [/en/glossary/ai-crawlers](https://haloxlabs.ai/en/glossary/ai-crawlers) |
| 183 | 제목 미제공 · /en/glossary/ai-overview | [/en/glossary/ai-overview](https://haloxlabs.ai/en/glossary/ai-overview) |
| 184 | 제목 미제공 · /en/glossary/avi | [/en/glossary/avi](https://haloxlabs.ai/en/glossary/avi) |
| 185 | 제목 미제공 · /en/glossary/backlink | [/en/glossary/backlink](https://haloxlabs.ai/en/glossary/backlink) |
| 186 | 제목 미제공 · /en/glossary/brand-sov | [/en/glossary/brand-sov](https://haloxlabs.ai/en/glossary/brand-sov) |
| 187 | 제목 미제공 · /en/glossary/citation-rate | [/en/glossary/citation-rate](https://haloxlabs.ai/en/glossary/citation-rate) |
| 188 | 제목 미제공 · /en/glossary/citation-sov | [/en/glossary/citation-sov](https://haloxlabs.ai/en/glossary/citation-sov) |
| 189 | 제목 미제공 · /en/glossary/content-cluster | [/en/glossary/content-cluster](https://haloxlabs.ai/en/glossary/content-cluster) |
| 190 | 제목 미제공 · /en/glossary/content-optimization | [/en/glossary/content-optimization](https://haloxlabs.ai/en/glossary/content-optimization) |
| 191 | What is CTR (Click-Through Rate)? — Definition & Meaning | [/en/glossary/ctr](https://haloxlabs.ai/en/glossary/ctr) |
| 192 | 제목 미제공 · /en/glossary/domain-authority | [/en/glossary/domain-authority](https://haloxlabs.ai/en/glossary/domain-authority) |
| 193 | 제목 미제공 · /en/glossary/e-e-a-t | [/en/glossary/e-e-a-t](https://haloxlabs.ai/en/glossary/e-e-a-t) |
| 194 | 제목 미제공 · /en/glossary/featured-snippet | [/en/glossary/featured-snippet](https://haloxlabs.ai/en/glossary/featured-snippet) |
| 195 | 제목 미제공 · /en/glossary/geo | [/en/glossary/geo](https://haloxlabs.ai/en/glossary/geo) |
| 196 | 제목 미제공 · /en/glossary/internal-linking | [/en/glossary/internal-linking](https://haloxlabs.ai/en/glossary/internal-linking) |
| 197 | What is JSON-LD? - Definition & Meaning \| Halox Glossary | [/en/glossary/json-ld](https://haloxlabs.ai/en/glossary/json-ld) |
| 198 | 제목 미제공 · /en/glossary/keyword | [/en/glossary/keyword](https://haloxlabs.ai/en/glossary/keyword) |
| 199 | 제목 미제공 · /en/glossary/keyword-difficulty | [/en/glossary/keyword-difficulty](https://haloxlabs.ai/en/glossary/keyword-difficulty) |
| 200 | 제목 미제공 · /en/glossary/llm | [/en/glossary/llm](https://haloxlabs.ai/en/glossary/llm) |
| 201 | 제목 미제공 · /en/glossary/llm-seo | [/en/glossary/llm-seo](https://haloxlabs.ai/en/glossary/llm-seo) |
| 202 | 제목 미제공 · /en/glossary/llms-txt | [/en/glossary/llms-txt](https://haloxlabs.ai/en/glossary/llms-txt) |
| 203 | 제목 미제공 · /en/glossary/meta-tags | [/en/glossary/meta-tags](https://haloxlabs.ai/en/glossary/meta-tags) |
| 204 | 제목 미제공 · /en/glossary/on-page-seo | [/en/glossary/on-page-seo](https://haloxlabs.ai/en/glossary/on-page-seo) |
| 205 | 제목 미제공 · /en/glossary/organic-traffic | [/en/glossary/organic-traffic](https://haloxlabs.ai/en/glossary/organic-traffic) |
| 206 | 제목 미제공 · /en/glossary/paa | [/en/glossary/paa](https://haloxlabs.ai/en/glossary/paa) |
| 207 | 제목 미제공 · /en/glossary/prompt-tracking | [/en/glossary/prompt-tracking](https://haloxlabs.ai/en/glossary/prompt-tracking) |
| 208 | 제목 미제공 · /en/glossary/query-fan-out | [/en/glossary/query-fan-out](https://haloxlabs.ai/en/glossary/query-fan-out) |
| 209 | 제목 미제공 · /en/glossary/rag | [/en/glossary/rag](https://haloxlabs.ai/en/glossary/rag) |
| 210 | 제목 미제공 · /en/glossary/schema-markup | [/en/glossary/schema-markup](https://haloxlabs.ai/en/glossary/schema-markup) |
| 211 | 제목 미제공 · /en/glossary/search-intent | [/en/glossary/search-intent](https://haloxlabs.ai/en/glossary/search-intent) |
| 212 | 제목 미제공 · /en/glossary/search-volume | [/en/glossary/search-volume](https://haloxlabs.ai/en/glossary/search-volume) |
| 213 | 제목 미제공 · /en/glossary/seo | [/en/glossary/seo](https://haloxlabs.ai/en/glossary/seo) |
| 214 | 제목 미제공 · /en/glossary/serp | [/en/glossary/serp](https://haloxlabs.ai/en/glossary/serp) |
| 215 | 제목 미제공 · /en/glossary/technical-seo | [/en/glossary/technical-seo](https://haloxlabs.ai/en/glossary/technical-seo) |
| 216 | 제목 미제공 · /en/glossary/top10-ratio | [/en/glossary/top10-ratio](https://haloxlabs.ai/en/glossary/top10-ratio) |
| 217 | 제목 미제공 · /en/glossary/topical-authority | [/en/glossary/topical-authority](https://haloxlabs.ai/en/glossary/topical-authority) |
| 218 | 제목 미제공 · /en/glossary/zero-click-search | [/en/glossary/zero-click-search](https://haloxlabs.ai/en/glossary/zero-click-search) |

#### en / solutions (2개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 219 | 제목 미제공 · /en/solutions/agency | [/en/solutions/agency](https://haloxlabs.ai/en/solutions/agency) |
| 220 | 제목 미제공 · /en/solutions/in-house | [/en/solutions/in-house](https://haloxlabs.ai/en/solutions/in-house) |

#### en / tools (5개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 221 | 제목 미제공 · /en/tools | [/en/tools](https://haloxlabs.ai/en/tools) |
| 222 | 제목 미제공 · /en/tools/ai-questions | [/en/tools/ai-questions](https://haloxlabs.ai/en/tools/ai-questions) |
| 223 | 젠스파크 - HaloX | [/en/tools/genspark](https://haloxlabs.ai/en/tools/genspark) |
| 224 | Lovable - 헤일로X(haloX) | [/en/tools/lovable](https://haloxlabs.ai/en/tools/lovable) |
| 225 | 제목 미제공 · /en/tools/site-audit | [/en/tools/site-audit](https://haloxlabs.ai/en/tools/site-audit) |

#### en / use-cases (5개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 226 | Use Cases - AI Visibility for Every Team \| HaloX | [/en/use-cases](https://haloxlabs.ai/en/use-cases) |
| 227 | 제목 미제공 · /en/use-cases/brand-monitoring | [/en/use-cases/brand-monitoring](https://haloxlabs.ai/en/use-cases/brand-monitoring) |
| 228 | 제목 미제공 · /en/use-cases/competitor-analysis | [/en/use-cases/competitor-analysis](https://haloxlabs.ai/en/use-cases/competitor-analysis) |
| 229 | 제목 미제공 · /en/use-cases/content-optimization | [/en/use-cases/content-optimization](https://haloxlabs.ai/en/use-cases/content-optimization) |
| 230 | 제목 미제공 · /en/use-cases/seo-geo-integration | [/en/use-cases/seo-geo-integration](https://haloxlabs.ai/en/use-cases/seo-geo-integration) |

#### en / 기본·회사·지원 페이지 (18개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 231 | HaloX - SEO & GEO Platform \| AI Search Optimization | [/en](https://haloxlabs.ai/en) |
| 232 | 제목 미제공 · /en/about | [/en/about](https://haloxlabs.ai/en/about) |
| 233 | Changelog \| HaloX | [/en/changelog](https://haloxlabs.ai/en/changelog) |
| 234 | SEO & GEO Consulting - HaloX | [/en/consulting](https://haloxlabs.ai/en/consulting) |
| 235 | Ads & Affiliate Disclosure - 헤일로X(haloX) | [/en/disclosure](https://haloxlabs.ai/en/disclosure) |
| 236 | 제목 미제공 · /en/faq | [/en/faq](https://haloxlabs.ai/en/faq) |
| 237 | 제목 미제공 · /en/feedback | [/en/feedback](https://haloxlabs.ai/en/feedback) |
| 238 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/en/free-tools](https://haloxlabs.ai/en/free-tools) |
| 239 | Integrations - 헤일로X(haloX) | [/en/integrations](https://haloxlabs.ai/en/integrations) |
| 240 | 제목 미제공 · /en/methodology | [/en/methodology](https://haloxlabs.ai/en/methodology) |
| 241 | 제목 미제공 · /en/pricing | [/en/pricing](https://haloxlabs.ai/en/pricing) |
| 242 | 제목 미제공 · /en/privacy | [/en/privacy](https://haloxlabs.ai/en/privacy) |
| 243 | 제목 미제공 · /en/refund-policy | [/en/refund-policy](https://haloxlabs.ai/en/refund-policy) |
| 244 | AI Citation Research - 헤일로X(haloX) | [/en/research](https://haloxlabs.ai/en/research) |
| 245 | Security & Trust — HaloX | [/en/security](https://haloxlabs.ai/en/security) |
| 246 | 제목 미제공 · /en/terms | [/en/terms](https://haloxlabs.ai/en/terms) |
| 247 | Topics \| HaloX | [/en/topics](https://haloxlabs.ai/en/topics) |
| 248 | Workflows — HaloX | [/en/workflows](https://haloxlabs.ai/en/workflows) |

#### id / 기본·회사·지원 페이지 (1개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 249 | haloxlabs.ai | [/id](https://haloxlabs.ai/id) |

#### vi / 기본·회사·지원 페이지 (1개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 250 | Contact Us - haloxlabs.ai | [/vi/contact](https://haloxlabs.ai/vi/contact) |

#### zh / blog (1개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 251 | Topics \| HaloX | [/zh/blog/topics](https://haloxlabs.ai/zh/blog/topics) |

#### zh / 기본·회사·지원 페이지 (3개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 252 | Halox — AI 대화 최적화 플랫폼 | [/zh/about](https://haloxlabs.ai/zh/about) |
| 253 | Contact Us - haloxlabs.ai | [/zh/contact](https://haloxlabs.ai/zh/contact) |
| 254 | Pricing - HaloX | [/zh/pricing](https://haloxlabs.ai/zh/pricing) |

#### 기타 / 기타 주소 (4개)

| 번호 | 제목 또는 경로 식별자 | URL |
| --- | --- | --- |
| 255 | HaloX - SEO & AI 검색 최적화 플랫폼 | [/](https://haloxlabs.ai) |
| 256 | HaloX \| 헤일로X - AI 대화 최적화 플랫폼 | [/?ref=CUZCE8SM](https://haloxlabs.ai/?ref=CUZCE8SM) |
| 257 | AI 대화 최적화 플랫폼 - HaloX \| 헤일로X | [/blog/topics/geo](https://haloxlabs.ai/blog/topics/geo) |
| 258 | 헤일로X - AI 대화 최적화 플랫폼 - HaloX | [/tag](https://haloxlabs.ai/tag) |

### 홈에서 추가 발견한 공개 주소

| 항목 | URL | 근거 |
| --- | --- | --- |
| 도입 문의 | [/ko/contact-sales](https://haloxlabs.ai/ko/contact-sales) | 공개 홈 링크 |
| 도입 문의 — 온보딩 진입 | [/ko/contact-sales?type=onboarding&from=home_support](https://haloxlabs.ai/ko/contact-sales?type=onboarding&from=home_support) | 공개 홈 지원 영역의 링크; 위 페이지의 쿼리 변형 |

## 9. 확인 상태와 수집 근거

- **실제 화면 확인**: 앱의 사이드바 15개 페이지, 추가 페이지, 설정 12개 항목, 분석·전략 탭의 메뉴명과 URL.
- **빈 상태 / 제한 상태**: 콘텐츠 제작·내보내기·주간 리포트는 데이터가 없는 상태였고, 모니터링은 GSC·GA4 미연결 상태였습니다. 해당 조건이 충족된 후의 화면 구성은 확인하지 않았습니다.
- **준비 중**: 설정의 알림, 연동의 네이버 서치어드바이저·Bing·Slack.
- **공개 URL 발견만 확인**: 부록의 Map URL 258개 및 홈에서 발견한 추가 링크. 현재 유효성·본문 전체 수집을 의미하지 않습니다.
- **제외 범위**: 계정별 모든 레코드의 상세 URL 나열, 권한 밖 관리자 화면, 콘텐츠 생성 후에만 나타나는 화면, 결제 완료 후 흐름, 외부 문서 사이트 전체.
- 클릭형 메뉴·탭·조회로 수집했으며 콘텐츠 생성, 결제, 회원가입, 초대 발송, 설정 저장, 재분석 실행은 하지 않았습니다.

수집 파일은 [sources 폴더](/Users/user01/Desktop/haloX/docs/sources)에 보관했습니다. Firecrawl 원본은 [초기 수집 JSON](/Users/user01/Desktop/haloX/docs/sources/firecrawl-initial.json)과 [추가 수집 JSON](/Users/user01/Desktop/haloX/docs/sources/firecrawl-extra.json), 앱 화면 근거는 개별 JSON 파일입니다.
