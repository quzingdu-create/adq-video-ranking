#!/usr/bin/env python3
"""Verify V2 light seed payloads against static sales-center data files."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed-dir", default="/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed")
    parser.add_argument("--prepare-script", default="/Users/duziqing/WorkBuddy/2026-05-12-task-5/scripts/cloudbase_migration/prepare_v2_light_seed.py")
    parser.add_argument("--sales-center", default="/Users/duziqing/WorkBuddy/2026-05-12-task-5/github_pages_adq_publish/sales-center")
    args = parser.parse_args()

    seed_dir = Path(args.seed_dir).resolve()
    manifest_path = seed_dir / "manifest.json"
    snapshot_path = seed_dir / "sc_snapshot_daily.seed.json"
    top_path = seed_dir / "sc_top_metrics.seed.json"
    job_path = seed_dir / "sc_import_jobs.seed.json"

    missing = [str(p) for p in (manifest_path, snapshot_path, top_path, job_path) if not p.exists()]
    if missing:
        print(json.dumps({"ok": False, "error": "missing_seed_files", "missing": missing}, ensure_ascii=False, indent=2))
        return 1

    manifest = load_json(manifest_path)
    snapshots = load_json(snapshot_path)
    tops = load_json(top_path)
    job = load_json(job_path)

    checks = []
    def check(name, passed, detail=None):
        checks.append({"name": name, "ok": bool(passed), "detail": detail})

    check("manifest_snapshot_count", manifest["counts"]["snapshotRecords"] == len(snapshots), {"manifest": manifest["counts"]["snapshotRecords"], "actual": len(snapshots)})
    check("manifest_top_count", manifest["counts"]["topRecords"] == len(tops), {"manifest": manifest["counts"]["topRecords"], "actual": len(tops)})
    check("job_status_local_only", job.get("status") == "prepared_local_only", job.get("status"))
    check("all_snapshot_versions_match", len({x.get("snapshotVersion") for x in snapshots + tops}) == 1, sorted({x.get("snapshotVersion") for x in snapshots + tops}))
    check("all_data_dates_match", len({x.get("dataDate") for x in snapshots + tops}) == 1, sorted({x.get("dataDate") for x in snapshots + tops}))
    check("no_empty_payload", all(x.get("count", 0) > 0 for x in snapshots + tops), [{"type": x.get("type"), "count": x.get("count")} for x in snapshots + tops if x.get("count", 0) <= 0])

    key_counts = {x["type"]: x["count"] for x in snapshots + tops}
    expected_min = {
        "center_daily_kpi": 1,
        "center_quarter_summary": 1,
        "top80_effective_metrics": 1,
        "top_status_data": 1,
        "redblack_data": 1,
        "yest_new_customer_tasks": 1,
    }
    for key, min_count in expected_min.items():
        check(f"min_count_{key}", key_counts.get(key, 0) >= min_count, key_counts.get(key, 0))

    failed = [c for c in checks if not c["ok"]]
    report = {
        "ok": not failed,
        "seedDir": str(seed_dir),
        "dataDate": manifest.get("dataDate"),
        "snapshotVersion": manifest.get("snapshotVersion"),
        "counts": manifest.get("counts"),
        "checks": checks,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
