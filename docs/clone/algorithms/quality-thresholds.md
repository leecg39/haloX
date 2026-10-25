# 품질 임계값 알고리즘 (Ground Truth)

근거: `assets_score-utils-39eMCIGJ.js`, `assets_grounding-thresholds-K6nCQzXN.js`, `assets_freshness-B4jDGqVT.js`. 모두 [관찰].

## Core Web Vitals (`score-utils`)

```
임계값 [good, poor]:
fcp [1800, 3000]ms | lcp [2500, 4000]ms | si [3400, 5800]ms | tbt [200, 600]ms
tti [3800, 7300]ms | cls [0.1, 0.25]    | ttfb [800, 1800]ms | fid [100, 300]ms

지표 점수(값, [good,poor]):
  값 <= good -> 100
  값 >= poor -> 0
  else       -> round(100 * (1 - (값 - good) / (poor - good)))
등급: 값 <= good -> "good" | <= poor -> "needs-improvement" | else "poor"
cls 표기: 소수점 3자리. 기타 시간: >=1000ms -> "N.N s" else "N ms"
```

지표별 어트리뷰션(개선 힌트): fcp/lcp/si/ttfb→render-blocking·server-response-time, tbt/fid→unused-javascript·third-party-summary, cls→unsized-images·font-display 등.

## 그라운딩(근거 소스) 규칙 (`grounding-thresholds`)

```
MIN_SEGMENT_LENGTH = 40 (미만 Skip)
MIN_SOURCE_CONFIDENCE = 0.3
클레임 confidence 최소값(티어별): official 0.4 | reputable 0.6 | community 0.6 | unknown 0.8
SAVE_THRESHOLD = 0.4, SKIP_THRESHOLD = 0.8

Tier-Kind 허용 규칙:
pricing, policy, promotion            -> official만
update, tech_version, statistic, benchmark -> official + reputable
feature, comparison, definition(부분), mechanism, risk, quote, general -> + community (+unknown: definition/general)

Best Source 2단계 선정: 1) 티어별 confidence 임계 통과 후보만 2) Official > Reputable > Community > Unknown, 같은 티어면 confidence 높은 것 1개만 저장.
DB 저장 2단계 중복 제거: 1) 품질 검증(40자 미만·숫자 100배 불일치 Skip) 2) 2-Phase Jaccard 유사도 검사.
스킵 사유 라벨: gap(소스 없음), short(40자 미만), no_candidate(conf<30%), low_best(Tier-conf 부족), tier_mismatch(Tier-Kind 위반), question_block
```

## 신선도 (`freshness`)

```
분류: undefined -> medium | ageDays < 30 -> high | < 90 -> medium | else low
라벨: high "최신성 중요" | medium "적정 최신성" | low "에버그린"
발행 주기: weekly/biweekly/monthly

목표 달성 상태(goalStatus):
bestRank(현재/최고 중 유효 양수 최솟값)가 0<r<=10 -> achieved
!article -> no_article | !publishedAt -> not_published
ageDays >= 주간*7 -> overdue | >= 주간*7 - 7 -> due_soon | else pending

상대 시간: 0"오늘" 1"내일" 음수"경과" <7d"n일 후" <30d"n주 후" <365d"n개월 후"
```

## 웹 건강도 배지 (`webHealth`)

```
visibility: >= 80 success(양호) | >= 60 muted(보통) | >= 40 warning(낮음) | else destructive(위험)
diagnostic: >= 80 success | >= 60 warning | else destructive
```
(점수 산출 자체는 서버 측 — 관측 응답의 web_score 사용)
