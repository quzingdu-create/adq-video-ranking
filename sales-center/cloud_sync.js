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
  // B1 鉴权：每个销售一个 CloudBase 账号（邮箱+用户自定义密码）
  // 邮箱固定为 rtx@adq.tuoke；密码由销售首次输入，CloudBase token 持久化到 localStorage
  // 之后免登录直到 token 过期（默认 30 天）
  var AUTH_EMAIL_DOMAIN = '@adq.tuoke';
  function buildEmail(rtx) { return rtx + AUTH_EMAIL_DOMAIN; }
  var SALES_LIST = [
    { rtx: 'jonzhu',       name: 'Jonzhu' },
    { rtx: 'brownfan',     name: 'brownfan' },
    { rtx: 'kaikaigenli',  name: 'kaikaigenli' },
    { rtx: 'yvaineechen',  name: 'yvaineechen' },
    { rtx: 'lijunwu',      name: 'lijunwu' },
    { rtx: 'ruilingzhan',  name: 'ruilingzhan' },
    { rtx: 'kinsleyjin',   name: 'kinsleyjin', is_admin: true }
  ];

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
      return '<option value="' + s.rtx + '">' + s.name + (s.is_admin ? '（管理员）' : '') + ' · ' + s.rtx + '</option>';
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
      err.style.display = 'none';
      if (!rtx) { err.textContent = '请选择您的姓名'; err.style.display = 'block'; return; }
      if (!pwd) { err.textContent = '请输入密码'; err.style.display = 'block'; return; }
      // 关键：先 setRtx，再 ensureReady（带 rtx + 密码做首次登录）
      setRtx(rtx);
      ensureReady(rtx, pwd).then(function () {
        document.getElementById('cloud-login-pwd').value = '';
        modal.style.display = 'none';
        showToast('☁️ 已连接云端，rtx=' + rtx);
        if (cloud._afterLogin) { var cb = cloud._afterLogin; cloud._afterLogin = null; cb(); }
      }).catch(function (e) {
        clearRtx();
        var msg = e.message || '账号未注册或密码错误';
        if (msg.indexOf('USER_NOT_FOUND') >= 0 || msg.indexOf('not found') >= 0) msg = '账号还没建，找管理员开通';
        else if (msg.indexOf('PASSWORD') >= 0 || msg.indexOf('password') >= 0) msg = '密码错误，请重输';
        err.textContent = '登录失败：' + msg;
        err.style.display = 'block';
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
      var data = Object.assign({}, rec, { _rtx: getRtx() || '', _updatedAt: Date.now() });
      // 用 rec.id 当业务主键。先 where(id).get → 有则 update，无则 add
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
      if (!el) return;
      if (cloud.isLoggedIn()) {
        el.textContent = '☁️ ' + getRtx();
        el.style.color = '#166534';
        el.style.background = '#dcfce7';
      } else {
        el.textContent = '⚠️ 未连接';
        el.style.color = '#991b1b';
        el.style.background = '#fee2e2';
      }
    }
    refreshStatus();

    document.getElementById('cloud-btn-login').onclick = function () {
      if (cloud.isLoggedIn()) {
        if (confirm('当前已选 ' + getRtx() + '，是否切换/退出？')) {
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
        if (!confirm('确认上传 ' + records.length + ' 条本地记录到云端？(同 id 会被覆盖)')) return;
        showToast('上传中...');
        cloud.upload(records).then(function (data) {
          showToast('✅ 已同步 created=' + data.created + ' updated=' + data.updated);
          refreshStatus();
        }).catch(function (e) {
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
