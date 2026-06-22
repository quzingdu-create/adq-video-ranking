(function (window) {
  'use strict';

  var VERSION = 'v2-dual-check-20260622';
  var SNAPSHOT_VERSION = '20260622_v2_light';
  var CHECK_TYPES = {
    getBootstrap: {
      action: 'getBootstrap',
      staticMap: {
        center_daily_kpi: '__CENTER_DAILY_KPI__',
        center_quarter_summary: '__CENTER_QUARTER_SUMMARY__',
        dashboard_runtime_summary: '__DASHBOARD_RUNTIME_SUMMARY__',
        center_sales_summary: '__CENTER_SALES_SUMMARY__',
        current_rising: '__CURRENT_RISING_SET__'
      }
    },
    getTopMetrics: {
      action: 'getTopMetrics',
      staticMap: {
        top80_effective_metrics: '__TOP80_EFFECTIVE_METRICS__',
        top_status_data: '__TOP_STATUS_DATA__',
        top_status_list: '__TOP_STATUS_LIST__',
        redblack_data: '__REDBLACK_DATA__',
        top_rising_data: '__TOP_RISING_DATA__',
        yest_new_customer_tasks: '__YEST_NEW_CUSTOMER_TASKS__',
        enough_candidates: '__ENOUGH_CANDIDATES__'
      }
    }
  };

  function mode() {
    return window.SalesCenterApi && window.SalesCenterApi.getMode ? window.SalesCenterApi.getMode() : (window.__SALES_CENTER_DATA_MODE__ || 'static');
  }

  function normalize(value) {
    if (value instanceof Set) return Array.from(value).sort();
    return value;
  }

  function count(value) {
    value = normalize(value);
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.list)) return value.list.length;
      if (Array.isArray(value.items)) return value.items.length;
      if (Array.isArray(value.rows)) return value.rows.length;
      if (Array.isArray(value.data)) return value.data.length;
      return Object.keys(value).length;
    }
    return value == null ? 0 : 1;
  }

  function stableString(value) {
    value = normalize(value);
    if (Array.isArray(value)) return '[' + value.map(stableString).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (k) {
        return JSON.stringify(k) + ':' + stableString(value[k]);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function lightHash(value) {
    var str = stableString(value);
    var h = 0;
    for (var i = 0; i < str.length; i += 1) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }

  function comparePayload(actionName, cloudPayload) {
    var cfg = CHECK_TYPES[actionName];
    var rows = [];
    Object.keys(cfg.staticMap).forEach(function (type) {
      var staticKey = cfg.staticMap[type];
      var hasStatic = Object.prototype.hasOwnProperty.call(window, staticKey);
      var staticValue = hasStatic ? window[staticKey] : undefined;
      var cloudValue = cloudPayload ? cloudPayload[type] : undefined;
      var hasCloud = typeof cloudValue !== 'undefined';
      var staticCount = count(staticValue);
      var cloudCount = count(cloudValue);
      var staticHash = hasStatic ? lightHash(staticValue) : '';
      var cloudHash = hasCloud ? lightHash(cloudValue) : '';
      rows.push({
        type: type,
        staticKey: staticKey,
        hasStatic: hasStatic,
        hasCloud: hasCloud,
        staticCount: staticCount,
        cloudCount: cloudCount,
        countMatch: staticCount === cloudCount,
        hashMatch: hasStatic && hasCloud ? staticHash === cloudHash : false,
        staticHash: staticHash,
        cloudHash: cloudHash
      });
    });
    return rows;
  }

  function callCloud(action) {
    if (!window.SalesCenterApi || typeof window.SalesCenterApi.callCloud !== 'function') {
      return Promise.resolve({ ok: false, error: { code: 'API_CLIENT_MISSING', message: 'SalesCenterApi missing' } });
    }
    return window.SalesCenterApi.callCloud(action, { snapshotVersion: SNAPSHOT_VERSION }, { functionName: 'salesCenterApi' });
  }

  function run() {
    if (mode() !== 'dual') return;
    var report = {
      ok: null,
      status: 'running',
      version: VERSION,
      snapshotVersion: SNAPSHOT_VERSION,
      startedAt: new Date().toISOString(),
      page: location.pathname,
      checks: [],
      note: 'Dual check is still running. Wait for status=finished before reading ok.'
    };
    window.__SALES_CENTER_DUAL_REPORT__ = report;

    Promise.all([
      callCloud('getBootstrap'),
      callCloud('getTopMetrics')
    ]).then(function (results) {
      ['getBootstrap', 'getTopMetrics'].forEach(function (name, idx) {
        var res = results[idx];
        var payload = res && res.data && res.data.payload ? res.data.payload : null;
        var rows = comparePayload(name, payload);
        report.checks.push({
          action: name,
          cloudOk: !!(res && res.ok),
          cloudCount: res && res.data ? res.data.count : null,
          error: res && res.error ? res.error : null,
          rows: rows
        });
      });
      report.finishedAt = new Date().toISOString();
      report.status = 'finished';
      report.ok = report.checks.every(function (c) {
        return c.cloudOk && c.rows.every(function (r) { return !r.hasStatic || r.hashMatch; });
      });
      report.summary = {
        actions: report.checks.length,
        failedActions: report.checks.filter(function (c) { return !c.cloudOk; }).map(function (c) { return c.action; }),
        mismatches: report.checks.reduce(function (arr, c) {
          c.rows.forEach(function (r) { if (r.hasStatic && !r.hashMatch) arr.push(c.action + ':' + r.type); });
          return arr;
        }, [])
      };
      if (window.console && console.table) {
        console.info('[sales-center-dual] report ok=' + report.ok, report);
        report.checks.forEach(function (c) { console.table(c.rows); });
      } else if (window.console && console.info) {
        console.info('[sales-center-dual] report', report);
      }
    }).catch(function (err) {
      report.ok = false;
      report.status = 'failed';
      report.error = err && err.message ? err.message : String(err);
      report.finishedAt = new Date().toISOString();
      if (window.console && console.warn) console.warn('[sales-center-dual] failed', report);
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(run, 0);
  } else {
    document.addEventListener('DOMContentLoaded', run);
  }
})(window);
