# CloudBase API 草案

版本：V2 light read skeleton  
云函数名：`salesCenterApi`

## 调用格式

```js
window.SalesCenterApi.call('healthcheck', { ping: true })
```

云函数入参：

```json
{
  "action": "healthcheck",
  "params": {}
}
```

标准返回：

```json
{
  "ok": true,
  "action": "healthcheck",
  "data": {},
  "meta": {
    "env": "adq-tuoke-2-d9gktr9mn2e462acd",
    "version": "v1-skeleton"
  }
}
```

## V2 已定义 action

| action | 状态 | 说明 |
|---|---|---|
| `healthcheck` | local ok | 返回云函数可用状态、集合名、SDK 状态 |
| `listVersions` | cloud read | 从 `sc_import_jobs` 查询 latest 版本 |
| `getBootstrap` | cloud read | 从 `sc_snapshot_daily` 查询首页首屏轻量数据 |
| `getTopMetrics` | cloud read | 从 `sc_top_metrics` 查询 Top80、小红点、红黑榜等 |
| `queryRecords` | planned | 拓客明细分页查询，V3 再做 |
| `getCustomerDetail` | planned | 单客户详情，V3 再做 |
| `queryLookup` | planned | 字典/判重按 key 查询，V3 再做 |
| `getProgress` | planned | 小红点处理进度，V4 再做 |
| `updateProgress` | planned | 标记已处理/撤销，V4 再做 |
| `upsertRecord` | planned | 登记/编辑客户，V4 再做 |
| `deleteRecord` | planned | 删除客户记录，V4 再做 |
| `exportRecords` | planned | 导出记录，V3/V4 再做 |

## V2 查询参数

`getBootstrap` / `getTopMetrics` 支持：

```json
{
  "dataDate": "2026-06-22",
  "snapshotVersion": "20260622_v2_light",
  "types": ["center_daily_kpi"]
}
```

不传 `types` 时返回本阶段默认轻量集合。

## 错误格式

```json
{
  "ok": false,
  "action": "unknown",
  "error": {
    "code": "UNKNOWN_ACTION",
    "message": "Unsupported action: xxx"
  }
}
```
