/**
 * 🦞 销售作战中心 - 云端同步层 (v2.0 · CloudBase)
 * 由橘橘有500w搭建 · 2026-05-21 14:20
 *
 * 后端切换：DevCloud Node 后端  →  腾讯云开发 CloudBase（云数据库 + 匿名登录）
 *
 * 数据模型：
 *   tuoke_records      拓客登记（销售 / 客户简称 / 客户主体 / 类目 / 登记日期 / 备注 / 创建时间 / id）
 *   sales_kpi_daily    销售看板每日快照（销售 / 日期 / 新锐客户数 / 季度新客日均消耗）
 *
 * 公开 API（保持向后兼容）：
 *   cloud.isLoggedIn()          → bool
 *   cloud.rtx()                 → 当前选定的 rtx
 *   cloud.requireLogin(cb)      → 已登录直接 cb，否则弹选人弹窗
 *   cloud.showLogin(cb)         → 弹选人弹窗
 *   cloud.logout()              → 清空本地 rtx
 *   cloud.upload(records)       → 批量 upsert 到 tuoke_records
 *   cloud.download()            → 拉全部 tuoke_records
 *   cloud.save(rec)             → 单条 upsert
 *   cloud.deleteOne(id)         → 单条删除
 *   cloud.injectToolbar(opts)   → 顶栏按钮
 *   cloud.toast(msg, isErr)
 *
 * 新增（KPI 快照）：
 *   cloud.kpi.upsert(snapshot)  → upsert 一条 sales_kpi_daily（按 销售+日期 唯一）
 *   cloud.kpi.query({sale,from,to}) → 查询快照
 *
 * 依赖：window.cloudbase（@cloudbase/js-sdk UMD），HTML 必须先引入 CDN
 */
