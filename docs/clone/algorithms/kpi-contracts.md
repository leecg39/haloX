# KPI 집계 계약 (Ground Truth)

근거: `assets_calculateKpiStats-DxA1l2BD.js`, `assets_index-Dkac1sNp.js`(`tT`,`Fne`,`Une`,`RH`,`PH`,`OH`), `assets_keywordInvalidation-Db4aHNVZ.js`, `assets_classifyBrandScope-hYJNOYQf.js`, `assets_useFullFunnelMetrics-dNvwlQ-n.js`, `assets_cohortContext-BsJQdYf9.js`. 모두 [관찰].

## GEO KPI 실행 통계 (`calculateKpiStats`)

```
창: 기본 28일(U=28), 종료 = endDaysAgo일 전의 "한국 기준 하루 끝":
   end = Date.UTC(y,m,d,23,59,59,999) - 9시간(9*60*60*1000)
엔진: 기본 ["chatgpt"], 정규화 후 세트 비교. 실행 포함 조건:
   latestRunByEngine[engine].status === "completed" && metrics && finished_at
   && windowStart <= finished_at <= windowEnd
집계 창 밖 실행/미완료 실행은 제외.

실행 플래그:
  mentioned   = !!metrics.brand_mentioned
  cited       = !!metrics.is_cited
  sourced     = is_cited || (our_source_count ?? 0) > 0 || !!source_but_not_cited
  hasCompetitorCitation = (competitor_citation_count ?? 0) > 0

파생 상태:
  sourcedOnly = sourced && !cited
  ghost       = cited && !mentioned
  mentionOnly = mentioned && !cited
  compOnlyCited = !cited && hasCompetitorCitation

프롬프트 단위 집계(최근 실행 "any" 기준):
  total, mentionedCount, sourcedCount, citedCount, hiddenOppCount(comp 인용·자사 미인용),
  compOnlyCitedCount, ghostCitedCount, mentionAndCitedCount, mentionOnlyCount
  brandCoverage = mentioned/total*100, sourceCoverage, citationCoverage (기본 simple 비율)
  slots = { denom: 최근실행프롬프트수, mention, source, citation }

weighted-avg 집계: 엔진별 개수를 1회(engines: [e], any)씩 평가 후 엔진 평균 비율로 재계산.
```

## 엔진 목록·정규화 (`tT` 계열)

```
ENGINES = ["chatgpt", "gemini", "perplexity", "claude"]
도메인: chatgpt.com | gemini.google.com | perplexity.ai | claude.ai
표기:   ChatGPT | Gemini | Pplx | Claude (GEO 표기도 동일)
정규화: "openai" -> "chatgpt"; 목록 밖 -> "chatgpt"
엔진 병합: chatgpt/openai는 동일 집합으로 취급 후 정렬·중복 제거
```

## 키워드 변경 무효화 쿼리 키 (30종)

```
keywords, keywords-kpi, keywords-count, keywords-total-count, keyword-sets,
keywords-gsc-stats, workspace-keywords, workspace-keywords-lite, recent-keywords,
clusters, keyword-clusters, keyword-prompt-suggestions, keyword-suggestion-counts,
gap-overview, keyword-panel, naver-snapshots, serp-job-stats, serp-matrix,
serp-matrix-keywords, serp-matrix-site-types, serp-rank-trend, serp-snapshots,
serp-summary, google-serp-history, naver-serp-history, keyword-created-dates,
dashboard-kpis, workspace-quota, workspace-usage-history, workspace-usage-reservations
```
(모두 refetchType:"all" 무효화)

## 브랜드 스코프 분류 (`classifyBrandScope`)

```
정규화: trim + toLowerCase + 공백 축약
문자열.contains 순차 매칭: 브랜드 목록 우선 -> competitor
분류: brand(자사) | competitor(경쟁사) | non_brand(비브랜드)
```

## 코호트·태그 스코프 (`cohortContext`)

```
태그 스코프: "or"면 태그 1개 이상 매칭, 그 외(기본 "and")는 선택 태그 전부 매칭 필요
세트 스코프: keyword_set_id IN setIds
빈 태그 결과 -> 매칭 없음 처리(더미 UUID로 IN 빈집합)
```

## 풀 퍼널 통계 (`useFullFunnelMetrics`)

RPC `get_full_funnel_stats{p_workspace_id, p_days(기본30), p_limit(100)}`:
summary = total_pages, matched_pages, gsc_only_pages, ga4_only_pages, total_clicks,
total_organic_sessions, total_ai_sessions, total_conversions, has_conversion_setup, total_engagement_rate
개별 증거 RPC: `get_keyword_ga4_evidence{p_workspace_id, p_page_path, p_days}`

## 캐싱 계약 (관찰)

- `rpc-cache` 엣지 래퍼: `{rpc_name, args}` 경유, 실패 시 `error_fallback:true`로 클라이언트 직접 RPC
- staleTime: SEO 개요/gap/풀퍼널/라이트 프롬프트 5분, AVI 15분, 세트 목록 10분, gcTime 30분
