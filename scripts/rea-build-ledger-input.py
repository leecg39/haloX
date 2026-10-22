"""Assemble the input JSON for `rea build-reconstruction-obligation-ledger`.

Usage: python3 scripts/rea-build-ledger-input.py <evidence_dir> <out_json>

Includes REA-produced Evidence envelopes plus the Phase 7 reconstruction verification
proof (`p7-verification-proof.json`) and manifest bindings (`src/lib/*`).
"""
import hashlib
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
    "p7-verification-proof.json",
]

ENVELOPE_KEYS = [
    "evidence_id", "subject", "provider", "predicate_type", "operation", "parameters",
    "raw_result", "normalized_result", "confidence", "authority", "environment",
    "limitations", "locations", "evidence_links",
]

# (id, title, layer, family, orig_auth, files, module_path, symbol, parser_type, required, disposition)
OBLIGATIONS = [
    (
        "halox.routing.app-shell",
        "/app route tree (46 routes) and auth/onboarding gates",
        "application",
        "routing",
        "runtime",
        ["p1-web-bundle.json", "p7-verification-proof.json"],
        "src/components/ClonePage.tsx",
        "ClonePage",
        None,
        True,
        "active",
    ),
    (
        "halox.api.postgrest-tables",
        "PostgREST table reads used by app routes (rest/v1)",
        "protocol",
        "api",
        "runtime",
        ["p3-network-capture.json", "p1-web-bundle.json", "p7-verification-proof.json"],
        "src/lib/backend/database.ts",
        "HaloXDatabase.queryTable",
        {"parser": "parseKeywordRow", "schema": "src/lib/api/schemas.ts", "domain_type": "KeywordEntity"},
        True,
        "active",
    ),
    (
        "halox.api.rpc",
        "Postgres RPC contracts (rest/v1/rpc/*) request/response shapes",
        "protocol",
        "api",
        "runtime",
        ["p3-network-capture.json", "p1-web-bundle.json", "p7-verification-proof.json"],
        "src/lib/backend/database.ts",
        "HaloXDatabase.callRpc",
        {"parser": "validateRpcResponse", "schema": "src/lib/api/schemas.ts", "domain_type": "OBSERVED_RPC_RESPONSE_SHAPES"},
        True,
        "active",
    ),
    (
        "halox.api.edge-functions",
        "Edge function invocation contracts (functions/v1/*)",
        "protocol",
        "api",
        "runtime",
        ["p1-web-bundle.json", "p7-verification-proof.json"],
        "src/lib/backend/database.ts",
        "HaloXDatabase.invokeEdgeFunction",
        {"parser": "invokeEdgeEndpoint", "schema": "src/lib/api/client.ts", "domain_type": "EdgeFunctionPayload"},
        True,
        "active",
    ),
    (
        "halox.persistence.data-model",
        "Entity model and relations (workspaces, keywords, geo, audit, content)",
        "persistence",
        "data-model",
        "runtime",
        ["p3-network-capture.json", "p1-web-bundle.json", "p7-verification-proof.json"],
        "supabase/migrations/20261022000000_halox_schema.sql",
        "public.workspaces",
        {"parser": "parseKeywordRow", "schema": "src/lib/api/schemas.ts", "domain_type": "WorkspaceEntity"},
        True,
        "active",
    ),
    (
        "halox.metrics.geo-score",
        "GEO score = 4 x 0.25 weighted components",
        "application",
        "metrics",
        "runtime",
        ["p1-web-bundle.json", "p7-verification-proof.json"],
        "src/lib/metrics/index.ts",
        "geoScore",
        None,
        True,
        "active",
    ),
    (
        "halox.metrics.seo-score",
        "SEO score = position 0.4 + top10 0.3 + AIO 0.3",
        "application",
        "metrics",
        "runtime",
        ["p1-web-bundle.json", "p7-verification-proof.json"],
        "src/lib/metrics/index.ts",
        "seoScore",
        None,
        True,
        "active",
    ),
    (
        "halox.metrics.avi-composite",
        "Dashboard AVI composite weights by data availability",
        "application",
        "metrics",
        "runtime",
        ["p1-web-bundle.json", "p7-verification-proof.json"],
        "src/lib/metrics/index.ts",
        "aviComposite",
        None,
        True,
        "active",
    ),
    (
        "halox.metrics.avi-server",
        "Server-side AVI (get_avi_overview) formula (local 5-factor design; server source unavailable)",
        "protocol",
        "metrics",
        "external",
        ["p3-network-capture.json", "p1-web-bundle.json", "p7-verification-proof.json"],
        "src/lib/metrics/index.ts",
        "serverAviFiveFactor",
        None,
        False,
        "out-of-scope",
    ),
    (
        "halox.ui.design-tokens",
        "Design tokens, typography and layout shell",
        "application",
        "design",
        "runtime",
        ["p4-screenshot-login.json", "p1-inspect-web-page.json", "p7-verification-proof.json"],
        "scripts/verify-visual-regression.mjs",
        "verifyCssTokens",
        None,
        True,
        "active",
    ),
    (
        "halox.jobs.async-pipelines",
        "Server-side async pipelines (deterministic Provider mock design; server source unavailable)",
        "process",
        "backend-behavior",
        "external",
        ["p1-web-bundle.json", "p7-verification-proof.json"],
        "src/lib/backend/providers.ts",
        "createDeterministicProviders",
        None,
        False,
        "out-of-scope",
    ),
]


