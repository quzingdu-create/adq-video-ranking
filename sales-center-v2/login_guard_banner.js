/* 🚨 未登录云端强提示横幅（2026-05-25）
 * 死规矩：未登录云端 → 全站红色横幅 + 立即登录按钮
 * iframe 子页跳过（顶层页已显示，不重复）
 */
(function initLoginGuardBanner(){
  if (window !== window.top) return; // iframe 子页不显示
  function ensureBanner(){
    var b = document.getElementById('login-guard-banner');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'login-guard-banner';
    b.style.cssText = [
      'position:fixed','top:0','left:0','right:0','z-index:99999',
      'background:linear-gradient(90deg,#dc2626,#b91c1c)','color:#fff',
      'padding:10px 16px','font-size:14px','font-weight:600',
      'display:none','align-items:center','justify-content:center','gap:12px',
      'box-shadow:0 2px 8px rgba(220,38,38,0.4)'
    ].join(';');
    b.innerHTML = '<span>⛔ 你尚未登录云端，所有新增 / 批量 / 删除登记操作都已被锁定。登记数据必须同步到云端，否则汇总会丢条。</span>'
      + '<button id="login-guard-btn" style="background:#fff;color:#dc2626;border:none;padding:6px 16px;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px;">立即登录 →</button>';
    document.body.appendChild(b);
    document.getElementById('login-guard-btn').addEventListener('click', function(){
      if (window.cloud && window.cloud.showLogin) window.cloud.showLogin(function(){ refresh(); });
    });
    return b;
  }
  function refresh(){
    if (!document.body) return;
    var b = ensureBanner();
    var logged = !!(window.cloud && window.cloud.isLoggedIn && window.cloud.isLoggedIn());
    b.style.display = logged ? 'none' : 'flex';
    document.body.style.paddingTop = logged ? '' : '44px';
  }
  // 等 cloud 初始化
  setTimeout(refresh, 500);
  setInterval(refresh, 3000);
})();
