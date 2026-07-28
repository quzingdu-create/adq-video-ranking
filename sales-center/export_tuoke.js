/* 拓新组双导出按钮 — 公共逻辑 v1.5（2026-07-13）
 * 用法：每个页面 (index.html / kanban_embed.html / register_v3.2.html / mobile.html) 都需要：
 *   1. 加载 lib_loader.js（导出前按需加载 xlsx）
 *   2. 引入本文件 export_tuoke.js
 *   3. 页面 DOM 含两个隐藏 button: #btnExportTuokeAll + #btnExportTuokeNew
 *      （cloud_sync.js 注入的下拉菜单会代理 click 这两个隐藏按钮）
 *
 * 数据口径：
 *   - 全量「拓新组登记客户明细」：window.__TUOKE_REAL_RECORDS__ 全部 (14631 登记表口径)
 *     表头 18 列 = 登记日期/销售/主体/简称/首投季度/是否新客/有效/新锐/链路（手填）/投放端（AData）
 *                /类目/拓客途径/拓客来源/商品消费链路/链路日耗/全域通日耗/ADQ日耗/综合投放端
 *   - 新客「25Q3-26Q3新客明细」：data/kanban_new_customer_view.js 大盘视图 (30402 / 与 KPI 卡 8142 同源)
 *     表头 6 列 = 客户简称 / 登记销售 / 首投季度 / 是否新客 / 是否有效 / 是否新锐
 *
 * 2026-06-15 修复1：PC / mobile 首屏提速后不再同步加载 tuoke_real_records.js，
 * 点击右上角下载时必须先按需加载 data/tuoke_real_records.js，再生成 xlsx。
 * 2026-06-15 修复2：登记日期按业务口径修正，月份 7-12 一律归 2025 年，月份 1-6 一律归 2026 年。
 * 2026-06-30 修复3：新客明细按钮改为读 kanban_new_customer_view.js 大盘视图（与 KPI 卡 8142 同源）。
 * 2026-06-30 修复4：登记表明细新增 5 列（商品消费链路/链路日耗/全域通日耗/ADQ日耗/综合投放端），
 *                  来源 = enrich_tuoke_with_link_delivery.py 把每日 链路/全域通/adq 三份CSV
 *                  按客户简称 left-join 进 tuoke_real_records.js。
 */
