# CloudBase 数据新鲜度保护（2026-06-23）

## 背景

每日看板更新会先刷新静态 `data/*.js`，但 CloudBase V3 大文件分片如果没有同步上传新快照，`dataMode=dual/cloud` 可能读取旧 CloudBase 快照。

为避免后续更新看板数据时，灰度/云端读取旧数据，本次增加新鲜度保护。

## 规则

- 静态数据日来源：`window.__CENTER_DAILY_KPI__.dataDate`
- 云端大文件快照日期来源：`snapshotVersion` 前 8 位，例如 `20260622_v3_big` -> `2026-06-22`
- 两者一致：允许走 CloudBase 大文件读取
- 两者不一致：自动回退 static，不读取旧 CloudBase 大文件

## 保护范围

`data_adapter.js`：

- `queryRecords`
- `queryLookup`
- `queryAllRecords`
- `queryLookupAll`
- `getCustomerDetail`

`kanban_embed.html`：

- `BIG_DATA_LOADER` 会先判断 `SalesCenterDataAdapter.cloudFreshness()`
- 如果 cloud snapshot stale，直接 fallback 静态 JS

## 验证结果

模拟结果：

| static dataDate | snapshotVersion | 结果 |
|---|---|---|
| 2026-06-22 | 20260622_v3_big | ok=true，允许 cloud |
| 2026-06-23 | 20260622_v3_big | ok=false，回退 static |
| 2026-06-23 | 20260623_v3_big | ok=true，允许 cloud |

## 对每日更新的影响

默认 `static` 不受影响。

如果当天只更新静态看板，没同步 CloudBase 大文件：

- 默认入口继续正常。
- dual/cloud 会自动识别 CloudBase 快照落后，回退静态数据。
- 不会把旧 CloudBase 大文件混进新看板。

如果当天也上传了 CloudBase 新快照：

- snapshotVersion 日期与 dataDate 一致后，dual/cloud 自动恢复云端读取。
