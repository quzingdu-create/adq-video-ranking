/* 拓新组双导出按钮 — 公共逻辑 v1.1（2026-06-15）
 * 用法：每个页面 (index.html / kanban_embed.html / register_v3.2.html / mobile.html) 都需要：
 *   1. 加载 lib_loader.js（导出前按需加载 xlsx）
 *   2. 引入本文件 export_tuoke.js
 *   3. 页面 DOM 含两个隐藏 button: #btnExportTuokeAll + #btnExportTuokeNew
 *      （cloud_sync.js 注入的下拉菜单会代理 click 这两个隐藏按钮）
 *
 * 数据口径：
 *   - 全量：window.__TUOKE_REAL_RECORDS__ 全部
 *   - 新客：firstQuarter 命中 2025Q3/2025Q4/2026Q1/2026Q2
 *
 * 2026-06-15 修复：PC / mobile 首屏提速后不再同步加载 tuoke_real_records.js，
 * 点击右上角下载时必须先按需加载 data/tuoke_real_records.js，再生成 xlsx。
 */
(function () {
  if (window.__EXPORT_TUOKE_BOUND__) return;
  window.__EXPORT_TUOKE_BOUND__ = true;

  var HEADERS = ['登记日期','销售名称','客户主体','客户简称','首投季度','是否新客','是否有效','是否新锐','链路','投放端','类目','拓客途径','拓客来源'];
  var EXPORT_FALLBACK_VERSION = '20260615e';
  var _tuokePromise = null;
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

  function ensureTuokeRecords() {
    var existing = window.__TUOKE_REAL_RECORDS__;
    if (Array.isArray(existing) && existing.length) return Promise.resolve(existing);
    if (_tuokePromise) return _tuokePromise;
    toast('正在加载登记底表，请稍等…');
    var src = 'data/tuoke_real_records.js?v=' + currentVersion();
    _tuokePromise = loadScriptOnce(src).then(function () {
      var rows = window.__TUOKE_REAL_RECORDS__;
      if (!Array.isArray(rows) || !rows.length) throw new Error('登记底表为空，请刷新页面后重试');
      return rows;
    });
    return _tuokePromise;
  }
  window.__ensureTuokeRecordsForExport = ensureTuokeRecords;

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

  function rowOf(r) {
    var isNewFlag = (r.isNew === true || r.isNewCustomer === true) ? true : isNewByFq(r);
    return [
      r.date || '',
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
      r.source || ''
    ];
  }

  function exportXlsx(records, sheetName, filenamePrefix) {
    if (!records.length) return Promise.reject(new Error('没有命中数据'));
    if (typeof XLSX === 'undefined') {
      if (typeof window.ensureXLSX === 'function') {
        toast('正在加载 xlsx 导出组件…');
        return window.ensureXLSX().then(function () {
          return exportXlsx(records, sheetName, filenamePrefix);
        });
      }
      return Promise.reject(new Error('xlsx 库未加载，请刷新页面'));
    }
    var sorted = records.slice().sort(function (a, b) {
      return ((a.date || '') + '').localeCompare((b.date || '') + '')
          || ((a.sale || '') + '').localeCompare((b.sale || '') + '');
    });
    var aoa = [HEADERS];
    sorted.forEach(function (r) { aoa.push(rowOf(r)); });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
      { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 18 }
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    var meta = [
      ['指标', '值'],
      ['导出时间', new Date().toLocaleString()],
      ['Sheet名称', sheetName],
      ['总记录数', records.length],
      ['来源', '看板 __TUOKE_REAL_RECORDS__'],
      ['数据日', (window.__CENTER_DAILY_KPI__ && window.__CENTER_DAILY_KPI__.dataDate) || '']
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), '说明');
    var ymd = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, filenamePrefix + '_' + ymd + '_' + records.length + '条.xlsx');
    return Promise.resolve(records.length);
  }

  function runExport(btn, getRecords, label, filePrefix, sheetName) {
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.innerText = '加载底表…'; }
    ensureTuokeRecords().then(function (all) {
      var recs = getRecords(all) || [];
      if (!recs.length) throw new Error('没有命中数据');
      if (btn) btn.innerText = '生成表格…';
      toast('正在生成表格…');
      return exportXlsx(recs, sheetName, filePrefix).then(function (n) {
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

  function bindBtn(btnId, getRecords, label, filePrefix, sheetName) {
    var btn = document.getElementById(btnId);
    window['__exec_' + btnId] = function () {
      runExport(btn || null, getRecords, label, filePrefix, sheetName);
    };
    if (!btn) return;
    btn.onclick = window['__exec_' + btnId];
  }

  function init() {
    bindBtn('btnExportTuokeAll',
      function (all) { return all; },
      '⬇️ 拓新组登记客户明细',
      '拓新组登记客户明细',
      '全量登记');
    bindBtn('btnExportTuokeNew',
      function (all) { return all.filter(function (r) { return NEW_QSET[normalizeQuarter(r.firstQuarter)]; }); },
      '⬇️ 25Q3-26Q2新客明细',
      '25Q3-26Q2新客明细',
      '新客明细');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
