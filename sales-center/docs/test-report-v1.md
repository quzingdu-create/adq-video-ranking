# V1 测试报告

日期：2026-06-22

## 已执行检查

| 检查项 | 结果 |
|---|---|
| `api_client.js` 语法检查 | 通过 |
| `data_adapter.js` 语法检查 | 通过 |
| `cloudfunctions/salesCenterApi/index.js` 语法检查 | 通过 |
| 前端 adapter 默认模式 | `static` |
| adapter 挂载对象 | `window.SalesCenterApi` / `window.SalesCenterDataAdapter` 均存在 |
| `getBootstrap()` 默认返回 | 静态快照，不调用云端 |
| 云函数 `healthcheck` 本地调用 | 返回 `ok=true` |
| HTML 接入范围 | 仅 `index.html` / `kanban_embed.html` / `mobile.html` 各新增 2 个 script 引用 |
| 本地 HTTP 预览 | `http://localhost:8765/sales-center/index.html` 返回 200 |
| 本地页面脚本命中 | PC / kanban / mobile 均命中新 adapter 引用 |

## 验收标准

- 默认模式为 `static`。已通过。
- 无业务数据替换。已通过，本次未改任何 `data/*.js` 读取内容。
- 无 UI 样式改动。已通过，本次未改 CSS/DOM 结构，只新增 defer 脚本引用。
- 新增脚本只挂载 `window.SalesCenterApi` 和 `window.SalesCenterDataAdapter`。已通过。
- 云函数 skeleton 可本地语法检查和 `healthcheck` 调用。已通过。

## 未执行项

- 未部署 CloudBase 云函数。
- 未推送 GitHub Pages。
- 未切换线上默认数据模式。