(function () {
  if (window.__EXPORT_TUOKE_BOUND__) return;
  window.__EXPORT_TUOKE_BOUND__ = true;

  var HEADERS = ['登记日期','销售名称','客户主体','客户简称','首投季度','是否新客','是否有效','是否新锐','链路（手填）','投放端（AData）','类目','拓客途径','拓客来源','商品消费链路','链路日耗','全域通日耗','ADQ日耗','综合投放端'];
  var NEW_VIEW_HEADERS = ['客户简称','登记销售','首投季度','是否新客','是否有效','是否新锐'];
  var EXPORT_FALLBACK_VERSION = '20260622c';
  var _tuokePromise = null;
  var _newViewPromise = null;
  var _scriptState = window.__EXPORT_TUOKE_SCRIPT_STATE__ = window.__EXPORT_TUOKE_SCRIPT_STATE__ || {};

  function toast(msg, isError) {
    try {
      if (window.cloud && typeof window.cloud.toast === 'function') {
        window.cloud.toast(msg, !!isError);
        return;
      }
    } catch (e) {}
    if (isError) console.warn('[export_tuoke]', msg);
    else console.log('[export_tuoke]', msg);
  }

  function currentVersion() {
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].getAttribute('src') || '';
        var m = /export_tuoke\.js\?v=([^&]+)/.exec(src);
        if (m && m[1]) return m[1];
      }
    } catch (e) {}
    return EXPORT_FALLBACK_VERSION;
  }

  function loadScriptOnce(src) {
    if (_scriptState[src]) return _scriptState[src];
    _scriptState[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error('数据脚本加载失败: ' + src)); };
      document.head.appendChild(s);
    });
    return _scriptState[src];
  }

  // R11.9 (2026-07-01): 下载前合并云端 T-0 新登记 (含今天销售登记的)
  // 之前: 只读 tuoke_real_records.js 静态 T-1 快照 → 同事下载看不到今天登记 → 打脸
  // 现在: 静态 + 云端 tuoke_records 全量 + 云端 tuoke_user_records 增量（销售新登记）三合一, 按 _id 去重合并
  // 2026-07-28 Round 11 P0 根治: 销售登记走 saveUserRecord 写到 tuoke_user_records 集合，
  //   老 exportAllRecords 只拉 tuoke_records → 义乌市伊谨等今天登记的客户永远不在下载 excel 里
  //   → 新增 fetchCloudUserRecords 拉 tuoke_user_records 并合并
  function fetchCloudRecentTuoke() {
    if (!window.cloud || typeof window.cloud.callFunction !== 'function') {
      return Promise.resolve([]);
    }
    // 拉云端全量 tuoke_records (与 exportAllRecords 云函数对齐), 无 cursor 从头拉
    var acc = [];
    function pullPage(cursor) {
      var params = { pageSize: 2000 };
      if (cursor) params.cursor = cursor;
      return window.cloud.callFunction('salesCenterApi', {
        action: 'exportAllRecords',
        params: params
      }).then(function (r) {
        // 2026-07-28 Round 9-i: CloudBase SDK 1.8.0 返回结构双兼容 (r.result 可能缺失)
        var body = (r && r.result && typeof r.result === 'object') ? r.result : (r || {});
        if (!body.ok) return acc;
        var data = body.data || {};
        var rows = data.rows || [];
        acc = acc.concat(rows);
        // 🦞 2026-07-27 Bug3 修复：pageSize 1000→2000 已在 params；上限 50000→200000 防截断
        if (data.hasMore && data.nextCursor && acc.length < 200000) {
          return pullPage(data.nextCursor);
        }
        return acc;
      });
    }
    return pullPage(null).catch(function (err) {
      console.warn('[export_tuoke] 拉云端 tuoke_records 失败, 用静态兜底:', err);
      return [];
    });
  }

  // 2026-07-28 Round 11 P0 根治: 拉 tuoke_user_records (销售登记直写的集合)
  function fetchCloudUserRecords() {
    if (!window.cloud || typeof window.cloud.callFunction !== 'function') {
      return Promise.resolve([]);
    }
    return window.cloud.callFunction('salesCenterApi', {
      action: 'listUserRecords',
      params: { limit: 5000 }
    }).then(function (r) {
      var body = (r && r.result && typeof r.result === 'object') ? r.result : (r || {});
      if (!body.ok) return [];
      var data = body.data || {};
      var rows = data.records || [];
      console.info('[export_tuoke] Round 11: 拉 tuoke_user_records = ' + rows.length + ' 条');
      return rows;
    }).catch(function (err) {
      console.warn('[export_tuoke] 拉云端 tuoke_user_records 失败:', err);
      return [];
    });
  }

  // 2026-07-28 Round 11: 拓新组销售白名单 - 全局共享给静态兜底路径
  var TUOKE_WHITELIST_R11 = { 'kaikaigenli':1, 'Jonzhu':1, 'lijunwu':1, 'yvaineechen':1, 'ruilingzhan':1, 'kinsleyjin':1 };
  function applyTuokeWhitelistAndDateFill(rows) {
    var before = rows.length;
    var out = rows.filter(function(r){
      if (!r) return false;
      var _nm = (r.name || '') + '', _sn = (r.shortName || '') + '';
      if (_nm.indexOf('__诊断测试__') >= 0 || _sn.indexOf('__诊断测试__') >= 0) return false;
      if (r.source === 'diag' || (r.id && String(r.id).indexOf('diag_') === 0)) return false;
      var _sale = (r.sale || r._rtx || r._recorded_by || '') + '';
      return TUOKE_WHITELIST_R11[_sale] === 1;
    }).map(function(r){
      // 登记日期兜底: date 空 → 用 _createdAt / _updatedAt 格式化
      if (!r.date || String(r.date).length < 8) {
        var ts = r._createdAt || r._updatedAt || 0;
        if (ts) {
          var d = new Date(Number(ts));
          if (!isNaN(d.getTime())) {
            var yy = d.getFullYear();
            var mm = String(d.getMonth()+1).padStart(2,'0');
            var dd = String(d.getDate()).padStart(2,'0');
            r = Object.assign({}, r, { date: yy + '-' + mm + '-' + dd });
          }
        }
      }
      return r;
    });
    console.info('[export_tuoke] Round 11 白名单+日期兜底: ' + before + ' → ' + out.length);
    return out;
  }

  // 🦞 2026-07-27 Bug3 新增：主页面加载 override JSON（复用 kanban_embed 里的 __MANUAL_ATTR_OVERRIDE__）
  var _overridePromise = null;
  function _ensureOverrideMap() {
    if (_overridePromise) return _overridePromise;
    // 若 iframe 已经把它挂到 parent（同源），先复用
    try {
      if (window.__MANUAL_ATTR_OVERRIDE__ && window.__MANUAL_ATTR_OVERRIDE__.overrides) {
        return Promise.resolve(_buildOverrideMap(window.__MANUAL_ATTR_OVERRIDE__));
      }
    } catch(_){}
    var url = 'data/manual_attr_override.json?v=' + currentVersion();
    _overridePromise = fetch(url).then(function(r){ return r.json(); }).then(function(j){
      window.__MANUAL_ATTR_OVERRIDE__ = j;
      return _buildOverrideMap(j);
    }).catch(function(e){
      console.warn('[export_tuoke] 加载 override 失败，sale 走静态优先:', e);
      return {};
    });
    return _overridePromise;
  }
  function _buildOverrideMap(j) {
    var m = Object.create(null);
    try {
      var ov = (j && j.overrides) || {};
      Object.keys(ov).forEach(function(k){
        var rec = ov[k];
        if (rec && rec.sale) m[String(k).replace(/\s+/g,'')] = { sale: rec.sale, date: rec.date || '' };
      });
    } catch(_){}
    return m;
  }
  // R8.4 优先级链：override 锁 → 若销售 saleHistory 更新则解锁 → 静态首登记 → 云端兜底
  function _resolveSaleWithR84(staticR, cloudR, overrideMap) {
    var name1 = String((staticR && staticR.name) || (cloudR && cloudR.name) || '').replace(/\s+/g,'');
    var name2 = String((staticR && staticR.shortName) || (cloudR && cloudR.shortName) || '').replace(/\s+/g,'');
    var name3 = String((staticR && staticR.brand) || (cloudR && cloudR.brand) || '').replace(/\s+/g,'');
    var lockedRec = overrideMap[name1] || overrideMap[name2] || overrideMap[name3];
    var hist = (cloudR && Array.isArray(cloudR.saleHistory)) ? cloudR.saleHistory
             : ((staticR && Array.isArray(staticR.saleHistory)) ? staticR.saleHistory : []);
    var lastWhen = hist.length ? String(hist[hist.length-1].when || '').slice(0,10) : '';
    if (lockedRec) {
      // R8.4: saleHistory 最新 > override.date → 销售最新优先
      if (lastWhen && lockedRec.date && lastWhen > lockedRec.date) {
        return (hist[hist.length-1] && hist[hist.length-1].who) || (cloudR && cloudR.sale) || (staticR && staticR.sale) || lockedRec.sale;
      }
      return lockedRec.sale;
    }
    // 无 override → 静态优先（保护首登记），云端兜底
    return (staticR && staticR.sale) || (cloudR && cloudR.sale) || '';
  }

  function ensureTuokeRecords() {
    if (_tuokePromise) return _tuokePromise;
    toast('正在加载登记底表 + 拉取云端最新登记，请稍等…');
    var src = 'data/tuoke_real_records.js?v=' + currentVersion();
    var staticP = (Array.isArray(window.__TUOKE_REAL_RECORDS__) && window.__TUOKE_REAL_RECORDS__.length)
      ? Promise.resolve(window.__TUOKE_REAL_RECORDS__)
      : loadScriptOnce(src).then(function () {
          var rows = window.__TUOKE_REAL_RECORDS__;
          if (!Array.isArray(rows) || !rows.length) throw new Error('登记底表为空，请刷新页面后重试');
          return rows;
        });
    _tuokePromise = Promise.all([staticP, fetchCloudRecentTuoke(), _ensureOverrideMap(), fetchCloudUserRecords()]).then(function (arr) {
      var staticRows = arr[0] || [];
      var cloudRows = arr[1] || [];
      var overrideMap = arr[2] || {};
      var userRecords = arr[3] || [];
      // 2026-07-28 Round 11: 把 tuoke_user_records (销售新登记) 追加到 cloudRows, 让下面字段级并集统一处理
      if (userRecords.length) {
        cloudRows = cloudRows.concat(userRecords);
        console.info('[export_tuoke] Round 11 合并 tuoke_user_records: cloudRows=' + cloudRows.length + ' (含 ' + userRecords.length + ' 条销售直写)');
      }
      if (!cloudRows.length) {
        // 2026-07-28 Round 11: 静态兜底路径也必须过白名单 + 日期兜底
        return applyTuokeWhitelistAndDateFill(staticRows);
      }
      // 🦞 2026-07-27 Bug3 修复：字段级并集 + sale 走 R8.4 优先级链
      // 原逻辑：_id 已存在或 (name,date) 撞 → 云端 skip → 销售今天新登记/最新修改丢失
      // 新逻辑：
      //   1) _id 已存在 → 云端字段"补充"进静态（非空覆盖），sale 单独走 R8.4 判定
      //   2) _id 不存在 → 直接 append
      //   3) 极端保守：即使 (name,date) 撞了但 _id 不同 → 云端也 append（宁可重复不遗漏）
      function nk(r) {
        var nm = (r && (r.name || r.shortName) || '').replace(/\s+/g, '');
        var dt = String((r && r.date) || '').slice(0, 10);
        return nm + '|' + dt;
      }
      // 建 _id 索引
      var byId = {};
      staticRows.forEach(function (r, idx) {
        var k = r && (r._id || r.id);
        if (k) byId[String(k)] = idx;
      });
      var merged = staticRows.slice();
      var mergedFieldCnt = 0, appendedCnt = 0;
      cloudRows.forEach(function (cr) {
        if (!cr || !cr.name) return;
        var k = String(cr._id || cr.id || '');
        if (k && byId[k] != null) {
          // 字段级并集：云端非空字段覆盖静态（sale 单独判定）
          var sr = merged[byId[k]];
          var out = {};
          Object.keys(sr).forEach(function(f){ out[f] = sr[f]; });
          Object.keys(cr).forEach(function(f){
            if (f === 'sale' || f === '_rtx' || f === '_recorded_by') return;
            var v = cr[f];
            if (v !== undefined && v !== null && v !== '') out[f] = v;
          });
          out.sale = _resolveSaleWithR84(sr, cr, overrideMap);
          out._rtx = out.sale;
          out._recorded_by = out.sale;
          merged[byId[k]] = out;
          mergedFieldCnt++;
        } else {
          // 云端新记录 → 直接 append，sale 也套 override
          var out = {};
          Object.keys(cr).forEach(function(f){ out[f] = cr[f]; });
          out.sale = _resolveSaleWithR84(null, cr, overrideMap);
          out._rtx = out.sale;
          out._recorded_by = out.sale;
          merged.push(out);
          appendedCnt++;
        }
      });
      if (mergedFieldCnt > 0 || appendedCnt > 0) {
        toast('云端合并：字段更新 ' + mergedFieldCnt + ' 条，新增 ' + appendedCnt + ' 条');
        console.info('[export_tuoke] R8.4 字段级并集: fieldMerged=' + mergedFieldCnt + ' appended=' + appendedCnt + ' (static=' + staticRows.length + ' cloud=' + cloudRows.length + ')');
      }
      // 2026-07-28 Round 11: 复用 applyTuokeWhitelistAndDateFill (白名单 + 日期兜底)
      return applyTuokeWhitelistAndDateFill(merged);
    });
    return _tuokePromise;
  }
  window.__ensureTuokeRecordsForExport = ensureTuokeRecords;

  // 2026-06-30 新增：大盘新客视图（与 KPI 卡 8142 完全同源）
  function ensureNewCustomerView() {
    var existing = window.__KANBAN_NEW_CUSTOMER_VIEW__;
    if (Array.isArray(existing) && existing.length) return Promise.resolve(existing);
    if (_newViewPromise) return _newViewPromise;
    toast('正在加载大盘新客视图，请稍等…');
    var src = 'data/kanban_new_customer_view.js?v=' + currentVersion();
    _newViewPromise = loadScriptOnce(src).then(function () {
      var rows = window.__KANBAN_NEW_CUSTOMER_VIEW__;
      if (!Array.isArray(rows) || !rows.length) throw new Error('大盘新客视图为空，请刷新页面后重试');
      return rows;
    });
    return _newViewPromise;
  }

  function parseLinks(r) {
    var s = r.links;
    if (s && s !== '[]') {
      try {
        var arr = JSON.parse(s);
        if (Array.isArray(arr) && arr.length) {
          return arr.map(function (x) {
            if (typeof x === 'string') return x;
            if (x && typeof x === 'object') return x.type || x.name || x.label || JSON.stringify(x);
            return String(x);
          }).join(' / ');
        }
      } catch (e) {}
    }
    return r.link || '';
  }

  var NEW_QSET = { '2025Q3':1,'2025Q4':1,'2026Q1':1,'2026Q2':1,'2026Q3':1 };
  function normalizeQuarter(v) { return String(v || '').replace('/', ''); }
  function isNewByFq(r) { return !!NEW_QSET[normalizeQuarter(r.firstQuarter)]; }
  // 2026-07-13 修复：废除硬编码年份映射（原逻辑 7-12月→2025 / 1-6月→2026）。
  // 原因：进入2026年7月后，该函数将合法的 2026-07-* 日期强制改为 2025-07-*，
  //       导致导出Excel筛选"2026年"最新只到06-30，7月数据全部消失。
  // 现在底表(tuoke_real_records.js)日期已由 merge_cloud_records.py 统一年份口径，
  // 导出层直接透传，不再做年份修正。
  function fixRegYear(d) {
    return String(d || '').slice(0, 10) || '';
  }
  window.__fixRegYearForExport = fixRegYear;

  function rowOf(r) {
    var isNewFlag = (r.isNew === true || r.isNewCustomer === true) ? true : isNewByFq(r);
    return [
      fixRegYear(r.date),
      r.sale || '',
      r.name || '',
      r.shortName || '',
      normalizeQuarter(r.firstQuarter),
      isNewFlag ? '是' : '否',
      (r.isValid === true || r.isValidNew === true) ? '是' : '否',
      (r.isRising === '是' || r.status === '新锐' || r.isXinrui === true) ? '是' : '否',
      parseLinks(r),
      r.deliverySide || '',
      r.cat || '',
      r.channel || '',
      r.source || '',
      r.linkType || '',
      (r.linkCost != null && r.linkCost !== '') ? Number(r.linkCost) : 0,
      (r.qytCost != null && r.qytCost !== '') ? Number(r.qytCost) : 0,
      (r.adqCost != null && r.adqCost !== '') ? Number(r.adqCost) : 0,
      r.deliverySideEnriched || ''
    ];
  }

  function ensureXlsxReady() {
    if (typeof XLSX !== 'undefined') return Promise.resolve(true);
    if (typeof window.ensureXLSX === 'function') {
      toast('正在加载 xlsx 导出组件…');
      return window.ensureXLSX();
    }
    return Promise.reject(new Error('xlsx 库未加载，请刷新页面'));
  }

  // 登记表口径导出（13 列）
  function exportXlsxRecords(records, sheetName, filenamePrefix) {
    if (!records.length) return Promise.reject(new Error('没有命中数据'));
    return ensureXlsxReady().then(function () {
      var sorted = records.slice().sort(function (a, b) {
        return (fixRegYear(a.date) + '').localeCompare(fixRegYear(b.date) + '')
            || ((a.sale || '') + '').localeCompare((b.sale || '') + '');
      });
      var aoa = [HEADERS];
      sorted.forEach(function (r) { aoa.push(rowOf(r)); });
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [
        { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
        { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 18 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }
      ];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      var meta = [
        ['指标', '值'],
        ['导出时间', new Date().toLocaleString()],
        ['Sheet名称', sheetName],
        ['总记录数', records.length],
        ['来源', '看板 __TUOKE_REAL_RECORDS__（登记表口径）'],
        ['数据日', (window.__CENTER_DAILY_KPI__ && window.__CENTER_DAILY_KPI__.dataDate) || '']
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), '说明');
      var ymd = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, filenamePrefix + '_' + ymd + '_' + records.length + '条.xlsx');
      return records.length;
    });
  }

  // 大盘新客视图口径导出（6 列，与 KPI 卡 8142 同源）
  function exportXlsxNewView(rows, sheetName, filenamePrefix) {
    if (!rows.length) return Promise.reject(new Error('没有命中数据'));
    return ensureXlsxReady().then(function () {
      var quarterOrder = { '2025Q3':1, '2025Q4':2, '2026Q1':3, '2026Q2':4, '2026Q3':5 };
      var sorted = rows.slice().sort(function (a, b) {
        var qa = quarterOrder[normalizeQuarter(a['首投季度'])] || 9;
        var qb = quarterOrder[normalizeQuarter(b['首投季度'])] || 9;
        if (qa !== qb) return qa - qb;
        return ((a['登记销售'] || '') + '').localeCompare((b['登记销售'] || '') + '')
            || ((a['客户简称'] || '') + '').localeCompare((b['客户简称'] || '') + '');
      });
      var aoa = [NEW_VIEW_HEADERS];
      sorted.forEach(function (r) {
        aoa.push([
          r['客户简称'] || '',
          r['登记销售'] || '',
          normalizeQuarter(r['首投季度']),
          r['是否新客'] || '',
          r['是否有效'] || '',
          r['是否新锐'] || ''
        ]);
      });
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [
        { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }
      ];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      // 汇总分季度
      var summary = { '2025Q3':[0,0,0], '2025Q4':[0,0,0], '2026Q1':[0,0,0], '2026Q2':[0,0,0], '2026Q3':[0,0,0] };
      sorted.forEach(function (r) {
        var q = normalizeQuarter(r['首投季度']); if (!summary[q]) return;
        if (r['是否新客'] === '是') summary[q][0]++;
        if (r['是否有效'] === '是') summary[q][1]++;
        if (r['是否新锐'] === '是') summary[q][2]++;
      });
      var meta = [
        ['指标', '值'],
        ['导出时间', new Date().toLocaleString()],
        ['Sheet名称', sheetName],
        ['总记录数', rows.length],
        ['来源', 'kanban_new_customer_view.js（大盘口径，与 KPI 卡 8142 同源）'],
        ['数据日', (window.__CENTER_DAILY_KPI__ && window.__CENTER_DAILY_KPI__.dataDate) || ''],
        ['', ''],
        ['季度', '新客 / 有效 / 新锐'],
        ['2025Q3', summary['2025Q3'].join(' / ')],
        ['2025Q4', summary['2025Q4'].join(' / ')],
        ['2026Q1', summary['2026Q1'].join(' / ')],
        ['2026Q2', summary['2026Q2'].join(' / ')],
        ['2026Q3', summary['2026Q3'].join(' / ')]
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), '说明');
      var ymd = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, filenamePrefix + '_' + ymd + '_' + rows.length + '条.xlsx');
      return rows.length;
    });
  }

  function runExportAll(btn, label, filePrefix, sheetName) {
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.innerText = '加载底表…'; }
    ensureTuokeRecords().then(function (all) {
      if (!all.length) throw new Error('没有命中数据');
      if (btn) btn.innerText = '生成表格…';
      toast('正在生成表格…');
      return exportXlsxRecords(all, sheetName, filePrefix).then(function (n) {
        if (btn) btn.innerText = '✅ 已下载 ' + n + ' 条';
        toast('✅ 已下载 ' + n + ' 条');
        if (btn) setTimeout(function () { btn.disabled = false; btn.innerText = label; }, 2500);
      });
    }).catch(function (err) {
      console.error(err);
      toast('导出失败：' + err.message, true);
      alert('导出失败：' + err.message);
      if (btn) { btn.disabled = false; btn.innerText = label; }
    });
  }

  function runExportNewView(btn, label, filePrefix, sheetName) {
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.innerText = '加载大盘视图…'; }
    ensureNewCustomerView().then(function (rows) {
      if (!rows.length) throw new Error('没有命中数据');
      if (btn) btn.innerText = '生成表格…';
      toast('正在生成表格…');
      return exportXlsxNewView(rows, sheetName, filePrefix).then(function (n) {
        if (btn) btn.innerText = '✅ 已下载 ' + n + ' 条';
        toast('✅ 已下载 ' + n + ' 条');
        if (btn) setTimeout(function () { btn.disabled = false; btn.innerText = label; }, 2500);
      });
    }).catch(function (err) {
      console.error(err);
      toast('导出失败：' + err.message, true);
      alert('导出失败：' + err.message);
      if (btn) { btn.disabled = false; btn.innerText = label; }
    });
  }

  function bindAllBtn(btnId, label, filePrefix, sheetName) {
    var btn = document.getElementById(btnId);
    window['__exec_' + btnId] = function () {
      runExportAll(btn || null, label, filePrefix, sheetName);
    };
    if (!btn) return;
    btn.onclick = window['__exec_' + btnId];
  }

  function bindNewViewBtn(btnId, label, filePrefix, sheetName) {
    var btn = document.getElementById(btnId);
    window['__exec_' + btnId] = function () {
      runExportNewView(btn || null, label, filePrefix, sheetName);
    };
    if (!btn) return;
    btn.onclick = window['__exec_' + btnId];
  }

  function init() {
    bindAllBtn('btnExportTuokeAll',
      '⬇️ 拓新组登记客户明细',
      '拓新组登记客户明细',
      '全量登记');
    bindNewViewBtn('btnExportTuokeNew',
      '⬇️ 25Q3-26Q3新客明细',
      '25Q3-26Q3新客明细',
      '新客明细');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