(function (global) {
  'use strict';

  // ============== 配置 ==============
  var ENV_ID = 'adq-tuoke-2-d9gktr9mn2e462acd';
  var COLL_RECORDS = 'tuoke_records';
  var COLL_KPI = 'sales_kpi_daily';
  var RTX_KEY = 'cloud_rtx_v2';
  // B1 鉴权：每个销售一个 CloudBase 账号（用户名+用户自定义密码）
  // CloudBase 用户名 = rtx 本身（如 jonzhu），密码由销售首次输入
  // CloudBase token 持久化到 localStorage，之后免登录直到 token 过期（默认 30 天）
  function buildEmail(rtx) { return rtx; }  // 直接用 rtx 当 username 登录
  var SALES_LIST = [
    { rtx: 'ziqingdu',     name: '子青',          is_admin: true },
    { rtx: 'kinsleyjin',   name: 'Kinsleyjin',    is_admin: true },
    { rtx: 'jonzhu',       name: 'Jonzhu' },
    { rtx: 'brownfan',     name: 'Brownfan' },
    { rtx: 'kaikaigenli',  name: 'Kaikaigenli' },
    { rtx: 'yvaineechen',  name: 'Yvaineechen' },
    { rtx: 'lijunwu',      name: 'Lijunwu' },
    { rtx: 'ruilingzhan',  name: 'Ruilingzhan' }
  ];
  function isAdmin(rtx) {
    rtx = rtx || getRtx();
    for (var i = 0; i < SALES_LIST.length; i++) {
      if (SALES_LIST[i].rtx === rtx) return !!SALES_LIST[i].is_admin;
    }
    return false;
  }
  function getSalesList() { return SALES_LIST.slice(); }

  // ============== CloudBase 初始化 ==============
  var _app = null;
  var _auth = null;
  var _db = null;
  var _readyPromise = null;

  function ensureReady(rtx, password) {
    // 切换 rtx 时强制重置（不同身份不复用 promise）
    if (rtx && _readyPromise && _currentRtx && _currentRtx !== rtx) {
      _readyPromise = null;
      _app = null;
      _auth = null;
      _db = null;
    }
    if (_readyPromise) return _readyPromise;
    var targetRtx = rtx || getRtx();
    _readyPromise = new Promise(function (resolve, reject) {
      // 兼容两种全局名：tcb.js (1.7.x) 暴露 window.tcb；@cloudbase/js-sdk 暴露 window.cloudbase
      var SDK = (typeof cloudbase !== 'undefined') ? cloudbase
              : (typeof tcb !== 'undefined') ? tcb
              : null;
      if (!SDK) {
        reject(new Error('CloudBase SDK 未加载，HTML 缺少 <script src="https://imgcache.qq.com/qcloud/tcbjs/1.7.2/tcb.js"></script>'));
        return;
      }
      try {
        _app = SDK.init({ env: ENV_ID });
        _auth = _app.auth({ persistence: 'local' });
        // 路径 1：已有有效 token（同 rtx）→ 直接走
        if (_auth.hasLoginState && _auth.hasLoginState() && targetRtx === _currentRtx) {
          _db = _app.database();
          resolve();
          return;
        }
        // 路径 2：已有 CloudBase token 但 _currentRtx 没初始化（页面刚刷新）→ 信任 localStorage 的 rtx
        if (_auth.hasLoginState && _auth.hasLoginState() && targetRtx && !_currentRtx) {
          _currentRtx = targetRtx;
          _db = _app.database();
          resolve();
          return;
        }
        // 路径 3：必须传密码做首次登录
        if (!targetRtx) {
          reject(new Error('请先选择身份'));
          return;
        }
        if (!password) {
          var e2 = new Error('NEED_PASSWORD');
          e2.code = 'NEED_PASSWORD';
          reject(e2);
          return;
        }
        var email = buildEmail(targetRtx);
        var loginP = _auth.signIn
          ? _auth.signIn({ username: email, password: password })
          : _auth.signInWithEmailAndPassword(email, password);
        loginP.then(function () {
          _currentRtx = targetRtx;
          _db = _app.database();
          resolve();
        }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
    return _readyPromise;
  }
  var _currentRtx = null;

  // ============== rtx 身份（不依赖密码，前端选择持久化） ==============
  function getRtx() { return localStorage.getItem(RTX_KEY) || ''; }
  function setRtx(rtx) { localStorage.setItem(RTX_KEY, rtx); }
  function clearRtx() { localStorage.removeItem(RTX_KEY); }

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

  // ============== 选人弹窗 ==============
  function ensureLoginUI() {
    if (document.getElementById('cloud-login-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'cloud-login-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;';
    var optionsHtml = SALES_LIST.map(function (s) {
      return '<option value="' + s.rtx + '">' + s.name + (s.is_admin ? '（管理员）' : '') + '</option>';
    }).join('');
    modal.innerHTML = '<div style="position:relative;background:#fff;border-radius:16px;padding:32px;width:90%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.2);">' +
      '<div style="font-size:42px;text-align:center;margin-bottom:8px;">🦞</div>' +
      '<h2 style="margin:0 0 6px;font-size:20px;text-align:center;color:#1f1f1f;">连接云端</h2>' +
      '<div style="font-size:13px;color:#888;text-align:center;margin-bottom:24px;">选择身份并输入密码（首次登录后浏览器会记住，30 天内免输）</div>' +
      '<div style="margin-bottom:14px;">' +
        '<label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">我是</label>' +
        '<select id="cloud-login-rtx" style="width:100%;padding:11px 12px;border:1.5px solid #e5e5e5;border-radius:10px;font-size:15px;outline:none;background:#fff;"><option value="">— 请选择 —</option>' + optionsHtml + '</select>' +
      '</div>' +
      '<div style="margin-bottom:18px;">' +
        '<label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">密码 <span style="color:#999;">（管理员发给你的）</span></label>' +
        '<input id="cloud-login-pwd" type="password" placeholder="请输入密码" style="width:100%;padding:11px 12px;border:1.5px solid #e5e5e5;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;" />' +
      '</div>' +
      '<button id="cloud-login-submit" style="width:100%;padding:12px;background:linear-gradient(135deg,#FF6B35,#F7931E);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;">进入</button>' +
      '<div id="cloud-login-err" style="margin-top:10px;padding:8px 12px;background:#FFEBEB;color:#D33;border-radius:8px;font-size:12px;display:none;"></div>' +
      '<button id="cloud-login-close" style="position:absolute;top:14px;right:14px;background:transparent;border:none;font-size:20px;color:#999;cursor:pointer;">×</button>' +
    '</div>';
    document.body.appendChild(modal);

    document.getElementById('cloud-login-close').onclick = function () {
      modal.style.display = 'none';
    };
    // 回车提交
    document.getElementById('cloud-login-pwd').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') document.getElementById('cloud-login-submit').click();
    });
    document.getElementById('cloud-login-submit').onclick = function () {
      var rtx = document.getElementById('cloud-login-rtx').value;
      var pwd = document.getElementById('cloud-login-pwd').value;
      var err = document.getElementById('cloud-login-err');
      var btn = document.getElementById('cloud-login-submit');
      err.style.display = 'none';
      if (!rtx) { err.textContent = '请选择您的姓名'; err.style.display = 'block'; return; }
      if (!pwd) { err.textContent = '请输入密码'; err.style.display = 'block'; return; }
      // 修复：每次点击都强制重置已 reject 的 _readyPromise（之前一次失败后再点没反应）
      _readyPromise = null;
      _app = null; _auth = null; _db = null; _currentRtx = null;
      // 按钮 loading
      btn.disabled = true; btn.textContent = '正在登录…';
      setRtx(rtx);
      ensureReady(rtx, pwd).then(function () {
        btn.disabled = false; btn.textContent = '进入';
        document.getElementById('cloud-login-pwd').value = '';
        modal.style.display = 'none';
        showToast('☁️ 已连接云端，rtx=' + rtx);
        if (cloud._afterLogin) { var cb = cloud._afterLogin; cloud._afterLogin = null; cb(); }
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '进入';
        // 失败也要重置，下次点击才能重试
        _readyPromise = null; _app = null; _auth = null; _db = null; _currentRtx = null;
        clearRtx();
        var raw = e && e.message ? e.message : '';
        var code = e && e.code ? e.code : '';
        var hay = (code + ' ' + raw).toLowerCase();
        var msg = '账号未注册或密码错误';
        if (hay.indexOf('user_not_found') >= 0 || hay.indexOf('not found') >= 0 || hay.indexOf('user-not-found') >= 0) {
          msg = '账号还没在 CloudBase 后台建立，找管理员开通';
        } else if (hay.indexOf('password') >= 0 || hay.indexOf('credentials') >= 0) {
          msg = '密码错误，请重输（首次登录密码：Fszxdm1234）';
        } else if (hay.indexOf('invalid') >= 0 || hay.indexOf('incorrect') >= 0) {
          msg = '账号或密码不正确（如确认无误，请联系管理员检查 CloudBase 是否已建账号）';
        } else if (hay.indexOf('network') >= 0 || hay.indexOf('timeout') >= 0 || hay.indexOf('fetch') >= 0) {
          msg = '网络异常，请检查 VPN/代理后重试';
        } else if (raw) {
          msg = raw;
        }
        err.innerHTML = '登录失败：' + msg + '<br><span style="font-size:11px;color:#999;">debug: code=' + (code || 'N/A') + ' / raw=' + (raw || 'N/A').slice(0, 120) + '</span>';
        err.style.display = 'block';
        try { console.error('[cloud] login failed code=' + code + ' raw=' + raw, e); } catch(_) {}
      });
    };
    var lastRtx = getRtx();
    if (lastRtx) {
      var sel = document.getElementById('cloud-login-rtx');
      if (sel) sel.value = lastRtx;
    }
  }

  function showLoginModal(afterLogin) {
    ensureLoginUI();
    cloud._afterLogin = afterLogin || null;
    document.getElementById('cloud-login-modal').style.display = 'flex';
  }

  // ============== 数据 API ==============
  function upsertOne(rec) {
    return ensureReady().then(function () {
      var coll = _db.collection(COLL_RECORDS);
      var loginRtx = getRtx() || '';
      // _rtx 写"实际销售"（rec.sale 优先），_recorded_by 写当前登录账号
      var actualSale = rec.sale || loginRtx;
      var data = Object.assign({}, rec, {
        _rtx: actualSale,
        _recorded_by: loginRtx,
        _updatedAt: Date.now()
      });
      if (!data.id) {
        data.id = 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      }
      return coll.where({ id: data.id }).get().then(function (res) {
        if (res.data && res.data.length) {
          var docId = res.data[0]._id;
          return coll.doc(docId).update(data).then(function () { return { created: 0, updated: 1 }; });
        }
        data._createdAt = Date.now();
        return coll.add(data).then(function () { return { created: 1, updated: 0 }; });
      });
    });
  }

  function uploadBatch(records) {
    if (!records || !records.length) return Promise.resolve({ created: 0, updated: 0 });
    return ensureReady().then(function () {
      var created = 0, updated = 0;
      var queue = records.slice();
      function step() {
        if (!queue.length) return { created: created, updated: updated };
        var r = queue.shift();
        return upsertOne(r).then(function (x) {
          created += x.created || 0;
          updated += x.updated || 0;
          return step();
        });
      }
      return step();
    });
  }

  function downloadAll(opts) {
    return ensureReady().then(function () {
      var coll = _db.collection(COLL_RECORDS);
      var query = coll;
      if (opts && opts.sale) {
        query = coll.where({ sale: opts.sale });
      }
      // CloudBase 单次最多 1000 条，分页拉
      var all = [];
      function page(skip) {
        return query.skip(skip).limit(1000).get().then(function (res) {
          all = all.concat(res.data || []);
          if (res.data && res.data.length === 1000) {
            return page(skip + 1000);
          }
          return { list: all };
        });
      }
      return page(0);
    });
  }

  function deleteById(id) {
    return ensureReady().then(function () {
      var coll = _db.collection(COLL_RECORDS);
      return coll.where({ id: id }).get().then(function (res) {
        if (!res.data || !res.data.length) return { deleted: 0 };
        var docId = res.data[0]._id;
        return coll.doc(docId).remove().then(function () { return { deleted: 1 }; });
      });
    });
  }

  // ============== KPI 快照 API（销售/日期/新锐客户数/季度新客日均消耗） ==============
  function kpiUpsert(snap) {
    // snap = { sale, date, sharpCustomers, newCustomerDailyAvgCost }
    return ensureReady().then(function () {
      if (!snap || !snap.sale || !snap.date) {
        return Promise.reject(new Error('kpi snapshot 必须含 sale + date'));
      }
      var coll = _db.collection(COLL_KPI);
      var data = Object.assign({}, snap, { _rtx: getRtx() || '', _updatedAt: Date.now() });
      return coll.where({ sale: snap.sale, date: snap.date }).get().then(function (res) {
        if (res.data && res.data.length) {
          var docId = res.data[0]._id;
          return coll.doc(docId).update(data).then(function () { return { created: 0, updated: 1 }; });
        }
        data._createdAt = Date.now();
        return coll.add(data).then(function () { return { created: 1, updated: 0 }; });
      });
    });
  }

  function kpiQuery(opts) {
    opts = opts || {};
    return ensureReady().then(function () {
      var coll = _db.collection(COLL_KPI);
      var w = {};
      if (opts.sale) w.sale = opts.sale;
      var query = Object.keys(w).length ? coll.where(w) : coll;
      // 日期范围：CloudBase Web SDK 用 db.command
      if (opts.from || opts.to) {
        var _ = _db.command;
        var dateCond = null;
        if (opts.from && opts.to) dateCond = _.gte(opts.from).and(_.lte(opts.to));
        else if (opts.from) dateCond = _.gte(opts.from);
        else dateCond = _.lte(opts.to);
        var w2 = Object.assign({}, w, { date: dateCond });
        query = coll.where(w2);
      }
      return query.orderBy('date', 'desc').limit(1000).get().then(function (res) {
        return { list: res.data || [] };
      });
    });
  }

  // ============== 公开对象 ==============
  var cloud = {
    backendUrl: 'cloudbase://' + ENV_ID,
    envId: ENV_ID,
    isLoggedIn: function () { return !!getRtx(); },
    rtx: getRtx,
    requireLogin: function (cb) {
      if (cloud.isLoggedIn()) {
        ensureReady().then(function () { cb && cb(); }).catch(function (e) {
          // token 失效或无密码 → 弹密码框重登
          if (e && (e.code === 'NEED_PASSWORD' || (e.message || '').indexOf('NEED_PASSWORD') >= 0)) {
            showLoginModal(cb);
            return;
          }
          showToast('云端连接失败：' + e.message, true);
        });
        return;
      }
      showLoginModal(cb);
    },
    showLogin: showLoginModal,
    logout: function () {
      clearRtx();
      _currentRtx = null;
      _readyPromise = null;
      if (_auth && _auth.signOut) {
        try { _auth.signOut(); } catch (e) {}
      }
      showToast('已断开云端', true);
    },

    upload: uploadBatch,
    replace: function (records) {
      // 全表替换：先清空（按 _rtx 范围）再批量 add，避免误删别人数据，仍走 upsert
      return uploadBatch(records);
    },
    download: downloadAll,
    save: function (rec) { return upsertOne(rec); },
    deleteOne: deleteById,

    kpi: {
      upsert: kpiUpsert,
      query: kpiQuery
    },

    isAdmin: isAdmin,
    getSalesList: getSalesList,
    toast: showToast
  };

  // ============== 顶栏按钮注入（合并下拉版） ==============
  function injectToolbar(opts) {
    opts = opts || {};
    var bar = document.getElementById('cloud-sync-toolbar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'cloud-sync-toolbar';
    bar.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99998;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;';
    bar.innerHTML =
      '<div style="position:relative;">' +
        '<button id="cloud-main-btn" style="padding:7px 14px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.08);display:flex;align-items:center;gap:6px;">🔐 登录云端</button>' +
        '<div id="cloud-menu" style="display:none;position:absolute;top:38px;right:0;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:180px;overflow:hidden;">' +
          '<div id="cloud-menu-info" style="padding:10px 14px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;background:#f9fafb;"></div>' +
          '<button id="cloud-menu-upload" class="cloud-menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:#fff;border:none;border-bottom:1px solid #f3f4f6;font-size:13px;cursor:pointer;color:#1f2937;">⬆️ 同步本地到云端</button>' +
          '<button id="cloud-menu-download" class="cloud-menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:#fff;border:none;border-bottom:1px solid #f3f4f6;font-size:13px;cursor:pointer;color:#1f2937;">⬇️ 下载拓新组全量登记名单</button>' +
          '<button id="cloud-menu-export" class="cloud-menu-item" style="display:none;width:100%;text-align:left;padding:10px 14px;background:#fff;border:none;border-bottom:1px solid #f3f4f6;font-size:13px;cursor:pointer;color:#1f2937;">💾 导出全量备份（管理员）</button>' +
          '<button id="cloud-menu-logout" class="cloud-menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:#fff;border:none;font-size:13px;cursor:pointer;color:#dc2626;">🚪 退出登录</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);

    var mainBtn = document.getElementById('cloud-main-btn');
    var menu = document.getElementById('cloud-menu');
    var menuInfo = document.getElementById('cloud-menu-info');
    var btnUpload = document.getElementById('cloud-menu-upload');
    var btnDownload = document.getElementById('cloud-menu-download');
    var btnExport = document.getElementById('cloud-menu-export');
    var btnLogout = document.getElementById('cloud-menu-logout');

    function refreshStatus() {
      if (cloud.isLoggedIn()) {
        var rtx = getRtx();
        var s = null;
        for (var i = 0; i < SALES_LIST.length; i++) { if (SALES_LIST[i].rtx === rtx) { s = SALES_LIST[i]; break; } }
        var label = s ? (s.name + (s.is_admin ? '（管理员）' : '')) : rtx;
        mainBtn.innerHTML = '☁️ ' + label + ' <span style="font-size:10px;opacity:.7;">▾</span>';
        mainBtn.style.background = s && s.is_admin ? 'linear-gradient(135deg,#7c3aed,#5b21b6)' : 'linear-gradient(135deg,#059669,#047857)';
        mainBtn.style.color = '#fff';
        menuInfo.textContent = '当前身份：' + label;
        if (btnExport) btnExport.style.display = (s && s.is_admin) ? 'block' : 'none';
      } else {
        mainBtn.innerHTML = '🔐 登录云端';
        mainBtn.style.background = 'linear-gradient(135deg,#FF6B35,#F7931E)';
        mainBtn.style.color = '#fff';
        menuInfo.textContent = '未登录';
        if (btnExport) btnExport.style.display = 'none';
      }
    }
    refreshStatus();

    mainBtn.onclick = function (e) {
      e.stopPropagation();
      if (!cloud.isLoggedIn()) {
        showLoginModal(refreshStatus);
        return;
      }
      menu.style.display = (menu.style.display === 'none') ? 'block' : 'none';
    };
    document.addEventListener('click', function (e) {
      if (!bar.contains(e.target)) menu.style.display = 'none';
    });

    btnUpload.onclick = function () {
      menu.style.display = 'none';
      cloud.requireLogin(function () {
        var records = (typeof opts.getLocalRecords === 'function') ? opts.getLocalRecords() : [];
        if (!records.length) { showToast('本地没有要同步的记录', true); return; }
        if (!confirm('确认上传 ' + records.length + ' 条本地记录到云端？(同 id 会被覆盖)')) return;
        showToast('上传中...');
        cloud.upload(records).then(function (data) {
          showToast('✅ 已同步 created=' + data.created + ' updated=' + data.updated);
          refreshStatus();
        }).catch(function (e) { showToast('上传失败：' + e.message, true); });
      });
    };

    btnDownload.onclick = function () {
      menu.style.display = 'none';
      cloud.requireLogin(function () {
        if (!confirm('确认从云端拉取所有客户记录？\n会覆盖本地新登记但还没同步的数据，建议先点"同步本地到云端"再拉取。')) return;
        showToast('拉取中...');
        cloud.download().then(function (data) {
          var list = data.list || [];
          if (typeof opts.applyRemoteRecords === 'function') opts.applyRemoteRecords(list);
          showToast('✅ 已拉取 ' + list.length + ' 条');
          refreshStatus();
        }).catch(function (e) { showToast('拉取失败：' + e.message, true); });
      });
    };

    if (btnExport) btnExport.onclick = function () {
      menu.style.display = 'none';
      cloud.requireLogin(function () {
        showToast('导出中...');
        cloud.download().then(function (data) {
          var list = data.list || [];
          var blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'cloud_backup_' + new Date().toISOString().slice(0, 10) + '_' + list.length + '条.json';
          a.click();
          URL.revokeObjectURL(url);
          showToast('✅ 已导出 ' + list.length + ' 条云端记录');
        }).catch(function (e) { showToast('导出失败：' + e.message, true); });
      });
    };

    btnLogout.onclick = function () {
      menu.style.display = 'none';
      if (confirm('退出登录？\n（30 天免登的 token 将被清除，下次需要重新输密码）')) {
        cloud.logout();
        refreshStatus();
      }
    };

    cloud._refreshStatus = refreshStatus;
    return bar;
  }

  cloud.injectToolbar = injectToolbar;

  // ============== 暴露 ==============
  global.cloud = cloud;
  global.CloudSync = cloud;

  // 静默预热（仅当 localStorage 有 rtx + CloudBase token 时复用 token；否则等用户输密码）
  function autoInit() {
    var SDK = (typeof cloudbase !== 'undefined') ? cloudbase
            : (typeof tcb !== 'undefined') ? tcb
            : null;
    if (!SDK) return;
    var rtx = getRtx();
    if (!rtx) return;  // 没选过身份 → 等用户点登录
    try {
      var tmpApp = SDK.init({ env: ENV_ID });
      var tmpAuth = tmpApp.auth({ persistence: 'local' });
      if (tmpAuth.hasLoginState && tmpAuth.hasLoginState()) {
        // 有 token → 走「路径 2」复用，无需密码
        ensureReady(rtx).catch(function (e) {
          console.warn('[cloud] silent init warn:', e.message);
        });
      }
    } catch (e) {
      console.warn('[cloud] autoInit warn:', e.message);
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(autoInit, 0);
  } else {
    document.addEventListener('DOMContentLoaded', autoInit);
  }
})(window);
