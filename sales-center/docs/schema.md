# CloudBase Schema 草案

版本：V1 draft

## 新集合前缀

新集合统一使用 `sc_*`，不直接破坏现有集合。

## 集合设计

| 集合 | 用途 | 关键字段 |
|---|---|---|
| `sc_snapshot_daily` | 每日轻量快照 | `dataDate`, `snapshotVersion`, `type`, `payload`, `sourceHash`, `generatedAt` |
| `sc_top_metrics` | Top80、小红点、红黑榜、昨日新增 | `dataDate`, `snapshotVersion`, `type`, `sale`, `payload` |
| `sc_customer_records` | 客户/拓客明细 | `dataDate`, `snapshotVersion`, `id`, `shortName`, `subjectKey`, `sale`, `firstQuarter`, `quarterCost`, `yestCost` |
| `sc_customer_lookup` | 大字典/KV 查询 | `dataDate`, `snapshotVersion`, `type`, `key`, `value` |
| `sc_import_jobs` | 导入和对账记录 | `jobId`, `dataDate`, `snapshotVersion`, `status`, `sourceFiles`, `counts`, `diffs`, `createdAt` |
| `sc_assets` | 云存储素材元数据 | `assetId`, `type`, `cloudPath`, `url`, `relatedCustomer`, `createdAt` |

## 建议索引

- `sc_snapshot_daily`: `dataDate + type`, `snapshotVersion`
- `sc_top_metrics`: `dataDate + type`, `sale + type`
- `sc_customer_records`: `dataDate`, `sale`, `shortName`, `subjectKey`, `firstQuarter`
- `sc_customer_lookup`: `type + key`, `dataDate + type`
- `sc_import_jobs`: `dataDate`, `createdAt`, `status`

## 保留集合

- `tuoke_records`
- `redspot_progress`
- `user_sessions`
- `sales_kpi_daily`

V4 前不强迁写入链路。