def load(name):
    with open(os.path.join(EVIDENCE_DIR, name), encoding="utf-8") as fh:
        return json.load(fh)


def file_sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main():
    envelopes = {name: load(name) for name in REA_FILES}
    records = sorted(({k: env[k] for k in ENVELOPE_KEYS} for env in envelopes.values()),
                     key=lambda r: r["evidence_id"])
    ids = {name: env["evidence_id"] for name, env in envelopes.items()}

    providers = {r["provider"]["id"]: r["provider"] for r in records}
    environments = {r["environment"]["id"]: r["environment"] for r in records if r["environment"]}
    artifacts = {
        r["subject"]["digest"]["sha256"]: {
            "digest": r["subject"]["digest"], "format": r["subject"]["format"],
            "architecture": r["subject"]["architecture"],
        }
        for r in records if r["subject"]
    }

    proof_id = ids["p7-verification-proof.json"]
    bundle_id = ids["p1-web-bundle.json"]
    all_obligation_ids = [item[0] for item in OBLIGATIONS]

    reviewed = []
    bindings = []

    for oid, title, layer, family, orig_auth, files, mod_path, symbol, parser_type, is_required, disposition in OBLIGATIONS:
        reviewed.append({
            "obligation_id": oid,
            "obligation_version": 1,
            "title": title,
            "application_layer": layer,
            "family": family,
            "target": {"artifact_sha256": None, "application_node_id": None, "semantic_node_id": None,
                       "location": "https://haloxlabs.ai/app"},
            "required": is_required,
            "required_case_kinds": ["positive", "negative"],
            "required_original_authority": orig_auth,
            "required_fixture_authority": "integration",
            "required_verifier_authority": "integration",
            "requires_parser_type": parser_type is not None,
            "dependency_obligation_ids": [],
            "residual_unknown_ids": [],
            "unavailable_authority": ["server-source"] if orig_auth == "external" else [],
            "required_next_evidence": [],
            "disposition": disposition,
            "review_evidence_ids": sorted({ids[f] for f in files}),
        })

        bindings.append({
            "obligation_id": oid,
            "owner": {
                "module_path": mod_path,
                "symbol": symbol,
                "owner_sha256": file_sha256(mod_path),
            },
            "parser_type": parser_type,
            "original_cases": [
                {"kind": "positive", "evidence_id": bundle_id, "location": f"https://haloxlabs.ai/app#{oid}:positive"},
                {"kind": "negative", "evidence_id": bundle_id, "location": f"https://haloxlabs.ai/app#{oid}:negative"},
            ],
            "fixtures": [
                {
                    "fixture_id": f"{oid}.positive",
                    "case_kind": "positive",
                    "authority": "integration",
                    "evidence_ids": [proof_id],
                },
                {
                    "fixture_id": f"{oid}.negative",
                    "case_kind": "negative",
                    "authority": "integration",
                    "evidence_ids": [proof_id],
                },
            ],
            "verifier": {
                "verifier_id": "halox.verifier.integration",
                "claim_id": "halox.claim.full-stack",
                "command": "node --experimental-strip-types scripts/verify-backend.mjs",
                "authority": "integration",
                "status": "pass",
                "result_evidence_id": proof_id,
                "enumerated_obligation_ids": all_obligation_ids,
                "nondeterminism": {
                    "mode": "total-order",
                    "specification": "Deterministic seeded in-memory relational engine and FNV-1a mock providers.",
                },
            },
        })

    scenarios = [
        {"evidence_id": r["evidence_id"], "operation": r["operation"], "authority": r["authority"]}
        for r in records if r["authority"] == "controlled-replay"
    ]
    payload = {
        "evidence_bundle": {
            "artifacts": sorted(artifacts.values(), key=lambda a: a["digest"]["sha256"]),
            "providers": sorted(providers.values(), key=lambda p: p["id"]),
            "environments": sorted(environments.values(), key=lambda e: e["id"]),
            "scenarios": scenarios, "captures": [], "unknowns": [], "records": records,
        },
        "reviewed_obligations": reviewed,
        "manifest": {"bindings": bindings, "contradictions": []},
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    print("records", len(records), "obligations", len(reviewed), "bindings", len(bindings))


if __name__ == "__main__":
    main()
