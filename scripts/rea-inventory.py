"""Build an API-usage inventory from captured HaloX chunks.

Outputs only identifiers (table / rpc / edge-function names, query-key heads,
select column lists) plus chunk names — never source text.
"""
import hashlib
import json
import os
import re
import sys

SRC_DIRS = sys.argv[1].split(",")
OUT = sys.argv[2]

IGNORE_PREFIX = re.compile(
    r"^(content-|data-|aria-|font-|text-|bg-|border-|flex|grid|max-|min-|line-|z-|w-|h-|"
    r"p[xytblr]?-|m[xytblr]?-|gap-|rounded|shadow|ring-|col-|row-|space-|translate|scroll|"
    r"overflow|justify|items-|self-|place-|object-|inset|top-|left-|right-|bottom-|"
    r"x-|accept-|cache-|if-|sec-|user-|access-|cross-|referrer|transfer-|keep-|upgrade-|"
    r"lucide|radix|vaul|cmdk|sonner|recharts|echarts|react-|zr-|ec-)"
)
NON_VENDOR = re.compile(r"vendor|^index-|^install|generateCategoricalChart|^chunk-")


def read_chunks():
    chunks = {}
    for d in SRC_DIRS:
        for f in os.listdir(d):
            if f.endswith(".js") and f not in chunks:
                with open(os.path.join(d, f), encoding="utf-8", errors="ignore") as fh:
                    chunks[f] = fh.read()
    return chunks


def scan(src):
    tables = sorted(set(re.findall(r'(?<!storage)\.from\("([a-z_0-9]+)"\)', src)))
    rpcs = sorted(set(re.findall(r'\.rpc\("([a-z_0-9]+)"', src)))
    invokes = set(re.findall(r'functions\.invoke\("([a-zA-Z_0-9/-]+)"', src))
    wrapped = set(re.findall(r'[A-Za-z_$][\w$]{0,3}\("([a-z0-9]+(?:-[a-z0-9]+)+)",\{', src))
    edge = sorted(n for n in invokes | wrapped if not IGNORE_PREFIX.match(n))
    qkeys = sorted(set(re.findall(r'queryKey:\[\s*"([\w:./-]+)"', src)))
    selects = sorted(set(re.findall(r'\.select\("([^"]{3,400})"', src)))
    buckets = sorted(set(re.findall(r'storage\.from\("([^"]+)"', src)))
    imports = sorted(set(re.findall(r'["\'`]\./([\w.-]+\.js)["\'`]', src)))
    return {
        "tables": tables,
        "rpcs": rpcs,
        "edge_functions": edge,
        "query_keys": qkeys,
        "select_columns": selects,
        "storage_buckets": buckets,
        "imports": imports,
    }


def closure(start, graph, chunks):
    seen, stack = set(), [start]
    while stack:
        c = stack.pop()
        if c in seen or c not in chunks:
            continue
        seen.add(c)
        for dep in graph[c]["imports"]:
            if not NON_VENDOR.search(dep):
                stack.append(dep)
    return seen


def main():
    chunks = read_chunks()
    graph = {name: scan(src) for name, src in chunks.items()}
    page_chunks = sorted(n for n in chunks if re.match(r"[A-Z]\w*(Page|Overview|Login|Signup|Onboarding)-", n))
    pages = {}
    for p in page_chunks:
        members = closure(p, graph, chunks)
        agg = {k: set() for k in ("tables", "rpcs", "edge_functions", "query_keys", "storage_buckets")}
        for m in members:
            for k in agg:
                agg[k] |= set(graph[m][k])
        pages[re.sub(r"-[\w-]{8}\.js$", "", p)] = {
            "chunk": p,
            "closure_size": len(members),
            **{k: sorted(v) for k, v in agg.items()},
        }
    totals = {k: sorted({x for g in graph.values() for x in g[k]}) for k in
              ("tables", "rpcs", "edge_functions", "query_keys", "storage_buckets")}
    out = {
        "classification": "observation",
        "method": "regex over captured+fetched public chunks; identifiers only, no source text",
        "chunk_count": len(chunks),
        "chunk_digest": hashlib.sha256("".join(sorted(chunks)).encode()).hexdigest(),
        "totals": {k: {"count": len(v), "items": v} for k, v in totals.items()},
        "select_columns_by_chunk": {
            re.sub(r"-[\w-]{8}\.js$", "", n): g["select_columns"] for n, g in graph.items() if g["select_columns"]
        },
        "pages": pages,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print("chunks", len(chunks), {k: len(v) for k, v in totals.items()}, "pages", len(pages))


if __name__ == "__main__":
    main()
