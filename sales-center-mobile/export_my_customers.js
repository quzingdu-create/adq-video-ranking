/* =========================================================================
   销售自助导出 · 11-04 新口径（子青 2026-11-04 拍板）
   -------------------------------------------------------------------------
   每个销售在看板里自己点按钮下载自己名下客户，不再靠对话里手工出表。

   数据源：data/customer_export_profile.js（每日 daily_rebuild.sh 第 4.5/8 步生成，
           前端只读取、不现算，保证与报表口径一致）
   身份链：cloud.rtx() 登录态 > URL ?user= > 未登录「选择销售」必选
   权限  ：非管理员锁定本人、禁用销售下拉；管理员可切「全部销售」
   范围  ：按「当前归属」profile.owner（= attribution_resolved.js 的 s），
           不是登记底表的 sale 字段 —— 两者可差数百家，勿混用。
   口径  ：五项命中 ops / 链路双投 / 类目手填 / 无 24 老客 / 无客户类型；
           历史季度（首投早于当季）登记状态标红。
   ========================================================================= */
(function () {
  'use strict';
  // 🔴 版本号从本模块的 <script src="...?v=XXXX"> 读取，绝不硬编码。
  //    bump_cache_buster.py 只扫 *.html / version.json，不会替换 .js 里的字符串；
  //    若在此写死版本号，升版后 HTML 变了、PROFILE_URL 还停在旧版 → 浏览器一直读缓存旧 profile。
  var VER = (function () {
    try {
      var s = document.querySelector('script[src*="export_my_customers.js"]');
      var m = s && String(s.src).match(/[?&]v=(20\d{6}[a-z])/);
      if (m) return m[1];
      var all = document.querySelectorAll('script[src]');
      for (var i = 0; i < all.length; i++) {
        var m2 = String(all[i].src).match(/[?&]v=(20\d{6}[a-z])/);
        if (m2) return m2[1];
      }
    } catch (e) {}
    return '';
  })();
  var PROFILE_URL = 'data/customer_export_profile.js' + (VER ? '?v=' + VER : '');
  var EXCELJS_CDN = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

  var HDR = ['客户简称', '主体名称', '当前归属', '归属生效层', '首登人', '登记日期', '登记条数',
             '首投季度(ops)', '登记状态', '是否新客', '是否有效', '是否新锐', '投放端', '链路',
             '类目(销售手填)', '来源', '季度消耗(元)', '昨日消耗(元)', '消耗环比'];
  var WIDTH = [26, 30, 14, 16, 14, 12, 10, 14, 16, 10, 10, 10, 12, 10, 16, 24, 14, 14, 12];
  var SCOLS = ['首投季度', '客户数', '有效', '新锐(SOP)', 'ADQ', '全域通', '双投放',
               '小店', '直播', '链路双投', '季度消耗合计(元)'];

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('加载失败: ' + src)); };
      document.head.appendChild(s);
    });
  }

  var _profP = null;
  function ensureProfile() {
    if (window.__CUSTOMER_EXPORT_PROFILE__) return Promise.resolve();
    if (_profP) return _profP;
    _profP = loadScript(PROFILE_URL).then(function () {
      if (!window.__CUSTOMER_EXPORT_PROFILE__) throw new Error('profile 加载后仍不可用');
    });
    return _profP;
  }

  var _xlP = null;
  function ensureExcelJS() {
    if (window.ExcelJS) return Promise.resolve(true);
    if (_xlP) return _xlP;
    // ExcelJS 支持单元格字体色；CDN 挂了就降级到页面已有的 SheetJS（数据完整、无标红）
    _xlP = loadScript(EXCELJS_CDN).then(function () { return !!window.ExcelJS; },
                                       function () { return false; });
    return _xlP;
  }
  function ensureSheetJS() {
    if (typeof XLSX !== 'undefined') return Promise.resolve(true);
    if (typeof window.ensureXLSX === 'function') {
      return window.ensureXLSX().then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }

  // ---------- 身份 ----------
  function adminOf() {
    try {
      if (window.cloud && typeof cloud.isAdmin === 'function' && cloud.isAdmin()) return true;
      var r = String((window.cloud && cloud.rtx && cloud.rtx()) || '').toLowerCase();
      return ['ziqingdu', 'kinsleyjin', 'edcchen'].indexOf(r) >= 0;
    } catch (e) { return false; }
  }
  function loginRtx() {
    try { return String((window.cloud && cloud.rtx && cloud.rtx()) || ''); } catch (e) { return ''; }
  }
  function normalizeSale(r) {
    if (!r) return '';
    var el = document.getElementById('recordSales');
    if (el) {
      for (var i = 0; i < el.options.length; i++) {
        var v = el.options[i].value;
        if (v && v.toLowerCase() === r.toLowerCase()) return v;   // 修 rtx 大小写差异
      }
    }
    return r;
  }
  function currentUser() {
    var r = normalizeSale(loginRtx());
    if (r) return r;
    try {
      var u = new URLSearchParams(location.search).get('user');
      if (u) return normalizeSale(u);
    } catch (e) {}
    return '';
  }

  // ---------- UI 初始化 ----------
  var _tries = 0;
  function initUi() {
    var sel = document.getElementById('recordSales');
    var hint = document.getElementById('exportScopeHint');
    // #recordSales 的 options 由 renderRecords() 填充，可能晚于本模块 → 有限重试
    if (!sel || sel.options.length <= 1) {
      if (++_tries < 20) setTimeout(initUi, 300);
      return;
    }
    var isAdmin = adminOf(), u = currentUser();
    if (isAdmin) {
      if (hint) hint.textContent = '管理员 · 可导出全部销售或指定销售';
    } else if (u) {
      sel.value = u;
      sel.disabled = true;
      sel.style.background = '#f3f4f6';
      if (hint) hint.textContent = '🔒 已锁定为 ' + u + '（按当前归属导出）';
    } else {
      sel.value = '';
      if (hint) hint.textContent = '未登录 · 请先选择要导出的销售';
    }
  }
  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUi);
    else initUi();
  }

  // ---------- 组装导出数据 ----------
  function buildPayload(target, quarter) {
    var P = window.__CUSTOMER_EXPORT_PROFILE__ || {};
    var out = [];
    Object.keys(P).forEach(function (n) {
      var e = P[n];
      if (!e) return;
      if (target && e.owner !== target) return;
      if (quarter && e.q !== quarter) return;
      out.push([n, e]);
    });
    out.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });

    var detail = out.map(function (p) {
      var n = p[0], e = p[1];
      return [e.short || n, n, e.owner || '', e.attrSrc || '', e.firstBy || '',
              e.regDate || '', e.regCount || 0, e.q || '', e.status || '',
              e.isNew || '', e.isValid || '', e.isRising || '', e.side || '',
              e.link || '', e.cat || '', e.source || '', e.qCost || '', e.yCost || '', e.chg || ''];
    });

    var sm = {};
    out.forEach(function (p) {
      var e = p[1], q = e.q || '未投放';
      if (!sm[q]) {
        sm[q] = { '客户数': 0, '有效': 0, '新锐(SOP)': 0, 'ADQ': 0, '全域通': 0,
                  '双投放': 0, '小店': 0, '直播': 0, '链路双投': 0, '季度消耗合计(元)': 0 };
      }
      var d = sm[q];
      d['客户数']++;
      if (e.isValid === '是') d['有效']++;
      if (e.isRising === '是') d['新锐(SOP)']++;
      if (e.side === 'ADQ') d['ADQ']++;
      else if (e.side === '全域通') d['全域通']++;
      else if (e.side === '双投放') d['双投放']++;
      if (e.link === '小店') d['小店']++;
      else if (e.link === '直播') d['直播']++;
      else if (e.link === '双投') d['链路双投']++;
      var c = parseFloat(e.qCost || 0);
      if (!isNaN(c)) d['季度消耗合计(元)'] += c;
    });
    var summary = [SCOLS];
    Object.keys(sm).sort().forEach(function (q) {
      var d = sm[q];
      summary.push([q].concat(SCOLS.slice(1).map(function (k) {
        return k === '季度消耗合计(元)' ? Math.round(d[k] * 100) / 100 : d[k];
      })));
    });
    return {
      detail: detail,
      summary: summary,
      historyFlags: out.map(function (p) { return p[1].history === 1; }),
      n: out.length
    };
  }

  function notes(target, meta) {
    return [
      ['项目', '说明'],
      ['导出范围', target ? ('当前归属 = ' + target) : '全部销售（管理员）'],
      ['数据日', meta.dataDate || ''],
      ['当季', meta.currentQuarter || ''],
      ['profile 生成时间', meta.generatedAt || ''],
      ['🔴 24年老客', '概念已作废，全部删除：无 24老客 标签、无 OLD24 判定、无 2024/Q1 钉值。'],
      ['登记状态', '首投季度=当季 → {当季} 新客；首投更早 → {季度} 新客（标红）；查不到首投 → 未投放。'],
      ['五个判定真源', '是否新客 / 是否有效 / 投放端 / 首投季度 / 是否新锐 全部命中 ops 新客表，不再自算。'],
      ['ops 合并方式', '当季用每日更新的 服饰26Q4新客ops-M.D.csv 覆盖；历史季度用 xlsx「25-26新客」sheet 补齐。'],
      ['是否新锐', '沿用 SOP = 是否有效新客=是 AND 客群标签∈{新锐,经销商}。'],
      ['投放端', '取 ops「首投季度qyt/adq」：adq→ADQ、全域通→全域通、双投→双投放。'],
      ['链路', '取每日 链路-M.D.csv（25/1/1 至今全量、按客户+链路聚合、排除 __level=0 整体行）：只直播→直播；只小店→小店；直播+小店都出现→双投。'],
      ['🔴 两个「双投」别混', '「链路」列的双投 = 小店+直播；「投放端」列的双投放 = ADQ+全域通。'],
      ['类目', '直接取登记底表 cat（销售登记时手填），优先级最高。'],
      ['客户类型', '已删除该列（脏字段）。'],
      ['归属', '当前归属 / 首登人取单一真源 attribution_resolved.js（L0 override > L1 交接 > L2 首登），不采用底表原始 sale。'],
      ['消耗列', '季度消耗 / 昨日消耗 / 消耗环比 为登记底表原值，与 ops 口径不同源，仅供对照。'],
      ['🔴 与表格筛选的关系', '本导出按「当前归属」全量导出，不受明细表「销售下拉 / 今日 / 近7天 / 搜索」筛选影响；页面表格的销售列显示当前归属，筛选按登记 sale，两者口径不同。']
    ];
  }

  // ---------- 写出 ----------
  function writeExcelJS(payload, meta, target, filename) {
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('明细_Q3-Q4');
    ws.columns = HDR.map(function (h, i) { return { header: h, width: WIDTH[i] }; });
    payload.detail.forEach(function (r) { ws.addRow(r); });
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    payload.historyFlags.forEach(function (flag, i) {
      if (flag) ws.getCell(i + 2, 9).font = { color: { argb: 'FFFF0000' }, bold: true };
    });
    var ws2 = wb.addWorksheet('季度汇总');
    payload.summary.forEach(function (r) { ws2.addRow(r); });
    ws2.getRow(1).font = { bold: true };
    ws2.columns = payload.summary[0].map(function (h, i) { return { width: i === 0 ? 14 : 16 }; });
    var ws3 = wb.addWorksheet('口径说明');
    notes(target, meta).forEach(function (r) { ws3.addRow(r); });
    ws3.getRow(1).font = { bold: true };
    ws3.getColumn(1).width = 22; ws3.getColumn(2).width = 115;
    ws3.eachRow(function (row) { row.getCell(2).alignment = { wrapText: true, vertical: 'top' }; });
    return wb.xlsx.writeBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
  }

  function writeSheetJS(payload, meta, target, filename) {
    if (typeof XLSX === 'undefined') throw new Error('xlsx 库不可用');
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HDR].concat(payload.detail)), '明细_Q3-Q4');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(payload.summary), '季度汇总');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes(target, meta)), '口径说明');
    XLSX.writeFile(wb, filename);
  }

  // ---------- 主入口 ----------
  window.SC_selfExport = function () {
    var btn = document.getElementById('btnExportRecords');
    var sel = document.getElementById('recordSales');
    var qsel = document.getElementById('exportQuarter');
    var isAdmin = adminOf();
    var target = (sel && sel.value) || '';
    if (!isAdmin && !target) { alert('请先选择要导出的销售'); if (sel) sel.focus(); return; }
    var quarter = qsel ? qsel.value : '';
    var oldText = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = '准备数据…'; }

    ensureProfile().then(function () {
      var meta = window.__CUSTOMER_EXPORT_META__ || {};
      // 季度下拉按 profile 里实际出现的季度动态填充，避免硬编码过期
      if (qsel && qsel.options.length <= 1) {
        var P = window.__CUSTOMER_EXPORT_PROFILE__ || {}, qs = {};
        Object.keys(P).forEach(function (n) { if (P[n] && P[n].q) qs[P[n].q] = 1; });
        Object.keys(qs).sort().reverse().forEach(function (q) {
          var o = document.createElement('option');
          o.value = q; o.textContent = '仅 ' + q; qsel.appendChild(o);
        });
      }
      var payload = buildPayload(target, quarter);
      if (!payload.n) { alert('该销售名下没有客户'); throw new Error('empty'); }
      var msg = '将导出【' + (target || '全部销售') + '】名下 ' + payload.n + ' 家客户'
              + (quarter ? ('（仅 ' + quarter + '）') : '（全部季度）') + '，按当前归属口径。继续？';
      if (!window.confirm(msg)) throw new Error('cancel');
      var fn = '拓客登记客户_' + (target || '全部销售') + '_'
             + new Date().toISOString().slice(0, 10) + '_' + payload.n + '家.xlsx';
      return ensureExcelJS().then(function (has) {
        if (has) return writeExcelJS(payload, meta, target, fn).then(function () { return 'exceljs'; });
        return ensureSheetJS().then(function (ok) {
          if (!ok) throw new Error('导出组件加载失败，请检查网络后重试');
          writeSheetJS(payload, meta, target, fn);
          return 'sheetjs';
        });
      });
    }).then(function (mode) {
      if (btn) { btn.disabled = false; btn.innerText = oldText; }
      if (mode === 'sheetjs') alert('导出完成（导出组件降级，本次无红色标注，数据完整）');
      else console.log('[自助导出] 完成，样式版 xlsx');
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.innerText = oldText; }
      if (e && e.message !== 'cancel' && e.message !== 'empty') {
        alert('导出失败：' + ((e && e.message) || e));
      }
    });
  };

  boot();
})();
