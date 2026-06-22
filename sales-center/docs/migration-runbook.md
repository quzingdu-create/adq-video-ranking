# 迁移 Runbook

版本：V2 local seed

## V0/V1 已执行

1. 建立本地备份：`/Users/duziqing/WorkBuddy/2026-05-12-task-5/backups/sales-center_cloudbase_v0v1_20260622_1429`
2. 创建 Git tag：`sales-center-cloudbase-v0-baseline-20260622`
3. 新增文档目录：`sales-center/docs/`
4. 新增 API adapter 骨架和云函数 skeleton。

## V2 本地已执行

1. 解析静态 JS 为 JSON。
2. 计算源文件 hash 和 payload hash。
3. 生成本地导入种子：
   - `/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed/sc_snapshot_daily.seed.json`
   - `/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed/sc_top_metrics.seed.json`
   - `/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed/sc_import_jobs.seed.json`
   - `/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed/manifest.json`
4. 本地对账通过：`snapshotRecords=5`，`topRecords=7`，`totalPayloadItems=1375`。
5. 扩展 `salesCenterApi`，支持 `getBootstrap` / `getTopMetrics` 云端读取逻辑。

## V2 云端准备已执行

1. 新增上传脚本：`/Users/duziqing/WorkBuddy/2026-05-12-task-5/scripts/cloudbase_migration/upload_v2_light_seed.js`。
2. 上传脚本能力：
   - 读取 `cloudbase_v2_seed`。
   - dry-run 输出计划。
   - 确保 `sc_snapshot_daily`、`sc_top_metrics`、`sc_import_jobs` 集合存在。
   - 支持 `--replace` 删除同 `snapshotVersion` 后重写，避免重复版本污染。
   - 上传后查询集合数量做对账。
3. 本地 dry-run 已通过，计划写入：`snapshotRecords=5`、`topRecords=7`、`snapshotVersion=20260622_v2_light`。
4. 本机原始环境未检测到 `tcb/cloudbase` CLI，已开始在隔离 Node workspace 安装 `@cloudbase/node-sdk` 和 `@cloudbase/cli`。

## V2 待部署步骤

1. 等待或完成 CLI/SDK 安装。
2. 确认 CloudBase 登录/凭据可用。
3. 执行上传：`NODE_PATH=/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules /Users/duziqing/.workbuddy/binaries/node/versions/22.22.2/bin/node /Users/duziqing/WorkBuddy/2026-05-12-task-5/scripts/cloudbase_migration/upload_v2_light_seed.js --replace`。
4. 部署 `salesCenterApi` 云函数。
5. 调用 API 读取云端数据。
6. 与静态 `window.__XXX__` 对账。
7. 对账通过后打开 `dataMode=dual`。
8. 灰度测试 `dataMode=cloud`。

## 回退步骤

页面异常：

1. URL 加 `?dataMode=static`。
2. 若需要代码级回退，恢复备份或 revert 本次 commit。

数据异常：

1. API 版本切回上一 `snapshotVersion`。
2. 前端保留 static fallback，不影响基础展示。

## 禁止事项

- 禁止直接删除 `data/*.js`。
- 禁止默认切 `cloud`。
- 禁止把业务计算重写到云函数。
- 禁止绕过对账直接替换展示数据。
