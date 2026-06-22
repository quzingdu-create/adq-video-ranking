# CloudBase 重构架构文档

版本：V1 adapter skeleton  
日期：2026-06-22

## 当前架构

```text
index.html / kanban_embed.html / mobile.html
  -> <script src="data/*.js">
  -> window.__XXX__ 全局变量
  -> 页面直接消费全局变量
```

现有问题：

- `data/*.js` 公开暴露业务数据。
- 大文件体积过大，维护和缓存成本高。
- 部分功能前端直连 CloudBase DB，权限与接口边界不清晰。
- cache-buster、多端内联快照、静态文件同步容易导致数据不一致。

## 目标架构

```text
静态 html/js
  -> api_client.js
  -> data_adapter.js
  -> CloudBase 云函数 salesCenterApi
  -> CloudBase 云数据库 / 云存储
  -> import jobs / versioned snapshots
```

## 三态数据模式

| 模式 | 含义 | 用途 |
|---|---|---|
| `static` | 只用现有 `data/*.js` 和页面内全局变量 | 默认生产模式、回退模式 |
| `dual` | 静态数据展示，后台可做云端对账 | V2/V3 迁移验证 |
| `cloud` | 优先云函数 API，失败回退静态 | 灰度测试和最终切换 |

## V1 边界

- 新增 `api_client.js` 和 `data_adapter.js`。
- 新增 CloudBase 云函数代码骨架。
- 接入页面脚本，但默认 `static`。
- 不修改现有业务计算和 UI 渲染。
- 不删除任何 `data/*.js`。

## 回退

1. URL 加 `?dataMode=static`。
2. 或删除三处 HTML 中 adapter 脚本引用。
3. 或恢复备份：`/Users/duziqing/WorkBuddy/2026-05-12-task-5/backups/sales-center_cloudbase_v0v1_20260622_1429`。
4. 或回到 Git tag：`sales-center-cloudbase-v0-baseline-20260622`。
