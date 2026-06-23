# CloudBase 每日快照同步一键流程（2026-06-23）

## 目标

每日静态看板更新后，把当前 `sales-center/data/*.js` 对应的大文件快照同步到 CloudBase，确保 `dataMode=dual/cloud` 与静态看板同源。

## 脚本

```text
scripts/cloudbase_migration/sync_daily_cloudbase_snapshot.py
```

## 默认安全策略

默认不上传，只做 dry-run：

```bash
/Users/duziqing/.workbuddy/binaries/python/versions/3.13.12/bin/python3 \
  scripts/cloudbase_migration/sync_daily_cloudbase_snapshot.py
```

真正覆盖上传必须显式加：

```bash
/Users/duziqing/.workbuddy/binaries/python/versions/3.13.12/bin/python3 \
  scripts/cloudbase_migration/sync_daily_cloudbase_snapshot.py \
  --upload
```

只验证当前 CloudBase 是否与静态数据一致：

```bash
/Users/duziqing/.workbuddy/binaries/python/versions/3.13.12/bin/python3 \
  scripts/cloudbase_migration/sync_daily_cloudbase_snapshot.py \
  --verify-only
```

## 脚本串联内容

1. 读取 `sales-center/data/center_daily_kpi.js` 的 `dataDate`。
2. 读取静态 `tuoke_real_records.js` 行数。
3. 生成 V3 big-data seed。
4. 生成 V3.1 customer index seed。
5. `--upload` 时覆盖上传 `sc_customer_records/sc_customer_lookup/sc_customer_index/sc_import_jobs`。
6. 上传/验证后调用 `salesCenterApi`：
   - `queryRecords`
   - `queryLookup(customer_link_data, 阿迪达斯)`
   - `getCustomerDetail(杭州不姜就科技有限公司)`
   - `listVersions`
7. 强制校验：
   - 静态 `__TUOKE_REAL_RECORDS__.length == queryRecords.totalRecords`
   - lookup sample `foundCount >= 1`
   - customer detail `foundRecord=true`

## 本轮验证

Dry-run：通过

```text
dataDate=2026-06-22
snapshotVersion=20260622_v3_big
staticRecords=14479
```

Verify-only：通过

```text
queryRecords.totalRecords=14479
queryLookup(阿迪达斯).foundCount=1
getCustomerDetail(杭州不姜就科技有限公司).foundLookup=true
getCustomerDetail(杭州不姜就科技有限公司).foundRecord=true
indexRefCount=1
```

## 每日使用建议

每日看板更新完成后：

1. 先跑静态看板 postflight。
2. 再跑本脚本 dry-run。
3. 如果 dry-run 的 `dataDate/snapshotVersion/staticRecords` 正确，再跑 `--upload`。
4. 最后跑 `--verify-only`。

如果时间不够，可以不上传；前端已有 `cloudFreshness()` 保护，CloudBase 快照日期不一致会自动回退 static。
