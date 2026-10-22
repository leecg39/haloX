# 디자인 시스템 (역공학 확정본)

> 근거: E4-2 `p4-css-tokens.json`(`index-BjzOpcfp.css` 431KB, sha256 기록), E4-1 라우트 스크린샷 18장 + REA 로그인 화면 스크린샷, E1-1 번들(shadcn Sidebar 상수).
> 비유: 원본 UI는 "흰 종이 위에 검은 잉크, 신호등 색은 상태 표시에만" 쓰는 사무용 문서 스타일입니다. 브랜드 컬러는 차트와 점수 게이지에만 아껴 씁니다.

## 1. 기반 [관찰]

- **Tailwind CSS + shadcn/ui** 토큰 규약: `:root`에 `H S% L%` 형식 CSS 변수, 사용처는 `hsl(var(--token))`. Radix 프리미티브(`data-radix`), `vaul`(Drawer), `cmdk`(Command), `sonner`(Toast) 사용.
- **다크 모드 없음**: CSS에 `.dark{}` 블록 부재 [관찰]. 클론은 라이트 우선, 다크는 선택 사항.
- 아이콘: `lucide-react` (99개 청크에서 참조).
- 차트: **ECharts**(네트워크·매트릭스·대형 시계열, canvas renderer) + **Recharts**(카드 스파크라인·소형 차트) 혼용.

## 2. 색상 토큰 [관찰 — 값 그대로]

| 역할 | 토큰 | HSL |
|---|---|---|
| 배경/전경 | `--background` / `--foreground` | 0 0% 100% / 0 0% 12% |
| 주색(검정 CTA) | `--primary` / `--primary-foreground` | 0 0% 12% / 0 0% 100% |
| 보조 | `--secondary`, `--muted` | 0 0% 95%, 0 0% 96% |
| 보조 텍스트 | `--muted-foreground` | 0 0% 43% |
| 테두리/입력 | `--border`, `--input` | 0 0% 90% |
| 성공 | `--success` / `--success-strong` | 142 76% 36% / 142 72% 29% |
| 경고 | `--warning` / `--warning-strong` | 38 92% 50% / 26 90% 37% |
| 위험 | `--destructive` / `--destructive-strong` | 0 84% 60% / 0 84% 40% |
| 정보 | `--info` / `--info-strong` | 199 89% 48% / 199 89% 30% |
| 사이드바 | `--sidebar-background` / `--sidebar-accent` / `--sidebar-border` | 36 9% 95% / 36 8% 91% / 36 7% 88% (따뜻한 회색) |
| 표면 | `--surface-subtle` / `--surface-elevated` | 0 0% 98% / 0 0% 96% |
| 브랜드 팔레트 | `--brand-blue` `--brand-purple` `--brand-geo` `--brand-ochre` `--brand-cherry` | 236 52% 60% · 248 33% 60% · 127 37% 59% · 33 96% 43% · 345 80% 55% |
| 차트 자사 강조 | `--chart-own` | 43 96% 42% |
| 신호/하이라이트 | `--signal`, `--highlight` | 217 70% 42%, 210 100% 92% |
| 회색 스케일 | `--gray-50` … `--gray-900` | L 98 → 9% (채도 0) |

의미 규칙 [관찰 · 스크린샷+문서]: 자사=초록/파랑, 경쟁사=빨강, 경합(양측)=주황, 미점유/데이터 없음=회색. 점수 게이지는 `--brand-blue`, 상태 배지는 저채도 배경 + `*-strong` 텍스트.

> 컴플라이언스: 클론은 같은 **역할 체계**를 쓰되 브랜드 팔레트 5색은 자체 팔레트로 교체한다(원본 브랜드 정체성 비복제).

## 3. 타이포그래피 [관찰]

