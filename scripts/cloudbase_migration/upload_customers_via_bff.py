#!/usr/bin/env python3
"""通过已鉴权的 tcb CLI 调 bulkImportCustomers，分批灌 customers seed。"""
import json, subprocess, os, sys
from pathlib import Path

TCB = "/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules/.bin/tcb"
NODE_PATH = "/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules"
NODE_BIN = "/Users/duziqing/.workbuddy/binaries/node/versions/22.22.2/bin"
ENV = "adq-tuoke-2-d9gktr9mn2e462acd"
SEED = sys.argv[1] if len(sys.argv) > 1 else "/Users/duziqing/WorkBuddy/2026-06-24-10-53-06/customers_seed/customers.seed.json"
BATCH = 150

def invoke(params):
    payload = json.dumps({"action": "bulkImportCustomers", "params": params}, ensure_ascii=False, separators=(",", ":"))
    env = os.environ.copy(); env["NODE_PATH"] = NODE_PATH; env["PATH"] = NODE_BIN + os.pathsep + env.get("PATH", "")
    p = subprocess.run([TCB, "--env-id", ENV, "fn", "invoke", "salesCenterApi", "--params", payload, "--json"],
                       text=True, capture_output=True, env=env, timeout=120)
    if p.returncode != 0:
        raise RuntimeError("invoke failed: " + (p.stderr or p.stdout)[-500:])
    outer = json.loads(p.stdout)
    return json.loads(outer["data"]["RetMsg"])

def main():
    rows = json.loads(Path(SEED).read_text(encoding="utf-8"))
    print(f"待灌: {len(rows)} 条, 批大小 {BATCH}")
    total_added = 0; total_failed = 0
    for i in range(0, len(rows), BATCH):
        slice_ = rows[i:i+BATCH]
        params = {"rows": slice_}
        if i == 0:
            params["replace"] = True; params["replaceConfirm"] = "YES"  # 首批清空重灌
        r = invoke(params)
        if not r.get("ok"):
            print("批次失败:", r.get("error")); raise SystemExit(1)
        d = r["data"]
        total_added += d.get("added", 0); total_failed += d.get("failed", 0)
        if i == 0 and d.get("removed"):
            print(f"  清空旧数据: {d['removed']} 条")
        print(f"\r已灌 {total_added} 失败 {total_failed} (进度 {min(i+BATCH,len(rows))}/{len(rows)})", end="", flush=True)
    print()
    cnt = invoke({"rows": [], "replace": False}) if False else None
    # 用 customersCount 校验
    payload = json.dumps({"action": "customersCount", "params": {}}, ensure_ascii=False)
    env = os.environ.copy(); env["NODE_PATH"] = NODE_PATH; env["PATH"] = NODE_BIN + os.pathsep + env.get("PATH", "")
    p = subprocess.run([TCB, "--env-id", ENV, "fn", "invoke", "salesCenterApi", "--params", payload, "--json"], text=True, capture_output=True, env=env, timeout=60)
    try:
        final = json.loads(json.loads(p.stdout)["data"]["RetMsg"])["data"].get("total")
    except Exception:
        final = "?(解析失败,手动查customersCount)"
    print(f"=== 灌库完成: added={total_added} failed={total_failed} 云端最终={final} 期望={len(rows)} {'✅' if final==len(rows) else '⚠️核对'}")

if __name__ == "__main__":
    main()
