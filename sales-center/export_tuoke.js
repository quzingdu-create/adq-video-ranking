/* 拓新组双导出按钮 — 公共逻辑 v1.0（2026-05-24）
 * 用法：每个页面 (index.html / kanban_embed.html / register_v3.2.html / mobile.html) 都需要：
 *   1. 加载 xlsx CDN（或共用）
 *   2. 加载 data/tuoke_real_records.js（提供 window.__TUOKE_REAL_RECORDS__）
 *   3. 引入本文件 export_tuoke.js
 *   4. 页面 DOM 含两个隐藏 button: #btnExportTuokeAll + #btnExportTuokeNew
 *      （cloud_sync.js 注入的下拉菜单会代理 click 这两个隐藏按钮）
 *
 * 数据口径：
 *   - 全量：window.__TUOKE_REAL_RECORDS__ 全部（12647 条）
 *   - 新客：firstQuarter 命中 2025Q3/2025Q4/2026Q1/2026Q2（已统一为不带斜杠格式，共约 3658 条）
 */
(function () {
  if (window.__EXPORT_TUOKE_BOUND__) return;
  window.__EXPORT_TUOKE_BOUND__ = true;

  var HEADERS = ['登记日期','销售名称','客户主体','客户简称','首投季度','是否新客','是否有效','是否新锐','链路','投放端','类目','拓客途径','拓客来源'];

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

  function rowOf(r) {
    return [
      r.date || '',
      r.sale || '',
      r.name || '',
      r.shortName || '',
      r.firstQuarter || '',
      r.isNew ? '是' : '否',
      r.isValid ? '是' : '否',
      (r.isRising === '是' || r.status === '新锐') ? '是' : '否',
      parseLinks(r),
      r.deliverySide || '',
      r.cat || '',
      r.channel || '',
      r.source || ''
    ];
  }

  function exportXlsx(records, sheetName, filenamePrefix) {
    if (!records.length) { alert('没有命中数据'); return; }
    if (typeof XLSX === 'undefined') { alert('xlsx 库未加载，请刷新页面'); return; }
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
  }

  function bindBtn(btnId, getRecords, label, filePrefix, sheetName) {
    var btn = document.getElementById(btnId);
    if (!btn) {
      // 若页面无该按钮，则直接绑定 window 对象供下拉菜单 fallback 调用
      window['__exec_' + btnId] = function () {
        var all = window.__TUOKE_REAL_RECORDS__ || [];
        if (!all.length) { alert('数据还没加载完，请刷新页面后重试'); return; }
        try {
          exportXlsx(getRecords(all), sheetName, filePrefix);
        } catch (err) {
          console.error(err);
          alert('导出失败：' + err.message);
        }
      };
      return;
    }
    btn.onclick = function () {
      var all = window.__TUOKE_REAL_RECORDS__ || [];
      if (!all.length) { alert('数据还没加载完，请刷新页面后重试'); return; }
      var recs = getRecords(all);
      btn.disabled = true; btn.innerText = '导出中…';
      try {
        exportXlsx(recs, sheetName, filePrefix);
        btn.innerText = '✅ 已下载 ' + recs.length + ' 条';
        setTimeout(function () { btn.disabled = false; btn.innerText = label; }, 3000);
      } catch (err) {
        console.error(err);
        alert('导出失败：' + err.message);
        btn.disabled = false; btn.innerText = label;
      }
    };
  }

  // 双按钮口径（firstQuarter 已在底表统一为不带斜杠格式，仍保留斜杠版本兼容旧快照）
  var Q_SET = { '2025Q3': 1, '2025Q4': 1, '2026Q1': 1, '2026Q2': 1, '2025/Q3': 1, '2025/Q4': 1, '2026/Q1': 1, '2026/Q2': 1 };

  function init() {
    bindBtn('btnExportTuokeAll',
      function (all) { return all; },
      '⬇️ 拓新组登记客户明细',
      '拓新组登记客户明细',
      '全量登记');
    bindBtn('btnExportTuokeNew',
      function (all) { return all.filter(function (r) { return Q_SET[r.firstQuarter || '']; }); },
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
