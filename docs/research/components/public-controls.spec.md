# PublicControls
- 대상 src/components/public-controls.ts. 기준 docs/research/public-interactions.json.
- 클릭 FAQ 29개, 가격월간/연간 및 제품미리보기40개 상태는 원본 DOM을 사용.
- 각각 button text→captured panelHtml. FAQ는 해당 trigger 바로 아래 접고펼치기, aria-expanded동기화. 유지되는 section단위 tab전환은 captured section innerHTML 교체.
- 스타일 originalCSS이며 새 추정값 사용하지 않음. header메뉴 원본 grid880px/리소스/문의320px DOM 별도 navcomponent에 전달.
- hover/animation source stylesheet, 모바일390 동일 native breakpoints.
- 메뉴 links 실제본 데이터사용. bodyDOM original scripts외부폼 제출 제거, assets local rewrite.
