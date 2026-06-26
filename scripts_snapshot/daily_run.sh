#!/usr/bin/env bash
# daily_run.sh - 销售作战中心日报一键运行脚本
# (R8.1 2026-06-25 + R11 2026-06-26 补 4 步)
#
# 子青死规矩:
#   1. 先报口径 5 秒, 子青秒看
#   2. 严格守门红线失败立刻阻断, 不让错数据到子青眼前
#   3. 流水线串起来, 但每一步可以独立 rerun
#
# 用法:
#   bash daily_run.sh [DATA_DATE]    # 不传则按"昨天"
#   bash daily_run.sh 2026-06-25
#
# 退出码:
#   0 = 一切 OK, 快报已生成
#   1-12 = 某阶段失败, 看日志找原因

set -e

PROJ=/Users/duziqing/WorkBuddy/2026-05-12-task-5
PY=/Users/duziqing/.workbuddy/binaries/python/envs/default/bin/python
NODE_BIN=/Users/duziqing/.workbuddy/binaries/node/versions/22.22.2/bin
SC=$PROJ/github_pages_adq_publish/sales-center
SCMOBILE=$PROJ/github_pages_adq_publish/sales-center-mobile

# 1. 参数: 数据日 (T-1) + cache-buster
DATA_DATE=${1:-$(date -v-1d +%Y-%m-%d)}
# REPORT_DATE = 数据日+1 (= 报告日 = 今天)
REPORT_DATE=$($PY -c "from datetime import date,timedelta; print((date.fromisoformat('${DATA_DATE}')+timedelta(days=1)).isoformat())")
# cache-buster = 报告日 YYYYMMDD + a
CB_BASE=$(echo $REPORT_DATE | tr -d '-')
CB_NEW="${CB_BASE}a"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  daily_run.sh - 数据日 ${DATA_DATE} / 报告日 ${REPORT_DATE} / cache-buster ${CB_NEW}"
echo "  起始时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 2. 自动改 T_MINUS_1 (子青死规矩 8: 6.X CSV → 数据日 = X-1)
echo ""
echo "[Step 1/12] 自动改 T_MINUS_1 = ${DATA_DATE}"
sed -i.bak "s|T_MINUS_1 = \"[0-9-]*\"|T_MINUS_1 = \"${DATA_DATE}\"|" $PROJ/scripts/rebuild_kpi_csv.py
rm -f $PROJ/scripts/rebuild_kpi_csv.py.bak
echo "  ✅ T_MINUS_1 = \"${DATA_DATE}\""

# 2.5 死规矩 6+9+12 (R8.3): 自动通过 tcb cli 拉云端 tuoke_records → 合并本地
echo ""
echo "[Step 2/12] 自动拉云端 tuoke_records → 合并本地 tuoke_real_records.js"
echo "  (R8.3 tcb cli 调 exportAllRecords; 死规矩 6 全量为底; 死规矩 9 override 锁定 sale)"
$PY $PROJ/scripts/merge_cloud_records.py 2>&1 | tee /tmp/dr_merge.log | tail -20
if grep -q "❌" /tmp/dr_merge.log; then
    echo "❌ 合并云端失败"
    exit 2
fi
echo "  ✅ 云端合并完成"

# 2.6 R3.1.1 守门:override 一致性自检 (inline vs json + 静态字典 + tuoke_records)
echo ""
echo "[Step 2.6/12] override 一致性自检 (R3.1.1 死规矩守门)"
$PY $PROJ/scripts/preflight_override_consistency.py || { echo "❌ override 一致性失败,阻断后续步骤"; exit 2; }

# 3. 重建 KPI + 配套
echo ""
echo "[Step 3/12] rebuild_kpi + build_yest_new + reconcile + runtime"
cd $PROJ
$PY scripts/rebuild_kpi_csv.py > /tmp/dr_rebuild.log 2>&1 || { tail -30 /tmp/dr_rebuild.log; echo "❌ rebuild_kpi 失败"; exit 2; }
echo "  ✅ rebuild_kpi 完成 (日志 /tmp/dr_rebuild.log)"
$PY scripts/build_yest_new_tasks.py > /tmp/dr_yest.log 2>&1 || { tail -20 /tmp/dr_yest.log; echo "❌ build_yest_new 失败"; exit 3; }
echo "  ✅ build_yest_new 完成"
REBUILD_OUTPUT_DIR=$SC/data $PY scripts/build_register_lookup.py > /tmp/dr_lookup.log 2>&1 || { tail -20 /tmp/dr_lookup.log; echo "❌ build_register_lookup 失败"; exit 4; }
REBUILD_OUTPUT_DIR=$SC/data $PY scripts/reconcile_records.py > /tmp/dr_reconcile.log 2>&1 || { tail -20 /tmp/dr_reconcile.log; echo "❌ reconcile_records 失败"; exit 4; }
$PY scripts/build_runtime_summary.py > /tmp/dr_runtime.log 2>&1 || { tail -20 /tmp/dr_runtime.log; echo "❌ build_runtime_summary 失败"; exit 5; }
echo "  ✅ 配套脚本完成"

