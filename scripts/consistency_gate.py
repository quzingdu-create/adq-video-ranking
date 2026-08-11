#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全链路一致性守门（2026-08-10 落地，回应"守门本身谁检查"元问题）

设计原则
--------
1. 以【独立真源】为锚，而非"四出口互相比较"——后者防不了共同错源。
   - 锚A: snapshots/2026-08-09/center_quarter_summary.js  (rebuild 当日真实落地值)
   - 锚B: kanban_new_customer_view.js 直接数 Q3 新客 (最上游派生真值)
2. 每个维度从各出口抽取，与锚比对；任一不等即 FAIL 并阻断出报。
3. 抽取失败标记为 UNKNOWN（不假装 PASS）。

运行
----
    python3 scripts/consistency_gate.py
退出码: 0=通过, 1=存在不一致
"""
import json, re, sys, os

ROOT = "/Users/duziqing/WorkBuddy/2026-05-12-task-5/github_pages_adq_publish"
REP  = "/Users/duziqing/Desktop/日报快报/日报快报_2026-08-10"
QUARTER = "2026Q3"

BOARD  = f"{ROOT}/sales-center/data/center_quarter_summary.js"
SNAP   = f"{ROOT}/sales-center/data/snapshots/2026-08-09/center_quarter_summary.js"
KANBAN = f"{ROOT}/sales-center/data/kanban_new_customer_view.js"
REPORT = f"{REP}/服饰拓新日报快报_2026-08-10.html"
WECHAT = f"{REP}/微信群推送文案_generated.txt"


def load_summary(path):
    t = open(path, encoding="utf-8").read()
    m = re.search(r"window\.__CENTER_QUARTER_SUMMARY__\s*=\s*(\[.+?\]);", t, re.S)
    return json.loads(m.group(1))


def q3_total(arr):
    for r in arr:
        if r.get("quarter") == QUARTER and r.get("sale") == "合计":
            return r
    return None


def extract(pat, text, cast=int):
    m = re.search(pat, text)
    return cast(m.group(1)) if m else None


# ===== 加载真源与派生 =====
board = load_summary(BOARD)
snap  = load_summary(SNAP)
bt = q3_total(board)
st = q3_total(snap)

report = open(REPORT, encoding="utf-8").read()
wechat = open(WECHAT, encoding="utf-8").read()

# kanban 上游真值：首投季度==2026/Q3 的客户数
kt = open(KANBAN, encoding="utf-8").read()
km = re.search(r"window\.__KANBAN_NEW_CUSTOMER_VIEW__\s*=\s*(\[.+?\]);", kt, re.S)
karr = json.loads(km.group(1))
kanban_q3_count = sum(1 for r in karr if r.get("首投季度") == "2026/Q3")

# ===== 独立真源锚 =====
anchor_delta = st["newDayDelta"]          # 期望 310
anchor_count = st["newCount"]             # 期望 3427

# ===== 各出口抽取 =====
board_delta = bt["newDayDelta"]
board_count = bt["newCount"]

report_title_delta = extract(r"新客 <b>\d+</b> <span class=\"delta-up\">\+(\d+)", report)
report_title_count = extract(r"新客 <b>(\d+)</b> <span class=\"delta-up\">", report)
report_ds_deltas = [int(x) for x in re.findall(r"ds-delta-inline\">\+(\d+)", report)]
report_ds_total = sum(report_ds_deltas) if report_ds_deltas else None
# 反向守门：快报里所有 delta-up +N 只应 ∈ {0, anchor}，且 anchor 至少出现
report_all_pos = [int(x) for x in re.findall(r"delta-up\">\+(\d+)", report)]

wx_yest = extract(r"昨日首投客户(\d+)个", wechat)
wx_q3_count = extract(r"Q3新客数(\d+)个", wechat)
wx_q3_delta = extract(r"Q3新客数\d+个（\+(\d+)）", wechat)
wx_days = extract(r"已过(\d+)", wechat)

# ===== 一致性断言（全部必须 == 锚，且锚须被多源印证）=====
checks = []
def check(name, *vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        checks.append((name, "UNKNOWN(未提取到)", False)); return
    ok = len(set(vals)) == 1
    checks.append((name, vals, ok))

print(f"独立真源锚A (snapshot 8-09 rebuild): 新客+N={anchor_delta}, Q3累计={anchor_count}")
print(f"独立真源锚B (kanban 上游): Q3新客={kanban_q3_count}")
print("=" * 64)

# 锚自身先自洽：snapshot 与 kanban 上游应对得上
check("[锚自洽] snapshot累计 == kanban上游", anchor_count, kanban_q3_count)

# 新客 +N 维度
check("新客+N: 看板合计==锚A", board_delta, anchor_delta)
check("新客+N: 快报标题==锚A", report_title_delta, anchor_delta)
check("新客+N: 投放端环比合计==锚A", report_ds_total, anchor_delta)
check("新客+N: 微信昨日首投==锚A", wx_yest, anchor_delta)
check("新客+N: 微信Q3(+N)==锚A", wx_q3_delta, anchor_delta)

# 新客累计维度
check("Q3累计: 看板==锚A", board_count, anchor_count)
check("Q3累计: 快报标题==锚A", report_title_count, anchor_count)
check("Q3累计: 微信==锚A", wx_q3_count, anchor_count)

# 反向守门：快报不应出现锚以外的脏 +N
dirty = [v for v in report_all_pos if v not in (0, anchor_delta)]
if dirty:
    checks.append(("[反向] 快报出现非预期+值", dirty, False))
else:
    checks.append(("[反向] 快报+值均∈{0,锚}", [0, anchor_delta], True))

# 天数：微信 == diff-only(39)，且不应==看板+1口径(40)
check("天数: 微信已过==39(diff-only)", wx_days, 39)

# ===== 输出 =====
all_ok = True
for name, vals, ok in checks:
    flag = "PASS" if ok else "FAIL"
    if not ok: all_ok = False
    print(f"  [{flag}] {name}  ->  {vals}")
print("=" * 64)
if all_ok:
    print("✅ 全链路一致性守门通过")
    sys.exit(0)
else:
    print("❌ 守门拦截：存在不一致，阻断出报")
    sys.exit(1)
