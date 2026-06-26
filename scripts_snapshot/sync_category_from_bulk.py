#!/usr/bin/env python3
"""
R3.1.3-D4 类目自愈: 按 bulk_import_rows.js (登记类目) 校正 tuoke_real_records.js 的 cat 字段

死规矩 (子青 2026-06-26 拍板): 类目以登记为准 (bulk_import.类目)
归一化: 运动→运动户外, 珠宝→珠宝文玩

用法:
  python3 scripts/sync_category_from_bulk.py           # dry-run
  python3 scripts/sync_category_from_bulk.py --apply   # 写入
"""
import json, re, os, sys, argparse, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SC = f'{ROOT}/github_pages_adq_publish/sales-center'
CAT_NORM = {'运动':'运动户外', '珠宝':'珠宝文玩'}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    with open(f'{SC}/data/bulk_import_rows.js') as f: t = f.read()
    m = re.search(r'=\s*(\[[\s\S]+\]);?\s*$', t)
    bulk = json.loads(m.group(1))
    bk_cat = {}
    for r in bulk:
        n = (r.get('主体名称（红色主体代表重复，请自查去重）','') or '').strip()
        c = r.get('类目','')
        if isinstance(c, int): c = str(c)
        c = (c or '').strip()
        c = CAT_NORM.get(c, c)
        if not n or not c or c == '0': continue
        d = r.get('登记日期','')
        if n not in bk_cat or d < bk_cat[n][1]:
            bk_cat[n] = (c, d)
    bk_cat = {n: v[0] for n,v in bk_cat.items()}

    with open(f'{SC}/data/tuoke_real_records.js') as f: t = f.read()
    m = re.search(r'(window\.__TUOKE_REAL_RECORDS__\s*=\s*)(\[[\s\S]+\])(;?\s*)$', t)
    records = json.loads(m.group(2))

    conflict_changes = 0   # bulk 与 tuoke 有冲突, 改成 bulk 值
    fill_changes = 0       # tuoke 空/未打标, 用 bulk 补
    samples = []
    for r in records:
        n = (r.get('name','') or '').strip()
        if not n or n not in bk_cat: continue
        expected = bk_cat[n]
        actual = (r.get('cat','') or '').strip()
        actual_norm = CAT_NORM.get(actual, actual)
        if actual_norm == expected: continue
        if actual in ('','未打标'):
            r['cat'] = expected
            fill_changes += 1
        else:
            r['cat'] = expected
            conflict_changes += 1
            if len(samples) < 5:
                samples.append((n, actual, expected))

    print(f'=== D4 类目自愈 ({"APPLY" if args.apply else "DRY-RUN"}) ===')
    print(f'  bulk_import 类目字典: {len(bk_cat)} 条')
    print(f'  tuoke vs bulk 冲突: {conflict_changes} 条 (改成 bulk 值)')
    print(f'  tuoke 空/未打标: {fill_changes} 条 (用 bulk 补)')
    for n,b,a in samples: print(f'  ✓ {n[:30]} {b} → {a}')

    if args.apply and (conflict_changes + fill_changes):
        new_body = json.dumps(records, ensure_ascii=False, separators=(',',':'))
        with open(f'{SC}/data/tuoke_real_records.js','w') as f: f.write(m.group(1) + new_body + m.group(3))
        print('  ✓ tuoke_real_records.js 写回')

if __name__ == '__main__': main()
