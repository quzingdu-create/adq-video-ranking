#!/usr/bin/env python3
"""
R3.1.2 反向同步: kanban_embed.html inline __MANUAL_SALE_OVERRIDE__ → manual_attr_override.json

场景:
  子青在 kanban_embed.html line 934 改了 inline override (32 条快速生效层),
  但 manual_attr_override.json (1548 条真源) 没同步, 导致下次 rebuild 把 sale 刷回旧值。

死规矩:
  inline 是子青最新拍板, 优先级 > json。本脚本以 inline 为真源, 覆盖 json 对应条目。

用法:
  python3 scripts/sync_inline_to_json.py           # dry-run, 仅检查差异
  python3 scripts/sync_inline_to_json.py --apply   # 实际写入 json
"""
import json, re, sys, os, datetime, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SC = f'{ROOT}/github_pages_adq_publish/sales-center'
HTML = f'{SC}/kanban_embed.html'
JSON_PATH = f'{SC}/data/manual_attr_override.json'

def load_inline():
    with open(HTML) as f: html = f.read()
    m = re.search(r'window\.__MANUAL_SALE_OVERRIDE__\s*=\s*(\{[^}]+\});', html)
    if not m:
        print('❌ 未在 kanban_embed.html 找到 __MANUAL_SALE_OVERRIDE__')
        sys.exit(2)
    return json.loads(m.group(1))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    inline = load_inline()
    with open(JSON_PATH) as f: doc = json.load(f)
    ov = doc.setdefault('overrides', {})

    today = datetime.datetime.now().strftime('%Y-%m-%d')
    now_iso = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')

    changes = []  # (type, name, before, after)
    for name, sale in inline.items():
        if name not in ov:
            changes.append(('NEW', name, '(无)', sale))
            if args.apply:
                ov[name] = {
                    'sale': sale,
                    'reason': f'{today} sync_inline_to_json: inline 独有, 反向同步',
                    'date': today
                }
        elif ov[name].get('sale') != sale:
            old = ov[name].get('sale')
            changes.append(('CHANGE', name, old, sale))
            if args.apply:
                ov[name]['sale'] = sale
                ov[name]['reason'] = f'{today} sync_inline_to_json: {old}→{sale} (inline 子青最新拍板)'
                ov[name]['date'] = today

    print(f'=== R3.1.2 inline → json 反向同步 ({"APPLY" if args.apply else "DRY-RUN"}) ===')
    print(f'  inline override: {len(inline)} 条')
    print(f'  json  override: {len(ov)} 条')
    print(f'  待同步差异: {len(changes)} 条')
    for typ, n, b, a in changes[:30]:
        print(f'  [{typ}] {n}: {b} → {a}')
    if len(changes) > 30:
        print(f'  ... 还有 {len(changes)-30} 条')

    if args.apply and changes:
        doc['updatedAt'] = now_iso
        prev_note = doc.get('note', '')
        doc['note'] = (prev_note + f' | {today} sync_inline_to_json: 反向同步 {len(changes)} 条')[:500]
        with open(JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
        print(f'  ✓ 已写入 {JSON_PATH}')
        print(f'  → 下一步: 跑 sync_override_all.py --apply 把 json 同步到 register_lookup + tuoke_records')
    elif not changes:
        print('  ✓ 已经一致, 无需同步')

if __name__ == '__main__': main()