- 본문: **Pretendard** (자체 호스팅 woff2, 400/500/600 서브셋 분할 로드, `font-display: swap`), 대체 `system-ui`.
- 숫자/코드: **Geist Mono** (Google Fonts, 300–600) — KPI 수치·테이블 수치·탭 카운트에 사용.
- **유체 타입 스케일**: `clamp()` 기반. 관찰된 주요 단계 — 12→13px(caption), 14→15px(body-sm), 16→17px(body), 18→20px, 20→22px, 24→27px, 30→34px(KPI 숫자), 36→40px.
- 굵기 분포: 600(28회) > 500(18) > 700(15) > 400(11) > 800(9). 제목·KPI는 600–700.

## 4. 간격·모서리·그림자 [관찰]

- `--radius: .5rem`(8px) 기준, 파생 `calc(var(--radius) ± n)`. 카드 12px, 배지 6px, 알약형 9999px.
- 그림자는 매우 옅음: 카드 `0 1px 2px hsl(foreground/.03)`, 팝오버 `0 10px 30px rgba(0,0,0,.06)`, 모달 `0 12px 48px -8px rgba(0,0,0,.18)`.
- 브레이크포인트: 640 / 768 / 1024 / 1280 / **1380 / 1400**(커스텀) / 1536px.
- 모션: `kpi-fade-up`, `count-bounce`, `draw-donut`, `draw-line`, `shimmer`(스켈레톤), `flash-row`(행 갱신 강조), `live-pulse`(진행 중 표시) 등. 기본 전환 `all .2s cubic-bezier(.4,0,.2,1)`.

## 5. 레이아웃 셸 [관찰 · 스크린샷 + 번들 상수]

```
┌───────────────┬──────────────────────────────────────────────────────┐
│ 워크스페이스 ▾ │ [≡] 브레드크럼          [진행률 50%] [계정 메뉴]      │ ← 상단바 56px
│  (플랜 배지)   ├──────────────────────────────────────────────────────┤
│ 대시보드       │  페이지 제목 + 설명                 [세트▾][Raw][+추가] │
│ 분석 ▾ (4)     │  ┌KPI┐┌KPI┐┌KPI┐┌KPI┐                                 │
│ 전략 ▾ (2)     │  탭 바 (밑줄형, 카운트 Geist Mono)                    │
│ 실행 ▾ (3)     │  필터 툴바 (드롭다운·세그먼트·검색)                    │
│ (모니터링/기타)│  데이터 테이블 (정렬 헤더, 강조 컬럼 배경)              │
│ 도움말 카드    │                                                       │
│ 체험 n일 남음  │                                              (에이전트 FAB) │
└───────────────┴──────────────────────────────────────────────────────┘
```

- 사이드바: shadcn `Sidebar`, 너비 16rem(데스크톱) / 18rem(모바일 시트) / 3rem(아이콘 접힘), 열림 상태를 `app-sidebar-open` 키로 저장. 그룹 접기 가능.
- 메인 영역은 사이드바 배경 위에 떠 있는 둥근 흰 카드(inset 레이아웃).
- 우하단 원형 FAB → AI 에이전트(`/app/agent` 채팅, SSE).
- 공통 컴포넌트 패턴: KPI 카드(제목·info 툴팁·큰 수치·증감·하단 스파크라인), 상태 배지(점+라벨), 밑줄 탭, 세그먼트 토글, 정렬 테이블, 빈 상태 일러스트+CTA, 우측 드로어 상세 패널(`vaul`), 확인 다이얼로그.

## 6. 클론 구현 지침 [추론]

1. `tailwind.config` 색상은 위 역할 토큰명을 그대로 쓰고 값만 자체 팔레트로 치환.
2. 폰트: Pretendard(OFL) + Geist Mono(OFL) — 라이선스상 재사용 가능.
3. shadcn/ui 컴포넌트 세트(Sidebar, Tabs, Table, Badge, Dialog, Drawer, Tooltip, Command, Sonner) 생성 후 KPI 카드·상태 배지만 커스텀.
4. 차트는 Recharts 단일화 권장(네트워크 그래프만 ECharts 또는 react-force-graph).
