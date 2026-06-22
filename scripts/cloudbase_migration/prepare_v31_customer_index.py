#!/usr/bin/env python3
"""Prepare V3.1 customer-name index seed from V3 customer record chunks."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

TZ = timezone(timedelta(hours=8))


def stable_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def norm_key(value: Any) -> str:
    return str(value or "").strip()


def index_ref(row: Dict[str, Any], chunk_index: int, row_index: int) -> Dict[str, Any]:
    return {
        "chunkIndex": chunk_index,
        "rowIndex": row_index,
        "id": row.get("id"),
        "_id": row.get("_id"),
        "name": row.get("name") or "",
        "shortName": row.get("shortName") or "",
        "brand": row.get("brand") or "",
        "sale": row.get("sale") or "",
        "cat": row.get("cat") or "",
        "firstQuarter": row.get("firstQuarter") or "",
        "isNew": row.get("isNew"),
        "isValid": row.get("isValid"),
        "yestCost": row.get("yestCost") or 0,
        "quarterCost": row.get("quarterCost") or 0,
    }


def dict_chunks(d: Dict[str, Any], size: int) -> Iterable[Tuple[int, Dict[str, Any]]]:
    keys = sorted(d.keys())
    for i in range(0, len(keys), size):
        part_keys = keys[i:i + size]
        yield i // size, {k: d[k] for k in part_keys}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed-dir", default="/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v3_seed")
    parser.add_argument("--out", default="/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v31_index_seed")
    parser.add_argument("--chunk-size", type=int, default=1000)
    args = parser.parse_args()

    seed_dir = Path(args.seed_dir).resolve()
    out_dir = Path(args.out).resolve()
    manifest = json.loads((seed_dir / "manifest_v3.json").read_text(encoding="utf-8"))
    record_chunks = json.loads((seed_dir / "sc_customer_records.seed.json").read_text(encoding="utf-8"))
    snapshot_version = manifest["snapshotVersion"]
    data_date = manifest["dataDate"]
    generated_at = datetime.now(TZ).isoformat(timespec="seconds")

    index: Dict[str, List[Dict[str, Any]]] = {}
    total_rows = 0
    for chunk in record_chunks:
        chunk_index = int(chunk["chunkIndex"])
        for row_index, row in enumerate(chunk.get("payload") or []):
            total_rows += 1
            ref = index_ref(row, chunk_index, row_index)
            for raw_key in (row.get("shortName"), row.get("name"), row.get("brand")):
                key = norm_key(raw_key)
                if not key:
                    continue
                bucket = index.setdefault(key, [])
                if not any(x.get("chunkIndex") == chunk_index and x.get("rowIndex") == row_index for x in bucket):
                    bucket.append(ref)

    index_chunks = []
    for chunk_index, payload in dict_chunks(index, args.chunk_size):
        keys = sorted(payload.keys())
        index_chunks.append({
            "collection": "sc_customer_index",
            "type": "customer_name_index",
            "dataDate": data_date,
            "snapshotVersion": snapshot_version,
            "sourceCollection": "sc_customer_records",
            "sourceType": "tuoke_real_records",
            "payloadHash": stable_hash(payload),
            "chunkIndex": chunk_index,
            "chunkSize": args.chunk_size,
            "keyCount": len(keys),
            "totalKeys": len(index),
            "totalRows": total_rows,
            "firstKey": keys[0] if keys else None,
            "lastKey": keys[-1] if keys else None,
            "keys": keys,
            "payload": payload,
            "generatedAt": generated_at,
        })

    job = {
        "collection": "sc_import_jobs",
        "jobId": f"job_{snapshot_version}_v31_index_{datetime.now(TZ).strftime('%H%M%S')}",
        "phase": "v3_1_customer_index",
        "status": "prepared_local_only",
        "dataDate": data_date,
        "snapshotVersion": snapshot_version,
        "generatedAt": generated_at,
        "targetCollections": ["sc_customer_index"],
        "counts": {
            "indexChunks": len(index_chunks),
            "indexKeys": len(index),
            "sourceRows": total_rows,
        },
        "note": "Customer-name index for locating sc_customer_records chunkIndex/rowIndex.",
    }

    out_manifest = {
        "dataDate": data_date,
        "snapshotVersion": snapshot_version,
        "generatedAt": generated_at,
        "outputs": ["sc_customer_index.seed.json", "sc_import_jobs.v31.seed.json"],
        "counts": job["counts"],
    }
    write_json(out_dir / "sc_customer_index.seed.json", index_chunks)
    write_json(out_dir / "sc_import_jobs.v31.seed.json", job)
    write_json(out_dir / "manifest_v31.json", out_manifest)
    print(json.dumps({"ok": True, "outDir": str(out_dir), **out_manifest}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
