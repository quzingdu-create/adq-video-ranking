#!/usr/bin/env python3
"""One-click CloudBase snapshot sync for sales-center daily refresh.

It is intentionally conservative:
- default is dry-run (no upload)
- --upload enables replace upload
- always regenerates V3 big-data seed and V3.1 customer index from current sales-center data
- verifies static records count against CloudBase queryRecords totalRecords after upload/verify
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

TZ = timezone(timedelta(hours=8))
DEFAULT_ENV = "adq-tuoke-2-d9gktr9mn2e462acd"
MANAGED_PYTHON = "/Users/duziqing/.workbuddy/binaries/python/versions/3.13.12/bin/python3"
MANAGED_NODE = "/Users/duziqing/.workbuddy/binaries/node/versions/22.22.2/bin/node"
NODE_PATH_VALUE = "/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules"
TCB_BIN = "/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules/.bin/tcb"


def run(cmd: List[str], *, cwd: Optional[Path] = None, timeout: int = 600, env: Optional[Dict[str, str]] = None) -> subprocess.CompletedProcess:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    proc = subprocess.run(cmd, cwd=str(cwd) if cwd else None, text=True, capture_output=True, timeout=timeout, env=merged_env)
    if proc.returncode != 0:
        raise RuntimeError(
            "Command failed:\n{}\nSTDOUT:\n{}\nSTDERR:\n{}".format(" ".join(cmd), proc.stdout[-3000:], proc.stderr[-3000:])
        )
    return proc


def extract_var(path: Path, var_name: str) -> Any:
    text = path.read_text(encoding="utf-8")
    match = re.search(r"window\." + re.escape(var_name) + r"\s*=\s*([\s\S]*?);(?:\n|$)", text)
    if not match:
        raise ValueError(f"Cannot find window.{var_name} in {path}")
    return json.loads(match.group(1))


def parse_retmsg(stdout: str) -> Dict[str, Any]:
    outer = json.loads(stdout)
    ret = ((outer.get("data") or {}).get("RetMsg")) or "{}"
    return json.loads(ret)


def invoke_api(action: str, params: Dict[str, Any], env_id: str) -> Dict[str, Any]:
    payload = json.dumps({"action": action, "params": params}, ensure_ascii=False, separators=(",", ":"))
    proc = run(
        [TCB_BIN, "--env-id", env_id, "fn", "invoke", "salesCenterApi", "--params", payload, "--json"],
        env={"NODE_PATH": NODE_PATH_VALUE},
        timeout=180,
    )
    return parse_retmsg(proc.stdout)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync current sales-center static big-data snapshot to CloudBase.")
    parser.add_argument("--repo", default="/Users/duziqing/WorkBuddy/2026-05-12-task-5/github_pages_adq_publish", help="github_pages_adq_publish repo root")
    parser.add_argument("--sales-center", default="", help="sales-center directory; default: <repo>/sales-center")
    parser.add_argument("--out-root", default="", help="Output root for generated seed/report; default: /tmp/sales_center_cloudbase_daily_sync_<timestamp>")
    parser.add_argument("--env", default=DEFAULT_ENV, help="CloudBase env id")
    parser.add_argument("--upload", action="store_true", help="Actually replace-upload seed to CloudBase. Default is dry-run only.")
    parser.add_argument("--verify-only", action="store_true", help="Skip seed generation/upload and only verify existing CloudBase snapshot. Requires --out-root with manifests or uses current static dataDate.")
    parser.add_argument("--sample-name", default="杭州不姜就科技有限公司", help="Customer name for getCustomerDetail verification")
    parser.add_argument("--lookup-key", default="阿迪达斯", help="Customer link lookup key")
    parser.add_argument("--report", default="", help="Write JSON report to this path")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    sales_center = Path(args.sales_center).resolve() if args.sales_center else repo / "sales-center"
    scripts = repo / "scripts" / "cloudbase_migration"
    if not sales_center.exists():
        raise FileNotFoundError(sales_center)
    if not scripts.exists():
        raise FileNotFoundError(scripts)

    timestamp = datetime.now(TZ).strftime("%Y%m%d_%H%M%S")
    out_root = Path(args.out_root).resolve() if args.out_root else Path(f"/tmp/sales_center_cloudbase_daily_sync_{timestamp}")
    v3_dir = out_root / "cloudbase_v3_seed"
    v31_dir = out_root / "cloudbase_v31_index_seed"
    out_root.mkdir(parents=True, exist_ok=True)

    data_dir = sales_center / "data"
    center_kpi = extract_var(data_dir / "center_daily_kpi.js", "__CENTER_DAILY_KPI__")
    data_date = center_kpi.get("dataDate")
    if not isinstance(data_date, str) or not re.match(r"^20\d{2}-\d{2}-\d{2}$", data_date):
      raise ValueError(f"Invalid center_daily_kpi dataDate: {data_date}")
    snapshot_version = f"{data_date.replace('-', '')}_v3_big"
    static_records = extract_var(data_dir / "tuoke_real_records.js", "__TUOKE_REAL_RECORDS__")
    if not isinstance(static_records, list):
        raise TypeError("__TUOKE_REAL_RECORDS__ must be list")

    report: Dict[str, Any] = {
        "ok": False,
        "mode": "upload" if args.upload else ("verify-only" if args.verify_only else "dry-run"),
        "repo": str(repo),
        "salesCenter": str(sales_center),
        "outRoot": str(out_root),
        "envId": args.env,
        "dataDate": data_date,
        "snapshotVersion": snapshot_version,
        "static": {"records": len(static_records)},
        "steps": [],
    }

    if not args.verify_only:
        if v3_dir.exists():
            shutil.rmtree(v3_dir)
        if v31_dir.exists():
            shutil.rmtree(v31_dir)
        py = MANAGED_PYTHON if Path(MANAGED_PYTHON).exists() else sys.executable
        run([py, str(scripts / "prepare_v3_big_seed.py"), "--sales-center", str(sales_center), "--out", str(v3_dir)], timeout=180)
        run([py, str(scripts / "prepare_v31_customer_index.py"), "--seed-dir", str(v3_dir), "--out", str(v31_dir)], timeout=180)
        report["steps"].append("seed_generated")

        if args.upload:
            node = MANAGED_NODE if Path(MANAGED_NODE).exists() else "node"
            run([node, str(scripts / "upload_v3_big_seed_cli.js"), "--seed-dir", str(v3_dir), "--replace"], timeout=600)
            run([node, str(scripts / "upload_v31_customer_index_cli.js"), "--seed-dir", str(v31_dir), "--replace"], timeout=600)
            report["steps"].append("uploaded_replace")
        else:
            node = MANAGED_NODE if Path(MANAGED_NODE).exists() else "node"
            dry_v3 = run([node, str(scripts / "upload_v3_big_seed_cli.js"), "--seed-dir", str(v3_dir), "--dry-run"], timeout=60)
            dry_v31 = run([node, str(scripts / "upload_v31_customer_index_cli.js"), "--seed-dir", str(v31_dir), "--dry-run"], timeout=60)
            report["dryRun"] = {"v3": json.loads(dry_v3.stdout), "v31": json.loads(dry_v31.stdout)}
            report["steps"].append("dry_run_checked")

    v3_manifest_path = v3_dir / "manifest_v3.json"
    v31_manifest_path = v31_dir / "manifest_v31.json"
    if v3_manifest_path.exists():
        report["manifestV3"] = load_json(v3_manifest_path)
        if report["manifestV3"].get("snapshotVersion") != snapshot_version:
            raise AssertionError(f"V3 manifest snapshot mismatch: {report['manifestV3'].get('snapshotVersion')} != {snapshot_version}")
        if report["manifestV3"].get("counts", {}).get("recordRows") != len(static_records):
            raise AssertionError("V3 manifest recordRows does not match static records")
    if v31_manifest_path.exists():
        report["manifestV31"] = load_json(v31_manifest_path)
        if report["manifestV31"].get("snapshotVersion") != snapshot_version:
            raise AssertionError(f"V31 manifest snapshot mismatch: {report['manifestV31'].get('snapshotVersion')} != {snapshot_version}")

    if args.upload or args.verify_only:
        records_res = invoke_api("queryRecords", {"snapshotVersion": snapshot_version, "page": 1, "pageSize": 1}, args.env)
        lookup_res = invoke_api("queryLookup", {"snapshotVersion": snapshot_version, "type": "customer_link_data", "keys": [args.lookup_key]}, args.env)
        detail_res = invoke_api("getCustomerDetail", {"snapshotVersion": snapshot_version, "name": args.sample_name}, args.env)
        versions_res = invoke_api("listVersions", {}, args.env)
        report["cloudVerification"] = {
            "queryRecords": {
                "ok": records_res.get("ok"),
                "totalRecords": (records_res.get("data") or {}).get("totalRecords"),
                "count": (records_res.get("data") or {}).get("count"),
            },
            "queryLookup": {
                "ok": lookup_res.get("ok"),
                "foundCount": (lookup_res.get("data") or {}).get("foundCount"),
                "key": args.lookup_key,
            },
            "getCustomerDetail": {
                "ok": detail_res.get("ok"),
                "foundLookup": (detail_res.get("data") or {}).get("foundLookup"),
                "foundRecord": (detail_res.get("data") or {}).get("foundRecord"),
                "indexRefCount": (detail_res.get("data") or {}).get("indexRefCount"),
                "name": args.sample_name,
            },
            "listVersions": (versions_res.get("data") or {}),
        }
        if report["cloudVerification"]["queryRecords"]["totalRecords"] != len(static_records):
            raise AssertionError("Cloud queryRecords.totalRecords does not match static records")
        if report["cloudVerification"]["queryLookup"]["foundCount"] < 1:
            raise AssertionError("Cloud lookup sample did not hit")
        if not report["cloudVerification"]["getCustomerDetail"]["foundRecord"]:
            raise AssertionError("Cloud customer detail sample did not find record")
        report["steps"].append("cloud_verified")

    report["ok"] = True
    report_path = Path(args.report).resolve() if args.report else out_root / "sync_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "mode": report["mode"], "dataDate": data_date, "snapshotVersion": snapshot_version, "staticRecords": len(static_records), "report": str(report_path)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
