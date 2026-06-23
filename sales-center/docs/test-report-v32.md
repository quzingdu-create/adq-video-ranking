# V3.2 前端大文件 dual 接入测试报告

日期：2026-06-23

## 范围

本阶段只把 V3 大文件 API 接入前端 adapter 和浏览器 dual 检查，不替换默认静态数据源，不删除旧 `data/*.js`。

## 新增/修改

| 文件 | 说明 |
|---|---|
| `sales-center/data_adapter.js` | 增加 `queryRecords` / `queryLookup` / `getCustomerDetail`，支持 static fallback 与 dual 返回 |
| `sales-center/big_data_dual_check.js` | 仅 `dataMode=dual` 时运行的大文件云端检查 |
| `sales-center/index.html` | 接入 `big_data_dual_check.js?v=20260623a` |
| `sales-center/kanban_embed.html` | 接入 `big_data_dual_check.js?v=20260623a` |
| `sales-center/mobile.html` | 接入 `big_data_dual_check.js?v=20260623a` |
| `sales-center/version.json` | 升到 `20260623a` |

## 浏览器检查变量

打开 `?dataMode=dual` 后在 Console 查看：

```js
window.__SALES_CENTER_BIG_DUAL_REPORT__
```

预期：

```js
window.__SALES_CENTER_BIG_DUAL_REPORT__.status === 'finished'
window.__SALES_CENTER_BIG_DUAL_REPORT__.ok === true
```

## 检查项

| 检查 | 预期 |
|---|---|
| `queryRecords` | 云端返回 10 条，totalRecords=23652；如果页面已加载静态大文件则 hash 一致 |
| `queryLookup(customer_link_data, 阿迪达斯)` | found=true |
| `getCustomerDetail(杭州不姜就科技有限公司)` | foundLookup=true，foundRecord=true |

## 自检结果

| 项目 | 结果 |
|---|---|
| `data_adapter.js` 语法 | 通过 |
| `big_data_dual_check.js` 语法 | 通过 |
| 三端 HTML 引用 | 通过 |
| 默认数据模式 | 仍为 static |

## 说明

PC 首页默认不加载 `__TUOKE_REAL_RECORDS__` 大文件，因此 `queryRecords` 在首页只要求云端分页结果正确；在已加载静态大文件的页面，会追加 hash 对账。

## 下一步

1. 推送 GitHub Pages 后在线上 `?dataMode=dual` 检查 `__SALES_CENTER_BIG_DUAL_REPORT__`。
2. 若通过，再逐步把移动端/kanban 的大文件加载替换成 `SalesCenterDataAdapter.queryRecords()`。
3. 替换必须保留 static fallback，不直接切默认 cloud。
