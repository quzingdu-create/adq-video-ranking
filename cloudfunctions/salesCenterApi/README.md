# salesCenterApi

CloudBase 云函数骨架，V1 只提供标准响应和 `healthcheck`。

## 当前状态

- 不连接数据库。
- 不替换线上数据链路。
- 不改变现有业务口径。

## 后续

V2 开始接入 `sc_snapshot_daily` / `sc_top_metrics`，先双读对账，再灰度切换。
