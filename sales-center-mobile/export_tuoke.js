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
  // 现在: 静态 + 云端最近 3 天增量, 按 _id 去重合并
  function fetchCloudRecentTuoke() {
    if (!window.cloud || typeof window.cloud.callFunction !== 'function') {
      return Promise.resolve([]);
    }
    // 拉云端全量 tuoke_records (与 exportAllRecords 云函数对齐), 无 cursor 从头拉
    var acc = [];
    function pullPage(cursor) {
      var params = { pageSize: 1000 };
      if (cursor) params.cursor = cursor;
      return window.cloud.callFunction('salesCenterApi', {
        action: 'exportAllRecords',
        params: params
      }).then(function (r) {
        var body = (r && r.result) || {};
        if (!body.ok) return acc;
        var data = body.data || {};
        var rows = data.rows || [];
        acc = acc.concat(rows);
        if (data.hasMore && data.nextCursor && acc.length < 5000) {
          return pullPage(data.nextCursor);
        }
        return acc;
      });
    }
    return pullPage(null).catch(function (err) {
      console.warn('[export_tuoke] 拉云端 tuoke 失败, 用静态兜底:', err);
      return [];
    });
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
    _tuokePromise = Promise.all([staticP, fetchCloudRecentTuoke()]).then(function (arr) {
      var staticRows = arr[0] || [];
      var cloudRows = arr[1] || [];
      if (!cloudRows.length) return staticRows;
      // 用 _id 建索引; 云端 _id 已存在则跳过 (静态口径已是最终), 不存在则 append
      var ids = {};
      staticRows.forEach(function (r) {
        var k = r && (r._id || r.id);
        if (k) ids[String(k)] = true;
      });
      // 同 (name, date) 也算已合并 (避免云端同客户多 _id 造成重复)
      function nk(r) {
        var nm = (r && (r.name || r.shortName) || '').replace(/\s+/g, '');
        var dt = String((r && r.date) || '').slice(0, 10);
        return nm + '|' + dt;
      }
      var nks = {};
      staticRows.forEach(function (r) { nks[nk(r)] = true; });
      var merged = staticRows.slice();
      var appendedCnt = 0;
      cloudRows.forEach(function (r) {
        if (!r || !r.name) return;
        var k = String(r._id || r.id || '');
        if (k && ids[k]) return;
        if (nks[nk(r)]) return;
        merged.push(r);
        appendedCnt++;
      });
      if (appendedCnt > 0) {
        toast('已合并云端 ' + appendedCnt + ' 条最新登记');
        console.info('[export_tuoke] 云端补集 append: ' + appendedCnt + ' 条 (static=' + staticRows.length + ' cloud=' + cloudRows.length + ')');
      }
      return merged;
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

  var NEW_QSET = { '2025Q3':1,'2025Q4':1,'2026Q1':1,'2026Q2':1 };
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
