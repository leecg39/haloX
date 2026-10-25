# 서버 AVI 공식 — 원본 실험으로 확정 (U-2 해결)

근거: `docs/rea/evidence/p9-avi-observation.json` (2026-10-25 13시경, Ego 세션에서 읽기 전용 RPC 직접 관찰). [관찰]

## 결론

**`get_avi_overview`(서버 AVI) = GEO 점수 공식과 동일한 4요소 평균이다.**

```
averageScore = mentionRate*0.25 + citationRate*0.25 + mentionRank*0.25 + citationRank*0.25
```

관측: `{mentionRate: 30, citationRate: 30, mentionRank: 100, citationRank: 100}` → `averageScore: 65`
계산: 7.5 + 7.5 + 25 + 25 = **65** (정확히 일치, 반올림 오차 없음)

## 문서 5요소 공식 반박

공개 문서 후보(인용률 35/멘션 20/감성 15/커버리지 15/위치품질 15)는 이 관측을 설명할 수 없다:
인용률 30×0.35 + 멘션율 30×0.20 + 커버리지 30×0.15 = 10.5+6+4.5 = 21 → 감성·위치품질이 만점(15+15=30)이어도 51 < 65. **반박됨.**

## 일간 시리즈 교차 검증

응답의 `dailySeries` 마지막 점수: 10/22 = **60**, 10/23~25 = **65** — 각각 원본 대시보드에서 관측된 당일 GEO 점수(10/22: 60, 10/25: 65)와 정확히 일치한다. 서로 다른 날의 독립 관측 2건이 모두 일치하므로 4분의 1 가중치 식별은 단일 관측의 우연이 아니다.

## 순위 성분 변환 [추론]

응답의 `avgMentionRank: 1`, `avgCitationRank: 1`이고 `components.mentionRank/citationRank: 100` — 평균 순위를 순위 점수표(`XR`, 1위=100)로 변환한 값이 성분으로 들어간다. 두 값이 표와 정확히 일치(1→100).

## 응답 계약 (관찰)

```
{ level: "high", averageScore, coverageRate,
  setCount, activeSetCount, totalPrompts, citedPrompts, totalRuns,
  components: { mentionRate, citationRate, mentionRank, citationRank, mentionSov, citationSov },
  avgMentionRank, avgCitationRank, firstMentionRate, firstCitationRate,
  dailySeries: [{date, label, score}] }
```
- 파라미터: `{p_workspace_id, p_days}` (1/7/28/90)
- 라이트 대시보드 요약(`get_light_dashboard_overview.avi_summary`) 병행 관측: `{run_count, prompt_count, sum_sentiment, mentioned_count, sum_citation_rate, cited_prompt_count, cited_runs_with_position, sum_position_quality_norm}` — 라이트 유도 입력(F5-6)과 정합 (멘션율 3/10=30, 인용률 3/10=30)

## 쿼터 선차단 계약 (관찰, 부수 획득)

키워드 추가 시도(승인된 실험)에서 원본은 **서버 요청 없이 클라이언트가 한도를 선차단**했다: 한도 도달 상태에서 "키워드 추가" 클릭 → 네트워크 쓰기 0건 → "이번 달 한도에 도달했어요" 모달. F5-9의 예약 흐름은 한도 여유 시에만 서버까지 진행된다. 액션형 쓰기 계약(U-1)은 이번 달 키워드 한도 소진(20/20)으로 관측하지 못했다 — 다음 달 또는 플랜 업그레이드 후에만 가능.

## 방법·안전 조치

- 관찰은 사용자 Ego 로그인 세션에서 대시보드가 쓰는 것과 동일한 읽기 전용 RPC를 호출했다 (쿼터 소모 없음).
- 세션 토큰은 브라우저 세션 안에서만 일시 사용했고 어떤 로그·증거 파일에도 남기지 않았다.
- 증거에서 워크스페이스 UUID는 기록하지 않았다.
