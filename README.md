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
npm run build
npm run start -- -p 3001
```

개발 실행은 `npm run dev -- -p 3001`입니다. 같은 포트에서 실행 중인 서버가 있다면 종료한 뒤 실행하거나 다른 포트를 지정하세요.

이미 준비된 `public/clone` 파일을 사용하므로 실행 시 원본 사이트에 로그인하거나 다시 수집할 필요가 없습니다.

실제 인증·결제·SEO/AI 분석 백엔드는 연결하지 않았습니다. 입력·저장·추가는 로컬 데모이며, 차트와 분석 수치는 수집 당시 상태입니다. 원본에서 404로 응답한 73개 페이지는 원본 404 화면으로 재현했습니다.
