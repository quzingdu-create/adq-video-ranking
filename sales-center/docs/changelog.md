# Changelog

## 2026-06-22 V2 local seed

### Added

- 新增 `scripts/cloudbase_migration/prepare_v2_light_seed.py`，将轻量核心 `data/*.js` 转为 CloudBase seed JSON。
- 新增 `scripts/cloudbase_migration/verify_v2_light_seed.py`，校验 seed 数量、版本、日期、payload 非空。
- 新增本地 seed 输出目录：`/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed`。
- 新增 `docs/test-report-v2.md`。

### Changed

- `salesCenterApi` 从 V1 skeleton 扩展为 V2 light read skeleton。
- `getBootstrap` 规划为读取 `sc_snapshot_daily`。
- `getTopMetrics` 规划为读取 `sc_top_metrics`。
- `listVersions` 规划为读取 `sc_import_jobs`。
- `package.json` 增加 `@cloudbase/node-sdk` 依赖，供部署时使用。

### Not changed

- 未部署 CloudBase。
- 未创建云数据库集合。
- 未上传 seed。
- 未切换前端默认 `dataMode=static`。
- 未改 UI 和业务逻辑。

## 2026-06-22 V0/V1

### Added

- 新增 CloudBase 重构文档骨架。
- 新增 `api_client.js`：CloudBase 云函数调用客户端骨架。
- 新增 `data_adapter.js`：`static / dual / cloud` 数据模式骨架。
- 新增 `cloudfunctions/salesCenterApi/` 云函数 skeleton。

### Changed

- `index.html`、`kanban_embed.html`、`mobile.html` 接入 adapter 脚本。
- 默认仍为 `dataMode=static`，不改变现有展示数据。

### Not changed

- 未改业务口径。
- 未改 UI。
- 未删除任何 `data/*.js`。
- 未切换生产数据到云端。
- 未推送 GitHub Pages。

### Rollback

- 本地备份：`/Users/duziqing/WorkBuddy/2026-05-12-task-5/backups/sales-center_cloudbase_v0v1_20260622_1429`
- Git tag：`sales-center-cloudbase-v0-baseline-20260622`
