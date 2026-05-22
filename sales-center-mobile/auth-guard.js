/* 销售作战中心 · 权限门 v1（前端密码门，2026-05-22 上线）
 * 用法：在 <head> 里第一行 <script src="auth-guard.js"></script>
 * 校验通过后 7 天免登；失败 5 次锁 5 分钟。
 * 注：前端密码门只挡随手点入的外人，安全要求高时升级 CloudBase 鉴权（方案 B）。
 */
(function () {
  'use strict';

  // SHA256 of password "Fszxdm1234"
  var PASS_HASH = '0011c14d6b19751f709388bde9bf25abb725a4326bf01886e104225cd18c939d';
  var TTL_MS    = 7 * 24 * 60 * 60 * 1000; // 7 天
  var KEY_OK    = 'sc_auth_ok_v1';
  var KEY_FAIL  = 'sc_auth_fail_v1';
  var MAX_FAIL  = 5;
  var LOCK_MS   = 5 * 60 * 1000;

  // 已登录直接放行
  try {
    var saved = JSON.parse(localStorage.getItem(KEY_OK) || 'null');
    if (saved && saved.t && (Date.now() - saved.t) < TTL_MS) return;
  } catch (e) {}

  // 先把页面藏起来
  var hideStyle = document.createElement('style');
  hideStyle.id = 'sc-auth-hide';
  hideStyle.textContent = 'html,body{visibility:hidden!important;}#sc-auth-mask{visibility:visible!important;}';
  document.documentElement.appendChild(hideStyle);

  function sha256Hex(str) {
    // 用 SubtleCrypto，回退到老浏览器拒绝
    if (!window.crypto || !crypto.subtle) {
      return Promise.reject(new Error('SubtleCrypto not available'));
    }
    var enc = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
      return Array.from(new Uint8Array(buf))
        .map(function (b) { return b.toString(16).padStart(2, '0'); })
        .join('');
    });
  }

  function getFailState() {
    try {
      var f = JSON.parse(localStorage.getItem(KEY_FAIL) || 'null');
      if (f && f.until && f.until > Date.now()) return f;
    } catch (e) {}
    return null;
  }

  function setFail(times) {
    var data = { times: times };
    if (times >= MAX_FAIL) data.until = Date.now() + LOCK_MS;
    localStorage.setItem(KEY_FAIL, JSON.stringify(data));
  }

  function clearFail() {
    localStorage.removeItem(KEY_FAIL);
  }

  function buildMask() {
    var mask = document.createElement('div');
    mask.id = 'sc-auth-mask';
    mask.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 50%,#3b82f6 100%)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:"PingFang SC","Microsoft YaHei",sans-serif',
      'visibility:visible'
    ].join(';');

    mask.innerHTML = ''
      + '<div style="background:#fff;border-radius:16px;padding:36px 40px;width:380px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3);">'
      +   '<div style="font-size:22px;font-weight:700;color:#1f2937;text-align:center;margin-bottom:6px;">🔐 销售作战中心</div>'
      +   '<div style="font-size:13px;color:#6b7280;text-align:center;margin-bottom:24px;">仅限服饰拓新组内部访问</div>'
      +   '<input id="sc-auth-input" type="password" placeholder="请输入访问密码" autocomplete="off" '
      +     'style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;outline:none;margin-bottom:12px;" />'
      +   '<button id="sc-auth-btn" '
      +     'style="width:100%;padding:12px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">'
      +     '进入'
      +   '</button>'
      +   '<div id="sc-auth-tip" style="margin-top:12px;font-size:12px;color:#ef4444;text-align:center;min-height:18px;"></div>'
      +   '<div style="margin-top:18px;font-size:11px;color:#9ca3af;text-align:center;line-height:1.6;">'
      +     '密码请联系子青获取 · 7 天免登<br/>外泄密码视为违规'
      +   '</div>'
      + '</div>';

    return mask;
  }

  function mount() {
    var mask = buildMask();
    document.body ? document.body.appendChild(mask) : document.documentElement.appendChild(mask);

    var input = mask.querySelector('#sc-auth-input');
    var btn   = mask.querySelector('#sc-auth-btn');
    var tip   = mask.querySelector('#sc-auth-tip');

    function refreshLock() {
      var f = getFailState();
      if (f) {
        var sec = Math.ceil((f.until - Date.now()) / 1000);
        if (sec > 0) {
          btn.disabled = true;
          btn.style.background = '#9ca3af';
          btn.style.cursor = 'not-allowed';
          tip.textContent = '错误次数过多，请 ' + sec + ' 秒后重试';
          setTimeout(refreshLock, 1000);
          return;
        } else {
          clearFail();
        }
      }
      btn.disabled = false;
      btn.style.background = '#3b82f6';
      btn.style.cursor = 'pointer';
      if (tip.textContent.indexOf('请') === 0) tip.textContent = '';
    }

    function tryAuth() {
      var v = input.value.trim();
      if (!v) { tip.textContent = '请输入密码'; return; }
      tip.textContent = '校验中…';
      tip.style.color = '#6b7280';
      sha256Hex(v).then(function (hash) {
        if (hash === PASS_HASH) {
          localStorage.setItem(KEY_OK, JSON.stringify({ t: Date.now() }));
          clearFail();
          tip.textContent = '✓ 通过，正在进入…';
          tip.style.color = '#10b981';
          setTimeout(function () {
            var s = document.getElementById('sc-auth-hide');
            if (s) s.remove();
            mask.remove();
          }, 200);
        } else {
          var f = getFailState() || { times: 0 };
          var times = (f.times || 0) + 1;
          setFail(times);
          tip.style.color = '#ef4444';
          if (times >= MAX_FAIL) {
            tip.textContent = '错误 ' + times + ' 次，已锁定 5 分钟';
            refreshLock();
          } else {
            tip.textContent = '密码错误，剩余 ' + (MAX_FAIL - times) + ' 次';
          }
          input.value = '';
          input.focus();
        }
      }).catch(function (err) {
        tip.style.color = '#ef4444';
        tip.textContent = '浏览器不支持，请用 Chrome / Edge / Safari 最新版';
      });
    }

    btn.addEventListener('click', tryAuth);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') tryAuth();
    });
    setTimeout(function () { input.focus(); }, 50);
    refreshLock();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
