#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
靶向客户监控看板 · v2 数据构建器（2026-09-13 刷新版）
输入（~/Downloads/ 通用分析数据集 - 2026-09-13T*.csv）：
  T200348.333  客户 QTD by 天（含整体行，73 天 7.1-9.11）
  T200355.667  整体 QTD by 天 + 总览趋势（74 行 = 73 天 + 整体）
  T200311.092  主表（微信小店x视频号）：15 指标 + 内嵌环比 + 日均消耗
  T200303.051  投放端（是否全域通广告）+ 消耗 + 环比
  T200203.206  行业对标（运营二级行业）+ 15 指标 + 环比 → 市场基准
  T200257.240  原生推广（1538）   T200249.997  潜客优投（458）
  T200240.184  智投广告（1187）   T200224.237  4+m（86）       —— 4 个产品能力
  靶向-9.14.xlsx                销售归属白名单 v2（87 主体，15 列追踪表：行业/销售/投放主体/服务商）
  154421 副本 csv               代理商政策集团（本轮复用 9.3 版）

注：指标明细/大盘趋势/203808 环比 已合并进上述主表/行业表；多商品聚合页 = T200704.276（客户简称口径）。
行业映射兜底：../dashboard.bak-20260831-pre-v2/data.json
"""
import json, csv, re, sys, math
from pathlib import Path
from collections import defaultdict
from datetime import datetime
import openpyxl

HOME = Path.home(); SRC = HOME/'Downloads'
OUT  = HOME/'Downloads/dashboard'
BUILD = OUT / 'build'
OLD  = HOME/'Downloads/dashboard.bak-20260831-pre-v2'

def f(x, default=0.0):
    """求和/计数类字段：无效值 → 0（如消耗、广告数）"""
    if x is None: return default
    s = str(x).strip()
    if s in ('','~','-','nan','NaN','null','None'): return default
    try: return float(s)
    except: return default

def fn(x):
    """指标类字段：无效值 → None（缺失）。
    ⚠️ 关键：CSV 里 '~' 表示平台"无数据/不适用"，不能当 0 用。
    主表实测 '~' 占比：差评率 84.8% / 单价 62.3% / ROI 58.4% /
    新广告占比 58.4% / 品退率·纠纷率 58.5%。
    若按 0 处理会：① 前端显示 0 误导；② 拉低 P75 行业标杆；
    ③ 建议引擎误报（如"一键起量 0% → P1 建议开启"，实际是没数据）。
    """
    if x is None: return None
    s = str(x).strip()
    if s in ('','~','-','nan','NaN','null','None'): return None
    try:
        v = float(s)
        return None if v != v else v   # NaN → None
    except: return None

def i(x, default=0):
    v = f(x, default); return int(v) if v==v else default
def inn(x):
    """计数类字段：无效值 → None"""
    v = fn(x); return None if v is None else int(v)
def b(x):
    s = str(x or '').strip().lower()
    if s in ('true','是','1','yes','t'): return True
    if s in ('false','否','0','no','f'): return False
    return None

def quantile(arr, q):
    """分位数 —— 线性插值法（numpy 默认 'linear'）
    🔴 修复 2026-09-03：原用"最近秩" int(n*q)-1，小样本严重偏差
       - n=2 时 P75 取到最小值（[10,20] → 10），完全错误
       - 箱包鞋靴 ads=[1,2,3,223] → 旧 P75=3，正确应为 58
    """
    if not arr: return 0
    arr = sorted(arr); n = len(arr)
    if n == 1: return arr[0]
    idx = q * (n - 1)
    lo = int(math.floor(idx)); hi = int(math.ceil(idx))
    if lo == hi: return arr[lo]
    return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo)
p75 = lambda a: quantile(a, 0.75)
p25 = lambda a: quantile(a, 0.25)

def main():
    # ─── 1) 销售白名单（靶向-9.14.xlsx，15 列追踪表）───
    # 🔴 9.14 新口径：白名单真源改为「靶向-9.14.xlsx」
    #   列序：0=行业 3=品牌/小店名称 8=销售 11=投放主体(公司全称) 14=服务商/渠道反馈
    #   投放主体 = join 9.13 数据「客户简称(=公司全称)」的键；多公司会叠在同一格（换行/顿号/逗号），需拆开
    wb = openpyxl.load_workbook(SRC/'靶向-9.14.xlsx')
    ws = wb.active
    sales_map = {}        # sub(公司全称) -> 销售
    ind_map_x = {}        # sub -> 行业（来自 xlsx，优先于 INDUSTRY_MAP）
    svc_map   = {}        # sub -> 服务商/渠道反馈
    brand_map = {}        # sub -> 品牌/小店名称
    for r in ws.iter_rows(min_row=2, values_only=True):
        ind   = str(r[0]).strip()  if r[0]  else ''
        sale  = str(r[8]).strip()  if r[8]  else ''
        svc   = str(r[14]).strip() if r[14] else ''
        brand = str(r[3]).strip()  if r[3]  else ''
        raw   = str(r[11]).strip() if r[11] else ''
        if not raw or raw == '-': continue
        for name in re.split(r'[\n、，,\s]+', raw):
            name = name.strip()
            if not name: continue
            sales_map[name] = sale
            ind_map_x[name] = ind
            svc_map[name]   = svc
            brand_map[name] = brand
    targets = list(sales_map.keys())

    # 环比 + 全平台 日均消耗 累加器（在主表扫描 §2 时填充）
    mom_map = {}            # sub -> {field_mom: value}
    main_consume_all = {}   # sub -> 日均消耗合计（全平台，含非靶向）
    MOM_COLS = {
        'consume_mom':'日均消耗(元)环比变化率(%)',
        'ctr_mom':'ctr(%)环比变化率(%)',
        'cvr_mom':'浅层cvr(%)环比变化率(%)',
        'aov_mom':'下单单价(元)环比变化率(%)',
        'roi_mom':'下单ROI环比变化率(%)',
        'account_mom':'有消耗的账户数环比变化率(%)',
        'ads_mom':'有消耗广告数环比变化率(%)',
        'creative_id_mom':'日均曝光创意唯一性ID数环比变化率(%)',
        'new_ratio_mom':'新广告占比(%)环比变化率(%)',
        'auto_ratio_mom':'天一键起量使用广告占比(%)环比变化率(%)',
        '3s_play_mom':'视频3秒完播率(%)环比变化率(%)',
        'avg_dur_mom':'平均播放时长环比变化率(%)',
        'bad_mom':'小店订单-差评率(%)环比变化率(%)',
        'ret_mom':'小店订单-品退率(%)环比变化率(%)',
        'dispute_mom':'小店订单-纠纷率(%)环比变化率(%)',
    }
    def read_mom(r):
        out = {}
        for k, c in MOM_COLS.items():
            v = fn(r.get(c))
            out[k] = round(v, 2) if v is not None else None
        return out

    # === 4.5) 客户趋势（提前加载，给 customers 用 consume_recent/qtd）===
    # 🔴 9.13 优化：同一次扫描顺带累加 cust_by_day_total（靶向客户 by 天合计），
    #    避免下方 §8.5 再次全量读取 30 万行大文件（原双读 ≈ 0.5s 浪费）。
    cust_trend = defaultdict(list)
    cust_by_day_total = defaultdict(float)
    with open(SRC/'通用分析数据集 - 2026-09-13T200348.333.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            sub = (r.get('客户简称') or '').strip()
            d = (r.get('时间') or '').strip()
            v = f(r.get('日均消耗(元)'))
            if sub and d and d != '整体' and v is not None and sub in sales_map:
                cust_trend[sub].append({'date':d, 'value':v})
                cust_by_day_total[d] += v
    for sub in cust_trend:
        cust_trend[sub].sort(key=lambda x: x['date'])
    print(f'[trend] {len(cust_trend)} 客户趋势（每客户 73 天 by 天）')

    # === 4.55) 环比数据 ===
    # 🔴 9.13 调整：环比已内嵌进主表 T200311.092（每个指标带 环比变化率(%) 列）
    #   → 不再单独加载 203808.282；mom_map 在主表扫描（§2）时按 客户简称 填充。
    #   对照表 T200203.206（行业对标）同样带环比，仅用于市场基准，不进客户级 mom。
    print(f'[环比] 主表内嵌：{len(mom_map)} 个靶向主体已带环比（主表扫描时填充）')

    # === 4.6) 代理商政策集团对应（154421 副本 csv） ===
    agent_policy_map = {}
    agent_total_wan = 0.0
    agent_consume_wan = {}
    with open(SRC/'通用分析数据集 - 2026-09-03T154421.109_副本.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            sub = (r.get('客户简称') or '').strip()
            agent = (r.get('代理商政策集团') or '').strip() or '未分配'
            wan_s = (r.get('消耗(万元)') or '').strip()
            wan = (fn(wan_s) if wan_s else 0) or 0
            if sub == '整体':
                agent_total_wan = wan
            elif sub:
                agent_policy_map[sub] = agent
                if wan > 0:
                    agent_consume_wan[agent] = agent_consume_wan.get(agent, 0) + wan
    print(f'[agent] {len(agent_consume_wan)} 家代理商（QTD {agent_total_wan:.1f} 万）')

    print(f'[xlsx] 主体 {len(targets)} 条 / 销售 {len(set(sales_map.values()))} 人')

    # ─── 2) 主表（微信小店x视频号，T200311.092，含 15 指标 + 环比）───
    by_sub = defaultdict(lambda: {'shops':[], 'consume_total':0.0})
    with open(SRC/'通用分析数据集 - 2026-09-13T200311.092.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            sub=r.get('客户简称','').strip()
            consume = f(r.get('日均消耗(元)'))
            if sub:
                main_consume_all[sub] = main_consume_all.get(sub,0.0) + consume
            if sub not in sales_map: continue
            shop_id = r.get('微信小店店铺id','').strip()
            video   = r.get('视频号名称','').strip()
            by_sub[sub]['consume_total'] += consume
            if sub not in mom_map:
                mom_map[sub] = read_mom(r)
            by_sub[sub]['shops'].append({
                'shop_id':shop_id,'video':video,'consume':consume,
                # 指标类用 fn/inn —— '~' 保留为 None（无数据），不当 0
                'ctr':fn(r.get('ctr(%)')),'cvr':fn(r.get('浅层cvr(%)')),
                'aov':fn(r.get('下单单价(元)')),'roi':fn(r.get('下单ROI')),
                'ads':inn(r.get('有消耗广告数')),'account':inn(r.get('有消耗的账户数')),
                'new_ratio':fn(r.get('新广告占比(%)')),
                'auto_ratio':fn(r.get('天一键起量使用广告占比(%)')),
                'creative_id':inn(r.get('日均曝光创意唯一性ID数')),
                '3s_play':fn(r.get('视频3秒完播率(%)')),
                'avg_dur':fn(r.get('平均播放时长')),
                'bad':fn(r.get('小店订单-差评率(%)')),
                'ret':fn(r.get('小店订单-品退率(%)')),
                'dispute':fn(r.get('小店订单-纠纷率(%)')),
            })
    print(f'[主] 命中白名单 {len(by_sub)} / {len(targets)}')

    # ─── 2.5) 大盘基准：主表全量客户（不局限于靶向白名单）───
    # 🔴 子青 9.3 拍板："行业标杆不仅仅是限制于靶向客户中"
    # 主表虽名为"靶向"，实际含全量客户（15668 家）。但主表没有行业字段，
    # 所以只能做"全平台大盘基准"（不分行业），用于补充行业标杆样本不足的情况。
    market_vals = defaultdict(list)
    _market_rows = 0
    with open(SRC/'通用分析数据集 - 2026-09-13T200203.206.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            _market_rows += 1
            cons = f(r.get('日均消耗(元)'))
            if cons <= 0: continue        # 只统计有消耗的客户
            for key, getter in [
                ('ctr', lambda r: fn(r.get('ctr(%)'))),
                ('cvr', lambda r: fn(r.get('浅层cvr(%)'))),
                ('aov', lambda r: fn(r.get('下单单价(元)'))),
                ('roi', lambda r: fn(r.get('下单ROI'))),
                ('ads', lambda r: inn(r.get('有消耗广告数'))),
                ('account', lambda r: inn(r.get('有消耗的账户数'))),
                ('creative_id', lambda r: inn(r.get('日均曝光创意唯一性ID数'))),
                ('new_ratio', lambda r: fn(r.get('新广告占比(%)'))),
                ('auto_ratio', lambda r: fn(r.get('天一键起量使用广告占比(%)'))),
                ('3s_play', lambda r: fn(r.get('视频3秒完播率(%)'))),
                ('avg_dur', lambda r: fn(r.get('平均播放时长'))),
                ('bad', lambda r: fn(r.get('小店订单-差评率(%)'))),
                ('ret', lambda r: fn(r.get('小店订单-品退率(%)'))),
                ('dispute', lambda r: fn(r.get('小店订单-纠纷率(%)'))),
            ]:
                v = getter(r)
                if v is not None and v > 0:
                    market_vals[key].append(v)
    market_bench = {
        'source': '通用分析数据集 - 2026-09-13T200203.206.csv（行业对标·全量，不局限于靶向白名单）',
        'total_rows': _market_rows,
        'sample_size': {k: len(v) for k, v in market_vals.items()},
    }
    for k, v in market_vals.items():
        market_bench[k + '_p75'] = round(p75(v), 3) if v else 0
        market_bench[k + '_p25'] = round(p25(v), 3) if v else 0
    print(f'[大盘基准] 全量 {_market_rows} 行 · 有效样本 '
          f'ctr={len(market_vals.get("ctr",[]))} ads={len(market_vals.get("ads",[]))}')

    # ─── 3) KPI 权威源：日均消耗主体口径（从主表 T200311.092 汇总）───
    # 🔴 9.13 调整：原 指标明细-9.3.csv 已合并进主表，主表 日均消耗(元) 按 客户简称 逐行累加
    #   = 该客户全部视频号日均消耗合计（主体口径）。全平台 kpi_all 取全部有消耗客户。
    main_consume = dict(main_consume_all)   # sub -> 日均消耗合计（全平台）
    kpi_all = list(main_consume_all.values())
    kpi_target = [main_consume_all[s] for s in targets if s in main_consume_all]
    kpi_summary = {
        'all_total': round(sum(kpi_all), 2),       # 全平台有消耗客户总日均
        'all_count': len(kpi_all),                  # 全平台客户数
        'all_avg':   round(sum(kpi_all)/max(1,len(kpi_all)), 2),
        'target_total': round(sum(kpi_target), 2),   # 销售白名单 66 总日均
        'target_count': len(kpi_target),            # 靶向在投数
        'target_avg':   round(sum(kpi_target)/max(1,len(kpi_target)), 2),
    }

    # ─── 4) 4 个使用标记 ───
    def load_uses(path, has_extra=False):
        m = {}
        with open(path, encoding='utf-8-sig') as fh:
            for r in csv.DictReader(fh):
                sub=r.get('客户简称','').strip()
                if sub in sales_map:
                    m[sub] = b(r.get('是否全域通广告')) if has_extra else True
        return m
    # 🔴 9.13：4 个产品能力来自新 通用分析数据集；多商品聚合页本轮未提供 → 置空
    use_quanyutong = load_uses(SRC/'通用分析数据集 - 2026-09-13T200303.051.csv', True)
    use_native     = load_uses(SRC/'通用分析数据集 - 2026-09-13T200257.240.csv')
    use_latent     = load_uses(SRC/'通用分析数据集 - 2026-09-13T200249.997.csv')
    use_smart_ad   = load_uses(SRC/'通用分析数据集 - 2026-09-13T200240.184.csv')
    use_4m         = load_uses(SRC/'通用分析数据集 - 2026-09-13T200224.237.csv')
    use_aggregate  = load_uses(SRC/'通用分析数据集 - 2026-09-13T200704.276.csv')   # 商品聚合页

    # 各工具/能力的消耗（用于"消耗占比"展示）
    def load_consumes(path, has_extra=False):
        m = {}
        with open(path, encoding='utf-8-sig') as fh:
            for r in csv.DictReader(fh):
                sub = r.get('客户简称','').strip()
                if not sub: continue
                v = f(r.get('日均消耗(元)'))
                if v: m[sub] = m.get(sub,0) + v
        return m
    consume_4m         = load_consumes(SRC/'通用分析数据集 - 2026-09-13T200224.237.csv')
    consume_aggregate  = load_consumes(SRC/'通用分析数据集 - 2026-09-13T200704.276.csv')   # 商品聚合页
    consume_latent     = load_consumes(SRC/'通用分析数据集 - 2026-09-13T200249.997.csv')
    consume_native     = load_consumes(SRC/'通用分析数据集 - 2026-09-13T200257.240.csv')
    consume_smart_ad   = load_consumes(SRC/'通用分析数据集 - 2026-09-13T200240.184.csv')
    # 全域通：从"是否全域通广告=true"的行累加
    consume_quanyutong = {}
    with open(SRC/'通用分析数据集 - 2026-09-13T200303.051.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            v = r.get('是否全域通广告','')
            if str(v).strip().lower() in ('true','是','1','yes','t'):
                sub = r.get('客户简称','').strip()
                val = f(r.get('日均消耗(元)'))
                if sub and val: consume_quanyutong[sub] = consume_quanyutong.get(sub,0) + val
    # adq 投放：主表 consume 视为 adq 全部消耗
    # 直播 / 小店：暂无数据源，记为 0

    # ─── 5) 行业映射（用户 9.3 拍板：主体→行业） ───
    # 来源：用户 9.3 14:21 给的手工对齐表（49 主体 / 含多公司名展开）
    # 同时也吃旧 data.json 的 fallback（不覆盖用户给的新映射）
    INDUSTRY_MAP = {
        # 珠宝配饰
        '长沙芬尚贸易有限公司':'珠宝配饰',
        '株洲绅悦传媒有限公司':'珠宝配饰',
        '开心集藏(南京)网络科技有限公司':'珠宝配饰',
        '上海聚藏甄选网络科技有限公司':'珠宝配饰',
        '上海东藏文化传播有限公司':'珠宝配饰',
        '上海伊碧思电子科技有限公司':'珠宝配饰',
        '北京卯生文化发展有限公司':'珠宝配饰',
        '成都翔吉同电子商务有限公司':'珠宝配饰',
        '萍乡市安源区维洪商贸营业部(个体工商户)':'珠宝配饰',
        '北京卡路里信息技术有限公司':'珠宝配饰',
        '大猫文化传媒(石家庄)有限公司':'珠宝配饰',
        # 服饰配件
        '广州尊格皮具制品有限公司':'服饰配件',
        # 箱包鞋靴
        '广州市花都区狮岭蔡蔡轻复古包包店':'箱包鞋靴',
        '广州振瑞贸易有限公司':'箱包鞋靴',
        '青白江师弟商贸部':'箱包鞋靴',
        '成都伊丽高电子商务有限公司':'箱包鞋靴',
        '温州碧玉鞋服有限公司':'箱包鞋靴',
        '广州礼善电子商务有限公司':'箱包鞋靴',
        '温州和而不同商贸有限公司':'箱包鞋靴',
        '沈阳市云舒岁月服装商行(个体工商户)':'箱包鞋靴',
        '广州密丝贸易有限公司':'箱包鞋靴',
        '杭州酷步科技有限公司':'箱包鞋靴',
        '厦门炬变引力电子商务有限公司':'箱包鞋靴',
        '福州青弓运动科技有限公司':'箱包鞋靴',
        '无锡喜可文化创意有限公司':'箱包鞋靴',
        '无锡市妃姗电子商务有限公司':'箱包鞋靴',
        '晋江泰觉科技有限公司':'箱包鞋靴',
        '石狮市姚幸贸易有限公司':'箱包鞋靴',
        '石狮市凤坷贸易有限公司':'箱包鞋靴',
        '石狮市莲卿电子商务有限公司':'箱包鞋靴',
        '泉州市赫芭电子商务有限公司':'箱包鞋靴',
        '泉州市誉函电子商务有限公司':'箱包鞋靴',
        '泉州赤诚相待电子商务有限公司':'箱包鞋靴',
        '泉州市赫芭品牌管理有限公司':'箱包鞋靴',
        # 运动户外
        '义乌市轻练体育用品有限公司':'运动户外',
        '义乌市炼夏日用品商行':'运动户外',
        '漳平市成言电子商务店(个体工商户)':'运动户外',
        '菲罗科技成都有限公司':'运动户外',
        '广州麦咚咚网络科技有限公司':'运动户外',
        '义乌市备棱贸易商行（个体工商户）':'运动户外',
        # 贴身衣物
        '东莞市道滘木语贸易商行(个体工商户)':'贴身衣物',
        '东莞市道滘森屿贸易商行(个体工商户)':'贴身衣物',
        '广州亦非主角传媒有限公司':'贴身衣物',
        '汕头市康多利内衣有限公司':'贴身衣物',
        '广州澜悦服饰有限公司':'贴身衣物',
        '广州悠点美服饰有限公司':'贴身衣物',
        '深圳千艺美人服饰有限公司':'贴身衣物',
        '深圳赢时代电子商务有限公司':'贴身衣物',
        '济南易顺服饰有限公司':'贴身衣物',
        '杭州萧山素里贸易商行(个体工商户)':'贴身衣物',
        '义乌市澎茹电子商务商行(个体工商户)':'贴身衣物',
        '广州占芭啦科技有限公司':'贴身衣物',
        '上海行径科技有限公司':'贴身衣物',
        '上海雅裹科技有限公司':'贴身衣物',
        '上海心裹电子商务有限公司':'贴身衣物',
        '洛阳嘉思故电子商务有限公司':'贴身衣物',
        '广州莱思美科技信息有限公司':'贴身衣物',
        '广州市云感批发有限公司':'贴身衣物',
        '广州市橙芯批发有限公司':'贴身衣物',
        # 男装
        '杭州贝旭服饰有限公司':'男装',
        '杭州剑卓服饰有限公司':'男装',
        '沈阳晟行传媒有限公司':'男装',
        '天津希辰文化传媒有限公司':'男装',
        '上海瞰上贸易有限公司':'男装',
        '杭州毅励服饰有限公司':'男装',
        # 女装
        '餘发的苏州市姑苏区云舒岁月服装商行(个体工商户)':'女装',
    }
    sub_to_industry = dict(INDUSTRY_MAP)
    sub_to_alias = {}
    old_path = OLD/'data.json'
    if old_path.exists():
        old = json.load(open(old_path, encoding='utf-8'))
        for c in old.get('customers', []):
            sub_to_alias[c['sub']] = c.get('alias','')
            # 旧 data.json 里的 industry 仅在新映射表缺失时作为 fallback
            if c['sub'] not in sub_to_industry:
                sub_to_industry[c['sub']] = c.get('industry','其他')
    alias_to_sub = {c['alias']:c['sub'] for c in (old.get('customers',[]) if old_path.exists() else []) if c.get('alias')}
    def resolve_industry(sub):
        if sub in ind_map_x and ind_map_x[sub]:
            return ind_map_x[sub]
        if sub in sub_to_industry: return sub_to_industry[sub]
        for alias, full in alias_to_sub.items():
            if alias and (alias in sub or sub in alias):
                return sub_to_industry.get(full,'其他')
        return '其他'

    # 🔴 9.14 切换：QTD 总额真源改吃 `靶向客户消耗数据-9.14.csv` 的 2026/Q3 合计
    # 背景：9.13 T200348.333 漏覆盖 30/87 个靶向客户的 QTD 行（被当 0），且 57 命中客户金额偏低；
    #       9.14 文件 60 个有消耗客户 100% 命中 87 名单，合计 577.91 万 = 87 靶向真实 QTD。
    #       9.14 数据日截至 9.11（与看板周期一致），整体行(786万)为含历史季度，仅取 2026/Q3。
    q3_consume_map = {}
    _q3p = SRC / '靶向客户消耗数据-9.14.csv'
    if _q3p.exists():
        with open(_q3p, encoding='utf-8-sig') as _f:
            _rr = csv.reader(_f); next(_rr)
            for _row in _rr:
                if len(_row) < 4: continue
                if _row[1].strip() != '2026/Q3': continue
                _nm = _row[2].strip()
                if not _nm or _nm == '整体': continue
                _v = f(_row[3])
                if _v is None: continue
                q3_consume_map[_nm] = q3_consume_map.get(_nm, 0.0) + _v
    print(f"[QTD源] 靶向客户消耗数据-9.14.csv 2026/Q3 命中 87 名单客户数={len(q3_consume_map)}, 合计={sum(q3_consume_map.values())/1e4:.2f}万")

    # ─── 6) 构建客户数组（含 28 个空白占位） ───
    customers = []
    for sub in targets:
        agg = by_sub.get(sub, {'shops':[], 'consume_total':0})
        shops = agg['shops']
        consume = agg['consume_total']
        if shops:
            def w_avg(field):
                """按消耗加权平均。跳过 None（无数据）与 0 消耗行。
                全部无效 → 返回 None（而不是 0），让前端显示 '—'"""
                vs = [s for s in shops if s.get(field) is not None and (s['consume'] or 0)>0]
                if not vs: return None
                tw = sum(s['consume'] for s in vs)
                if tw <= 0: return None
                return sum(s[field]*s['consume'] for s in vs) / tw
            def rnd(v, n):
                return None if v is None else round(v, n)
            def sum_or_none(field):
                """计数类求和：全 None → None"""
                vs = [s[field] for s in shops if s.get(field) is not None]
                return sum(vs) if vs else None
            # GMV/ROI：只用有 roi 数据的行
            roi_rows = [s for s in shops if s.get('roi') is not None]
            gmv = sum((s['consume'] or 0)*(s['roi'] or 0) for s in roi_rows)
            tw_roi = sum((s['consume'] or 0) for s in roi_rows)
            roi = (gmv/tw_roi) if tw_roi>0 else None
            # 🔴 子青 9.3 拍板：标注周期——「近期」(9.5-9.11) 和「季度」(QTD) 都开
            # 用 customers_trend[sub]（73 天 by 天）累加
            _trend = cust_trend.get(sub, [])
            _recent = sum(p['value'] for p in _trend if '2026/09/05' <= p['date'] <= '2026/09/11')
            _qtd    = q3_consume_map.get(sub, sum(p['value'] for p in _trend))   # 全部 73 天累计（9.14 优先）
            c = {
                'sub':sub, 'alias':sub_to_alias.get(sub, sub[:6]),
                'sales':sales_map[sub], 'industry':resolve_industry(sub),
                'agent':agent_policy_map.get(sub,'内部'),
                'service':svc_map.get(sub,''), 'brand':brand_map.get(sub,''),
                'consume':round(consume,2),'gmv':round(gmv,2),'roi':rnd(roi,2),
                'consume_recent':round(_recent,2),   # 近期 7 天累计（9.5-9.11）
                'consume_qtd':round(_qtd,2),          # 季度累计（QTD ~73 天）
                # 🔴 环比（主表 T200311.092 内嵌）：每指标环比变化率(%)，无数据为 None
                **{k: mom_map.get(sub, {}).get(k) for k in [
                    'consume_mom','ctr_mom','cvr_mom','aov_mom','roi_mom',
                    'account_mom','ads_mom','creative_id_mom',
                    'new_ratio_mom','auto_ratio_mom',
                    '3s_play_mom','avg_dur_mom',
                    'bad_mom','ret_mom','dispute_mom'
                ]},
                'main_consume':main_consume.get(sub, round(consume,2)),
                # KPI（消耗/双率/ROI）—— 无数据 → None
                'ctr':rnd(w_avg('ctr'),3),'cvr':rnd(w_avg('cvr'),3),
                'aov':rnd(w_avg('aov'),1),'target_bid':None,
                # 基建
                'ads':sum_or_none('ads'),'account':sum_or_none('account'),
                'main_subject':1,'creative_id':sum_or_none('creative_id'),
                'new_ratio':rnd(w_avg('new_ratio'),2),
                'auto_ratio':rnd(w_avg('auto_ratio'),2),
                # 素材/内容质量
                '3s_play':rnd(w_avg('3s_play'),2),'avg_dur':rnd(w_avg('avg_dur'),1),
                # 三率（越低越好）
                'ret':rnd(w_avg('ret'),3),'bad':rnd(w_avg('bad'),3),'dispute':rnd(w_avg('dispute'),3),
                # 产品能力（默认 False；直播/4+m/聚合页 无数据源 → 默认 False）
                'is_4m':bool(use_4m.get(sub,False)),'is_aggregate':bool(use_aggregate.get(sub,False)),
                'is_latent':bool(use_latent.get(sub,False)),
                'is_native':bool(use_native.get(sub,False)),
                'is_smart_ad':bool(use_smart_ad.get(sub,False)),
                'is_live':False,
                'shop_count':len(set(s['shop_id'] for s in shops if s['shop_id'])),
                # 链路
                'is_quan_yu_tong':use_quanyutong.get(sub,False),
                # 各工具/能力的消耗（来自各 CSV 的日均消耗）与占比
                'consume_4m':round(consume_4m.get(sub,0),2),
                'consume_aggregate':round(consume_aggregate.get(sub,0),2),
                'consume_latent':round(consume_latent.get(sub,0),2),
                'consume_native':round(consume_native.get(sub,0),2),
                'consume_smart_ad':round(consume_smart_ad.get(sub,0),2),
                'consume_quanyutong':round(consume_quanyutong.get(sub,0),2),
                'adq':True,
                'shops':shops,
            }
        else:
            # 占位（主表 T200311 无视频号行）——但若趋势文件 T200348 有该主体 by 天消耗，
            # 仍要计入 QTD/近期，绝不能清零（否则总消耗漏算"有趋势无主表"的目标）
            _trend = cust_trend.get(sub, [])
            _recent = sum(p['value'] for p in _trend if '2026/09/05' <= p['date'] <= '2026/09/11')
            _qtd    = q3_consume_map.get(sub, sum(p['value'] for p in _trend))
            _consume_proxy = round(_qtd/max(1,len(_trend)), 2) if _trend else 0.0
            c = {
                'sub':sub,'alias':sub_to_alias.get(sub, sub[:6]),
                'sales':sales_map[sub],'industry':resolve_industry(sub),'agent':agent_policy_map.get(sub,'内部'),
                'service':svc_map.get(sub,''),'brand':brand_map.get(sub,''),
                'consume':round(q3_consume_map.get(sub, _consume_proxy),2),'gmv':0.0,'roi':None,'consume_recent':round(_recent,2),'consume_qtd':round(_qtd,2),
                'main_consume':main_consume.get(sub,0.0),
                'ctr':None,'cvr':None,'aov':None,'target_bid':None,
                'ads':None,'account':None,'main_subject':1,'creative_id':None,
                'new_ratio':None,'auto_ratio':None,
                '3s_play':None,'avg_dur':None,
                'ret':None,'bad':None,'dispute':None,
                'is_4m':bool(use_4m.get(sub,False)),'is_aggregate':bool(use_aggregate.get(sub,False)),
                'is_latent':bool(use_latent.get(sub,False)),
                'is_native':bool(use_native.get(sub,False)),
                'is_smart_ad':bool(use_smart_ad.get(sub,False)),
                'is_live':False,
                'shop_count':0,
                'is_quan_yu_tong':use_quanyutong.get(sub,False),
                'consume_4m':0,'consume_aggregate':0,'consume_latent':0,
                'consume_native':0,'consume_smart_ad':0,'consume_quanyutong':0,
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
        ctr   = [c['ctr']   for c in lst if c['ctr']   is not None and c['ctr']>0]
        cvr   = [c['cvr']   for c in lst if c['cvr']   is not None and c['cvr']>0]
        roi   = [c['roi']   for c in lst if c['roi']   is not None and c['roi']>0]
        aov   = [c['aov']   for c in lst if c['aov']   is not None and c['aov']>0]
        ads   = [c['ads']   for c in lst if c['ads']   is not None and c['ads']>0]
        acc   = [c['account'] for c in lst if c['account'] is not None and c['account']>0]
        cid   = [c['creative_id'] for c in lst if c['creative_id'] is not None and c['creative_id']>0]
        new_r = [c['new_ratio'] for c in lst if c['new_ratio'] is not None and c['new_ratio']>0]
        auto_r= [c['auto_ratio'] for c in lst if c['auto_ratio'] is not None and c['auto_ratio']>0]
        p3s   = [c['3s_play'] for c in lst if c['3s_play'] is not None and c['3s_play']>0]
        dur   = [c['avg_dur'] for c in lst if c['avg_dur'] is not None and c['avg_dur']>0]
        ret   = [c['ret']    for c in lst if c['ret']    is not None and c['ret']>0]
        bad   = [c['bad']    for c in lst if c['bad']    is not None and c['bad']>0]
        dsp   = [c['dispute']for c in lst if c['dispute']is not None and c['dispute']>0]
        # 样本量：以 ads（有消耗广告数）的有效值个数代表该行业可对标样本数
        _sample = len([c for c in lst if c['ads'] is not None and c['ads']>0])
        ind_bench[ind] = {
            'top10_count':len(lst),'industry_customer_count':len(lst),
            'sample_size':_sample,
            'sample_enough':_sample >= 3,   # 🔴 子青 9.3：样本<3 家的行业标杆不可信
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
    with open(SRC/'通用分析数据集 - 2026-09-13T200355.667.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            d=(r.get('时间') or '').strip()
            v=f(r.get('日均消耗(元)'))
            if d and d!='整体' and v:
                target_trend.append({'date':d,'value':v})


    # ─── 8.5) qtd by 天双线（大盘 + 客户合计）───
    qtd_dash = []
    with open(SRC/'通用分析数据集 - 2026-09-13T200355.667.csv', encoding='utf-8-sig') as fh:
        for r in csv.DictReader(fh):
            d = r.get('时间','').strip()
            v = f(r.get('日均消耗(元)'))
            if d and d != '整体' and v:
                qtd_dash.append({'date':d, 'value':v})
    qtd_dash.sort(key=lambda x:x['date'])
    # 🔴 9.13：cust_by_day_total 已在 §4.5 同一次扫描中累加，此处不再二次读取大文件
    qtd_target = [{'date':d, 'value':round(v,2)} for d,v in sorted(cust_by_day_total.items())]
    # 防呆：qtd 客户合计必须有数据
    assert len(qtd_target) >= 30, f'qtd 客户合计数据不足 30 天，实际 {len(qtd_target)} 天'

    # 87 靶向目标 总消耗（来自客户级 consume_recent / consume_qtd）
    target_recent   = sum(c['consume_recent'] for c in customers)
    target_qtd      = sum(c['consume_qtd'] for c in customers)
    target_recent_n = sum(1 for c in customers if c['consume_recent'] > 0)

    # === 10) 输出 ===
    out = {
        'meta': {
            'data_date':'2026-09-11',
            'data_period':'qtd (7.1 - 9.11)',
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
            'active_count':sum(1 for c in customers if c['consume']>0),
            'industry_count':len(ind_bench),
            'sales_count':len(set(sales_map.values())),
            'period':'qtd (7.1 - 9.11)',
            'period_days':7,
            'kpi': {
            'period_8_28_9_1': {     # 87 靶向目标 近期 9.5-9.11 合计（趋势文件 T200348.333）
                'period': '2026-09-05 ~ 2026-09-11',
                'total_yuan': round(target_recent, 2),
                'count': target_recent_n,
                'avg_yuan': round(target_recent/max(1,target_recent_n), 2),
                'source': '通用分析数据集 - 2026-09-13T200348.333.csv（87 靶向目标）',
            },
            'period_qtd': {         # 87 靶向目标 QTD 7.1-9.11 合计
                'period': 'QTD (7.1 - 9.11)',
                'total_wan': round(target_qtd/10000, 2),
                'source': '靶向客户消耗数据-9.14.csv（87 靶向目标，2026/Q3）',
            },
        },
        'agents': sorted(agent_consume_wan.keys()),
        'agent_policy_map': agent_policy_map,
        },
        'industry_benchmark':ind_bench,
        'market_benchmark':market_bench,
        'target_dashboard_trend':target_trend,
        'qtd_dashboard_trend':qtd_dash,
        'qtd_target_trend':qtd_target,
        'sops': json.load(open(BUILD/'sops.json', encoding='utf-8')),  # 5 份产品 SOP 文案
        'customers_trend':dict(cust_trend),
        'customers':customers,
    }
    p = OUT/'data.json'
    p.write_text(json.dumps(out, ensure_ascii=False, separators=(',',':')), encoding='utf-8')
    # 重新读 + 验证
    d = json.load(open(p, encoding='utf-8'))
    # 防呆：检查 data_period 在 meta 里
    period = d.get('meta',{}).get('data_period','')
    if 'qtd' not in str(period).lower():
        raise RuntimeError(f'❌ meta.data_period 必须含 qtd，当前: {period!r}')
    if out['overall']['count'] != 87:
        raise RuntimeError(f'❌ 客户总数应为 87（靶向-9.14.xlsx 投放主体拆后），实际 {out["overall"]["count"]}')
    if len(out.get('qtd_dashboard_trend',[])) < 7:
        raise RuntimeError(f'❌ qtd 大盘数据不足 7 天')
    if len(out.get('qtd_target_trend',[])) < 7:
        raise RuntimeError(f'❌ qtd 客户合计数据不足 7 天')
    print(f'[out] {p}  {p.stat().st_size/1024:.1f}KB')
    print(f'[总体] 消耗 {out["overall"]["consume"]:.0f} 元 / GMV {out["overall"]["gmv"]:.0f} 元 / 客户 {out["overall"]["count"]} / 在投 {out["meta"]["active_count"]}')

if __name__ == '__main__':
    main()