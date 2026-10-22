"""Generate docs/clone/pages/*.md from four evidence sources.

Sources (all local, identifiers/labels only):
  SUP  docs/sources/*.json                 UI scrape (tabs, buttons, columns, inputs)
  REA  docs/rea/evidence/p1-api-inventory.json  static data dependencies per page chunk
  REA  docs/rea/evidence/p3-api-shapes.json     runtime endpoints observed per route
  SUP  docs.haloxlabs.ai feature page slug       public documentation pointer

Usage: python3 scripts/build-page-specs.py <repo_root>
"""
import collections
import glob
import json
import os
import sys

ROOT = sys.argv[1]
SRC = os.path.join(ROOT, "docs", "sources")
EVD = os.path.join(ROOT, "docs", "rea", "evidence")
OUT = os.path.join(ROOT, "docs", "clone", "pages")

# route, slug, page chunk key (inventory), menu group, docs slug, purpose (our own words)
PAGES = [
    ("/app", "dashboard", "AppOverview", "공통", "overview",
     "워크스페이스 전체의 AVI·GEO·SEO·웹 건강도 점수를 한 화면에 요약하고, 키워드/질문/진단 하위 표로 다음 작업을 안내한다."),
    ("/app/keywords", "keywords", "KeywordsPage", "분석", "keyword-status",
     "추적 키워드 목록과 SERP 순위·AI 요약 인용·검색량·의도 등 키워드 단위 상태를 관리한다. 세트/태그/네트워크/아이디어 뷰 제공."),
    ("/app/seo/insights", "seo-insights", "SEOInsightsPage", "분석", "keyword-analysis",
     "키워드 묶음의 SEO 성과(점수, 위치 분포, 경쟁사, 기회, AIO, SERP 매트릭스)를 분석한다."),
    ("/app/geo/prompts", "geo-prompts", "GeoPromptSetsPage", "분석", "prompt-status",
     "AI 엔진에 반복 질의할 프롬프트(질문)와 세트·태그를 관리하고 질문별 인용 상태를 본다."),
    ("/app/geo/analysis", "geo-analysis", "GeoInsightsPage", "분석", "prompt-analysis",
     "프롬프트 실행 결과를 개요/프롬프트/멘션/인용 소스/상품/인용 매트릭스/경쟁사/플랫폼/검색 패턴 관점으로 분석한다."),
    ("/app/gap", "gap", "GapIntelligencePage", "분석(기회)", "geo-dashboard",
     "SEO 강도와 GEO 인용을 교차해 키워드·프롬프트·경쟁사·콘텐츠 공백을 찾는다."),
    ("/app/strategy-map", "strategy-map", "StrategyMapPage", "전략", "strategy-map",
     "키워드를 클러스터로 묶어 리스트/포트폴리오/네트워크로 보여주고 우선순위를 정한다."),
    ("/app/site-audit", "site-audit", "SiteAuditPage", "전략", "site-audit",
     "사이트를 크롤링해 건강도·AI 준비도 점수, 이슈, 페이지, AI 봇 접근성, 엔티티, 내부 링크를 진단한다."),
    ("/app/factory", "factory", "FactoryPage", "실행", "content-factory",
     "키워드/프롬프트 기반 콘텐츠 작업(content_jobs)을 만들고 전략 분석→초안 작성→근거 확인 단계로 진행한다."),
    ("/app/optimize", "optimize", "OptimizePage", "실행", "content-factory",
     "기존 콘텐츠를 진단(audit)하고 SERP·전략을 반영해 개선본을 만든다."),
    ("/app/exports", "exports", "ExportsPage", "실행", "content-export",
     "완성 콘텐츠와 근거를 외부 전달용으로 내보내고 이력을 관리한다."),
    ("/app/monitoring", "monitoring", "MonitoringDashboardPage", "모니터링", "monitoring-dashboard",
     "GSC·GA4 연동 데이터로 검색/AI 유입 추이를 overview·queries·pages 탭으로 본다."),
    ("/app/reports/weekly", "reports-weekly", "WeeklyReportPage", "모니터링", "weekly-report",
     "주 단위 KPI 변화와 다음 액션을 리포트 스냅샷(report_snapshots)으로 정리한다."),
    ("/app/personas", "personas", "PersonasPage", "기타", "personas",
     "콘텐츠 작성 톤·독자 페르소나(writing_style_profiles)를 관리한다."),
    ("/app/knowledgehub", "knowledgehub", "KnowledgeHubPage", "기타", "knowledge-hub",
     "브랜드 엔티티와 주장(claim)·출처(source)를 관리해 콘텐츠 근거로 쓴다."),
    ("/app/raw-data", "raw-data", "RawDataPage", "기타", None,
     "수집 원본(SERP 스냅샷, 프롬프트 실행, 인용 등)을 표 형태로 조회·다운로드한다."),
    ("/app/settings", "settings", "SettingsPage", "계정", None,
     "워크스페이스·멤버·일반·사용량·결제·연동·브랜드 트래킹·태그·등록 URL·내보내기·알림·API&MCP 12개 탭 설정."),
]


