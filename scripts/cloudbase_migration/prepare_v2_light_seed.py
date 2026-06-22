#!/usr/bin/env python3
"""Prepare V2 CloudBase seed payloads from sales-center static data files.

This script does not upload anything. It only converts existing data/*.js files
into JSON payloads shaped for future sc_snapshot_daily / sc_top_metrics imports.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List

TZ = timezone(timedelta(hours=8))

SNAPSHOT_SOURCES = [
    ("center_daily_kpi", "center_daily_kpi.js", "__CENTER_DAILY_KPI__"),
    ("center_quarter_summary", "center_quarter_summary.js", "__CENTER_QUARTER_SUMMARY__"),
    ("dashboard_runtime_summary", "dashboard_runtime_summary.js", "__DASHBOARD_RUNTIME_SUMMARY__"),
    ("center_sales_summary", "center_sales_summary.js", "__CENTER_SALES_SUMMARY__"),
    ("current_rising", "current_rising_data.js", "__CURRENT_RISING_SET__"),
]

TOP_SOURCES = [
    ("top80_effective_metrics", "top80_effective_metrics.js", "__TOP80_EFFECTIVE_METRICS__"),
    ("top_status_data", "top_status_data.js", "__TOP_STATUS_DATA__"),
    ("top_status_list", "top_status_data.js", "__TOP_STATUS_LIST__"),
    ("redblack_data", "redblack_data.js", "__REDBLACK_DATA__"),
    ("top_rising_data", "top_rising_data.js", "__TOP_RISING_DATA__"),
    ("yest_new_customer_tasks", "yest_new_customer_tasks.js", "__YEST_NEW_CUSTOMER_TASKS__"),
    ("enough_candidates", "enough_candidates.js", "__ENOUGH_CANDIDATES__"),
]

ASSIGN_RE_TEMPLATE = r"window\.{var}\s*=\s*([\s\S]*?);(?:\n|$)"


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract_var(path: Path, var_name: str) -> Any:
    text = path.read_text(encoding="utf-8")
    pattern = ASSIGN_RE_TEMPLATE.format(var=re.escape(var_name))
    match = re.search(pattern, text)
    if not match:
        raise ValueError(f"Cannot find window.{var_name} in {path}")
    raw = match.group(1).strip()
    set_match = re.match(r"^new\s+Set\((\[[\s\S]*\])\)$", raw)
    if set_match:
        raw = set_match.group(1)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Cannot parse JSON for {var_name} in {path}: {exc}") from exc


def count_payload(payload: Any) -> int:
    if isinstance(payload, list):
        return len(payload)
    if isinstance(payload, dict):
        for key in ("list", "items", "rows", "data"):
            if isinstance(payload.get(key), list):
                return len(payload[key])
        return len(payload)
    return 1


def infer_data_date(snapshot_items: List[Dict[str, Any]], top_items: List[Dict[str, Any]]) -> str:
    for item in snapshot_items + top_items:
        payload = item.get("payload")
        if isinstance(payload, dict):
            for key in ("dataDate", "date", "updatedAt"):
                val = payload.get(key)
                if isinstance(val, str) and re.match(r"^20\d{2}-\d{2}-\d{2}", val):
                    return val[:10]
    return datetime.now(TZ).strftime("%Y-%m-%d")


def build_records(data_dir: Path, sources: List[tuple], collection_name: str) -> List[Dict[str, Any]]:
    records = []
    for data_type, filename, var_name in sources:
        path = data_dir / filename
        if not path.exists():
            raise FileNotFoundError(path)
        payload = extract_var(path, var_name)
        source_text = path.read_text(encoding="utf-8")
        records.append({
            "collection": collection_name,
            "type": data_type,
            "sourceFile": f"data/{filename}",
            "sourceVar": var_name,
            "sourceHash": sha256_file(path),
            "payloadHash": sha256_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))),
            "count": count_payload(payload),
            "payload": payload,
            "sourceSizeBytes": len(source_text.encode("utf-8")),
        })
    return records


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sales-center", default="/Users/duziqing/WorkBuddy/2026-05-12-task-5/github_pages_adq_publish/sales-center")
    parser.add_argument("--out", default="/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed")
    args = parser.parse_args()

    sales_center = Path(args.sales_center).resolve()
    data_dir = sales_center / "data"
    out_dir = Path(args.out).resolve()

    snapshot_records = build_records(data_dir, SNAPSHOT_SOURCES, "sc_snapshot_daily")
    top_records = build_records(data_dir, TOP_SOURCES, "sc_top_metrics")
    data_date = infer_data_date(snapshot_records, top_records)
    snapshot_version = f"{data_date.replace('-', '')}_v2_light"
    generated_at = datetime.now(TZ).isoformat(timespec="seconds")

    for idx, item in enumerate(snapshot_records + top_records, 1):
        item["dataDate"] = data_date
        item["snapshotVersion"] = snapshot_version
        item["generatedAt"] = generated_at
        item["importOrder"] = idx

    import_job = {
        "collection": "sc_import_jobs",
        "jobId": f"job_{snapshot_version}_{datetime.now(TZ).strftime('%H%M%S')}",
        "dataDate": data_date,
        "snapshotVersion": snapshot_version,
        "status": "prepared_local_only",
        "generatedAt": generated_at,
        "sourceRoot": str(sales_center),
        "targetCollections": ["sc_snapshot_daily", "sc_top_metrics"],
        "counts": {
            "snapshotRecords": len(snapshot_records),
            "topRecords": len(top_records),
            "totalPayloadItems": sum(item["count"] for item in snapshot_records + top_records),
        },
        "files": [
            {"type": item["type"], "sourceFile": item["sourceFile"], "sourceVar": item["sourceVar"], "count": item["count"], "sourceHash": item["sourceHash"]}
            for item in snapshot_records + top_records
        ],
        "note": "Local V2 seed only. No CloudBase upload has been performed.",
    }

    write_json(out_dir / "sc_snapshot_daily.seed.json", snapshot_records)
    write_json(out_dir / "sc_top_metrics.seed.json", top_records)
    write_json(out_dir / "sc_import_jobs.seed.json", import_job)
    write_json(out_dir / "manifest.json", {
        "dataDate": data_date,
        "snapshotVersion": snapshot_version,
        "generatedAt": generated_at,
        "outputs": [
            "sc_snapshot_daily.seed.json",
            "sc_top_metrics.seed.json",
            "sc_import_jobs.seed.json",
        ],
        "counts": import_job["counts"],
    })

    print(json.dumps({
        "ok": True,
        "outDir": str(out_dir),
        "dataDate": data_date,
        "snapshotVersion": snapshot_version,
        "counts": import_job["counts"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
