#!/usr/bin/env python3
"""Prepare V3 chunked seed payloads for sales-center big data files.

Local only. It converts big static JS payloads into chunk documents for:
- sc_customer_records
- sc_customer_lookup
- sc_import_jobs
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

TZ = timezone(timedelta(hours=8))

RECORD_SOURCE = ("tuoke_real_records", "tuoke_real_records.js", "__TUOKE_REAL_RECORDS__")
LOOKUP_SOURCES = [
    ("mapping_data", "register_lookup_data.js", "__MAPPING_DATA__"),
    ("customer_link_data", "customer_link_data.js", "__CUSTOMER_LINK_DATA__"),
    ("customer_main_product", "customer_main_product.js", "__CUSTOMER_MAIN_PRODUCT__"),
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def extract_var(path: Path, var_name: str) -> Any:
    text = path.read_text(encoding="utf-8")
    m = re.search(r"window\." + re.escape(var_name) + r"\s*=\s*([\s\S]*?);(?:\n|$)", text)
    if not m:
        raise ValueError(f"Cannot find window.{var_name} in {path}")
    return json.loads(m.group(1).strip())


def chunks(seq: List[Any], size: int) -> Iterable[Tuple[int, List[Any]]]:
    for i in range(0, len(seq), size):
        yield i // size, seq[i:i + size]


def dict_chunks(d: Dict[str, Any], size: int) -> Iterable[Tuple[int, Dict[str, Any]]]:
    keys = sorted(d.keys())
    for i in range(0, len(keys), size):
        part_keys = keys[i:i + size]
        yield i // size, {k: d[k] for k in part_keys}


def infer_data_date_from_sources(paths: List[Path]) -> str:
    patterns = [
        r"Auto-(?:refreshed|generated)\s+(20\d{2}-\d{2}-\d{2})",
        r"T-1=(20\d{2}-\d{2}-\d{2})",
        r"(20\d{2}-\d{2}-\d{2})",
    ]
    for path in paths:
        head = path.read_text(encoding="utf-8", errors="ignore")[:300]
        for pat in patterns:
            m = re.search(pat, head)
            if m:
                return m.group(1)
    return datetime.now(TZ).strftime("%Y-%m-%d")


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sales-center", default="/tmp/adq_publish_cloudbase_v3/sales-center")
    parser.add_argument("--out", default="/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v3_seed")
    parser.add_argument("--record-chunk-size", type=int, default=500)
    parser.add_argument("--lookup-chunk-size", type=int, default=1000)
    args = parser.parse_args()

    sales_center = Path(args.sales_center).resolve()
    data_dir = sales_center / "data"
    out_dir = Path(args.out).resolve()
    generated_at = datetime.now(TZ).isoformat(timespec="seconds")

    record_type, record_file, record_var = RECORD_SOURCE
    record_path = data_dir / record_file
    records = extract_var(record_path, record_var)
    if not isinstance(records, list):
        raise TypeError("tuoke records must be a list")

    lookup_paths = [data_dir / filename for _, filename, _ in LOOKUP_SOURCES]
    data_date = infer_data_date_from_sources([record_path] + lookup_paths)
    snapshot_version = f"{data_date.replace('-', '')}_v3_big"

    record_chunks = []
    for chunk_index, payload in chunks(records, args.record_chunk_size):
        record_chunks.append({
            "collection": "sc_customer_records",
            "type": record_type,
            "dataDate": data_date,
            "snapshotVersion": snapshot_version,
            "sourceFile": f"data/{record_file}",
            "sourceVar": record_var,
            "sourceHash": sha256_bytes(record_path.read_bytes()),
            "payloadHash": stable_hash(payload),
            "chunkIndex": chunk_index,
            "chunkSize": args.record_chunk_size,
            "recordCount": len(payload),
            "totalRecords": len(records),
            "payload": payload,
            "generatedAt": generated_at,
        })

    lookup_chunks = []
    lookup_summary = {}
    for lookup_type, filename, var_name in LOOKUP_SOURCES:
        path = data_dir / filename
        payload = extract_var(path, var_name)
        if not isinstance(payload, dict):
            raise TypeError(f"{lookup_type} must be a dict")
        lookup_summary[lookup_type] = len(payload)
        for chunk_index, part in dict_chunks(payload, args.lookup_chunk_size):
            keys = sorted(part.keys())
            lookup_chunks.append({
                "collection": "sc_customer_lookup",
                "type": lookup_type,
                "dataDate": data_date,
                "snapshotVersion": snapshot_version,
                "sourceFile": f"data/{filename}",
                "sourceVar": var_name,
                "sourceHash": sha256_bytes(path.read_bytes()),
                "payloadHash": stable_hash(part),
                "chunkIndex": chunk_index,
                "chunkSize": args.lookup_chunk_size,
                "recordCount": len(part),
                "totalRecords": len(payload),
                "firstKey": keys[0] if keys else None,
                "lastKey": keys[-1] if keys else None,
                "keys": keys,
                "payload": part,
                "generatedAt": generated_at,
            })

    job = {
        "collection": "sc_import_jobs",
        "jobId": f"job_{snapshot_version}_{datetime.now(TZ).strftime('%H%M%S')}",
        "phase": "v3_big",
        "status": "prepared_local_only",
        "dataDate": data_date,
        "snapshotVersion": snapshot_version,
        "generatedAt": generated_at,
        "sourceRoot": str(sales_center),
        "targetCollections": ["sc_customer_records", "sc_customer_lookup"],
        "counts": {
            "recordChunks": len(record_chunks),
            "recordRows": len(records),
            "lookupChunks": len(lookup_chunks),
            "lookupRows": sum(lookup_summary.values()),
            "lookupSummary": lookup_summary,
        },
        "note": "Local V3 big-data chunk seed. Upload with upload_v3_big_seed_cli.js.",
    }

    manifest = {
        "dataDate": data_date,
        "snapshotVersion": snapshot_version,
        "generatedAt": generated_at,
        "outputs": [
            "sc_customer_records.seed.json",
            "sc_customer_lookup.seed.json",
            "sc_import_jobs.v3.seed.json",
        ],
        "counts": job["counts"],
    }

    write_json(out_dir / "sc_customer_records.seed.json", record_chunks)
    write_json(out_dir / "sc_customer_lookup.seed.json", lookup_chunks)
    write_json(out_dir / "sc_import_jobs.v3.seed.json", job)
    write_json(out_dir / "manifest_v3.json", manifest)

    print(json.dumps({"ok": True, "outDir": str(out_dir), **manifest}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
