#!/usr/bin/env python3
"""R0: 把 tuoke_real_records.js (14504条登记) 合并去重成 customers 主集合 seed。

设计要点（2026-06-24 子青拍板）:
- customerId = 系统稳定 UUID（绑 primaryName=工商主体全名，永不变）
- 同一 primaryName 的多条登记合并成一条主记录
- sale = 「先登记先归属」: 取最早登记(id最小=毫秒时间戳最早)那条有效销售的 sale
- override(manual_attr_override.json) 优先级最高: 命中则用 override 的 sale
- 简称/品牌名收进 aliases（解决简称漂移，如紫羽→BONAS）
- 留痕字段: firstRegisterAt/firstRegisterBy/saleLockedAt/saleSource
"""
import re, json, uuid, argparse
from collections import defaultdict
from pathlib import Path

SALES = {'brownfan','Jonzhu','kaikaigenli','kinsleyjin','lijunwu','ruilingzhan','yvaineechen'}

def extract_records(js_path):
    s = Path(js_path).read_text(encoding='utf-8')
    m = re.search(r'__TUOKE_REAL_RECORDS__\s*=\s*(\[[\s\S]*?\]);', s)
    return json.loads(m.group(1))

def reg_ts(r):
    """登记时间戳: 优先 id(毫秒), 退 _createdAt, 退 date->天"""
    for k in ('id','_createdAt'):
        v = r.get(k)
        if isinstance(v,(int,float)) and v > 1e12:
            return int(v)
    d = r.get('date')
    if isinstance(d,str) and re.match(r'^\d{4}-\d{2}-\d{2}', d):
        # 当天 0 点的近似毫秒（仅用于排序，比真时间戳大的兜底）
        import datetime
        try:
            return int(datetime.datetime.strptime(d[:10],'%Y-%m-%d').timestamp()*1000)
        except: pass
    return 1 << 62  # 无时间信息的排最后

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--records', default='/Users/duziqing/WorkBuddy/2026-05-12-task-5/github_pages_adq_publish/sales-center/data/tuoke_real_records.js')
    ap.add_argument('--override', default='/Users/duziqing/WorkBuddy/2026-05-12-task-5/github_pages_adq_publish/sales-center/data/manual_attr_override.json')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    recs = extract_records(args.records)
    ov = json.load(open(args.override)).get('overrides', {})
    # override 可能按 shortName 或 name 命中, 建两套索引
    print(f'读入登记记录: {len(recs)} 条, override: {len(ov)} 条')

    by_name = defaultdict(list)
    for r in recs:
        name = (r.get('name') or r.get('shortName') or '').strip()
        if name:
            by_name[name].append(r)

    customers = []
    stats = {'total':0,'sale_from_override':0,'sale_from_earliest':0,'sale_empty':0,
             'multi_record':0,'sale_conflict_resolved':0}

    for name, group in by_name.items():
        stats['total'] += 1
        if len(group) > 1: stats['multi_record'] += 1
        # 按登记时间排序（最早在前）
        group_sorted = sorted(group, key=reg_ts)
        earliest = group_sorted[0]

        # aliases: 所有 shortName + brand 去重
        aliases = []
        for r in group:
            for k in ('shortName','brand'):
                v = (r.get(k) or '').strip()
                if v and v != name and v not in aliases:
                    aliases.append(v)

        # sale 决策: override 最高优先, 否则取最早登记的有效 sale
        sale = ''
        sale_source = ''
        sale_locked_at = reg_ts(earliest)
        # 先查 override (按 name 或任一 alias 命中)
        ov_hit = None
        if name in ov: ov_hit = ov[name]
        else:
            for a in aliases:
                if a in ov: ov_hit = ov[a]; break
        if ov_hit and (ov_hit.get('sale') or '').strip() in SALES:
            sale = ov_hit['sale'].strip()
            sale_source = 'override'
            stats['sale_from_override'] += 1
        else:
            # 先登记先归属: 最早一条有效 sale
            valid_sales = [(reg_ts(r), (r.get('sale') or '').strip()) for r in group_sorted
                           if (r.get('sale') or '').strip() in SALES]
            if valid_sales:
                valid_sales.sort()
                sale = valid_sales[0][1]
                sale_locked_at = valid_sales[0][0]
                sale_source = 'earliest_register'
                stats['sale_from_earliest'] += 1
                # 冲突检测
                distinct = set(s for _,s in valid_sales)
                if len(distinct) > 1: stats['sale_conflict_resolved'] += 1
            else:
                sale = ''
                sale_source = 'unassigned'
                stats['sale_empty'] += 1

        # 取最新一条的业务字段(cat/source等用最新), 但归属用上面决策的
        latest = group_sorted[-1]
        cust = {
            'customerId': str(uuid.uuid4()),
            'primaryName': name,
            'aliases': aliases,
            'sale': sale,
            'saleSource': sale_source,
            'saleLockedAt': sale_locked_at,
            'firstRegisterAt': reg_ts(earliest),
            'firstRegisterBy': (earliest.get('sale') or earliest.get('_recorded_by') or '').strip(),
            'cat': (latest.get('cat') or '').strip(),
            'source': (latest.get('source') or '').strip(),
            'channel': (latest.get('channel') or '').strip(),
            'firstQuarter': (latest.get('firstQuarter') or '').strip(),
            'isOld24': bool(latest.get('isLaoke') or latest.get('old24')),
            'recordCount': len(group),
            'legacyIds': [r.get('id') for r in group if r.get('id') is not None],
        }
        customers.append(cust)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(customers, ensure_ascii=False), encoding='utf-8')

    # 对账报告
    sale_dist = defaultdict(int)
    for c in customers:
        sale_dist[c['sale'] or '(空)'] += 1
    report = {
        'ok': True,
        'sourceRecords': len(recs),
        'uniqueCustomers': len(customers),
        'stats': stats,
        'saleDistribution': dict(sale_dist),
    }
    (out.parent / 'build_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
