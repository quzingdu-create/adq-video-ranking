# V3 大文件 API 化测试报告

日期：2026-06-22

## 范围

本阶段仅做大文件数据上云和 API 骨架验证，不切换前端默认数据源，不删除旧 `data/*.js`。

## 数据源

| 静态文件 | 变量 | 原始规模 |
|---|---|---:|
| `data/tuoke_real_records.js` | `window.__TUOKE_REAL_RECORDS__` | 23,652 条 |
| `data/register_lookup_data.js` | `window.__MAPPING_DATA__` | 36,586 key |
| `data/customer_link_data.js` | `window.__CUSTOMER_LINK_DATA__` | 35,912 key |
| `data/customer_main_product.js` | `window.__CUSTOMER_MAIN_PRODUCT__` | 3,502 key |

## CloudBase 集合

| 集合 | 用途 | 写入结果 |
|---|---|---:|
| `sc_customer_records` | 客户明细分片 | 48 chunks / 23,652 rows |
| `sc_customer_lookup` | 字典和客户链路分片 | 77 chunks / 76,000 rows |
| `sc_customer_index` | 客户名到明细 chunk/row 索引 | 24 chunks / 23,129 keys |
| `sc_import_jobs` | 导入任务记录 | V3 + V3.1 jobs |

- snapshotVersion：`20260622_v3_big`
- dataDate：`2026-06-22`

## 脚本

| 文件 | 说明 |
|---|---|
| `scripts/cloudbase_migration/prepare_v3_big_seed.py` | 把大 JS 文件转成 chunk seed |
| `scripts/cloudbase_migration/upload_v3_big_seed_cli.js` | 用 tcb CLI 登录态上传 chunk seed |
| `scripts/cloudbase_migration/prepare_v31_customer_index.py` | 从客户明细 chunks 生成客户名索引 seed |
| `scripts/cloudbase_migration/upload_v31_customer_index_cli.js` | 上传 `sc_customer_index` 并对账 |

## 云函数 API

`salesCenterApi` 已升级为：`v3-big-read-skeleton-20260622`

| action | 结果 | 说明 |
|---|---|---|
| `queryRecords` | 通过 | `page=1&pageSize=3` 返回 3 条，总数 23,652 |
| `queryLookup` | 通过 | 查询 `customer_link_data/阿迪达斯`，`foundCount=1`，耗时约 319ms |
| `getCustomerDetail` | 通过 | 查询 `阿迪达斯`，返回 lookup + record，`foundRecord=true`，耗时约 1.4s |
| `getCustomerDetail` | 通过 | 查询 `杭州不姜就科技有限公司`，`foundRecord=true`，耗时约 1.3s |
| `listVersions` | 通过 | `latestV3=20260622_v3_big`，`latestV31=20260622_v3_big` |

## 性能修复

初版 `getCustomerDetail` 扫描全部 48 个客户明细 chunk，导致 15 秒超时。V3.1 已新增 `sc_customer_index`：按客户名定位 `chunkIndex/rowIndex`，再读取目标 chunk 的单行明细，避免全量扫描。

## 当前未做

- 未让前端替换读取 `tuoke_real_records.js`。
- 未让前端替换读取 `register_lookup_data.js` / `customer_link_data.js`。
- 未切默认 `dataMode=cloud`。
- 未删除任何旧静态大文件。

## 下一步

1. 前端先接 `queryRecords` 分页，用于替换移动端/iframe 的大明细加载。
2. 再接 `queryLookup`，替换判重和链路字典整包加载。
3. 客户弹窗可接 `getCustomerDetail` 读取 lookup + record。
4. 每一步继续保留 `static/dual/cloud` 回退。
