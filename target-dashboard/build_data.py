#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
靶向客户监控看板 · v2 数据构建器
输入（~/Downloads/）：
  靶向客户-销售-9.3.xlsx                销售归属白名单（49 主体）
  微信小店x视频号-靶向-9.3.csv         主指标（13 个）+ 视频号明细
  指标明细-9.3.csv                     日均消耗主体口径
  投放端-靶向-9.3.csv / 原生推广...csv / 潜客优投...csv / 智投广告-9.3.csv
                                       是否使用标记（4 类产品能力）
  大盘消耗趋势-9.3.csv                 总览折线图 1
  消耗趋势-客户-9.3.csv                总览折线图 2（按客户）

行业映射兜底：../dashboard.bak-20260831-pre-v2/data.json
"""
import json, csv, re, sys
from pathlib import Path
from collections import defaultdict
from datetime import datetime
import openpyxl

HOME = Path.home(); SRC = HOME/'Downloads'
OUT  = HOME/'Downloads/dashboard'
OLD  = HOME/'Downloads/dashboard.bak-20260831-pre-v2'

def f(x, default=0.0):
    if x is None: return default
    s = str(x).strip()
    if s in ('','~','-','nan','NaN','null','None'): return default
    try: return float(s)
    except: return default
def i(x, default=0):
    v = f(x, default); return int(v) if v==v else default
def b(x):
    s = str(x or '').strip().lower()
    if s in ('true','是','1','yes','t'): return True
    if s in ('false','否','0','no','f'): return False
    return None

def quantile(arr, q):
    if not arr: return 0
    arr=sorted(arr); n=len(arr); idx=max(0, int(n*q)-1)
    return arr[idx]
p75 = lambda a: quantile(a, 0.75)
p25 = lambda a: quantile(a, 0.25)

def main():
    # ─── 1) 销售白名单（拆多公司名） ───
    wb = openpyxl.load_workbook(SRC/'靶向客户-销售-9.3.xlsx')
    ws = wb.active
    sales_map = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r[0] or not r[1]: continue
        for name in re.split(r'[、，,\s]+', str(r[1])):
            name=name.strip()
            if name: sales_map[name] = str(r[0]).strip()
    targets = list(sales_map.keys())
    print(f'[xlsx] 主体 {len(targets)} 条 / 销售 {len(set(sales_map.values()))} 人')

    # ─── 2) 主表（微信小店x视频号）→ 索引到白名单 ───
    by_sub = defaultdict(lambda: {'shops':[], 'consume_total':0.0})
    with open(SRC/'微信小店x视频号-靶向-9.3.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            sub=r.get('客户简称','').strip()
            if sub not in sales_map: continue
            shop_id = r.get('微信小店店铺id','').strip()
            video   = r.get('视频号名称','').strip()
            consume = f(r.get('日均消耗(元)'))
            by_sub[sub]['consume_total'] += consume
            by_sub[sub]['shops'].append({
                'shop_id':shop_id,'video':video,'consume':consume,
                'ctr':f(r.get('ctr(%)')),'cvr':f(r.get('浅层cvr(%)')),
                'aov':f(r.get('下单单价(元)')),'roi':f(r.get('下单ROI')),
                'ads':i(r.get('有消耗广告数')),'account':i(r.get('有消耗的账户数')),
                'new_ratio':f(r.get('新广告占比(%)')),
                'auto_ratio':f(r.get('天一键起量使用广告占比(%)')),
                'creative_id':i(r.get('日均曝光创意唯一性ID数')),
                '3s_play':f(r.get('视频3秒完播率(%)')),
                'avg_dur':f(r.get('平均播放时长')),
                'bad':f(r.get('小店订单-差评率(%)')),
                'ret':f(r.get('小店订单-品退率(%)')),
                'dispute':f(r.get('小店订单-纠纷率(%)')),
            })
    print(f'[主] 命中白名单 {len(by_sub)} / {len(targets)}')

    # ─── 3) 指标明细：日均消耗主体口径 ───
    main_consume = {}
    with open(SRC/'指标明细-9.3.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            sub=r.get('客户简称','').strip()
            if sub in sales_map:
                main_consume[sub] = f(r.get('日均消耗(元)'))

    # ─── 4) 4 个使用标记 ───
    def load_uses(path, has_extra=False):
        m = {}
        with open(path, encoding='utf-8-sig') as fh:
            for r in csv.DictReader(fh):
                sub=r.get('客户简称','').strip()
                if sub in sales_map:
                    m[sub] = b(r.get('是否全域通广告')) if has_extra else True
        return m
    use_quanyutong = load_uses(SRC/'投放端-靶向-9.3.csv', True)
    use_native     = load_uses(SRC/'原生推广-靶向-9，3.csv')
    use_latent     = load_uses(SRC/'潜客优投-靶向-9.3.csv')
    use_smart_ad   = load_uses(SRC/'智投广告-9.3.csv')
    use_4m         = load_uses(SRC/'4+m.csv')
    use_aggregate  = load_uses(SRC/'多商品聚合页-靶向-9.3.csv')

    # ─── 5) 行业继承（从旧 data.json） ───
    sub_to_industry = {}
    sub_to_alias = {}
    old_path = OLD/'data.json'
    if old_path.exists():
        old = json.load(open(old_path, encoding='utf-8'))
        for c in old.get('customers', []):
            sub_to_industry[c['sub']] = c.get('industry','其他')
            sub_to_alias[c['sub']] = c.get('alias','')
        alias_to_sub = {c['alias']:c['sub'] for c in old.get('customers',[]) if c.get('alias')}
    else:
        alias_to_sub = {}
    def resolve_industry(sub):
        if sub in sub_to_industry: return sub_to_industry[sub]
        for alias, full in alias_to_sub.items():
            if alias and (alias in sub or sub in alias):
                return sub_to_industry.get(full,'其他')
        return '其他'

    # ─── 6) 构建客户数组（含 28 个空白占位） ───
    customers = []
    for sub in targets:
        agg = by_sub.get(sub, {'shops':[], 'consume_total':0})
        shops = agg['shops']
        consume = agg['consume_total']
        if shops:
            tot_w = sum(s['consume'] for s in shops if s['consume']>0) or 1
            def w_avg(field):
                vs = [s for s in shops if s.get(field) is not None and s['consume']>0]
                if not vs: return 0
                return sum(s[field]*s['consume'] for s in vs) / sum(s['consume'] for s in vs)
            gmv = sum(s['consume']*s['roi'] for s in shops)
            roi = gmv / max(1, sum(s['consume'] for s in shops))
            c = {
                'sub':sub, 'alias':sub_to_alias.get(sub, sub[:6]),
                'sales':sales_map[sub], 'industry':resolve_industry(sub),
                'agent':'内部',
                'consume':round(consume,2),'gmv':round(gmv,2),'roi':round(roi,2),
                'main_consume':main_consume.get(sub, round(consume,2)),
                # KPI（消耗/双率/ROI）
                'ctr':round(w_avg('ctr'),3),'cvr':round(w_avg('cvr'),3),
                'aov':round(w_avg('aov'),1),'target_bid':None,
                # 基建
                'ads':sum(s['ads'] for s in shops),'account':sum(s['account'] for s in shops),
                'main_subject':1,'creative_id':sum(s['creative_id'] for s in shops),
                'new_ratio':round(w_avg('new_ratio'),2),
                'auto_ratio':round(w_avg('auto_ratio'),2),
                # 素材/内容质量
                '3s_play':round(w_avg('3s_play'),2),'avg_dur':round(w_avg('avg_dur'),1),
                # 三率（越低越好）
                'ret':round(w_avg('ret'),3),'bad':round(w_avg('bad'),3),'dispute':round(w_avg('dispute'),3),
                # 产品能力（默认 False；直播/4+m/聚合页 无数据源 → 默认 False）
                'is_4m':bool(use_4m.get(sub,False)),'is_aggregate':bool(use_aggregate.get(sub,False)),
                'is_latent':bool(use_latent.get(sub,False)),
                'is_native':bool(use_native.get(sub,False)),
                'is_smart_ad':bool(use_smart_ad.get(sub,False)),
                'is_live':False,
                'shop_count':len(set(s['shop_id'] for s in shops if s['shop_id'])),
                # 链路
                'is_quan_yu_tong':use_quanyutong.get(sub,False),
                # 投放端
                'adq':True,
                'shops':shops,
            }
        else:
            # 占位（暂无消耗数据）
            c = {
                'sub':sub,'alias':sub_to_alias.get(sub, sub[:6]),
                'sales':sales_map[sub],'industry':resolve_industry(sub),'agent':'内部',
                'consume':0.0,'gmv':0.0,'roi':0.0,
                'main_consume':main_consume.get(sub,0.0),
                'ctr':0,'cvr':0,'aov':0,'target_bid':None,
                'ads':0,'account':0,'main_subject':1,'creative_id':0,
                'new_ratio':0,'auto_ratio':0,
                '3s_play':0,'avg_dur':0,
                'ret':0,'bad':0,'dispute':0,
                'is_4m':bool(use_4m.get(sub,False)),'is_aggregate':bool(use_aggregate.get(sub,False)),
                'is_latent':bool(use_latent.get(sub,False)),
                'is_native':bool(use_native.get(sub,False)),
                'is_smart_ad':bool(use_smart_ad.get(sub,False)),
                'is_live':False,
                'shop_count':0,
                'is_quan_yu_tong':use_quanyutong.get(sub,False),
                'adq':False,
                'shops':[],
            }
        customers.append(c)
    # 按消耗降序
    customers.sort(key=lambda x:(-x['consume'], x['sub']))
    print(f'[客户] 总数 {len(customers)} / 有数据 {sum(1 for c in customers if c["consume"]>0)}')

    # ─── 7) 头部对标（按二级行业；空值跳过） ───
    by_ind = defaultdict(list)
    for c in customers:
        by_ind[c['industry']].append(c)
    ind_bench = {}
    for ind, lst in by_ind.items():
        ctr   = [c['ctr']   for c in lst if c['ctr']>0]
        cvr   = [c['cvr']   for c in lst if c['cvr']>0]
        roi   = [c['roi']   for c in lst if c['roi']>0]
        aov   = [c['aov']   for c in lst if c['aov']>0]
        ads   = [c['ads']   for c in lst if c['ads']>0]
        acc   = [c['account'] for c in lst if c['account']>0]
        cid   = [c['creative_id'] for c in lst if c['creative_id']>0]
        new_r = [c['new_ratio'] for c in lst if c['new_ratio']>0]
        auto_r= [c['auto_ratio'] for c in lst if c['auto_ratio']>0]
        p3s   = [c['3s_play'] for c in lst if c['3s_play']>0]
        dur   = [c['avg_dur'] for c in lst if c['avg_dur']>0]
        ret   = [c['ret']    for c in lst if c['ret']>0]
        bad   = [c['bad']    for c in lst if c['bad']>0]
        dsp   = [c['dispute']for c in lst if c['dispute']>0]
        ind_bench[ind] = {
            'top10_count':len(lst),'industry_customer_count':len(lst),
            'ctr_p75':round(p75(ctr),3),'cvr_p75':round(p75(cvr),3),
            'roi_p75':round(p75(roi),2),'aov_p75':round(p75(aov),1),
            'ads_p75':int(p75(ads)),'account_p75':int(p75(acc)),
            'creative_id_p75':int(p75(cid)),
            'new_ratio_p75':round(p75(new_r),2),'auto_ratio_p75':round(p75(auto_r),2),
            '3s_play_p75':round(p75(p3s),2),'avg_dur_p75':round(p75(dur),1),
            # 越低越好
            'ret_p25':round(p25(ret),3),'bad_p25':round(p25(bad),3),'dispute_p25':round(p25(dsp),3),
            # 兼容旧 key
            'roi_p50':round(p75(roi)/2,2),'aov_p50':round(p75(aov)/2,1),
        }
    for c in customers:
        c['benchmark'] = ind_bench.get(c['industry'], {})

    # ─── 8) 大盘趋势 ───
    target_trend = []
    with open(SRC/'大盘消耗趋势-9.3.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            target_trend.append({'date':r['时间'],'value':f(r['日均消耗(元)'])})

    # ─── 9) 客户趋势 ───
    cust_trend = defaultdict(list)
    with open(SRC/'消耗趋势-客户-9.3.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            sub=r.get('客户简称','').strip()
            if sub in sales_map:
                cust_trend[sub].append({'date':r['时间'],'value':f(r['日均消耗(元)'])})

    # ─── 10) 输出 ───
    out = {
        'meta': {
            'data_date':'2026-09-02',
            'build_time':datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'target_count':len(customers),
            'active_count':sum(1 for c in customers if c['consume']>0),
            'industry_count':len(ind_bench),
            'sales_count':len(set(sales_map.values())),
        },
        'overall':{
            'consume':sum(c['consume'] for c in customers),
            'gmv':sum(c['gmv'] for c in customers),
            'count':len(customers),
        },
        'industry_benchmark':ind_bench,
        'target_dashboard_trend':target_trend,
        'customers_trend':dict(cust_trend),
        'customers':customers,
    }
    p = OUT/'data.json'
    p.write_text(json.dumps(out, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
    print(f'[out] {p}  {p.stat().st_size/1024:.1f}KB')
    print(f'[总体] 消耗 {out["overall"]["consume"]:.0f} 元 / GMV {out["overall"]["gmv"]:.0f} 元 / 客户 {out["overall"]["count"]} / 在投 {out["meta"]["active_count"]}')

if __name__ == '__main__':
    main()