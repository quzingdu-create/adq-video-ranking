# CloudBase V4 收尾报告

日期：2026-06-23

## 范围

本阶段完成 CloudBase 优化收尾，但仍遵守可回退原则：默认生产入口保持 `static`，`?dataMode=dual/cloud` 可验证云端路径。旧 `data/*.js` 继续保留作为回退兜底。

## 已完成

### 1. V4 云函数读写 BFF

`salesCenterApi` 已升级到：

```text
v4-read-write-bff-20260623
```

已启用 action：

| action | 状态 | 说明 |
|---|---|---|
| `healthcheck` | 已验证 | 返回 v4 版本和集合清单 |
| `getBootstrap` | 已验证 | V2 轻量核心数据读取 |
| `getTopMetrics` | 已验证 | Top80/小红点/潜力起量等轻量数据读取 |
| `queryRecords` | 已验证 | 客户明细分页，pageSize 最高 500 |
| `queryLookup` | 已验证 | lookup 按 key 或 chunk 读取，支持 includePayload |
| `getCustomerDetail` | 已验证 | 通过客户索引定位明细行 |
| `getProgress` | 已验证 | 封装 `redspot_progress` 读取 |
| `updateProgress` | 已实现 | 封装 `redspot_progress` 写入 |
| `upsertRecord` | 已实现 | 封装 `tuoke_records` 新增/更新 |
| `deleteRecord` | 已实现 | 默认软删除 `tuoke_records` |
| `exportRecords` | 已验证 | 分页导出 `tuoke_records` |
| `listVersions` | 已验证 | 返回 V2/V3/V3.1 版本 |

### 2. 前端 adapter 收尾

`sales-center/data_adapter.js` 升级到：

```text
v4-cloud-ready-adapter-20260623
```

新增：

- `queryAllRecords()`：云端分页拉取全量拓客明细，失败 fallback 静态。
- `queryLookupAll()`：云端合并 lookup chunks，失败 fallback 静态。
- `getProgress()` / `updateProgress()`。
- `upsertRecord()` / `deleteRecord()`。
- `exportRecords()`。

### 3. kanban 大文件加载优化

`kanban_embed.html` 的 `BIG_DATA_LOADER` 已支持：

- `dataMode=static`：仍走旧静态 JS，不影响默认生产。
- `dataMode=dual/cloud`：优先通过 CloudBase API 加载：
  - `tuoke_real_records`：走 `queryAllRecords(pageSize=500)`。
  - `customer_link_data`：走 `queryLookupAll(type=customer_link_data)`。
- 云端失败时自动 fallback 到静态 JS。

## 冒烟验证

已通过 CloudBase CLI 调用验证：

| action | 结果 |
|---|---|
| `healthcheck` | ok=true，version=`v4-read-write-bff-20260623` |
| `queryRecords(page=1,pageSize=1)` | ok=true，totalRecords=23652 |
| `queryLookup(customer_link_data, 阿迪达斯)` | ok=true |
| `getCustomerDetail(杭州不姜就科技有限公司)` | ok=true，foundLookup=true，foundRecord=true，indexRefCount=1 |
| `getProgress(dateKey=1970-01-01)` | ok=true，count=0 |
| `exportRecords(page=1,limit=1)` | ok=true，count=1 |

## 当前上线版本

- cache-buster：`20260623d`
- 默认模式：`static`
- 测试模式：

```text
https://quzingdu-create.github.io/adq-video-ranking/sales-center/?dataMode=dual&v=20260623d
https://quzingdu-create.github.io/adq-video-ranking/sales-center/kanban_embed.html?dataMode=dual&v=20260623d
```

## 仍保留的回退

- 页面异常：去掉 `dataMode=cloud/dual` 或默认 static。
- API 异常：前端 adapter fallback 到 static。
- 数据异常：旧 `data/*.js` 未删除，可继续使用。

## 未切默认 cloud 的原因

CloudBase 优化已具备可验证路径，但默认生产仍保持 `static`，因为每日业务刷新仍依赖 rebuild 生成物，且旧静态文件需按规则保留至少 7 天做回退。下一步如要灰度，可先让指定入口加 `?dataMode=cloud` 验证 1 天，再决定是否默认切 cloud。
