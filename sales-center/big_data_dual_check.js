(function (window) {
  'use strict';

  var VERSION = 'v3.2-big-dual-check-20260623';
  var DEFAULT_V3_VERSION = '20260622_v3_big';

  function mode() {
    return window.SalesCenterApi && window.SalesCenterApi.getMode ? window.SalesCenterApi.getMode() : (window.__SALES_CENTER_DATA_MODE__ || 'static');
  }
  function stableString(value) {
    if (Array.isArray(value)) return '[' + value.map(stableString).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ':' + stableString(value[k]); }).join(',') + '}';
    }
    return JSON.stringify(value);
  }
  function lightHash(value) {
    var str = stableString(value);
    var h = 0;
    for (var i = 0; i < str.length; i += 1) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }
  function pickRows(res) {
    if (!res) return [];
    if (res.mode === 'dual') return res.cloud && res.cloud.data && Array.isArray(res.cloud.data.rows) ? res.cloud.data.rows : [];
    return res.data && Array.isArray(res.data.rows) ? res.data.rows : [];
  }
  function cloudOk(res) {
    if (!res) return false;
    if (res.mode === 'dual') return !!(res.cloud && res.cloud.ok !== false);
    return res.ok !== false;
  }
  function run() {
    if (mode() !== 'dual') return;
    var report = {
      ok: null,
      status: 'running',
      version: VERSION,
      snapshotVersion: DEFAULT_V3_VERSION,
      startedAt: new Date().toISOString(),
      page: location.pathname,
      checks: [],
      note: 'Big data dual check is running. Wait for status=finished.'
    };
    window.__SALES_CENTER_BIG_DUAL_REPORT__ = report;

    if (!window.SalesCenterDataAdapter || typeof window.SalesCenterDataAdapter.queryRecords !== 'function') {
      report.ok = false;
      report.status = 'failed';
      report.error = 'SalesCenterDataAdapter.queryRecords missing';
      report.finishedAt = new Date().toISOString();
      return;
    }

    Promise.all([
      window.SalesCenterDataAdapter.queryRecords({ snapshotVersion: DEFAULT_V3_VERSION, page: 1, pageSize: 10 }),
      window.SalesCenterDataAdapter.queryLookup({ snapshotVersion: DEFAULT_V3_VERSION, type: 'customer_link_data', keys: ['阿迪达斯'] }),
      window.SalesCenterDataAdapter.getCustomerDetail({ snapshotVersion: DEFAULT_V3_VERSION, name: '杭州不姜就科技有限公司' })
    ]).then(function (results) {
      var rec = results[0];
      var rows = pickRows(rec);
      var staticRows = Array.isArray(window.__TUOKE_REAL_RECORDS__) ? window.__TUOKE_REAL_RECORDS__.slice(0, 10) : [];
      var totalRecords = rec && rec.cloud && rec.cloud.data ? rec.cloud.data.totalRecords : (rec && rec.data ? rec.data.totalRecords : null);
      var staticAvailable = staticRows.length > 0;
      var hashMatch = staticAvailable && rows.length > 0 ? lightHash(staticRows) === lightHash(rows) : null;
      report.checks.push({
        action: 'queryRecords',
        cloudOk: cloudOk(rec),
        staticAvailable: staticAvailable,
        staticCount: staticRows.length,
        cloudCount: rows.length,
        staticHash: staticAvailable ? lightHash(staticRows) : '',
        cloudHash: lightHash(rows),
        hashMatch: hashMatch,
        totalRecords: totalRecords,
        pass: cloudOk(rec) && rows.length === 10 && totalRecords === 23652 && (!staticAvailable || hashMatch === true)
      });
      var lookup = results[1];
      var lookupPayload = lookup && lookup.cloud && lookup.cloud.data ? lookup.cloud.data.payload : (lookup && lookup.data ? lookup.data.payload : {});
      report.checks.push({
        action: 'queryLookup.customer_link_data.阿迪达斯',
        cloudOk: cloudOk(lookup),
        found: !!(lookupPayload && lookupPayload['阿迪达斯'])
      });
      var detail = results[2];
      var detailData = detail && detail.cloud && detail.cloud.data ? detail.cloud.data : (detail && detail.data ? detail.data : {});
      report.checks.push({
        action: 'getCustomerDetail.杭州不姜就科技有限公司',
        cloudOk: cloudOk(detail),
        foundLookup: !!detailData.foundLookup,
        foundRecord: !!detailData.foundRecord,
        indexRefCount: detailData.indexRefCount || (detailData.detail && detailData.detail.indexRefs ? detailData.detail.indexRefs.length : 0)
      });
      report.status = 'finished';
      report.finishedAt = new Date().toISOString();
      report.ok = report.checks.every(function (c) {
        if (c.action === 'queryRecords') return c.pass === true;
        if (c.action.indexOf('queryLookup') === 0) return c.cloudOk && c.found;
        if (c.action.indexOf('getCustomerDetail') === 0) return c.cloudOk && c.foundLookup && c.foundRecord;
        return false;
      });
      report.summary = {
        failed: report.checks.filter(function (c) {
          if (c.action === 'queryRecords') return c.pass !== true;
          if (c.action.indexOf('queryLookup') === 0) return !(c.cloudOk && c.found);
          if (c.action.indexOf('getCustomerDetail') === 0) return !(c.cloudOk && c.foundLookup && c.foundRecord);
          return true;
        }).map(function (c) { return c.action; })
      };
      if (window.console && console.info) console.info('[sales-center-big-dual] report ok=' + report.ok, report);
      if (window.console && console.table) console.table(report.checks);
    }).catch(function (err) {
      report.ok = false;
      report.status = 'failed';
      report.error = err && err.message ? err.message : String(err);
      report.finishedAt = new Date().toISOString();
      if (window.console && console.warn) console.warn('[sales-center-big-dual] failed', report);
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(run, 0);
  else document.addEventListener('DOMContentLoaded', run);
})(window);
