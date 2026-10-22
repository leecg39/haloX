# Workspaces
- Source: docs/sources/_app_workspaces.json의 확인된 UI 문구.
- 현 세션에서 /app/workspaces는 자동으로 /app로 이동하므로 현재 화면의 pixel 검증은 불가능. 로컬에서는 기존 목록의 선택 화면을 재구성한다.
- DOM: centered workspace heading + description + 새 워크스페이스 만들기, 브리찌 Trial card, 10/20키워드 · 10/20 AI Questions ·0/1콘텐츠, 상세 button.
- sharedCSS tokens: white background, #1f1f1f text, muted#6e6e6e,border#e6e6e6,radius12. Layout is inferred not extracted; explicitly record limitation.
- click card enters/app; 상세 opens settingsworkspace; create opens local dialog and persists record.
- responsive maxwidth960, pad24, cardcolumns 3→1 below768.
