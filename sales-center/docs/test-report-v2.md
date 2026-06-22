# V2 本地种子与轻量接口测试报告

日期：2026-06-22

## 范围

本阶段完成本地准备，已把 V2 轻量 seed 写入 CloudBase `sc_*` 集合，并成功部署 `salesCenterApi` 云函数。前端默认模式仍为 `static`，未切换线上默认模式。

## 产物

| 文件 | 说明 |
|---|---|
| `scripts/cloudbase_migration/prepare_v2_light_seed.py` | 从 `data/*.js` 解析轻量核心数据，生成 CloudBase seed |
| `scripts/cloudbase_migration/verify_v2_light_seed.py` | 对账 seed 文件数量、版本、日期、核心 payload count |
| `scripts/cloudbase_migration/upload_v2_light_seed_cli.js` | 使用 tcb CLI 登录态上传 seed，并按 snapshotVersion 对账 |
| `cloudfunctions/salesCenterApi/index.js` | V2 轻量读取接口 skeleton |
| `cloudfunctions/salesCenterApi/package.json` | 增加 `@cloudbase/node-sdk` 依赖，部署时使用 |
| `cloudbaserc.json` | 固定 envId、functionRoot 和 salesCenterApi 配置，解决直接 `--dir` 部署 zip 结构异常 |
| `sales-center/dual_check.js` | 浏览器端 `?dataMode=dual` 只读双读检查脚本，不影响默认展示 |
| `scripts/cloudbase_migration/verify_v2_cloud_api.py` | CLI 端调用云函数，对比云端 payloadHash 与本地 seed |

## 生成结果

- 输出目录：`/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed`
- dataDate：`2026-06-22`
- snapshotVersion：`20260622_v2_light`

| 指标 | 数量 |
|---|---:|
| `sc_snapshot_daily` records | 5 |
| `sc_top_metrics` records | 7 |
| payload items 合计 | 1375 |

## 对账结果

| 检查项 | 结果 |
|---|---|
| manifest snapshot count | 通过 |
| manifest top count | 通过 |
| import job 状态 local only | 通过 |
| snapshotVersion 一致 | 通过 |
| dataDate 一致 | 通过 |
| payload 非空 | 通过 |
| `center_daily_kpi` 最小数量 | 通过，22 |
| `center_quarter_summary` 最小数量 | 通过，54 |
| `top80_effective_metrics` 最小数量 | 通过，80 |
| `top_status_data` 最小数量 | 通过，80 |
| `redblack_data` 最小数量 | 通过，2 |
| `yest_new_customer_tasks` 最小数量 | 通过，407 |
| Python 脚本语法 | 通过 |
| JS 文件语法 | 通过，`api_client.js` / `data_adapter.js` / `salesCenterApi/index.js` |
| 云函数本地 healthcheck | 通过，`ok=true`，`mode=v2-light-read-skeleton` |
| CloudBase CLI 登录 | 通过，`env:list` 可见 `adq-tuoke-2-d9gktr9mn2e462acd` |
| seed 云端写入 | 通过，使用 CLI 版上传脚本 |
| `sc_snapshot_daily` 云端数量 | 通过，5/5 |
| `sc_top_metrics` 云端数量 | 通过，7/7 |
| `sc_import_jobs` 云端数量 | 通过，1 |
| 云函数部署 | 通过，`salesCenterApi` 状态 `Deployment completed` |
| 云函数 healthcheck | 通过，`InvokeResult=0`，`cloudbaseSdkReady=true` |
| `getBootstrap` 云端读取 | 通过，返回 `count=5`，`snapshotVersion=20260622_v2_light` |
| `getTopMetrics` 云端读取 | 通过，返回 `count=7`，`snapshotVersion=20260622_v2_light` |
| `listVersions` 云端读取 | 通过，返回 `latest=20260622_v2_light` |
| CLI 双读 hash 对账 | 通过，5 个 bootstrap 类型 + 7 个 top 类型 payloadHash 全一致 |
| `dual_check.js` 语法 | 通过 |
| 三端 HTML dual_check 引用 | 通过，`index.html` / `kanban_embed.html` / `mobile.html` 各 1 处 |
| 本地 dual 测试入口 | 通过，`http://localhost:8766/sales-center/index.html?dataMode=dual` 命中脚本 |
| 本地浏览器 dual 报告 | 通过，子青截图确认 `window.__SALES_CENTER_DUAL_REPORT__.ok === true` 且 `status=finished` |

## 浏览器端 dual 使用方式

打开以下任一测试链接后，在控制台查看：`window.__SALES_CENTER_DUAL_REPORT__`。

```text
http://localhost:8766/sales-center/index.html?dataMode=dual
http://localhost:8766/sales-center/kanban_embed.html?dataMode=dual
http://localhost:8766/sales-center/mobile.html?dataMode=dual
```

说明：`dual_check.js` 只在 `dataMode=dual` 时运行；默认 `static` 不调用云端，不影响当前展示。

## 部署坑位记录

- 直接使用 `tcb fn deploy salesCenterApi --dir <函数目录>` 曾失败：`InvalidParameter.ZipCodeFmt` / `filename not matched: index.js`。
- 解决方式：在仓库根目录新增 `cloudbaserc.json`，设置 `functionRoot=cloudfunctions` 和函数配置，然后从仓库根目录执行 `tcb fn deploy salesCenterApi --deployMode zip`。
- 部署前需删除失败残留函数，避免卡在 `Creation failed` 或 `Function deleting`。

## 未做

- 未切默认 `dataMode=cloud`。
- 未推送 GitHub Pages。
- 未在真实线上 URL 执行浏览器控制台双读检查。

## 下一步

1. 整理本次 V0-V2 改动范围。
2. 提交并推送 GitHub Pages 测试版本。
3. 在线上 URL 用 `?dataMode=dual` 做同样检查。
4. 双端通过后，再设计灰度 `dataMode=cloud`，默认线上仍保持 `static`。
