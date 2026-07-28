/* 版本自动重定向 v1.0（2026-06-10 子青拍板：固定链接永远最新）
 * 原理：页面加载时 fetch version.json（带时间戳绕缓存）拿到最新版本号，
 *   若当前 URL 的 ?v= 与最新不一致 → location.replace 自动跳一次到最新版。
 * 用法：在每个顶层 HTML 的 <head> 第一行引入（必须在 auth-guard 之前或之后均可，
 *   它只管重定向，不碰密码门逻辑）。
 *
 * 防坑：
 *   ① 仅顶层窗口执行，iframe 内直接跳过（iframe 由父页带版本号加载，无需自管）
 *   ② sessionStorage 标记一次性重定向，杜绝 fetch 抖动导致的无限跳
 *   ③ fetch 失败/超时（1.2s）静默放行，绝不阻塞页面（宁可看旧版也不白屏）
 *   ④ version.json 自身 ?t=时间戳，永远绕过 GitHub Pages 的 max-age=600 缓存
 */
(function () {
  'use strict';
  // ① iframe 跳过
  try { if (window.top !== window.self) return; } catch (e) { return; }

  var CUR = (function () {
    var m = /[?&]v=([0-9a-z]+)/i.exec(location.search);
    return m ? m[1] : '';
  })();

  // ② 防无限跳：本会话已经为「拿到的某版本」跳过一次，就不再跳
  var REDIR_KEY = 'sc_ver_redirected';

  // ③ 1.2s 超时控制
  var done = false;
  var timer = setTimeout(function () { done = true; }, 1200);

  fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (done || !j || !j.v) return;          // 超时或无效 → 放行
      clearTimeout(timer);
      var latest = String(j.v);
      if (CUR === latest) return;               // 已是最新 → 不动
      var already = '';
      try { already = sessionStorage.getItem(REDIR_KEY) || ''; } catch (_) {}
      if (already === latest) return;           // 本会话已为该版本跳过 → 不再跳（防循环）
      try { sessionStorage.setItem(REDIR_KEY, latest); } catch (_) {}
      // 重写 ?v= 后整页 replace（不留历史记录）
      var base = location.origin + location.pathname;
      var qs = location.search.replace(/([?&])v=[0-9a-z]+/i, '$1v=' + latest);
      if (qs.indexOf('v=') === -1) qs = (qs ? qs + '&' : '?') + 'v=' + latest;
      location.replace(base + qs + location.hash);
    })
    .catch(function () { /* 静默放行 */ });
})();
