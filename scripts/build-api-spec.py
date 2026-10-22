"""Generate docs/clone/api-spec.md and docs/clone/openapi.yaml from REA evidence.

Inputs : docs/rea/evidence/p3-api-shapes.json   (runtime, observed shapes)
         docs/rea/evidence/p1-api-inventory.json (static identifiers)
         docs/rea/evidence/p5-bundled-edge-catalog.json (bundled internal catalog)
Usage  : python3 scripts/build-api-spec.py <repo_root>
"""
import json
import os
import sys

ROOT = sys.argv[1]
EVD = os.path.join(ROOT, "docs", "rea", "evidence")
OUT_MD = os.path.join(ROOT, "docs", "clone", "api-spec.md")
OUT_YAML = os.path.join(ROOT, "docs", "clone", "openapi.yaml")

TYPE_MAP = {
    "string": {"type": "string"}, "number": {"type": "number"}, "boolean": {"type": "boolean"},
    "null": {"description": "observed only as null (type unknown)"}, "string<uuid>": {"type": "string", "format": "uuid"},
    "string<date>": {"type": "string", "format": "date"},
    "string<datetime>": {"type": "string", "format": "date-time"},
    "string<url>": {"type": "string", "format": "uri"},
}


def load(name):
    with open(os.path.join(EVD, name), encoding="utf-8") as fh:
        return json.load(fh)


def to_schema(shape):
    if isinstance(shape, dict):
        return {"type": "object", "properties": {k: to_schema(v) for k, v in shape.items()}}
    if isinstance(shape, list):
        inner = shape[0] if shape else None
        if inner in (None, "<empty>", "…"):
            return {"type": "array", "items": {}}
        return {"type": "array", "items": to_schema(inner)}
    if isinstance(shape, str):
        return dict(TYPE_MAP.get(shape, {"description": f"observed: {shape}"}))
    return {}


def yaml_dump(obj, indent=0):
    pad = "  " * indent
    lines = []
    if isinstance(obj, dict):
        if not obj:
            return [pad + "{}"]
        for k, v in obj.items():
            key = json.dumps(k) if any(c in k for c in ":{}[],&*#?|-<>=!%@`'\" ") or k[:1].isdigit() else k
            if isinstance(v, (dict, list)) and v:
                lines.append(f"{pad}{key}:")
                lines += yaml_dump(v, indent + 1)
            else:
                lines.append(f"{pad}{key}: {scalar(v)}")
    elif isinstance(obj, list):
        for v in obj:
            if isinstance(v, (dict, list)) and v:
                sub = yaml_dump(v, indent + 1)
                lines.append(f"{pad}- {sub[0].strip()}")
                lines += sub[1:]
            else:
                lines.append(f"{pad}- {scalar(v)}")
    return lines


