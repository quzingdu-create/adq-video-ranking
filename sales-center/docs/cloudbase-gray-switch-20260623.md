# CloudBase 灰度开关说明（2026-06-23）

## 当前版本

- 前端版本：`20260623e`
- 灰度脚本：`cloud_gray_switch.js`
- API client：`v4-gray-client-20260623e`
- 默认模式：`static`

## 灰度原则

1. 默认入口不带参数时仍保持 `static`，不影响销售日常使用。
2. URL 参数优先级最高：`?dataMode=static|dual|cloud`。
3. 紧急回退优先级最高：`?forceStatic=1` 或本地 `SalesCenterGray.forceStatic()`。
4. 本地个人灰度：控制台执行 `SalesCenterGray.enableForMe('dual')` 或 `SalesCenterGray.enableForMe('cloud')`，刷新后生效。
5. 当前配置对白名单 `rtx=ziqingdu` 默认进入 `dual`，其他用户默认 `static`。
6. 云端失败仍自动 fallback 静态数据，不删除旧 `data/*.js`。

## 控制台命令

```js
SalesCenterGray.status()
SalesCenterGray.enableForMe('dual')
SalesCenterGray.enableForMe('cloud')
SalesCenterGray.disableForMe()
SalesCenterGray.forceStatic()
SalesCenterGray.clearForceStatic()
SalesCenterApi.getMode()
```

## 测试链接

- 默认稳定入口：`https://quzingdu-create.github.io/adq-video-ranking/sales-center/?v=20260623e`
- 双跑验证入口：`https://quzingdu-create.github.io/adq-video-ranking/sales-center/?dataMode=dual&v=20260623e`
- 云端优先入口：`https://quzingdu-create.github.io/adq-video-ranking/sales-center/?dataMode=cloud&v=20260623e`
- 强制回退入口：`https://quzingdu-create.github.io/adq-video-ranking/sales-center/?forceStatic=1&v=20260623e`

## 本地验证结果

- 默认无登录态：`static / default-static`
- URL `dataMode=cloud`：`cloud / url-dataMode`
- `rtx=ziqingdu`：`dual / rtx-allowlist`
- localStorage 单人设置 cloud：`cloud / local-override`
- `forceStatic=1`：`static / url-force-static`

## 本轮改动范围

- `sales-center/cloud_gray_switch.js`
- `sales-center/api_client.js`
- `sales-center/index.html`
- `sales-center/kanban_embed.html`
- `sales-center/mobile.html`
- `sales-center/version.json`
- `sales-center-mobile/index.html`
- `sales-center-mobile/cloud_gray_switch.js`
- `sales-center-mobile/api_client.js`
- `sales-center-mobile/data_adapter.js`
- `sales-center-mobile/lib_loader.js`
- `sales-center-mobile/cloud_sync.js`
- `sales-center-mobile/dual_check.js`
- `sales-center-mobile/big_data_dual_check.js`

## 回退方式

1. URL 临时回退：加 `?forceStatic=1`。
2. 控制台本地回退：`SalesCenterGray.forceStatic()` 后刷新。
3. 代码回退：把 `cloud_gray_switch.js` 配置 `enabled=false` 或把 `allowRtx=[]`、`rolloutPercent=0`。
4. 旧静态文件仍保留，可继续 `dataMode=static`。
