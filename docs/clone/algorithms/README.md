# 원본 알고리즘 스펙 — 점수·지표 계산 (P9)

원본 SPA 번들(`docs/rea/bundle/`, 2026-10-25 배포 `psr2.534e5cd0`)에서 추출한 ground truth.
모든 항목은 [관찰] (번들 코드에 문자 그대로 존재)이며, 청크 파일명을 근거로 표기한다.

| 스펙 | 내용 | 근거 청크 |
|---|---|---|
| [scoring-core.md](scoring-core.md) | 순위 점수표·보간, SEO/GEO/AVI 공식, 레벨 임계값, 명시적 가중치 오버라이드 | `index-Dkac1sNp.js` (`wi`, `XR`, `ure`, `pre`, `ire`, `ZR`, `Hb`, `dre`), `useAVIScore` |
| [gap-opportunity.md](gap-opportunity.md) | 갭 4분류, 갭 점수, 기회 점수, Quick Win, 콘텐츠 이슈, 경쟁사 위협, 퍼널 건강 | `gap-intelligence-C9XEiCaw.js`, `gap-quadrant-config`, `ctr-benchmarks` |
| [quality-thresholds.md](quality-thresholds.md) | Core Web Vitals 임계값·점수, 그라운딩 티어 규칙, 신선도 분류, CTR 벤치마크 | `score-utils`, `grounding-thresholds`, `freshness`, `ctr-benchmarks` |
| [kpi-contracts.md](kpi-contracts.md) | GEO KPI 집계 창·실행 상태 플래그, 엔진 목록 정규화, 인용률 반올림, 키워드 무효화 키, 브랜드 스코프 | `calculateKpiStats`, `index`(`tT`,`Fne`,`Une`,`RH`,`PH`), `keywordInvalidation`, `classifyBrandScope` |

## 원본 버그 (의도적 보존)

- 순위 점수: `rank >= 10 → 10` 분기가 테이블 10번째 값(15)보다 먼저 평가되어 **10위는 15점에 도달할 수 없다**. 클론은 1:1 충실도를 위해 동일 동작을 보존한다(기존 F5-5 추론이 코드로 확정됨).

## 서버 측 미확인 (Phase C 실험 대상)

- `get_avi_overview` RPC(Pro 모드 AVI) — 응답 키는 관찰(averageScore, level, components{mentionRate,citationRate,mentionRank,citationRank}, setCount, activeSetCount, totalPrompts, citedPrompts, totalRuns, coverageRate, dailySeries). 계산식은 서버에 있고 문서상 5요소 후보(35/20/15/15/15)가 검증 대상이다.
- `get_seo_overview_agg`, `get_gap_overview_light`, `get_serp_brand_presence_trend`, `get_light_prompt_stats`, `get_geo_prompt_status_kpi`, `get_full_funnel_stats` 등 — 클라이언트는 응답을 정규화만 하고 집계는 서버에서 수행된다.
