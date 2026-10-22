# 관찰된 동작과 로컬 대응

## 원본 관찰
- 앱 sidebar 그룹은 클릭으로 접고 펼치며, 전체 sidebar는 header toggle로 변경. 데스크톱256px, 모바일768px 미만 hidden/drawer.
- 앱 tabs는 클릭 전환. URL query(view/tab)가 있는 상태는 경로 그대로 사용하고 URL이 유지되는 상태는 cloneTab query로 로컬 식별.
- 설정은 modal dialog로 열리고 별도 tab query로 전환. Escape/close로 닫기.
- 키워드/프롬프트 list는 검색 입력, 필터, 정렬, 선택, 페이지네이션 제공.
- 공개 header는 제품/리소스/도입문의 dropdown, language menu. 모바일 hamburger.
- 공개 home section은 viewport 진입 시 opacity·transform 변경. 추출 단계에서 전체 scroll sweep해 모든 내용을 확보.
- 링크/버튼 hover는 원본 stylesheet transition에 따름. transition-smooth: all .2s cubic-bezier(.4,0,.2,1).
- FAQ는 click accordion. TOP 클릭은 window smooth scroll.
- 폼은 가입/로그인/문의/데모 분석. 원본에 제출하지 않고 로컬 데모 안내와 저장 상태로 처리.

## 경계
- 실제 인증, 결제, 서버 분석, 외부 연동은 연결하지 않음.
- 원본 canvas 차트는 수집 시점 차트 이미지를 보존. 실시간 chart 데이터 갱신은 수행하지 않음.
- localStorage에는 클론에서 사용자가 입력한 데모 데이터만 저장.