# Observations read directly from the route screenshots (docs/design-references/.../routes/*.png)
SCREENSHOT_NOTES = {
    "dashboard": [
        "상단 배너: 분석 범위 진행률(현재/한도)과 기회 탐색 CTA, 닫기 버튼.",
        "인사 헤더 + 부제(오늘의 검색·AI 가시성 현황).",
        "좌측 큰 카드: AVI 종합 점수 반원 게이지(0~100), 28일 대비 증감, 레벨 배지, 최근 28일 추이 스파크라인.",
        "KPI 카드 2행: 1행 GEO 점수 + 구성 4종(인용률/멘션율/인용 순위/멘션 순위, 각 가중치 25% 표기), "
        "2행 SEO 점수 + 구성 3종(평균 순위 40%/Top10 비율 30%/AIO 인용률 30%) + 웹 건강도.",
        "하단 탭 표: 키워드 상위 / AI 질문 상위 / 사이트 진단 / 주요 변화 Top 4 / 키워드 상태 현황, 우측 '전체 보기' 링크.",
        "키워드 표 컬럼: 키워드, 순위, 월 검색량, 상태(취약 등 배지), AIO.",
    ],
    "keywords": [
        "상단 KPI 4카드: Top10 키워드(도넛), AI 요약 인용(자사/경합/경쟁사/미점유/AIO 없음), 자사 순위(우위/경합/뒤처짐/미점유), 평균 순위(Top3/Top10/Top30/31+ 분포 막대).",
        "우상단: 세트 선택, Raw 다운로드, 키워드 추가(주 CTA, 검정 버튼).",
    ],
}


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def scrapes_by_route():
    out = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        name = os.path.basename(f)
        if name.startswith("firecrawl"):
            continue
        d = load_json(f)
        if isinstance(d, dict) and "url" in d:
            path = d["url"].split("haloxlabs.ai")[-1].split("?")[0]
            out[path].append((name, d))
    return out


def global_buttons(scrapes):
    counts, pages = collections.Counter(), 0
    for items in scrapes.values():
        for _, d in items[:1]:
            pages += 1
            for b in {x["label"] for x in d.get("buttons", []) if isinstance(x, dict)}:
                counts[b] += 1
    return {b for b, c in counts.items() if c >= max(3, int(pages * 0.6))}


def clean(label):
    return " ".join(str(label).split())[:60]


def section_ui(items, noise):
    tabs, buttons, columns, inputs = [], [], [], []
    for name, d in items:
        for t in d.get("tabs", []):
            if isinstance(t, dict):
                tabs.append(clean(t["label"]).split(" (")[0])
        for b in d.get("buttons", []):
            if isinstance(b, dict) and b["label"] not in noise:
                buttons.append(clean(b["label"]))
        columns += [clean(c) for c in d.get("columns", []) if c]
        for i in d.get("inputs", []):
            if isinstance(i, dict):
                inputs.append(clean(i.get("placeholder") or i.get("label") or i.get("type") or ""))
    uniq = lambda xs: [x for x in dict.fromkeys(xs) if x][:40]
    return uniq(tabs), uniq(buttons), uniq(columns), uniq(inputs)


def runtime_for(route, shapes):
    rows = []
    for e in shapes["endpoints"]:
        if any(r == route or r.startswith(route + "?") for r in e["routes"]):
            rows.append(e)
    return rows


