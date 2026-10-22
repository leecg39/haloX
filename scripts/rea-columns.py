"""Derive per-table column evidence: static (bundle) + dynamic (runtime shapes)."""
import json
import os
import re
import sys

SRC_DIRS = sys.argv[1].split(",")
SHAPES = sys.argv[2]
OUT = sys.argv[3]

FROM = re.compile(r'\.from\("([a-z_0-9]+)"\)')
COL_CALL = re.compile(r'\.(eq|neq|in|is|order|gte|lte|gt|lt|not|ilike|like|contains|match)\("([a-z_0-9]+)"')
SELECT = re.compile(r'\.select\("([^"]{1,600})"')
WRITE = re.compile(r'\.(insert|update|upsert)\(\{([^{}]{0,800})\}')
KEY = re.compile(r'(?:^|,)\s*([a-z_][a-z_0-9]*)\s*:')


def top_level_cols(sel):
    depth, cur, cols = 0, "", []
    for ch in sel:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            cols.append(cur)
            cur = ""
            continue
        if depth == 0:
            cur += ch
    cols.append(cur)
    out = []
    for c in cols:
        c = c.strip().split(":")[-1].split("!")[0]
        if re.fullmatch(r"[a-z_][a-z_0-9]*", c):
            out.append(c)
    return out


def static_cols():
    table_cols, relations = {}, {}
    for d in SRC_DIRS:
        for f in os.listdir(d):
            if not f.endswith(".js"):
                continue
            s = open(os.path.join(d, f), encoding="utf-8", errors="ignore").read()
            for m in FROM.finditer(s):
                t = m.group(1)
                window = s[m.end(): m.end() + 700]
                nxt = FROM.search(window)
                if nxt:
                    window = window[: nxt.start()]
                cols = table_cols.setdefault(t, set())
                for sm in SELECT.finditer(window):
                    cols |= set(top_level_cols(sm.group(1)))
                    for rel in re.findall(r'([a-z_0-9]+)(?:![a-z_0-9]+)?\(', sm.group(1)):
                        relations.setdefault(t, set()).add(rel)
                for cm in COL_CALL.finditer(window):
                    cols.add(cm.group(2))
                for wm in WRITE.finditer(window):
                    cols |= set(KEY.findall(wm.group(2)))
    return table_cols, relations


def dynamic_cols():
    data = json.load(open(SHAPES))
    out = {}
    for e in data["endpoints"]:
        m = re.match(r"/rest/v1/([a-z_0-9]+)$", e["path"])
        if not m or not isinstance(e["response_shape"], list):
            continue
        el = e["response_shape"][0] if e["response_shape"] else None
        if isinstance(el, dict):
            out.setdefault(m.group(1), {}).update(el)
    return out


def main():
    st, rel = static_cols()
    dyn = dynamic_cols()
    tables = sorted(set(st) | set(dyn))
    result = {}
    for t in tables:
        s_cols = sorted(c for c in st.get(t, set()) if c != "*")
        d_cols = dyn.get(t, {})
        result[t] = {
            "static_columns": s_cols,
            "runtime_columns": {k: v for k, v in d_cols.items() if isinstance(v, str)},
            "runtime_nested": sorted(k for k, v in d_cols.items() if not isinstance(v, str)),
            "embedded_relations": sorted(rel.get(t, set())),
            "agreement": sorted(set(s_cols) & set(d_cols)),
        }
    json.dump({"classification": "observation+inference", "tables": result}, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(len(result), "tables;", sum(1 for v in result.values() if v["runtime_columns"]), "with runtime shapes")


if __name__ == "__main__":
    main()
