# HaloX 클론 화면 구조

- 대상: docs/page.md의 실제 URL 322개(앱62·공개260) + 같은 URL에서 전환되는 앱 탭.
- 앱: 고정 256px 사이드바 → 헤더 breadcrumb → 독립 스크롤 main → 카드·탭·표·chart. md=768px 미만 사이드바는 drawer. 공통 도움말과 빠른탐색 overlay 존재.
- 공개: 최상단 상담 배너 → sticky 헤더 및 dropdown → 페이지별 main → CTA → footer → back-to-top. 홈의 각 section은 스크롤 진입으로 노출되며 클릭 기반 탭과 FAQ가 있음.
- 설정: 앱 shell 위 Radix portal dialog; 일반, 워크스페이스, 멤버, 사용량, 결제, 연동, 브랜드, 태그, URL, 내보내기, 알림, API 탭.
- 공개 하위 유형: 홈, 기능 소개, 비교, 고객 사례, 가격, 컨설팅, 문의, 블로그 목록·본문, 저자, 용어, 약관·개인정보.
- 현재 원본에서 404인 주소는 404 본문을 보존. 지도 URL 자체가 유효성을 보장하지 않음.
- 페이지를 이미지로 붙이지 않고 원본 semantic DOM을 React element로 변환. CSS와 SVG·폰트·이미지는 로컬 파일 사용.
- 원본 JavaScript와 인증 API는 실행하지 않음. 버튼·입력·메뉴·tabs는 local React interaction components가 담당.