def render(page, scrapes, noise, inv, shapes):
    route, slug, chunk, group, doc, purpose = page
    items = scrapes.get(route, [])
    tabs, buttons, columns, inputs = section_ui(items, noise)
    stat = inv["pages"].get(chunk, {})
    rt = runtime_for(route, shapes)
    shared = {"rpc/get_workspace_quota_summary", "workspace_plans", "subscriptions", "platform_admins",
              "rpc/record_auth_login", "rpc/cancel_account_deletion", "plan_templates", "orders",
              "workspace_members", "welcome_guide_config", "welcome_guide_settings", "workspace_usage",
              "rpc/get_billing_period_range", "rpc/get_paused_summary", "rpc/get_user_activity_snapshot",
              "rpc/get_workspace_activity_snapshot", "workspace_billing_overrides", "client_web_vitals",
              "site_audit_scans", "geo_prompt_sets", "rpc/get_full_funnel_stats"}
    page_rt = [e for e in rt if e["path"].replace("/rest/v1/", "") not in shared]
    L = [f"# {slug} — `{route}`", "",
         f"> 메뉴 그룹: {group} · 라우트 컴포넌트 청크: `{chunk}` · 스크린샷: "
         f"`docs/design-references/haloxlabs.ai/routes/{slug}.png`", "",
         "## 목적", "", purpose, "",
         "## 화면 구성 [관찰 · SUP 스크레이프]", ""]
    L.append(f"스크레이프 파일: {', '.join('`'+n+'`' for n, _ in items) or '없음 (미수집 — 미확인)'}")
    L += ["", f"- 탭: {', '.join(tabs) or '—'}",
          f"- 주요 액션 버튼: {', '.join(buttons[:25]) or '—'}",
          f"- 테이블 컬럼: {', '.join(columns[:30]) or '—'}",
          f"- 입력/필터: {', '.join(inputs[:15]) or '—'}", "",
          "> 컴플라이언스: 위 라벨은 원본 화면 구조 파악용 참조다. 클론 UI 문구는 자체 문구로 새로 작성한다.", ""]
    if slug in SCREENSHOT_NOTES:
        L += ["### 스크린샷 관찰 [관찰 · 2026-10-22 캡처]", ""] + [f"- {n}" for n in SCREENSHOT_NOTES[slug]] + [""]
    L += [
          "## 런타임 데이터 호출 [관찰 · REA E3-1]", "",
          "공통 셸 호출(플랜/쿼터/멤버/로그인 기록 등)은 `architecture.md`의 앱 셸 섹션 참조. 아래는 이 라우트 고유 호출.", ""]
    if page_rt:
        L += ["| 메서드 | 경로 | 쿼리 파라미터(이름) | 응답 최상위 키 |", "|---|---|---|---|"]
        for e in page_rt[:40]:
            shape = e["response_shape"]
            if isinstance(shape, list) and shape and isinstance(shape[0], dict):
                keys = "[ " + ", ".join(list(shape[0].keys())[:8]) + " ]"
            elif isinstance(shape, dict):
                keys = "{ " + ", ".join(list(shape.keys())[:8]) + " }"
            else:
                keys = str(shape)[:30]
            L.append(f"| {e['method']} | `{e['path']}` | {', '.join(e['query_params'][:6])} | {keys} |")
    else:
        L.append("이 라우트 고유의 런타임 호출 미관찰 (데이터 없음 또는 지연 로드) — 정적 의존성으로 대체.")
    L += ["", "## 정적 데이터 의존성 [관찰 · REA E1-4, 페이지 청크 전이 폐포]", "",
          f"- 테이블 ({len(stat.get('tables', []))}): {', '.join(stat.get('tables', [])) or '—'}",
          f"- RPC ({len(stat.get('rpcs', []))}): {', '.join(stat.get('rpcs', [])) or '—'}",
          f"- Edge Functions ({len(stat.get('edge_functions', []))}): {', '.join(stat.get('edge_functions', [])) or '—'}",
          "", "## 근거·신뢰도", "",
          f"- 라우트 존재: [관찰] 높음 — 메인 엔트리 라우트 트리 (E1-1).",
          f"- 화면 구성: [관찰] {'중간 — 단일 스크레이프 시점' if items else '낮음 — 스크레이프 없음'}.",
          f"- 데이터 계약: [관찰] {'높음 — 정적+런타임 일치' if page_rt else '중간 — 정적만'}.",
          f"- 공개 문서: {'https://docs.haloxlabs.ai/ko/features/' + doc if doc else '해당 기능 문서 없음'} (SUP).", ""]
    with open(os.path.join(OUT, f"{slug}.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))
    return slug, len(tabs), len(buttons), len(columns), len(page_rt)


def main():
    os.makedirs(OUT, exist_ok=True)
    scrapes = scrapes_by_route()
    noise = global_buttons(scrapes)
    inv = load_json(os.path.join(EVD, "p1-api-inventory.json"))
    shapes = load_json(os.path.join(EVD, "p3-api-shapes.json"))
    for page in PAGES:
        print(*render(page, scrapes, noise, inv, shapes))


if __name__ == "__main__":
    main()