def scalar(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if v is None:
        return "null"
    if isinstance(v, (dict, list)):
        return "{}" if isinstance(v, dict) else "[]"
    return json.dumps(v, ensure_ascii=False)


def keys_of(shape, limit=14):
    if isinstance(shape, list) and shape and isinstance(shape[0], dict):
        return "[ " + ", ".join(list(shape[0])[:limit]) + (" …" if len(shape[0]) > limit else "") + " ]"
    if isinstance(shape, dict):
        return "{ " + ", ".join(list(shape)[:limit]) + (" …" if len(shape) > limit else "") + " }"
    return f"`{json.dumps(shape, ensure_ascii=False)[:40]}`"


def build():
    shapes = load("p3-api-shapes.json")["endpoints"]
    inv = load("p1-api-inventory.json")["totals"]
    cat = load("p5-bundled-edge-catalog.json")
    rest = [e for e in shapes if e["path"].startswith("/rest/v1/") and "/rpc/" not in e["path"]]
    rpc = [e for e in shapes if "/rest/v1/rpc/" in e["path"]]
    fn = [e for e in shapes if e["path"].startswith("/functions/v1/")]
    seen_rpc = {e["path"].rsplit("/", 1)[-1] for e in rpc}
    seen_tables = {e["path"].rsplit("/", 1)[-1] for e in rest}

    md = ["# API 스펙 (역공학 확정본)", "",
          "> 생성: `scripts/build-api-spec.py` · 근거: E3-1(런타임 shape, REA `inspect_web_network_capture`), "
          "E1-4(정적 인벤토리), E5-3(번들 동봉 Edge Function 카탈로그). 값은 기록하지 않고 키·타입만 기록.", "",
          "## 1. 전송 계층 [관찰]", "",
          "원본은 자체 REST 서버가 없고 **Supabase 3면 구조**를 브라우저에서 직접 호출한다.", "",
          "| 면 | 베이스 경로 | 인증 | 용도 |", "|---|---|---|---|",
          "| PostgREST 테이블 | `{SUPABASE_URL}/rest/v1/{table}` | `apikey`(publishable) + `Authorization: Bearer <user JWT>` | CRUD, RLS로 워크스페이스 격리 |",
          "| PostgREST RPC | `{SUPABASE_URL}/rest/v1/rpc/{fn}` (POST) | 동일 | 집계·KPI·트랜잭션성 작업 |",
          "| Edge Functions | `{SUPABASE_URL}/functions/v1/{name}` (POST JSON) | 동일, 만료 30초 전 세션 갱신 후 호출, 기본 타임아웃 60초 | 외부 API·LLM·크롤·배치 |",
          "| Auth | `{SUPABASE_URL}/auth/v1/*` | — | 이메일/비밀번호, Google·Kakao OAuth (+ Firebase 휴대폰 인증) |",
          "| Storage | `storage.from(bucket)` | 동일 | 버킷 4종: " + ", ".join(inv["storage_buckets"]["items"]) + " |", "",
          "- 에러 형태 [관찰]: Edge 래퍼는 비 2xx 시 본문 JSON의 `error` 필드를 메시지로 사용, 타임아웃 시 한국어 안내 오류를 던짐. "
          "`strategy_map_temporarily_stopped` 같은 코드 문자열을 `code` 또는 `payload.error`로 판별.",
          "- 캐시 프록시 [관찰]: `POST /functions/v1/rpc-cache` `{rpc_name, args}` → `{data, error_fallback, reason}`. "
          "무거운 RPC를 서버 캐시 경유로 호출하고 실패 시 클라이언트가 직접 RPC로 폴백.",
          "- 스트리밍 [관찰]: `POST /functions/v1/agent-chat` `{message, conversation_id?, workspace_id, context.currentPage}` → SSE(status/chunk/done).",
          "- 공개 API [SUP]: `app.haloxlabs.ai/functions/v1/halox-mcp` — 워크스페이스 API 키(`workspace_api_keys`: key_prefix, scopes, expires_at) 기반 MCP 엔드포인트. 스키마 비공개 → [미확인].", "",
          f"## 2. RPC 계약 — 런타임 관찰 {len(rpc)}종 [관찰]", "",
          "| RPC | 요청 바디 | 응답 최상위 구조 | 관찰 라우트 수 |", "|---|---|---|---|"]
    for e in sorted(rpc, key=lambda x: x["path"]):
        name = e["path"].rsplit("/", 1)[-1]
        req = json.dumps(e["request_body_shape"], ensure_ascii=False) if e["request_body_shape"] else "—"
        md.append(f"| `{name}` | `{req[:120]}` | {keys_of(e['response_shape'])} | {len(e['routes'])} |")
    static_rpc = sorted(set(inv["rpcs"]["items"]) - seen_rpc)
    md += ["", f"### 정적으로만 확인된 RPC {len(static_rpc)}종 [관찰-정적, shape 미확인]", "",
           ", ".join(f"`{r}`" for r in static_rpc), "",
           f"## 3. 테이블 읽기 — 런타임 관찰 {len(rest)}종 [관찰]", "",
           "PostgREST 규약: `select`(임베드 포함), `eq.`/`is.`/`in.` 필터, `order`, `limit`/`offset`. "
           "HEAD 요청은 `Prefer: count=exact` 카운트 전용.", "",
           "| 메서드 | 테이블 | 쿼리 파라미터 | 응답(요소) 키 |", "|---|---|---|---|"]
    for e in sorted(rest, key=lambda x: (x["path"], x["method"])):
        md.append(f"| {e['method']} | `{e['path'].rsplit('/', 1)[-1]}` | {', '.join(e['query_params'][:8])} | {keys_of(e['response_shape'])} |")
    static_tables = sorted(set(inv["tables"]["items"]) - seen_tables)
    md += ["", f"### 정적으로만 확인된 테이블 {len(static_tables)}종", "", ", ".join(f"`{t}`" for t in static_tables), "",
           "## 4. Edge Functions [관찰-정적 + SUP 카탈로그]", "",
           f"코드에서 호출 확인 {inv['edge_functions']['count']}종, 번들 동봉 카탈로그 {len(cat['function_names_in_doc'])}종, "
           f"교집합 {len(cat['in_doc_and_code'])}종. 런타임 관찰은 `rpc-cache` 1종(나머지는 사용자 액션 트리거라 읽기 전용 캡처 범위 밖).", "",
           "| 도메인 | 함수 | 입력 | 출력 | 외부 의존 |", "|---|---|---|---|---|"]
    for r in cat["rows"]:
        if r["input"] or r["output"]:
            md.append(f"| {r['section']} | `{r['name']}` | {r['input'] or '—'} | {r['output'] or '—'} | {r['llm'] or '—'} |")
    md += ["", "### 카탈로그에 입출력 미기재·코드에서만 확인된 함수", "",
           ", ".join(f"`{n}`" for n in cat["code_only"]), "",
           "## 5. 미해결 [미확인]", "",
           "- Edge Function 요청/응답 바디의 정확한 shape (액션 트리거 함수는 런타임 미캡처). 다음 증거: 사용자 협조 HAR(생성 액션 포함) 또는 클론에서 계약 재정의.",
           "- RLS 정책 내용, DB 트리거, cron 스케줄(서버 측) — 정적·런타임 모두 도달 불가.",
           "- `halox-mcp` 공개 API 도구 스키마.",
           "- 빈 응답(`<empty>`)으로만 관찰된 테이블의 요소 shape — 정적 select 컬럼(`data-model.md`)으로 대체.", ""]
    with open(OUT_MD, "w", encoding="utf-8") as fh:
        fh.write("\n".join(md))

    paths = {}
    for e in rest + rpc + fn:
        op_id = (e["method"].lower() + "_" + e["path"].strip("/").replace("/", "_").replace("-", "_"))
        op = {"operationId": op_id, "summary": f"observed on {len(e['routes'])} route(s)",
              "responses": {"200": {"description": "observed shape",
                                    "content": {"application/json": {"schema": to_schema(e["response_shape"])}}}}}
        params = [{"name": q, "in": "query", "schema": {"type": "string"}} for q in e["query_params"]]
        if params:
            op["parameters"] = params
        if e["request_body_shape"] is not None:
            op["requestBody"] = {"content": {"application/json": {"schema": to_schema(e["request_body_shape"])}}}
        paths.setdefault(e["path"], {})[e["method"].lower()] = op
    for name in sorted(set(inv["edge_functions"]["items"]) - {"rpc-cache"}):
        paths.setdefault(f"/functions/v1/{name}", {})["post"] = {
            "operationId": "post_fn_" + name.replace("-", "_"),
            "summary": "static-only (shape unknown)", "x-evidence": "E1-4",
            "requestBody": {"content": {"application/json": {"schema": {"type": "object"}}}},
            "responses": {"200": {"description": "unknown"}}}
    spec = {"openapi": "3.0.3",
            "info": {"title": "HaloX clone — reverse-engineered contract (draft)", "version": "0.1.0",
                     "description": "Generated from REA evidence. Shapes observed at runtime; values never recorded."},
            "servers": [{"url": "{SUPABASE_URL}", "variables": {"SUPABASE_URL": {"default": "https://example.supabase.co"}}}],
            "components": {"securitySchemes": {
                "apikey": {"type": "apiKey", "in": "header", "name": "apikey"},
                "bearer": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}}},
            "security": [{"apikey": [], "bearer": []}],
            "paths": dict(sorted(paths.items()))}
    with open(OUT_YAML, "w", encoding="utf-8") as fh:
        fh.write("\n".join(yaml_dump(spec)) + "\n")
    print("rpc", len(rpc), "rest", len(rest), "fn", len(fn), "paths", len(paths))


if __name__ == "__main__":
    build()
