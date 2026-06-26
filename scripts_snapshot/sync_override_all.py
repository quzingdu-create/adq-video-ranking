#!/usr/bin/env python3
"""
R3.1.1 自愈脚本: 用 manual_attr_override.json (真源) 同步到 4 个数据源
- inline __MANUAL_SALE_OVERRIDE__ (kanban_embed.html) → 不动 (inline 是子青最新拍板, 不应被脚本反向修改)
- register_lookup_data.js → 按 json 校正
- tuoke_real_records.js sale/_rtx/_recorded_by → 按 json 校正, 加 saleHistory

注: 只校正 register_lookup/tuoke_records, 不动 inline。
    inline 改动后, 需要先用本脚本同步到 json, 再跑本脚本同步到 register_lookup/tuoke_records。

用法:
  --dry-run  仅检查不修改 (默认)
  --apply    实际写入文件
"""
import json, re, sys, os, datetime, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SC = f'{ROOT}/github_pages_adq_publish/sales-center'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='实际写入文件 (否则只 dry-run)')
    args = ap.parse_args()

    # 读 json override (真源)
    with open(f'{SC}/data/manual_attr_override.json') as f: doc = json.load(f)
    json_ov = {k: v['sale'] for k,v in doc['overrides'].items() if v.get('sale')}

    # 读 register_lookup_data.js
    with open(f'{SC}/data/register_lookup_data.js') as f: rl_txt = f.read()
    m = re.search(r'(window\.__REGISTERED_SUBJECTS__\s*=\s*)(\{[\s\S]+?\})(;\s*)$', rl_txt, re.M)
    reg = json.loads(m.group(2))

    # 读 tuoke_real_records.js
    with open(f'{SC}/data/tuoke_real_records.js') as f: tk_txt = f.read()
    mt = re.search(r'(window\.__TUOKE_REAL_RECORDS__\s*=\s*)(\[[\s\S]+\])(;?\s*)$', tk_txt)
    records = json.loads(mt.group(2))

    # 1) 校正 register_lookup
    reg_changes = 0
    for n, expected in json_ov.items():
        if n in reg and reg[n].get('sale') != expected:
            reg[n]['sale'] = expected
            reg_changes += 1

    # 2) 校正 tuoke_records
    today = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    tk_changes = 0
    for r in records:
        n = (r.get('name','') or '').strip()
        if n in json_ov and r.get('sale') != json_ov[n]:
            old_sale = r.get('sale')
            r.setdefault('saleHistory', [])
            r['saleHistory'].append({
                'from': old_sale, 'to': json_ov[n], 'at': today,
                'by': 'sync_override_all', 'note': 'R3.1.1 自愈同步 manual_attr_override → tuoke_records'
            })
            r['sale'] = json_ov[n]
            r['_rtx'] = json_ov[n]
            r['_recorded_by'] = json_ov[n]
            r['saleEffectiveAt'] = today[:10]
            tk_changes += 1

    print(f'=== R3.1.1 自愈脚本 ({"APPLY" if args.apply else "DRY-RUN"}) ===')
    print(f'  register_lookup_data.js 待校正: {reg_changes} 条')
    print(f'  tuoke_real_records.js  待校正: {tk_changes} 条')

    if not args.apply:
        print('  (dry-run 模式, 未写入文件; 加 --apply 实际生效)')
        return

    # 写回
    if reg_changes:
        new_reg = json.dumps(reg, ensure_ascii=False, separators=(',',':'))
        rl_txt2 = m.group(1) + new_reg + m.group(3)
        with open(f'{SC}/data/register_lookup_data.js','w') as f: f.write(rl_txt2)
        print('  ✓ register_lookup_data.js 已写回')

    if tk_changes:
        new_tk = json.dumps(records, ensure_ascii=False, separators=(',',':'))
        tk_txt2 = mt.group(1) + new_tk + mt.group(3)
        with open(f'{SC}/data/tuoke_real_records.js','w') as f: f.write(tk_txt2)
        print('  ✓ tuoke_real_records.js 已写回')

if __name__ == '__main__': main()
