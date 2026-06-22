#!/usr/bin/env python3
"""Verify salesCenterApi cloud responses against local V2 seed files."""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

NODE_BIN_DIR = "/Users/duziqing/.workbuddy/binaries/node/versions/22.22.2/bin"
NODE_PATH = "/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules"
TCB = "/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules/.bin/tcb"
ENV_ID = "adq-tuoke-2-d9gktr9mn2e462acd"
SEED_DIR = Path("/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def invoke(action: str, params=None):
    params = params or {}
    payload = json.dumps({"action": action, "params": params}, ensure_ascii=False)
    cmd = [TCB, "--env-id", ENV_ID, "fn", "invoke", "salesCenterApi", "--params", payload, "--json"]
    env = os.environ.copy()
    env["NODE_PATH"] = NODE_PATH
    env["PATH"] = NODE_BIN_DIR + os.pathsep + env.get("PATH", "")
    proc = subprocess.run(cmd, text=True, capture_output=True, env=env, timeout=90)
    if proc.returncode != 0:
        raise RuntimeError(f"invoke {action} failed: {proc.stderr or proc.stdout}")
    outer = json.loads(proc.stdout)
    data = outer.get("data", {})
    ret = data.get("RetMsg")
    if not ret:
        raise RuntimeError(f"invoke {action} missing RetMsg: {proc.stdout[:500]}")
    return json.loads(ret)


def seed_map(rows):
    return {row["type"]: row for row in rows}


def main() -> int:
    manifest = load_json(SEED_DIR / "manifest.json")
    snapshots = seed_map(load_json(SEED_DIR / "sc_snapshot_daily.seed.json"))
    tops = seed_map(load_json(SEED_DIR / "sc_top_metrics.seed.json"))
    sv = manifest["snapshotVersion"]

    health = invoke("healthcheck", {"from": "verify_v2_cloud_api"})
    boot = invoke("getBootstrap", {"snapshotVersion": sv})
    top = invoke("getTopMetrics", {"snapshotVersion": sv})
    versions = invoke("listVersions", {})

    checks = []
    def check(name, passed, detail=None):
        checks.append({"name": name, "ok": bool(passed), "detail": detail})

    check("healthcheck_ok", health.get("ok") is True, health.get("data"))
    check("cloudbase_sdk_ready", health.get("data", {}).get("cloudbaseSdkReady") is True, health.get("data", {}).get("cloudbaseSdkReady"))
    check("bootstrap_count", boot.get("data", {}).get("count") == len(snapshots), boot.get("data", {}).get("count"))
    check("top_count", top.get("data", {}).get("count") == len(tops), top.get("data", {}).get("count"))
    check("latest_version", versions.get("data", {}).get("latest") == sv, versions.get("data", {}).get("latest"))

    for row in boot.get("data", {}).get("records", []):
        s = snapshots.get(row.get("type"))
        check(f"bootstrap_hash_{row.get('type')}", bool(s) and s.get("payloadHash") == row.get("payloadHash"), {
            "expected": s.get("payloadHash") if s else None,
            "actual": row.get("payloadHash")
        })
    for row in top.get("data", {}).get("records", []):
        s = tops.get(row.get("type"))
        check(f"top_hash_{row.get('type')}", bool(s) and s.get("payloadHash") == row.get("payloadHash"), {
            "expected": s.get("payloadHash") if s else None,
            "actual": row.get("payloadHash")
        })

    failed = [c for c in checks if not c["ok"]]
    report = {
        "ok": not failed,
        "snapshotVersion": sv,
        "counts": {
            "bootstrap": boot.get("data", {}).get("count"),
            "top": top.get("data", {}).get("count"),
        },
        "checks": checks,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