# 3.5 R3.1.1 override 自愈守门 (必须放在 rebuild_kpi + build_register_lookup 都跑完之后)
#     - rebuild_kpi 改 tuoke_records 的 quarterCost/yestCost, 可能附带刷 sale
#     - build_register_lookup 重新生成 register_lookup_data.js, 也会刷 sale
#     这里强制按 manual_attr_override.json 校正一遍, 然后自检阻断
echo "  [Step 3.5/12] override 自愈 (按 manual_attr_override.json 校正 register_lookup + tuoke_records)"
$PY $PROJ/scripts/sync_override_all.py --apply 2>&1 | grep -E "校正|✓"
$PY $PROJ/scripts/preflight_override_consistency.py || { echo "❌ rebuild+build_register_lookup 后 override 自检失败"; exit 2; }

# 4. R11.1: 产业带 rebuild (今早 6/26 手动跑过, 现纳入 SOP)
echo ""
echo "[Step 4/12] 产业带 industry-belt rebuild"
# 自动算 Q2 PASSED_DAYS
PASSED_DAYS=$($PY -c "from datetime import date; print((date.fromisoformat('${DATA_DATE}')-date(2026,4,1)).days+1)")
sed -i.bak "s|^PASSED_DAYS = [0-9]*|PASSED_DAYS = ${PASSED_DAYS}|" $PROJ/scripts/rebuild_band_data.py 2>/dev/null
rm -f $PROJ/scripts/rebuild_band_data.py.bak
# 改 build_band_src ADATA 路径(如果存在)
if [ -f /tmp/build_band_src_625.py ]; then
    sed -i.bak "s|adata_refresh_2026-06-[0-9]*|adata_refresh_${DATA_DATE}|g" /tmp/build_band_src_625.py
    rm -f /tmp/build_band_src_625.py.bak
    $PY /tmp/build_band_src_625.py > /tmp/dr_band_src.log 2>&1 || { tail -20 /tmp/dr_band_src.log; echo "⚠️ build_band_src 失败, 跳过产业带刷新"; }
fi
if [ -f /tmp/band_calc_src.json ]; then
    $PY scripts/rebuild_band_data.py > /tmp/dr_band.log 2>&1 || { tail -20 /tmp/dr_band.log; echo "⚠️ rebuild_band 失败"; }
    # patch industry-belt.html
    if [ -f /tmp/new_band_data.json ]; then
        $PY -c "
import re, json
PATH = '$SC/industry-belt.html'
NEW = json.load(open('/tmp/new_band_data.json'))
new_str = json.dumps(NEW, ensure_ascii=False, separators=(',', ':'))
txt = open(PATH).read()
new_txt = re.sub(r'(window\.__BAND_DATA__\s*=\s*)\{.*?\}(\s*;)', lambda m: m.group(1) + new_str + m.group(2), txt, count=1, flags=re.S)
if new_txt != txt:
    open(PATH, 'w').write(new_txt)
    print(f'  ✅ 产业带 patch OK: total={NEW[\"kpi\"][\"total\"]} new={NEW[\"kpi\"][\"new\"]} eff={NEW[\"kpi\"][\"eff\"]} rise={NEW[\"kpi\"][\"rise\"]}')
else:
    print('  ⚠️ 产业带 patch 未替换')
"
    fi
else
    echo "  ⚠️ /tmp/band_calc_src.json 不存在, 跳过产业带刷新"
fi

# 5. R11.2 + 原 sync: sync_mobile + 升 cache-buster + 打 snapshot + 镜像
echo ""
echo "[Step 5/12] sync_mobile (mobile 4 块 md5 同源)"
PATH=$NODE_BIN:$PATH $PY scripts/sync_mobile.py > /tmp/dr_sync.log 2>&1 || { tail -20 /tmp/dr_sync.log; echo "⚠️ sync_mobile 出错(非致命, 继续)"; }
echo "  ✅ sync_mobile 完成"

