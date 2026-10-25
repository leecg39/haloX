# 갭·기회 점수 알고리즘 (Ground Truth)

근거: `assets_gap-intelligence-C9XEiCaw.js`, `assets_gap-quadrant-config-DBGf3iew.js`, `assets_ctr-benchmarks-BnTCmxiu.js`. 모두 [관찰].

## 갭 4분류 (`classifyGap`)

```
seoStrong = our.best_rank != null && best_rank <= 10
geoStrong = aio.our_cited (불리얜)
seoStrong && geoStrong -> FORTRESS
seoStrong && !geoStrong -> GEO_GAP
!seoStrong && geoStrong -> SEO_GAP
!seoStrong && !geoStrong -> CRITICAL
```

## 갭 종합 점수 (aggregate)

```
weights = { critical: 3, geoGap: 2, seoGap: 1, fortress: 0 }
weighted = critical*3 + geoGap*2 + seoGap*1 + fortress*0
score = min(100, max(0, round(weighted / (totalCount*3) * 100)))
분포 비율 = 각 카운트 / totalCount * 100 (0.1 단위 반올림)
```

## 기회 점수 (`opportunityScore`)

```
volume = max(searchVolume, 1)
volumeScore     = min(log10(volume) * 10, 50)
difficultyScore = (100 - min(keywordDifficulty, 100)) / 100 * 30
gapBonus        = { CRITICAL: 100, GEO_GAP: 70, SEO_GAP: 50, FORTRESS: 0 }[gapType] ?? 0
score = round(clamp(volumeScore*0.4 + difficultyScore*0.3 + gapBonus*0.3, 0, 100))
components = { volumeScore(0.1단위), difficultyScore(0.1단위), gapBonus }
```

구조적 특이점 [관찰]: volumeScore 상한 50·difficultyScore 상한 30이라 **이론적 최대치는 50×0.4 + 30×0.3 + 100×0.3 = 59**다 (100점 스케일에 도달 불가).

## Quick Win — 키워드 매트릭스 판정 (`isQuickWin`)

```
ourPosition == null                          -> false
keywordDifficulty <= 30 && 11 <= ourPosition && ourPosition <= 30  -> true
```
KD 상한 30(`maxKD`), 순위 창 11~30(`minPosition`/`maxPosition`).

## SERP Quick Win / CTR Gap (`ctr-benchmarks`)

```
CTR 벤치마크(순위별 %): 1위 28, 2위 15, 3위 11, 4위 8, 5위 6.3, 6위 4.5,
                      7위 3.5, 8위 2.9, 9위 2.4, 10위 2.1, 10위 초과 1
변형 u (GSC): avgPosition 5~10 && impressions > 100:
  ctr < bench * 0.6 -> "ctr-gap"   else -> "quick-win"
변형 c (키워드): avgPosition 4~10 && impressions > 50:
  ctr < bench * 0.6 -> { type:"ctr-gap", label:"CTR Gap", warning }
  else              -> { type:"quick-win", label:"Quick Win", success }
```

## 콘텐츠 이슈 분류 (`contentIssue`)

```
!hasArticle                              -> "missing_content"
hasArticle && lastUpdatedMonthsAgo >= 12 -> "outdated_content"   (기본 임계 12개월)
ourPosition > 10 && competitor <= 10     -> "weak_content"
else                                     -> null
```

## 경쟁사 위협 수준 (`competitorThreat`)

```
totalGaps = seoGapCount + geoGapCount
>= 50 -> high | >= 20 -> medium | else low
```

## 갭 레벨 라벨 (`gapLevel`)

```
score <= 20 excellent | <= 40 good | <= 60 medium | <= 80 high | else critical
```

## 퍼널 건강 (`funnelHealth`)

```
gscClicks==0 && organicSessions==0 -> unknown("No traffic data")
gscClicks>10 && sessions==0        -> blocked("GSC clicks exist but no GA4 sessions — tracking issue")
sessions>10 && engagement<30       -> leaking("Low engagement — content quality issue")
hasConversionSetup && conversions>0 && engagement>=50 -> healthy("Strong funnel")
engagement>=40                     -> healthy("Good engagement")
else                               -> leaking("Moderate engagement")
```

## 주간/일간 트렌드 처리 (`useGapOverview`)

- 주간 분류: ISO 주(월요일 시작, `${year}-W${ww}`) 기준 최신 스냅샷 per 키워드
- 일간 창: `min(periodDays, 365)`일, 이전 값 캐리포워드(captured_at 내림차순 최신 유지)
- 인용률(일별) = aioDetected>0 ? round(geoCited/aioDetected*100) : 0
- 평균 순위 = 유효 순위 수로 나눈 평균, 0.1 단위
