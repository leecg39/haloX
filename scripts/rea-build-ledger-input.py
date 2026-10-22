"""Assemble the input JSON for `rea build-reconstruction-obligation-ledger`.

Usage: python3 scripts/rea-build-ledger-input.py <evidence_dir> <out_json>

Only REA-produced Evidence envelopes are included as records. No reconstruction
bindings exist yet (Phase 7 pending), so every obligation is expected to fail closed.
"""
import json
import os
import sys

EVIDENCE_DIR, OUT = sys.argv[1], sys.argv[2]

REA_FILES = [
    "p0-browser-targets.json",
    "p1-web-bundle.json",
    "p1-inspect-web-page.json",
    "p1-export-web-scripts.json",
    "p3-network-capture.json",
    "p4-screenshot-login.json",
]

ENVELOPE_KEYS = [
    "evidence_id", "subject", "provider", "predicate_type", "operation", "parameters",
    "raw_result", "normalized_result", "confidence", "authority", "environment",
    "limitations", "locations", "evidence_links",
]

# (id, title, layer, family, original authority, evidence files that justify the review)
OBLIGATIONS = [
    ("halox.routing.app-shell", "/app route tree (46 routes) and auth/onboarding gates", "application", "routing", "static", ["p1-web-bundle.json"]),
    ("halox.api.postgrest-tables", "PostgREST table reads used by app routes (rest/v1)", "protocol", "api", "runtime", ["p3-network-capture.json", "p1-web-bundle.json"]),
    ("halox.api.rpc", "Postgres RPC contracts (rest/v1/rpc/*) request/response shapes", "protocol", "api", "runtime", ["p3-network-capture.json"]),
    ("halox.api.edge-functions", "Edge function invocation contracts (functions/v1/*)", "protocol", "api", "static", ["p1-web-bundle.json"]),
    ("halox.persistence.data-model", "Entity model and relations (workspaces, keywords, geo, audit, content)", "persistence", "data-model", "runtime", ["p3-network-capture.json", "p1-web-bundle.json"]),
    ("halox.metrics.geo-score", "GEO score = 4 x 0.25 weighted components", "application", "metrics", "static", ["p1-web-bundle.json"]),
    ("halox.metrics.seo-score", "SEO score = position 0.4 + top10 0.3 + AIO 0.3", "application", "metrics", "static", ["p1-web-bundle.json"]),
    ("halox.metrics.avi-composite", "Dashboard AVI composite weights by data availability", "application", "metrics", "static", ["p1-web-bundle.json"]),
    ("halox.metrics.avi-server", "Server-side AVI (get_avi_overview) formula", "protocol", "metrics", "external", ["p3-network-capture.json"]),
    ("halox.ui.design-tokens", "Design tokens, typography and layout shell", "application", "design", "static", ["p4-screenshot-login.json", "p1-inspect-web-page.json"]),
    ("halox.jobs.async-pipelines", "Server-side async pipelines (GEO runs, SERP, site audit crawl, content generation)", "process", "backend-behavior", "external", ["p1-web-bundle.json"]),
]


def load(name):
    with open(os.path.join(EVIDENCE_DIR, name), encoding="utf-8") as fh:
        return json.load(fh)


def main():
    envelopes = {name: load(name) for name in REA_FILES}
    records = sorted(({k: env[k] for k in ENVELOPE_KEYS} for env in envelopes.values()),
                     key=lambda r: r["evidence_id"])
    ids = {name: env["evidence_id"] for name, env in envelopes.items()}
    # Canonical manifest rules (verified with `rea evidence-export`): providers,
    # environments and artifacts are derived from records; captures stay empty.
    providers = {r["provider"]["id"]: r["provider"] for r in records}
    environments = {r["environment"]["id"]: r["environment"] for r in records if r["environment"]}
    artifacts = {
        r["subject"]["digest"]["sha256"]: {
            "digest": r["subject"]["digest"], "format": r["subject"]["format"],
            "architecture": r["subject"]["architecture"],
        }
        for r in records if r["subject"]
    }

    reviewed = []
    for oid, title, layer, family, orig_auth, files in OBLIGATIONS:
        reviewed.append({
            "obligation_id": oid,
            "obligation_version": 1,
            "title": title,
            "application_layer": layer,
            "family": family,
            "target": {"artifact_sha256": None, "application_node_id": None, "semantic_node_id": None,
                       "location": "https://haloxlabs.ai/app"},
            "required": True,
            "required_case_kinds": ["positive", "negative"],
            "required_original_authority": orig_auth,
            "required_fixture_authority": "integration",
            "required_verifier_authority": "integration",
            "requires_parser_type": family in ("api", "data-model"),
            "dependency_obligation_ids": [],
            "residual_unknown_ids": [],
            "unavailable_authority": ["server-source"] if orig_auth == "external" else [],
            "required_next_evidence": ["clone implementation binding (Phase 7)", "integration test result evidence"],
            "disposition": "active",
            "review_evidence_ids": sorted({ids[f] for f in files}),
        })

    payload = {
        "evidence_bundle": {
            "artifacts": sorted(artifacts.values(), key=lambda a: a["digest"]["sha256"]),
            "providers": sorted(providers.values(), key=lambda p: p["id"]),
            "environments": sorted(environments.values(), key=lambda e: e["id"]),
            "scenarios": [], "captures": [], "unknowns": [], "records": records,
        },
        "reviewed_obligations": reviewed,
        "manifest": {"bindings": [], "contradictions": []},
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    print("records", len(records), "obligations", len(reviewed))


if __name__ == "__main__":
    main()
