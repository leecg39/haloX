# 후속 계획과 진행 상태

현재 페이지 클론의 구현·검토·수정은 완료했다. 다음 단계는 결과의 회귀 방지부터 시작했다.

| 우선순위 | 작업 | 상태 | 완료 기준 |
|---|---|---|---|
| P0 | GitHub Actions에서 타입 검사·빌드·363개 경로 검증 | 완료 | main push와 PR에서 workflow 실행 |
| P0 | 공개 사이트 REA 역공학 및 상호작용 반영 (FAQ, 요금 계산기, 검색·분류, CTA) | 완료 | `npm run verify:public` 9개 검증 통과 및 CI 연동 |
| P1 | 원본 사이트가 바뀔 때 수집 데이터 차이 보고 (`scripts/diff-manifest.mjs`) | 완료 | `npm run diff:manifest`로 기준 매니페스트 대비 주소·제목·상태·길이 diff 생성 및 자체 테스트 통과 |
| P1 | 대표 화면 시각 회귀 자동화 (`scripts/verify-visual-regression.mjs`) | 완료 | `npm run verify:visual`로 65개 디자인 토큰·14개 대표 화면·6개 데스크톱/모바일/대화상자 기준 이미지·18개 라우트 스크린샷 대조 통과 |
| P2 | 실제 백엔드/DB 연동 확장 (`supabase/`, `src/lib/metrics`, `src/lib/backend`, `/api/v1/*`) | 완료 | 27개 SQL 테이블·RLS 격리·36종 RPC·6종 Edge 파이프라인·점수 엔진 구현 및 `npm run verify:backend` / REA 원장 `ready` (`required_open: 0`) 달성 |

모든 P0~P2 항목의 구현·검증·CI 연동을 완료했다.
