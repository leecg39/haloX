# P8 패리티 매트릭스 — 원본(haloxlabs.ai) vs 클론(localhost:3000), 2026-10-25

뷰포트 1920x939. 픽셀 비교는 REA compare_web_screenshots(채널 임계값 8), 텍스트 유사도는 집합 자카드, DOM 유사도는 태그 개수 가중 자카드 파생 지표(DER).
원본은 사용자 Trial 워크스페이스, 클론은 시드 데모 워크스페이스이므로 데이터 영역 차이는 등급에 일부 반영된다.

## 요약

- 사소: 23개 라우트
- 일치: 4개 라우트
- 중간: 1개 라우트

## 라우트별 상세

| 라우트 | 등급 | 픽셀 변화 | 텍스트 유사 | DOM 유사 |
|---|---|---|---|---|
| app-geo-analysis-tab-products | 일치 | 0.59% | 91.3% | 42.7% |
| app-strategy-map | 일치 | 1.59% | 93.2% | 57.8% |
| app-raw-data | 일치 | 0.77% | 91.0% | 44.4% |
| app-login | 일치 | 0.22% | 92.7% | 34.1% |
| app-geo-analysis | 사소 | 5.04% | 94.8% | 74.7% |
| app-geo-analysis-tab-matrix | 사소 | 2.17% | 96.2% | 71.8% |
| app-geo-analysis-tab-fan-out | 사소 | 3.37% | 98.0% | 69.0% |
| app-geo-analysis-tab-sources | 사소 | 3.97% | 87.5% | 75.9% |
| app-geo-analysis-tab-mentions | 사소 | 3.96% | 95.6% | 61.7% |
| app-geo-analysis-tab-platforms | 사소 | 3.76% | 97.8% | 76.1% |
| app-geo-analysis-tab-prompts | 사소 | 4.56% | 96.4% | 78.5% |
| app-geo-analysis-tab-competitors | 사소 | 4.49% | 96.3% | 69.5% |
| app-geo | 사소 | 0.77% | 89.7% | 40.2% |
| app-monitoring | 사소 | 0.53% | 85.6% | 40.7% |
| app | 사소 | 4.06% | 83.2% | 60.1% |
| app-keywords | 사소 | 4.45% | 88.5% | 77.4% |
| app-geo-prompts | 사소 | 3.69% | 95.1% | 70.9% |
| app-gap | 사소 | 4.20% | 92.0% | 52.7% |
| app-site-audit | 사소 | 2.88% | 96.8% | 58.9% |
| app-factory | 사소 | 0.50% | 84.2% | 46.4% |
| app-optimize | 사소 | 0.49% | 86.9% | 41.5% |
| app-exports | 사소 | 0.43% | 80.8% | 39.6% |
| app-reports | 사소 | 0.45% | 83.1% | 39.7% |
| app-reports-weekly | 사소 | 0.45% | 83.1% | 39.8% |
| app-personas | 사소 | 0.44% | 83.5% | 39.5% |
| app-knowledgehub | 사소 | 0.57% | 84.5% | 49.1% |
| app-settings | 사소 | 0.54% | 86.8% | 45.6% |
| app-seo-insights | 중간 | 4.46% | 74.8% | 61.4% |

개별 REA Evidence: docs/rea/evidence/p8-compare/(로컬 보관, git 제외). 기계 판독: parity-matrix.json.