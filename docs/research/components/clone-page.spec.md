# ClonePage 및 페이지 데이터

- 대상: src/components/ClonePage.tsx, src/lib/content.ts, catch-all page.tsx, scripts/prepare-content.mjs
- 모델: 수집한 semantic DOM을 React element로 변환. SSR로 모든 경로 제공. 원본 전체 CSS/폰트/SVG 보존.
- Source: docs/research/captures의 DOM·computed JSON 343개; 1440/768/390 비교 PNG.
- 원본 페이지 전체를 이미지로 삽입하지 않는다. 텍스트·링크·입력·표·아이콘은 실제 DOM. canvas만 수집시점 raster chart asset.
- font Pretendard400/500/600/700/800와 GeistMono300..600 파일; body rgb31; white bg; sidebar256px/hsl36 9%95%; bordersrgb230.
- URL-query 탭 state, Radix 설정 portal, authform, bodyclass 보존. 데이터처리/메뉴/modal은 공통 독립 모듈 사용.
- 검증: 모든 sourceURL route의 SSR200 및 .clone-surface 존재, 빠진 asset 검사, 대표 desktop/mobile screenshots.
- 공개 fade-in 요소 opacity0 상태를 content와 함께 보존하되 로컬 observer로 노출. native responsive stylesheet breakpoint768px.
- 원본 폼action/스크립트/iframe 제거, 동일사이트 href를 local경로로 변환. 원본 인증/분석API 사용하지 않는다.