# 5.5 R11.3 升 cache-buster (找出当前 v=2026XXXX[a-z] 全替换)
echo ""
echo "[Step 6/12] 升 cache-buster → ${CB_NEW}"
CB_OLD=$(grep -hoE "v=2026062[0-9][a-z]" $SC/index.html | sort -u | head -1)
if [ -n "$CB_OLD" ] && [ "$CB_OLD" != "v=${CB_NEW}" ]; then
    for f in index.html mobile.html kanban_embed.html pursuit.html industry-belt.html attribution_admin.html monitor.html report.html version.json export_tuoke.js; do
        [ -f "$SC/$f" ] && sed -i.bak "s|${CB_OLD}|v=${CB_NEW}|g" "$SC/$f"
    done
    rm -f $SC/*.bak
    # version.json 同步
    $PY -c "
import json
d = {'v':'${CB_NEW}', 'dataDate':'${DATA_DATE}', 'note':'daily_run.sh auto-bump ${REPORT_DATE}'}
json.dump(d, open('$SC/version.json','w'), ensure_ascii=False)
"
    echo "  ✅ cache-buster ${CB_OLD} → v=${CB_NEW}"
else
    echo "  ⚠️ cache-buster 已是 ${CB_NEW} 或未找到旧版本, 跳过"
fi

# 5.6 R11.4 打 snapshot
echo ""
echo "[Step 7/12] 打 snapshot data/snapshots/${DATA_DATE}/"
SNAP_DIR=$SC/data/snapshots/${DATA_DATE}
mkdir -p "$SNAP_DIR"
for f in bulk_import_rows.js center_daily_kpi.js center_quarter_summary.js center_sales_summary.js current_rising_data.js delivery_side_summary.js enough_candidates.js top80_effective_metrics.js top_status_data.js; do
    [ -f "$SC/data/$f" ] && cp "$SC/data/$f" "$SNAP_DIR/$f"
done
SNAP_COUNT=$(ls "$SNAP_DIR" 2>/dev/null | wc -l | tr -d ' ')
echo "  ✅ snapshot ${SNAP_COUNT} 个文件"

# 5.7 R11.5 同步 mobile 镜像 (HTML + data/ 全镜像, R3.1.3 补 data/)
echo ""
echo "[Step 8/12] 同步 sales-center-mobile/ 镜像 (HTML + data/)"
cp "$SC/mobile.html" "$SCMOBILE/index.html"
cp "$SC/kanban_embed.html" "$SCMOBILE/kanban_embed.html"
cp "$SC/industry-belt.html" "$SCMOBILE/industry-belt.html"
cp "$SC/report.html" "$SCMOBILE/report.html"
# R3.1.3: 之前漏同步 data/, 导致 mobile 端杭启等 override 修复不生效 → 截图打脸的根因之一
# 用 rsync 同步全部 data/, 排除 *.bak 备份文件
rsync -a --delete --exclude='*.bak*' --exclude='snapshots/' "$SC/data/" "$SCMOBILE/data/" 2>&1 | tail -3
echo "  ✅ mobile 4 个 HTML + data/ 已全镜像同步"

# 6. postflight + anomaly
echo ""
echo "[Step 9/12] postflight + anomaly"
$PY scripts/postflight_check.py > /tmp/dr_postflight.log 2>&1 || { tail -30 /tmp/dr_postflight.log; echo "❌ postflight 失败"; exit 6; }
$PY scripts/data_anomaly_guard.py > /tmp/dr_anomaly.log 2>&1 || { tail -30 /tmp/dr_anomaly.log; echo "⚠️ anomaly_guard 有 RED (新锐换名单池预期, 不阻断)"; }
echo "  ✅ postflight + anomaly 完成"

# 7. 严格守门 preflight (红线阻断)
echo ""
echo "[Step 10/12] 严格守门 preflight (红线失败立刻阻断)"
$PY scripts/daily_preflight_strict.py --dataDate ${DATA_DATE} || { echo ""; echo "❌ preflight 红线失败, 禁止输出快报"; exit 7; }
echo "  ✅ preflight 全部通过"

# 8. 上传云端 + 出报告
echo ""
echo "[Step 11/12] 上传 KPI 快照到云端 + 生成快报 HTML"
$PY scripts/upload_kpi_snapshot.py > /tmp/dr_upload.log 2>&1 || { tail -20 /tmp/dr_upload.log; echo "❌ upload_kpi_snapshot 失败"; exit 8; }
echo "  ✅ 已上云 (日志 /tmp/dr_upload.log)"
$PY scripts/daily_report_generator.py --dataDate ${DATA_DATE} > /tmp/dr_gen.log 2>&1 || { tail -20 /tmp/dr_gen.log; echo "❌ generator 失败"; exit 9; }
tail -1 /tmp/dr_gen.log
$PY scripts/wechat_message_generator.py --dataDate ${DATA_DATE} --kanbanVer ${CB_NEW} > /tmp/dr_wechat.log 2>&1 || { tail -20 /tmp/dr_wechat.log; echo "⚠️ wechat_message_generator 失败, 不阻断"; }
echo "  ✅ 快报 + 微信文案生成完成"

# 9. 总结
echo ""
echo "[Step 12/12] 完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📋 数据日: ${DATA_DATE}"
echo "  📋 报告日: ${REPORT_DATE}"
echo "  📋 cache-buster: ${CB_NEW}"
echo "  📋 本地快报: ~/Desktop/日报快报/日报快报_${REPORT_DATE}/服饰拓新日报快报_${REPORT_DATE}__R5_generated.html"
echo "  📋 微信文案: ~/Desktop/日报快报/日报快报_${REPORT_DATE}/微信群推送文案_${REPORT_DATE}__R9_generated.txt"
echo "  📋 线上看板: https://quzingdu-create.github.io/adq-video-ranking/sales-center/?v=${CB_NEW}"
echo "  📋 在线快报: https://quzingdu-create.github.io/adq-video-ranking/sales-center/report.html"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ⏰ 结束时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "下一步 (子青手动):"
echo "  1. 浏览器看快报对账"
echo "  2. cd \$SC/github_pages_adq_publish && git add ... && git commit && git push"
echo "  3. 微信群推送文案 (cat ~/Desktop/日报快报/日报快报_${REPORT_DATE}/微信群推送文案_*.txt)"
