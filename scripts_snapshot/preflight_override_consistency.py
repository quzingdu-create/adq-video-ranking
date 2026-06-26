#!/usr/bin/env python3
"""
R3.1.1 死规矩守门:
- 检查 inline __MANUAL_SALE_OVERRIDE__ (kanban_embed.html) vs manual_attr_override.json 双向一致
- 检查 register_lookup_data.js 中所有 override 客户的 sale 是否打齐
- 检查 tuoke_real_records.js 中所有 override 客户的 sale 是否打齐

任一不一致直接退出 1,阻断后续 rebuild/部署。

用法:
  python3 scripts/preflight_override_consistency.py
"""
import json, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SC = f'{ROOT}/github_pages_adq_publish/sales-center'

def load_inline_override():
    with open(f'{SC}/kanban_embed.html') as f: html = f.read()
    m = re.search(r'window\.__MANUAL_SALE_OVERRIDE__\s*=\s*(\{[^}]+\});', html)
    if not m: return {}
    return json.loads(m.group(1))

def load_json_override():
    p = f'{SC}/data/manual_attr_override.json'
    if not os.path.exists(p): return {}
    with open(p) as f: return {k: v.get('sale') for k,v in json.load(f).get('overrides',{}).items()}

def load_register_lookup():
    with open(f'{SC}/data/register_lookup_data.js') as f: t = f.read()
    m = re.search(r'window\.__REGISTERED_SUBJECTS__\s*=\s*(\{[\s\S]+?\});\s*$', t, re.M)
    if not m: return {}
    return {k: v.get('sale') for k,v in json.loads(m.group(1)).items()}

def load_tuoke_records():
    with open(f'{SC}/data/tuoke_real_records.js') as f: t = f.read()
    m = re.search(r'=\s*(\[[\s\S]+\]);?\s*$', t)
    by_name = {}
    for r in json.loads(m.group(1)):
        n = (r.get('name','') or '').strip()
        if not n: continue
        # 取最早一条
        if n not in by_name or r.get('date','') < by_name[n].get('date',''):
            by_name[n] = r
    return {n: r.get('sale') for n,r in by_name.items()}

def main():
    inline = load_inline_override()
    json_ov = load_json_override()
    reg = load_register_lookup()
    tk = load_tuoke_records()

    errors = []

    # 1) inline vs json 双向 (inline 是子青最新拍板, 必须在 json 里有)
    for n,s in inline.items():
        if n not in json_ov:
            errors.append(f'[A1] inline 独有 (json 缺): {n} -> {s}')
        elif json_ov[n] != s:
            errors.append(f'[A2] inline={s} 但 json={json_ov[n]}: {n}')

    # 2) 全量 json override (1500+ 条) 核对 register_lookup + tuoke_records 是否打齐
    #    R3.1.1 升级: 之前只查 inline 32 条, 现在查全量 json, 防止有 override 被 rebuild 刷回
    reg_err = []
    tk_err = []
    for n, expected in json_ov.items():
        rs = reg.get(n)
        if rs is not None and rs != expected:
            reg_err.append(f'[B] register_lookup 未打齐: {n} 期望={expected} 实际={rs}')
        ts = tk.get(n)
        if ts is not None and ts != expected:
            tk_err.append(f'[C] tuoke_records 未打齐: {n} 期望={expected} 实际={ts}')

    errors.extend(reg_err)
    errors.extend(tk_err)

    if errors:
        print(f'❌ override 一致性自检失败,共 {len(errors)} 个问题:')
        for e in errors[:30]: print('  ' + e)
        if len(errors) > 30: print(f'  ... 还有 {len(errors)-30} 条')
        print('\n修复方法: python3 scripts/sync_override_all.py --apply')
        sys.exit(1)
    print(f'✅ override 一致性自检通过 (inline={len(inline)} json={len(json_ov)} reg={len(reg)} tk={len(tk)})')
    sys.exit(0)

if __name__ == '__main__': main()

