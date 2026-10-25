# 스코어링 코어 — 순위/SEO/GEO/AVI/레벨 (Ground Truth)

근거: `assets_index-Dkac1sNp.js` 내 `wi`, `wZ`, `XR`, `ure`, `pre`, `ire`, `Ul`, `are`, `ZR`, `Gl`, `Hb`, `dre` + `assets_useAVIScore-HfGbxHhQ.js`. 모두 [관찰].

## 순위 점수 (`XR`, 테이블 `wi`)

```
wi = [100, 85, 70, 55, 45, 37, 30, 24, 19, 15]   // 1~10위
wZ = 10                                          // 10위 이상 고정 점수
rank == null | !Finite | <= 0  -> null
rank <= 1                     -> 100
rank >= 10                    -> 10        // 주의: wi[9]=15에 도달 불가(원본 버그, 보존)
1 < rank < 10: t=floor(rank), n=ceil(rank)
  t==n -> wi[t-1]
  else -> round((wi[t-1] + (wi[n-1]-wi[t-1]) * (rank-t)) * 10) / 10
```

## SEO 점수 (`ure`)

```
positionScore = XR(avgPosition) ?? 0
brandSOV     = totalKeywords > 0 ? ourTop10Count / totalKeywords * 100 : 0
aioCoverage  = aioDetected    > 0 ? ourAioCited    / aioDetected    * 100 : 0
score = round(clamp(positionScore*0.4 + brandSOV*0.3 + aioCoverage*0.3, 0, 100))
components = { positionScore: round(positionScore), brandSOV: 0.1단위, aioCoverage: 0.1단위 }
level = scoreLevel(score)
```

입력 오버로드: `useSEOOverviewStats`는 서버 `get_seo_overview_agg`의 analyzed/top10/positionSum/ranked/aioDetected/aioCited/aioPosSum/aioPosCount를 받아
`avgPosition = ranked>0 ? round(positionSum/ranked, 0.1) : 0`로 파생한다. 트렌드: 현재 top10 > 이전 top10 → "up", < → "down", else "stable" (trendDirection 입력).

## AVI 종합 (`pre`) — 4분기 가중치 + 명시적 오버라이드

```
hasWeb = webScore != null && webScore > 0
hasGeo = geoScore > 0
seoWeight/geoWeight/webWeight 중 하나라도 정의되면(≠undefined) 그 값을 그대로 사용.
아니면:
  hasGeo && hasWeb -> (0.4, 0.3, 0.3)
  hasGeo           -> (0.5, 0.5, 0)
  hasWeb           -> (0.6, 0, 0.4)
  둘 다 없음        -> (1, 0, 0)
score = round(clamp(seoScore*seoW + geoScore*geoW + (hasWeb ? webScore : 0)*webW, 0, 100))
webScore 표기: hasWeb ? webScore : null
```

## GEO 점수 (`ire`, 가중치 `Ul`)

```
Ul = { mentionRate: 0.25, citationRate: 0.25, mentionRank: 0.25, citationRank: 0.25 }
score = mentionRate*0.25 + citationRate*0.25 + mentionRank*0.25 + citationRank*0.25
```

## 점수 레벨 (`are`/`ZR`, 임계값 `Gl`/`ql`)

```
< 20 -> critical | < 40 -> low | < 60 -> medium | < 80 -> high | >= 80 -> excellent
```
웹 건강도 배지도 동일 임계값을 사용(80/60/40 기준 success/muted/warning/destructive).

## 반올림 헬퍼

```
Hb(cited, total)  = total==0 ? 0 : round(cited/total*1000)/10     // 인용률 % 0.1 단위
dre(part, total)  = total==0 ? 0 : round(part/total*100)
```

## 서버 AVI (`useAVIScore` → `get_avi_overview` RPC)

- 파라미터: `{p_workspace_id, p_days}` — 1d→1, 7d→7, 28d→28, 90d→90 (기본 7d; 기간 선택: 프롬프트≤1→1d, ≤7→7d, ≤28→28d, else 90d)
- 응답 매핑: averageScore, level(기본 "critical"), components{mentionRate, citationRate, mentionRank, citationRank}(Number 기본 0), setCount, activeSetCount, totalPrompts, citedPrompts, totalRuns, coverageRate, dailySeries
- staleTime 15분, gcTime 30분 — 계산 자체는 서버 측(실험 대상)
