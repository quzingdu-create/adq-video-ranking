/**
 * 🦞 销售作战中心 - 云端同步层 (v1.0)
 * 由橘橘有500w搭建 · 2026-05-20 19:55
 *
 * 设计目标（不破坏现有看板/登记表 localStorage 逻辑）：
 *   1. 提供顶栏「☁️同步到云端」「⬇️从云端拉取」两个按钮（B 兜底方案）
 *   2. 提供登录态：首次访问弹密码 + 选 RTX → 拿 Bearer token 存 localStorage
 *   3. 提供 cloud.upload(records) / cloud.download() / cloud.deleteOne(id) 三个 API
 *   4. 不主动劫持 localStorage，由调用方（kanban/register）按需调用
 *
 * 部署目标：
 *   - 本地调试：BACKEND_URL = 'http://localhost:3002'
 *   - 公司部署：BACKEND_URL = 'https://your-devcloud-domain'  (办公电脑切换)
 *
 * 依赖：fetch、Promise，IE 不支持，本身销售用 Chrome/Safari 都没问题
 */
(function (global) {
  'use strict';

  // ============== 配置 ==============
  // 自动探测：如果当前页面 host 是 github.io / pages → 用 devcloud；否则用 localhost
  // 子青可以在地址栏 ?backend=http://x.x.x.x:3002 临时切换
  function detectBackend() {
    try {
      var url = new URL(location.href);
      var override = url.searchParams.get('backend');
      if (override) {
        localStorage.setItem('cloud_backend_url', override);
        return override;
      }
      var saved = localStorage.getItem('cloud_backend_url');
      if (saved) return saved;
    } catch (e) {}
    // 默认值：本地用 3002，GitHub Pages 走 devcloud（2026-05-21 上线）
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '') {
      return 'http://localhost:3002';
    }
    // GitHub Pages → devcloud 智能网关（容器: edcchen-2ihfibypea，端口: 80，登录后才能访问）
    return 'https://edcchen-2ihfibypea-80.devcloud.woa.com';
  }

  var BACKEND_URL = detectBackend();
  var TOKEN_KEY = 'cloud_token_v1';
  var RTX_KEY = 'cloud_rtx_v1';

  // ============== 内部工具 ==============
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function getRtx() { return localStorage.getItem(RTX_KEY) || ''; }
  function saveAuth(token, rtx) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(RTX_KEY, rtx);
  }
  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(RTX_KEY);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers['Content-Type'] = 'application/json';
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var rtx = getRtx();
    if (rtx) headers['X-Staffname'] = rtx;
    return fetch(BACKEND_URL + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'include',
      mode: 'cors'
    }).then(function (r) {
      if (r.status === 401) {
        clearAuth();
        throw new Error('GATE_LOCKED');
      }
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.message || ('HTTP ' + r.status));
        return data;
      });
    });
  }

  // ============== 登录弹窗 ==============
  function ensureLoginUI() {
    if (document.getElementById('cloud-login-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'cloud-login-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;';
    modal.innerHTML = '<div style="background:#fff;border-radius:16px;padding:32px;width:90%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.2);">' +
      '<div style="font-size:42px;text-align:center;margin-bottom:8px;">🦞</div>' +
      '<h2 style="margin:0 0 6px;font-size:20px;text-align:center;color:#1f1f1f;">连接云端</h2>' +
      '<div style="font-size:13px;color:#888;text-align:center;margin-bottom:24px;">登录后销售换浏览器/换设备数据不丢</div>' +
      '<div style="margin-bottom:14px;">' +
        '<label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">我是</label>' +
        '<select id="cloud-login-rtx" style="width:100%;padding:11px 12px;border:1.5px solid #e5e5e5;border-radius:10px;font-size:15px;outline:none;background:#fff;"><option value="">— 加载中 —</option></select>' +
      '</div>' +
      '<div style="margin-bottom:18px;">' +
        '<label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">访问密码</label>' +
        '<input type="password" id="cloud-login-pwd" placeholder="向金洁索取" style="width:100%;padding:11px 12px;border:1.5px solid #e5e5e5;border-radius:10px;font-size:15px;outline:none;">' +
      '</div>' +
      '<button id="cloud-login-submit" style="width:100%;padding:12px;background:linear-gradient(135deg,#FF6B35,#F7931E);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;">登录</button>' +
      '<div id="cloud-login-err" style="margin-top:10px;padding:8px 12px;background:#FFEBEB;color:#D33;border-radius:8px;font-size:12px;display:none;"></div>' +
      '<button id="cloud-login-close" style="position:absolute;top:14px;right:14px;background:transparent;border:none;font-size:20px;color:#999;cursor:pointer;">×</button>' +
    '</div>';
    document.body.appendChild(modal);

    document.getElementById('cloud-login-close').onclick = function () {
      modal.style.display = 'none';
    };
    document.getElementById('cloud-login-submit').onclick = function () {
      var rtx = document.getElementById('cloud-login-rtx').value;
      var pwd = document.getElementById('cloud-login-pwd').value;
      var err = document.getElementById('cloud-login-err');
      err.style.display = 'none';
      if (!rtx) { err.textContent = '请选择您的姓名'; err.style.display = 'block'; return; }
      if (!pwd) { err.textContent = '请输入密码'; err.style.display = 'block'; return; }
      fetch(BACKEND_URL + '/_gate/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd, rtx: rtx }),
        mode: 'cors'
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.ok && data.token) {
          saveAuth(data.token, data.rtx);
          modal.style.display = 'none';
          if (cloud._afterLogin) { var cb = cloud._afterLogin; cloud._afterLogin = null; cb(); }
          showToast('☁️ 已连接云端，rtx=' + data.rtx);
        } else {
          err.textContent = data.message || '登录失败';
          err.style.display = 'block';
        }
      }).catch(function (e) {
        err.textContent = '网络异常：' + e.message;
        err.style.display = 'block';
      });
    };
  }

  function loadSalesOptions() {
    return fetch(BACKEND_URL + '/_gate/sales', { mode: 'cors' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var sel = document.getElementById('cloud-login-rtx');
        if (!sel) return;
        sel.innerHTML = '<option value="">— 请选择 —</option>';
        (data.list || []).forEach(function (s) {
          var opt = document.createElement('option');
          opt.value = s.rtx;
          opt.textContent = s.name + (s.is_admin ? '（管理员）' : '') + ' · ' + s.rtx;
          sel.appendChild(opt);
        });
        // 自动选上次登录身份
        var lastRtx = localStorage.getItem('gate_last_rtx') || getRtx();
        if (lastRtx && [].slice.call(sel.options).some(function (o) { return o.value === lastRtx; })) {
          sel.value = lastRtx;
        }
      })
      .catch(function () {
        var sel = document.getElementById('cloud-login-rtx');
        if (sel) sel.innerHTML = '<option value="">— 后端未连接 —</option>';
      });
  }

  function showLoginModal(afterLogin) {
    ensureLoginUI();
    cloud._afterLogin = afterLogin || null;
    loadSalesOptions();
    document.getElementById('cloud-login-modal').style.display = 'flex';
    setTimeout(function () {
      var pwd = document.getElementById('cloud-login-pwd');
      if (pwd) pwd.focus();
    }, 100);
  }

  // ============== Toast ==============
  function showToast(msg, isErr) {
    var t = document.getElementById('cloud-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cloud-toast';
      t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:8px;font-size:14px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.15);display:none;';
      document.body.appendChild(t);
    }
    t.style.background = isErr ? '#fee2e2' : '#dcfce7';
    t.style.color = isErr ? '#991b1b' : '#166534';
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.style.display = 'none'; }, 2800);
  }

  // ============== 公开 API ==============
  var cloud = {
    backendUrl: BACKEND_URL,
    isLoggedIn: function () { return !!getToken(); },
    rtx: getRtx,
    requireLogin: function (cb) {
      if (cloud.isLoggedIn()) { cb && cb(); return; }
      showLoginModal(cb);
    },
    showLogin: showLoginModal,
    logout: function () { clearAuth(); showToast('已断开云端', true); },

    // 上传一批 records → POST /api/customer/import
    upload: function (records) {
      if (!records || !records.length) return Promise.resolve({ created: 0, updated: 0 });
      return api('/api/customer/import', { method: 'POST', body: { records: records, replace: false } });
    },
    // 全表替换上传（慎用）
    replace: function (records) {
      return api('/api/customer/import', { method: 'POST', body: { records: records, replace: true } });
    },
    // 拉取全部 records
    download: function (opts) {
      var qs = '';
      if (opts && opts.sale) qs = '?sale=' + encodeURIComponent(opts.sale);
      return api('/api/customer/list' + qs, { method: 'GET' });
    },
    // 单条保存（创建/更新）
    save: function (rec) {
      return api('/api/customer/save', { method: 'POST', body: rec });
    },
    // 单条删除
    deleteOne: function (id) {
      return api('/api/customer/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    toast: showToast
  };

  // ============== 顶栏按钮注入 ==============
  function injectToolbar(opts) {
    opts = opts || {};
    var bar = document.getElementById('cloud-sync-toolbar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'cloud-sync-toolbar';
    bar.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99998;display:flex;gap:8px;align-items:center;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;';
    bar.innerHTML =
      '<span id="cloud-status" style="font-size:12px;color:#888;background:#fff;padding:5px 9px;border-radius:6px;border:1px solid #e5e5e5;"></span>' +
      '<button id="cloud-btn-upload"  style="padding:6px 12px;background:#FF6B35;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;">☁️ 同步到云端</button>' +
      '<button id="cloud-btn-download" style="padding:6px 12px;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;">⬇️ 从云端拉取</button>' +
      '<button id="cloud-btn-login" style="padding:6px 10px;background:#fff;color:#555;border:1px solid #e5e5e5;border-radius:6px;font-size:12px;cursor:pointer;">🔐</button>';
    document.body.appendChild(bar);

    function refreshStatus() {
      var el = document.getElementById('cloud-status');
      if (cloud.isLoggedIn()) {
        el.textContent = '☁️ ' + getRtx();
        el.style.color = '#166534';
        el.style.background = '#dcfce7';
      } else {
        el.textContent = '⚠️ 未登录';
        el.style.color = '#991b1b';
        el.style.background = '#fee2e2';
      }
    }
    refreshStatus();

    document.getElementById('cloud-btn-login').onclick = function () {
      if (cloud.isLoggedIn()) {
        if (confirm('当前已登录为 ' + getRtx() + '，是否退出？')) {
          cloud.logout();
          refreshStatus();
        }
      } else {
        showLoginModal(refreshStatus);
      }
    };

    document.getElementById('cloud-btn-upload').onclick = function () {
      cloud.requireLogin(function () {
        var records = (typeof opts.getLocalRecords === 'function') ? opts.getLocalRecords() : [];
        if (!records.length) { showToast('本地没有要同步的记录', true); return; }
        if (!confirm('确认上传 ' + records.length + ' 条本地记录到云端？(已存在的同 id 会被覆盖)')) return;
        showToast('上传中...');
        cloud.upload(records).then(function (data) {
          showToast('✅ 已同步 created=' + data.created + ' updated=' + data.updated);
          refreshStatus();
        }).catch(function (e) {
          if (e.message === 'GATE_LOCKED') { showLoginModal(); return; }
          showToast('上传失败：' + e.message, true);
        });
      });
    };

    document.getElementById('cloud-btn-download').onclick = function () {
      cloud.requireLogin(function () {
        if (!confirm('确认从云端拉取所有客户记录？\n会覆盖本地新登记但还没同步的数据，建议先点☁️同步到云端再拉取。')) return;
        showToast('拉取中...');
        cloud.download().then(function (data) {
          var list = data.list || [];
          if (typeof opts.applyRemoteRecords === 'function') {
            opts.applyRemoteRecords(list);
          }
          showToast('✅ 已拉取 ' + list.length + ' 条');
          refreshStatus();
        }).catch(function (e) {
          if (e.message === 'GATE_LOCKED') { showLoginModal(); return; }
          showToast('拉取失败：' + e.message, true);
        });
      });
    };

    cloud._refreshStatus = refreshStatus;
    return bar;
  }

  cloud.injectToolbar = injectToolbar;

  // ============== 暴露 ==============
  global.cloud = cloud;
  global.CloudSync = cloud; // 别名

  // 自动按钮注入（DOMContentLoaded 后）
  function autoInit() {
    if (document.body) {
      // 默认不自动注入，等 HTML 显式调用 cloud.injectToolbar({...})
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(autoInit, 0);
  } else {
    document.addEventListener('DOMContentLoaded', autoInit);
  }
})(window);
