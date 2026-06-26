#!/usr/bin/env python3
"""
系统性多源数据一致性体检 (R3.1.3)
一次性自检看板里所有"多个数据源 → 同一业务字段"的不变量

覆盖维度:
  D1. 销售归属 sale          (R3.1.1+R3.1.2 已守门)
  D2. cache-buster 版本     (各 HTML 页面是否同步)
  D3. PC vs mobile 镜像     (sales-center vs sales-center-mobile data/)
  D4. 类目 cat              (tuoke_records vs bulk_import)
  D5. 老客标记 isLaoke      (与 firstQuarter 自洽)
  D6. 销售英文名规范        (只允许 7 个标准值)

退出码: 0=全通过 / 非 0=有阻断级问题

用法:
  python3 scripts/full_consistency_audit.py        # 完整审计
  python3 scripts/full_consistency_audit.py --hard # 把 D2/D4/D5 也升级到阻断级
"""
import json, re, os, sys, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SC = f'{ROOT}/github_pages_adq_publish/sales-center'
SCM = f'{ROOT}/github_pages_adq_publish/sales-center-mobile'

STANDARD_SALES = {'brownfan','lijunwu','Jonzhu','kaikaigenli','kinsleyjin','yvaineechen','ruilingzhan'}

def load_records(path):
    with open(path) as f: t = f.read()
    m = re.search(r'=\s*(\[[\s\S]+\]);?\s*$', t)
    return json.loads(m.group(1))

def load_dict(path, var):
    with open(path) as f: t = f.read()
    m = re.search(rf'window\.{var}\s*=\s*(\{{[\s\S]+?\}});\s*$', t, re.M)
    return json.loads(m.group(1)) if m else {}

def d1_sale_override():
    """复用 preflight_override_consistency"""
    rc = os.system(f'python3 {ROOT}/scripts/preflight_override_consistency.py > /dev/null 2>&1')
    return ('D1 sale override', rc == 0, '运行 preflight_override_consistency.py' if rc else '通过')

def d2_cache_buster():
    htmls = ['index.html','mobile.html','kanban_embed.html','pursuit.html','industry-belt.html','report.html']
    versions = {}
    for h in htmls:
        p = f'{SC}/{h}'
        if not os.path.exists(p): continue
        with open(p) as f: t = f.read()
        vs = set(re.findall(r'\?v=(20\d{6}[a-z])', t))
        if vs: versions[h] = vs
    all_v = set()
    for vs in versions.values(): all_v |= vs
    multi = {h:v for h,v in versions.items() if len(v) > 1}
    detail = []
    if len(all_v) > 1:
        detail.append(f'多版本并存: {sorted(all_v)}')
        for h,v in versions.items(): detail.append(f'  {h}: {sorted(v)}')
    if multi:
        detail.append(f'单页内多版本: {len(multi)} 个 HTML')
    return ('D2 cache-buster', len(all_v) <= 1 and not multi, '\n  '.join(detail) if detail else '通过')

def d3_mobile_mirror():
    files = ['register_lookup_data.js','tuoke_real_records.js','center_quarter_summary.js',
             'center_sales_summary.js','center_daily_kpi.js','top80_effective_metrics.js']
    diffs = []
    for f in files:
        a = f'{SC}/data/{f}'
        b = f'{SCM}/data/{f}'
        if not os.path.exists(b):
            diffs.append(f'mobile 缺: {f}')
            continue
        if open(a).read() != open(b).read():
            diffs.append(f'PC vs mobile 不一致: {f}')
    return ('D3 mobile 镜像', not diffs, f'{len(diffs)} 处差异: ' + ', '.join(diffs[:5]) if diffs else '通过')

def d4_category():
    try:
        records = load_records(f'{SC}/data/tuoke_real_records.js')
    except: return ('D4 类目', False, '读 tuoke_records 失败')
    # 类目归一化 (bulk 用简称, tuoke 用全称, 同义合并)
    CAT_NORM = {'运动':'运动户外', '珠宝':'珠宝文玩'}
    norm = lambda c: CAT_NORM.get(str(c or '').strip(), str(c or '').strip())
    tk_cat = {}
    for r in records:
        n = (r.get('name','') or '').strip()
        if n: tk_cat.setdefault(n, set()).add(norm(r.get('cat','')))
    bulk_path = f'{SC}/data/bulk_import_rows.js'
    if not os.path.exists(bulk_path): return ('D4 类目', True, '跳过(bulk_import 不存在)')
    with open(bulk_path) as f: t = f.read()
    m = re.search(r'=\s*(\[[\s\S]+\]);?\s*$', t)
    bulk = json.loads(m.group(1))
    bk_cat = {}
    for r in bulk:
        n = r.get('主体名称（红色主体代表重复，请自查去重）','').strip()
        if n: bk_cat.setdefault(n, set()).add(norm(r.get('类目','')))
    mismatch = 0
    for n in (set(tk_cat) & set(bk_cat)):
        tcs = {x for x in tk_cat[n] if x and x != '未打标'}
        bcs = {x for x in bk_cat[n] if x and x != '0'}
        if len(tcs) == 1 and len(bcs) == 1 and list(tcs)[0] != list(bcs)[0]:
            mismatch += 1
    return ('D4 类目 cat', mismatch == 0, f'tuoke vs bulk 不一致: {mismatch} 条')

def d5_isLaoke():
    records = load_records(f'{SC}/data/tuoke_real_records.js')
    curQ = '2026Q2'
    bad = 0
    seen = set()
    for r in records:
        n = (r.get('name','') or '').strip()
        if not n or n in seen: continue
        seen.add(n)
        fq = (r.get('firstQuarter','') or '').replace('/','')
        if not fq: continue
        expected = fq < curQ
        actual = r.get('isLaoke') == True
        if expected != actual: bad += 1
    return ('D5 老客标记', bad == 0, f'isLaoke 与 firstQuarter 自相矛盾: {bad} 条')

def d6_sale_names():
    records = load_records(f'{SC}/data/tuoke_real_records.js')
    bad = set()
    for r in records:
        s = r.get('sale','')
        if s and s not in STANDARD_SALES and s != '其他': bad.add(s)
    return ('D6 销售名规范', not bad, f'非标准销售名: {sorted(bad)}' if bad else '通过')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hard', action='store_true', help='把 D2/D4/D5 也升级到阻断级 (默认仅 D1/D3/D6 阻断)')
    args = ap.parse_args()
    checks = [d1_sale_override, d2_cache_buster, d3_mobile_mirror, d4_category, d5_isLaoke, d6_sale_names]
    hard_keys = {'D1','D3','D6'}
    if args.hard: hard_keys |= {'D2','D4','D5'}
    fail_hard = 0
    print('=== 系统性多源一致性体检 ===\n')
    for fn in checks:
        try:
            name, ok, detail = fn()
        except Exception as e:
            name, ok, detail = (fn.__name__, False, f'异常: {e}')
        tag = '✅' if ok else '❌'
        print(f'{tag} {name:25s} {detail}')
        key = name.split()[0]
        if not ok and key in hard_keys: fail_hard += 1
    print()
    if fail_hard:
        print(f'❌ 阻断级失败 {fail_hard} 项, 必须修复')
        sys.exit(1)
    print('✅ 体检通过 (阻断级)')

if __name__ == '__main__': main()
