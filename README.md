# HaloX 로컬 클론

`docs/page.md`에 있는 322개 주소와 추가 메뉴·탭을 포함한 363개 화면 상태를 Next.js로 구현한 로컬 프런트엔드입니다.

- 앱: [http://localhost:3001/app](http://localhost:3001/app)
- 공개 사이트: [http://localhost:3001/ko](http://localhost:3001/ko)
- [전체 페이지 목록](docs/clone/coverage.md)
- [실행 방법·구현 범위](docs/clone/README.md)
- [검증 결과와 재현 순서](docs/clone/QA.md)
- [적대적 검토 결과](docs/clone/adversarial-review.md)
- [후속 계획](docs/clone/next-plan.md)
- [REA 공개 사이트 역공학·반영 결과](docs/rea/public-site/README.md)

## 실행

Node.js 22에서 검증했습니다. 프로젝트 폴더에서 실행하세요.

```bash
npm ci
npm run typecheck
npm run build
npm run verify:public
npm run diff:manifest -- --fail-on-drift
npm run verify:visual
npm run verify:backend
npm run start -- -p 3001
```

개발 실행은 `npm run dev -- -p 3001`입니다. 같은 포트에서 실행 중인 서버가 있다면 종료한 뒤 실행하거나 다른 포트를 지정하세요.

이미 준비된 `public/clone` 파일을 사용하므로 실행 시 원본 사이트에 로그인하거나 다시 수집할 필요가 없습니다.

백엔드 계층은 `supabase/migrations/20261022000000_halox_schema.sql`(27개 테이블 + RLS + RPC), `src/lib/metrics/`(GEO/SEO/AVI 점수 엔진), `src/lib/backend/`(관계형 스토어·RLS 격리·36종 RPC·6종 Edge 파이프라인·결정적 Provider 목업) 및 Next.js `/api/v1/*` 엔드포인트로 구성되어 외부 유료 API 키 없이도 전체 읽기·쓰기 계약과 쿼터 예약-확정 흐름을 검증할 수 있습니다. 원본에서 404로 응답한 73개 페이지는 원본 404 화면으로 재현했습니다.
