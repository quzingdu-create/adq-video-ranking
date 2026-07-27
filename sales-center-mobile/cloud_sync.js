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
  var COLL_SESSIONS = 'user_sessions';
  var RTX_KEY = 'cloud_rtx_v2';
  // B1 鉴权：每个销售一个 CloudBase 账号（用户名+用户自定义密码）
  // CloudBase 用户名 = rtx 本身（如 jonzhu），密码由销售首次输入
  // CloudBase token 持久化到 localStorage，之后免登录直到 token 过期（默认 30 天）
  function buildEmail(rtx) { return rtx; }  // 直接用 rtx 当 username 登录
  var SALES_LIST = [
    { rtx: 'ziqingdu',     name: 'Ziqingdu',       is_admin: true },
    { rtx: 'kinsleyjin',   name: 'Kinsleyjin',    is_admin: true },
    { rtx: 'edcchen',      name: 'Edcchen',       is_admin: true },
    { rtx: 'jonzhu',       name: 'Jonzhu' },
    { rtx: 'grettazhao', name: 'Grettazhao' },
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
        reject(new Error('CloudBase SDK 未加载（可能是 CDN 被劫持/被防火墙拦截/被腾讯下架）。当前已改用 tcbjs/1.8.0；如仍失败，请检查浏览器 Network 面板里 tcb.js 是否 404/被拦截。'));
        return;
      }
      try {
        _app = SDK.init({ env: ENV_ID });
        // 关键修复（2026-05-21 19:30）：cloudbase v2 SDK 里 app.auth 是属性而不是函数
        // v1 (tcb.js 1.7.x): _app.auth({persistence:'local'}) - 调用得到 auth 对象
        // v2 (cloudbase-js-sdk latest): _app.auth - 直接是 auth 对象，方法是 signInWithPassword 且返回 {data, error}
        var authProp = _app.auth;
        var isV2 = (typeof authProp === 'object' && authProp && typeof authProp.signInWithPassword === 'function');
        if (isV2) {
          _auth = authProp;
          _isV2 = true;
        } else {
          _auth = _app.auth({ persistence: 'local' });
          _isV2 = false;
        }
        // 路径 1：已有有效 token（同 rtx）→ 直接走
        var hasState = false;
        try {
          if (_isV2) {
            // v2 用 getLoginState 异步检查；这里粗暴判断 localStorage 里有没有 token 标记
            hasState = !!localStorage.getItem('TCB_AUTH_STATE');
          } else if (_auth.hasLoginState) {
            hasState = !!_auth.hasLoginState();
          }
        } catch(_) { hasState = false; }
        if (hasState && targetRtx === _currentRtx) {
          _db = _isV2 ? (_app.database ? _app.database() : null) : _app.database();
          resolve();
          return;
        }
        if (hasState && targetRtx && !_currentRtx) {
          _currentRtx = targetRtx;
          _db = _isV2 ? (_app.database ? _app.database() : null) : _app.database();
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
        var loginP;
        if (_isV2) {
          // v2: signInWithPassword 返回 {data, error} 不抛错
          loginP = _auth.signInWithPassword({ username: email, password: password })
            .then(function (res) {
              if (res && res.error) {
                var er = new Error(res.error.message || res.error.errMsg || JSON.stringify(res.error));
                er.code = res.error.code || res.error.errCode || 'V2_LOGIN_ERROR';
                er.detail = res.error;
                throw er;
              }
              return res && res.data;
            });
        } else {
          loginP = _auth.signIn
            ? _auth.signIn({ username: email, password: password })
            : _auth.signInWithEmailAndPassword(email, password);
        }
        loginP.then(function () {
          _currentRtx = targetRtx;
          try { localStorage.setItem('TCB_AUTH_STATE', '1'); } catch(_) {}
          _db = _isV2 ? (_app.database ? _app.database() : null) : _app.database();
          resolve();
        }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
    return _readyPromise;
  }
  var _currentRtx = null;
  var _isV2 = false;

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
    t._timer = setTimeout(function () { t.style.display = 'none'; }, isErr ? 8000 : 2800);
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
        // 登录成功 → 记录 session
        try { sessionStart(); } catch(e) { console.warn('[session] start error', e); }
        if (cloud._afterLogin) { var cb = cloud._afterLogin; cloud._afterLogin = null; cb(); }
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '进入';
        // 失败也要重置，下次点击才能重试
        _readyPromise = null; _app = null; _auth = null; _db = null; _currentRtx = null;
        clearRtx();
        // 强力 debug：把 error 对象所有可见字段都序列化出来
        var rawMsg = (e && e.message) || '';
        var rawCode = (e && e.code) || (e && e.errCode) || (e && e.errorCode) || '';
        var rawName = (e && e.name) || '';
        var rawType = typeof e;
        var rawStr = '';
        try {
          // 把 error 对象的所有自有属性 + 原型链上的 message/name 都提出来
          var dump = {};
          if (e && typeof e === 'object') {
            Object.getOwnPropertyNames(e).forEach(function (k) {
              try { dump[k] = String(e[k]).slice(0, 200); } catch (_) {}
            });
            if (e.message) dump.message = String(e.message).slice(0, 200);
            if (e.name) dump.name = String(e.name);
          } else {
            dump.value = String(e);
          }
          rawStr = JSON.stringify(dump);
        } catch (_) {
          rawStr = String(e);
        }
        var hay = (rawCode + ' ' + rawMsg + ' ' + rawStr).toLowerCase();
        var msg = '账号未注册或密码错误';
        if (hay.indexOf('invalid_host') >= 0 || hay.indexOf('invalid http host') >= 0) {
          msg = '⚠️ CloudBase 后台没把 ' + location.host + ' 加入「Web 安全来源」白名单！\n请管理员去 console.cloud.tencent.com → 云开发 → 环境 → 环境设置 → 安全配置 → Web 应用安全域名，添加：' + location.origin;
        } else if (hay.indexOf('login mode is not supported') >= 0 || hay.indexOf('not_support') >= 0 || hay.indexOf('not enabled') >= 0 || hay.indexOf('未开启') >= 0) {
          msg = '⚠️ CloudBase 后台没开启"用户名密码登录"功能！请管理员去 console.cloud.tencent.com → 云开发 → 身份认证 → 登录方式 → 开启"用户名密码登录"';
        } else if (hay.indexOf('user_not_found') >= 0 || hay.indexOf('not found') >= 0 || hay.indexOf('user-not-found') >= 0 || hay.indexOf('username does not exist') >= 0 || hay.indexOf('账号不存在') >= 0) {
          msg = '⚠️ 账号还没在 CloudBase 后台建立。CloudBase 不支持直接"用户名+密码"注册，必须先用手机号/邮箱注册再绑定用户名';
        } else if (hay.indexOf('password') >= 0 || hay.indexOf('credentials') >= 0 || hay.indexOf('密码') >= 0) {
          msg = '密码错误，请重输';
        } else if (hay.indexOf('invalid') >= 0 || hay.indexOf('incorrect') >= 0) {
          msg = '账号或密码不正确';
        } else if (hay.indexOf('network') >= 0 || hay.indexOf('timeout') >= 0 || hay.indexOf('fetch') >= 0) {
          // 网络异常时主动 ping 一次后台，区分是 VPN 问题还是 INVALID_HOST 被包装
          msg = '⚠️ 网络异常或后台域名白名单未放行。请先确认：\n1) 网络畅通（CloudBase API 域名: tcb-api.tencentcloudapi.com）\n2) 当前域名 ' + location.origin + ' 已加入 CloudBase 后台「Web 应用安全域名」白名单';
        } else if (rawMsg) {
          msg = rawMsg;
        }
        err.innerHTML = '登录失败：' + msg
          + '<br><span style="font-size:11px;color:#999;display:block;margin-top:4px;word-break:break-all;">debug: type=' + rawType
          + ' | name=' + (rawName || 'N/A')
          + ' | code=' + (rawCode || 'N/A')
          + ' | msg=' + (rawMsg || 'N/A').slice(0, 80)
          + '<br>raw=' + (rawStr || 'N/A').slice(0, 250)
          + '</span>';
        err.style.display = 'block';
        try { console.error('[cloud] login failed', { code: rawCode, msg: rawMsg, name: rawName, dump: rawStr, originalError: e }); } catch(_) {}
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

  function uploadBatch(records, opts) {
    if (!records || !records.length) return Promise.resolve({ created: 0, updated: 0 });
    opts = opts || {};
    var concurrency = opts.concurrency || 10;
    var onProgress = opts.onProgress || null;
    return ensureReady().then(function () {
      var created = 0, updated = 0, failed = 0, done = 0;
      var queue = records.slice();
      var total = queue.length;
      function worker() {
        if (!queue.length) return Promise.resolve();
        var r = queue.shift();
        return upsertOne(r).then(function (x) {
          created += x.created || 0;
          updated += x.updated || 0;
        }).catch(function (err) {
          failed++;
          console.warn('[cloud] upsert fail id=' + (r && r.id), err && err.message);
        }).then(function () {
          done++;
          if (onProgress && (done % 50 === 0 || done === total)) {
            try { onProgress({ done: done, total: total, created: created, updated: updated, failed: failed }); } catch(_){}
          }
          return worker();
        });
      }
      var workers = [];
      for (var i = 0; i < concurrency; i++) workers.push(worker());
      return Promise.all(workers).then(function () {
        return { created: created, updated: updated, failed: failed, total: total };
      });
    });
  }

  function downloadAll(opts) {
    return ensureReady().then(function () {
      var coll = _db.collection(COLL_RECORDS);
      var query = coll;
      if (opts && opts.sale) {
        query = coll.where({ sale: opts.sale });
      }
      // 修复 2026-05-21 21:30：CloudBase JS SDK 客户端 limit 上限 = 100，不是 1000
      // 之前写 limit(1000) 会被静默截断为 100；实际云端可能只返 N 条但用户看到的"全量"包含本地 RECORDS
      var PAGE_SIZE = 100;
      var all = [];
      function page(skip) {
        return query.skip(skip).limit(PAGE_SIZE).get().then(function (res) {
          var got = (res.data || []);
          all = all.concat(got);
          if (got.length === PAGE_SIZE) {
            return page(skip + PAGE_SIZE);
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

  // ============== 用户登录统计 API（登录次数 + 有效浏览/操作时长） ==============
  var __currentSessionId = null;
  var __heartbeatTimer = null;
  var __lastActivityTime = null;      // 最后真实操作时间：click/keyup/scroll/可见切回
  var __lastDurationTickTime = null;  // 上一次累计有效时长的时间点
  var __activeDurationSec = 0;        // 逐段累计的有效浏览/操作秒数
  var __visibilityHiddenSince = null; // 页面隐藏起点（用于暂停计时）
  var __activityListenersAdded = false;
  var __unloadListenersAdded = false;
  var ACTIVE_WINDOW_MS = 2 * 60 * 1000;
  var HEARTBEAT_MS = 30 * 1000;

  function _dateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function _safeInt(v, fallback) {
    var n = parseInt(v, 10);
    return isFinite(n) ? n : (fallback || 0);
  }
  // Q1 (2026-07-03): 简易 hash (djb2), 用于生成 idempotencyKey
  function _hashStr(s) {
    s = String(s || '');
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h = h & 0xffffffff; }
    return Math.abs(h).toString(36);
  }
  function _isPageVisible() {
    return typeof document.visibilityState === 'undefined' || document.visibilityState !== 'hidden';
  }
  function _syncActiveDuration(now, forceVisible) {
    now = now || Date.now();
    if (!__lastDurationTickTime) {
      __lastDurationTickTime = now;
      return __activeDurationSec;
    }
    var visible = forceVisible || _isPageVisible();
    var inActiveWindow = !!__lastActivityTime && (now - __lastActivityTime) <= ACTIVE_WINDOW_MS;
    if (visible && inActiveWindow) {
      var deltaMs = Math.max(0, now - __lastDurationTickTime);
      // 防止电脑休眠/定时器阻塞后一次性补出异常大时长
      deltaMs = Math.min(deltaMs, HEARTBEAT_MS);
      __activeDurationSec = __activeDurationSec + Math.round(deltaMs / 1000);
    }
    __lastDurationTickTime = now;
    return __activeDurationSec;
  }
  function _updateCachedSession(now) {
    try {
      var cached = localStorage.getItem('__cloud_session_current__');
      if (!cached) return null;
      var d = JSON.parse(cached);
      d.lastActiveTime = now;
      d.lastActivityTime = __lastActivityTime || now;
      d.activeDurationSec = __activeDurationSec;
      d.duration = __activeDurationSec; // 兼容旧展示：duration 同步写为真实累计有效秒数
      localStorage.setItem('__cloud_session_current__', JSON.stringify(d));
      return d;
    } catch(_) {
      return null;
    }
  }
  function _persistSessionSnapshot(now) {
    if (!__currentSessionId) return;
    now = now || Date.now();
    _syncActiveDuration(now);
    _updateCachedSession(now);
    ensureReady().then(function () {
      var coll = _db.collection(COLL_SESSIONS);
      coll.where({ sessionId: __currentSessionId }).get().then(function (res) {
        if (res.data && res.data.length) {
          var docId = res.data[0]._id;
          coll.doc(docId).update({
            lastActiveTime: now,
            lastActivityTime: __lastActivityTime || now,
            activeDurationSec: __activeDurationSec,
            duration: __activeDurationSec,
            activeWindowMs: ACTIVE_WINDOW_MS,
            _updatedAt: now
          }).catch(function(){});
        }
      }).catch(function(){});
    }).catch(function(){});
  }
  function sessionStart() {
    var rtx = getRtx();
    if (!rtx) return Promise.resolve();
    var now = Date.now();

    // 5分钟内有活跃 session 则复用，避免刷新页面重复创建
    try {
      var raw = localStorage.getItem('__cloud_session_current__');
      if (raw) {
        var old = JSON.parse(raw);
        if (old.sessionId && old.lastActiveTime && (now - old.lastActiveTime) < 5 * 60 * 1000) {
          __currentSessionId = old.sessionId;
          __activeDurationSec = _safeInt(old.activeDurationSec, _safeInt(old.duration, 0));
          __lastActivityTime = now;
          __lastDurationTickTime = now;
          old.lastActiveTime = now;
          old.lastActivityTime = now;
          old.activeDurationSec = __activeDurationSec;
          old.duration = __activeDurationSec;
          localStorage.setItem('__cloud_session_current__', JSON.stringify(old));
          if (__heartbeatTimer) clearInterval(__heartbeatTimer);
          __heartbeatTimer = setInterval(sessionHeartbeat, HEARTBEAT_MS);
          _bindActivityListeners();
          _bindVisibility();
          _bindUnloadListeners();
          console.log('[session] reuse existing session', old.sessionId);
          return Promise.resolve();
        }
      }
    } catch(_) {}

    __currentSessionId = 'sess_' + now + '_' + Math.random().toString(36).slice(2, 8);
    __activeDurationSec = 0;
    __lastActivityTime = now;
    __lastDurationTickTime = now;
    var data = {
      rtx: rtx,
      sessionId: __currentSessionId,
      loginTime: now,
      lastActiveTime: now,
      lastActivityTime: now,
      duration: 0,
      activeDurationSec: 0,
      activeWindowMs: ACTIVE_WINDOW_MS,
      deviceInfo: (navigator.userAgent || '').slice(0, 200),
      date: _dateStr(),
      _createdAt: now
    };
    try { localStorage.setItem('__cloud_session_current__', JSON.stringify(data)); } catch(_) {}
    if (__heartbeatTimer) clearInterval(__heartbeatTimer);
    __heartbeatTimer = setInterval(sessionHeartbeat, HEARTBEAT_MS);
    _bindActivityListeners();
    _bindVisibility();
    _bindUnloadListeners();
    return ensureReady().then(function () {
      var coll = _db.collection(COLL_SESSIONS);
      return coll.add(data).catch(function (e) {
        console.warn('[session] start fail:', e && e.message);
      });
    }).catch(function () { /* 未登录云端时不阻断 */ });
  }
  function sessionHeartbeat() {
    if (!__currentSessionId) return;
    _persistSessionSnapshot(Date.now());
  }
  function sessionEnd() {
    if (!__currentSessionId) return Promise.resolve();
    if (__heartbeatTimer) { clearInterval(__heartbeatTimer); __heartbeatTimer = null; }
    var now = Date.now();
    _syncActiveDuration(now, true);
    var sid = __currentSessionId;
    var cached = _updateCachedSession(now);
    var lastActivityTime = (cached && cached.lastActivityTime) || __lastActivityTime || now;
    var durationSec = __activeDurationSec || 0;
    var data = {
      lastActiveTime: now,
      lastActivityTime: lastActivityTime,
      activeDurationSec: durationSec,
      duration: durationSec,
      activeWindowMs: ACTIVE_WINDOW_MS,
      _updatedAt: now
    };
    __currentSessionId = null;
    __lastDurationTickTime = null;
    try { localStorage.removeItem('__cloud_session_current__'); } catch(_) {}
    return ensureReady().then(function () {
      var coll = _db.collection(COLL_SESSIONS);
      return coll.where({ sessionId: sid }).get().then(function (res) {
        if (res.data && res.data.length) {
          var docId = res.data[0]._id;
          return coll.doc(docId).update(data);
        }
      }).catch(function (e) {
        console.warn('[session] end fail:', e && e.message);
      });
    }).catch(function(){});
  }
  function _onUserActivity() {
    var now = Date.now();
    _syncActiveDuration(now);
    if (__lastActivityTime && (now - __lastActivityTime) < 10000) return;
    __lastActivityTime = now;
    _updateCachedSession(now);
  }
  function _bindActivityListeners() {
    if (__activityListenersAdded) return;
    __activityListenersAdded = true;
    document.addEventListener('click', _onUserActivity, true);
    document.addEventListener('keyup', _onUserActivity, true);
    document.addEventListener('scroll', _onUserActivity, true);
  }
  function _onVisibilityChange() {
    var now = Date.now();
    if (document.visibilityState === 'hidden') {
      _syncActiveDuration(now, true);
      _updateCachedSession(now);
      __visibilityHiddenSince = now;
    } else {
      __visibilityHiddenSince = null;
      __lastDurationTickTime = now;
      _onUserActivity();
    }
  }
  function _bindVisibility() {
    if (typeof document.visibilityState !== 'undefined') {
      document.addEventListener('visibilitychange', _onVisibilityChange);
    }
  }
  function _bindUnloadListeners() {
    if (__unloadListenersAdded) return;
    __unloadListenersAdded = true;
    window.addEventListener('pagehide', function () { try { _persistSessionSnapshot(Date.now()); } catch(e) {} });
    window.addEventListener('beforeunload', function () { try { _persistSessionSnapshot(Date.now()); } catch(e) {} });
  }
  function sessionQuery(opts) {
    opts = opts || {};
    return ensureReady().then(function () {
      var coll = _db.collection(COLL_SESSIONS);
      var w = {};
      if (opts.rtx) w.rtx = opts.rtx;
      if (opts.date) w.date = opts.date;
      var query = Object.keys(w).length ? coll.where(w) : coll;
      if (opts.from || opts.to) {
        var _ = _db.command;
        var dateCond = null;
        if (opts.from && opts.to) dateCond = _.gte(opts.from).and(_.lte(opts.to));
        else if (opts.from) dateCond = _.gte(opts.from);
        else dateCond = _.lte(opts.to);
        var w2 = Object.assign({}, w, { date: dateCond });
        query = coll.where(w2);
      }
      return query.orderBy('loginTime', 'desc').limit(opts.limit || 1000).get().then(function (res) {
        var list = res.data || [];
        var stats = { totalSessions: list.length, totalDuration: 0, byDate: {} };
        list.forEach(function(r) {
          var effectiveDuration = _safeInt(r.activeDurationSec, 0);
          if (effectiveDuration <= 0) {
            effectiveDuration = _safeInt(r.duration, 0);
            if (effectiveDuration <= 0 && r.lastActivityTime && r.loginTime) {
              effectiveDuration = Math.max(0, Math.round((r.lastActivityTime - r.loginTime) / 1000));
            }
            effectiveDuration = Math.min(effectiveDuration, 30 * 60);
          }
          r.effectiveDuration = effectiveDuration;
          stats.totalDuration += effectiveDuration;
          var d = r.date || _dateStr(new Date(r.loginTime));
          if (!stats.byDate[d]) stats.byDate[d] = { count: 0, duration: 0 };
          stats.byDate[d].count++;
          stats.byDate[d].duration += effectiveDuration;
        });
        return { list: list, stats: stats };
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
      // 退出前结束当前 session
      try { sessionEnd(); } catch(e) {}
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

    // 复用同一登录态的数据库句柄（供 pursuit.html 等附属页共享同一 CloudBase 实例，避免各自 init 导致登录态丢失）
    // 用法：cloud.getDb().then(db => db.collection('pursuit_customers').get())
    getDb: function () {
      return ensureReady().then(function () {
        if (!_db) return Promise.reject(new Error('数据库句柄未就绪'));
        return _db;
      });
    },
    getApp: function () { return ensureReady().then(function () { return _app; }); },

    // 调用云函数（用于 exportAll 等管理员接口，绕开行级安全规则）
    // 用法：cloud.callFunction('exportAll', {}).then(res => res.records)
    callFunction: function (name, data) {
      return ensureReady().then(function () {
        if (!_app || !_app.callFunction) {
          return Promise.reject(new Error('SDK 不支持 callFunction（请检查 SDK 版本）'));
        }
        return _app.callFunction({ name: name, data: data || {} }).then(function (r) {
          // v1/v2 SDK 返回结构：{ result: {...} }
          return r && r.result !== undefined ? r.result : r;
        });
      });
    },

    // Q1+Q2+Q3 (2026-07-03): salesCenterApi 统一入口, 自动注入 traceId + idempotencyKey
    // 用法: cloud.callApi('checkBrandLimit', { brand: 'X' })
    // 用法: cloud.callApi('upsertRecord', { record: {...} }, { idempotencyKey: 'reg:abc123' })
    // 返回: 云函数返回结果 { ok, action, data, meta:{traceId,replayed?,...} }
    callApi: function (action, params, options) {
      params = params || {}; options = options || {};
      // 生成 traceId (前端优先, 云端 fallback)
      var traceId = params.traceId || options.traceId || ('t_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));
      // 幂等键(仅写操作有意义, 由调用方或自动生成)
      var WRITE_ACTIONS = ['upsertRecord','deleteRecord','registerCustomer','updateAttribution','updateProgress','bulkImportCustomers','writeKpiSnapshot','uploadBlobSubCollection'];
      var isWrite = WRITE_ACTIONS.indexOf(action) >= 0;
      var idempotencyKey = params.idempotencyKey || options.idempotencyKey || '';
      if (isWrite && !idempotencyKey) {
        // 自动生成: action + 关键字段 hash + 分钟窗口(避免用户误双击时被 24h 缓存拦掉真正的重试)
        var seed = [
          action,
          params.name || params.primaryName || (params.record && (params.record.name || params.record.shortName)) || '',
          params.shortName || (params.record && params.record.shortName) || '',
          params.sale || (params.record && params.record.sale) || '',
          params._id || (params.record && params.record._id) || '',
          Math.floor(Date.now() / 60000)  // 分钟窗
        ].join('|');
        idempotencyKey = 'auto_' + _hashStr(seed);
      }
      var enriched = Object.assign({}, params, { traceId: traceId });
      if (idempotencyKey) enriched.idempotencyKey = idempotencyKey;
      // 调用云函数
      return this.callFunction('salesCenterApi', { action: action, params: enriched }).then(function (r) {
        // 记入前端调试队列(可选,方便控制台排错)
        try {
          window.__SC_LAST_API__ = { action: action, traceId: traceId, idempotencyKey: idempotencyKey, ok: !!(r && r.ok), ts: Date.now() };
        } catch(_) {}
        return r;
      });
    },
    getTraceId: function () { return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); },

    kpi: {
      upsert: kpiUpsert,
      query: kpiQuery
    },

    session: {
      start: sessionStart,
      end: sessionEnd,
      heartbeat: sessionHeartbeat,
      query: sessionQuery
    },

    isAdmin: isAdmin,
    getSalesList: getSalesList,
    toast: showToast
  };

  // ============== 顶栏按钮注入（合并下拉版） ==============
  function injectToolbar(opts) {
    opts = opts || {};
    // 🦞 修复 2026-05-24：iframe 子页跳过注入，避免主页 + 子页各注入一个 → 出现两个管理员按钮
    try { if (window !== window.top) return null; } catch (e) { /* 跨域 frame：当作子页，跳过 */ return null; }
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
          '<button id="cloud-menu-upload" class="cloud-menu-item" style="display:none;width:100%;text-align:left;padding:10px 14px;background:#fff;border:none;border-bottom:1px solid #f3f4f6;font-size:13px;cursor:pointer;color:#1f2937;">⬆️ 补推未同步记录</button>' +
          '<button id="cloud-menu-export-all" class="cloud-menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:#fff;border:none;border-bottom:1px solid #f3f4f6;font-size:13px;cursor:pointer;color:#2563eb;font-weight:600;">⬇️ 拓新组登记客户明细（全量）</button>' +
          '<button id="cloud-menu-export-new" class="cloud-menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:#fff;border:none;border-bottom:1px solid #f3f4f6;font-size:13px;cursor:pointer;color:#10b981;font-weight:600;">⬇️ 25Q3-26Q3新客明细</button>' +
          '<button id="cloud-menu-export" class="cloud-menu-item" style="display:none;width:100%;text-align:left;padding:10px 14px;background:#fff;border:none;border-bottom:1px solid #f3f4f6;font-size:13px;cursor:pointer;color:#1f2937;">💾 导出全量备份（管理员）</button>' +
          '<button id="cloud-menu-logout" class="cloud-menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:#fff;border:none;font-size:13px;cursor:pointer;color:#dc2626;">🚪 退出登录</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);

    var mainBtn = document.getElementById('cloud-main-btn');
    var menu = document.getElementById('cloud-menu');
    var menuInfo = document.getElementById('cloud-menu-info');
    var btnUpload = document.getElementById('cloud-menu-upload');
    var btnDownload = null; // 已删除「下载云端登记名单 (33 条)」入口；用 btnExportAll/btnExportNew 替代
    var btnExportAll = document.getElementById('cloud-menu-export-all');
    var btnExportNew = document.getElementById('cloud-menu-export-new');
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
        if (btnUpload) btnUpload.style.display = (typeof opts.getLocalRecords === 'function') ? 'block' : 'none';
        if (btnExport) btnExport.style.display = (s && s.is_admin) ? 'block' : 'none';
      } else {
        mainBtn.innerHTML = '🔐 登录云端';
        mainBtn.style.background = 'linear-gradient(135deg,#FF6B35,#F7931E)';
        mainBtn.style.color = '#fff';
        menuInfo.textContent = '未登录';
        if (btnUpload) btnUpload.style.display = 'none';
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
        // 跳过已成功上云的 id（避免每次重推 5900+）
        var SYNCED_KEY = 'cloud_synced_ids_v1';
        var syncedIds = {};
        try { syncedIds = JSON.parse(localStorage.getItem(SYNCED_KEY) || '{}') || {}; } catch(_){ syncedIds = {}; }
        var pending = records.filter(function(r){ return r && r.id != null && !syncedIds[r.id]; });
        var skipCount = records.length - pending.length;
        var msg = '本地共 ' + records.length + ' 条，已上云 ' + skipCount + ' 条，待同步 ' + pending.length + ' 条。\n确认开始上传？(同 id 会被覆盖，10 并发，约 ' + Math.ceil(pending.length / 30) + ' 秒)';
        if (!pending.length) {
          if (!confirm('本地全部 ' + records.length + ' 条都已上云。\n点确定将强制重推（耗时较长）。')) return;
          pending = records;
        } else if (!confirm(msg)) return;

        showToast('上传中 0 / ' + pending.length);
        var startTime = Date.now();
        cloud.upload(pending, {
          concurrency: 10,
          onProgress: function(p){
            showToast('上传中 ' + p.done + ' / ' + p.total + ' (✓' + (p.created + p.updated) + ' ✗' + p.failed + ')');
          }
        }).then(function (data) {
          // 写回成功 id 缓存
          var newSynced = Object.assign({}, syncedIds);
          pending.forEach(function(r){ if (r && r.id != null) newSynced[r.id] = 1; });
          try { localStorage.setItem(SYNCED_KEY, JSON.stringify(newSynced)); } catch(_){}
          var sec = Math.round((Date.now() - startTime) / 1000);
          showToast('✅ 完成 created=' + data.created + ' updated=' + data.updated + (data.failed ? ' 失败=' + data.failed : '') + ' 耗时 ' + sec + 's');
          refreshStatus();
        }).catch(function (e) { showToast('上传失败：' + e.message, true); });
      });
    };

    btnDownload && (btnDownload.onclick = function () {
      menu.style.display = 'none';
      cloud.requireLogin(function () {
        if (!confirm('确认下载全量登记名单？\n= 云端记录 ∪ 页面已加载的拓客底表（5900+），按 id 去重\n会下载到本地为 .xlsx 文件，同时刷新页面登记列表。')) return;
        showToast('拉取中...');
        cloud.download().then(function (data) {
          var cloudList = data.list || [];
          // Step 1: 应用到页面记忆
          if (typeof opts.applyRemoteRecords === 'function') opts.applyRemoteRecords(cloudList);
          // Step 2: 合并云端 + 本地 RECORDS（页面已加载的全量底表 5900+）
          var localRecs = [];
          try {
            if (typeof opts.getLocalRecords === 'function') {
              localRecs = opts.getLocalRecords() || [];
            } else if (typeof window.RECORDS !== 'undefined' && Array.isArray(window.RECORDS)) {
              localRecs = window.RECORDS;
            }
          } catch (_) { localRecs = []; }
          // 去重：以 id 为 key，云端优先（云端是最新的），本地兜底（云端没的本地有）
          var byId = {};
          cloudList.forEach(function (r) { if (r && r.id != null) byId[r.id] = r; });
          var added = 0;
          localRecs.forEach(function (r) {
            if (r && r.id != null && !byId[r.id]) { byId[r.id] = r; added++; }
          });
          var merged = Object.keys(byId).map(function (k) { return byId[k]; });
          // Step 3: 直接导出 .xlsx 文件给用户
          try {
            exportRecordsToXlsx(merged);
            showToast('✅ 云端 ' + cloudList.length + ' + 本地补 ' + added + ' = 全量 ' + merged.length + ' 条已下载');
          } catch (err) {
            console.error('导出失败', err);
            exportRecordsToCsv(merged);
            showToast('✅ 全量 ' + merged.length + ' 条（.xlsx 库未加载，降级 .csv）');
          }
          refreshStatus();
        }).catch(function (e) { showToast('拉取失败：' + e.message, true); });
      });
    });

    // 新增：拓新组登记客户明细（全量）— 优先点击 DOM 按钮，回退到 window.__exec_*
    if (btnExportAll) btnExportAll.onclick = function () {
      menu.style.display = 'none';
      var hiddenBtn = document.getElementById('btnExportTuokeAll');
      if (hiddenBtn) { hiddenBtn.click(); return; }
      if (typeof window.__exec_btnExportTuokeAll === 'function') { window.__exec_btnExportTuokeAll(); return; }
      showToast('export_tuoke.js 未加载，请刷新页面', true);
    };

    // 新增：25Q3-26Q3 新客明细 — 同上
    if (btnExportNew) btnExportNew.onclick = function () {
      menu.style.display = 'none';
      var hiddenBtn = document.getElementById('btnExportTuokeNew');
      if (hiddenBtn) { hiddenBtn.click(); return; }
      if (typeof window.__exec_btnExportTuokeNew === 'function') { window.__exec_btnExportTuokeNew(); return; }
      showToast('export_tuoke.js 未加载，请刷新页面', true);
    };

    function fixRegYearForExport(d) {
      var s = String(d || '').slice(0, 10);
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return d || '';
      var mon = Number(m[2]);
      if (mon >= 7 && mon <= 12) return '2025-' + m[2] + '-' + m[3];
      if (mon >= 1 && mon <= 6) return '2026-' + m[2] + '-' + m[3];
      return d || '';
    }

    function exportRecordsToXlsx(list) {
      // 2026-06-13 性能优化：xlsx 改按需加载，导出前确保库已就绪
      if (typeof XLSX === 'undefined') {
        if (typeof window.ensureXLSX === 'function') {
          window.ensureXLSX().then(function () { exportRecordsToXlsx(list); })
            .catch(function (e) { alert('xlsx 库加载失败：' + e.message); });
          return;
        }
        throw new Error('XLSX 库未加载');
      }
      var headers = [
        '序号','登记日期','销售','客户主体','客户简称',
        '新老客身份','客户标签','是否新锐',
        '类目','在投链路','拓客途径','资源方','客户来源',
        '产业带区域','主营品牌',
        '是否在投','首投日期',
        '字典命中','数据来源',
        '授权书(张)','建联截图(张)','备注','记录ID'
      ];
      var sorted = list.slice().sort(function (a, b) {
        return (fixRegYearForExport(a.date) + '').localeCompare(fixRegYearForExport(b.date) + '')
            || ((a.sales || '') + '').localeCompare((b.sales || '') + '');
      });
      var aoa = [headers];
      sorted.forEach(function (r, idx) {
        var isLaoke = (r.isLaoke !== undefined) ? r.isLaoke
                      : (r.old24 === true);
        var rising = (r.rising === '是' || r.status === '新锐') ? '是' : '否';
        var xinlao = isLaoke ? '非本季度新客' : '新客';
        var tag    = r.status || (rising === '是' ? '新锐' : (isLaoke ? '存量' : '新客'));
        var matched= (r.matched === true) ? '命中' : (r.matched === false ? '未命中(待回扫)' : '');
        var invested = r.invested === '是' ? '是' : (r.invested === '否' ? '否' : '');
        var src    = r._preloaded ? '历史登记(种子)' : (r._bulkImport ? '批量导入' : (r._cloud ? '云端' : '页面新增'));
        aoa.push([
          idx + 1,
          fixRegYearForExport(r.date),
          r.sales || '',
          r.name || '',
          r.shortName || '',
          xinlao,
          tag,
          rising,
          r.category || '',
          Array.isArray(r.links) ? r.links.join('+') : '',
          r.channel || '',
          r.resource || '',
          r.source || '',
          r.region || '',
          r.brand || '',
          invested,
          r.firstDate || '',
          matched,
          src,
          (r.authImages || []).length,
          (r.images || []).length,
          r.remark || '',
          r.id || ''
        ]);
      });
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [
        {wch:5},{wch:12},{wch:14},{wch:34},{wch:20},
        {wch:14},{wch:8},{wch:8},
        {wch:12},{wch:14},{wch:14},{wch:14},{wch:18},
        {wch:14},{wch:18},
        {wch:8},{wch:12},
        {wch:14},{wch:16},
        {wch:10},{wch:10},{wch:24},{wch:14}
      ];
      ws['!freeze'] = { xSplit: 0, ySplit: 1 };
      var lastCol = String.fromCharCode(64 + headers.length);
      ws['!autofilter'] = { ref: 'A1:' + lastCol + '1' };

      // 概览 sheet
      var salesAgg = {};
      sorted.forEach(function (r) {
        var k = r.sales || '(未分配)';
        salesAgg[k] = (salesAgg[k] || 0) + 1;
      });
      var ovRows = [['统计项','数值'],
        ['导出时间', new Date().toLocaleString('zh-CN', {hour12:false})],
        ['全量记录数', sorted.length],
        ['——','——']];
      Object.keys(salesAgg).sort().forEach(function (s) { ovRows.push(['销售-' + s, salesAgg[s]]); });
      var wsOv = XLSX.utils.aoa_to_sheet(ovRows);
      wsOv['!cols'] = [{wch:24},{wch:14}];

      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '拓客全量登记');
      XLSX.utils.book_append_sheet(wb, wsOv, '概览');
      var ts = new Date().toISOString().slice(0,10);
      XLSX.writeFile(wb, '拓客全量登记_' + ts + '_' + sorted.length + '条.xlsx');
    }

    function exportRecordsToCsv(list) {
      var headers = ['序号','登记日期','销售','客户主体','客户简称','新老客','类目','拓客途径','资源方','客户来源','是否新锐','备注'];
      var rows = list.map(function (r, idx) {
        var isLaoke = !!(r.isLaoke || r.old24);
        var rising = (r.rising === '是' || r.status === '新锐') ? '是' : '否';
        return [
          idx + 1, fixRegYearForExport(r.date), r.sales || '', r.name || '', r.shortName || '',
          isLaoke ? '非本季度新客' : '新客', r.category || '', r.channel || '',
          r.resource || '', r.source || '', rising, r.remark || ''
        ];
      });
      var csv = '\ufeff' + [headers].concat(rows).map(function (row) {
        return row.map(function (v) { return '"' + String(v).replace(/"/g,'""') + '"'; }).join(',');
      }).join('\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '拓客全量登记_' + new Date().toISOString().slice(0,10) + '_' + list.length + '条.csv';
      a.click();
    }

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
        ensureReady(rtx).then(function () {
          // 静默复用 token 成功 → 也记 session
          try { sessionStart(); } catch(e) {}
        }).catch(function (e) {
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
