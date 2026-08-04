/*
 * cloud_diff_probe.js · V1 ·双读 diff 探针
 *
 * 目的：页面 idle 时，同时拉静态和云端两份数据做对比，把差异打console + 上报云函数。
 *      运行一周，如果 0 diff 就可以关闭静态那份。
 *
 * 触发：window.addEventListener('load') + requestIdleCallback (延迟 3s，不影响首屏)
 *
 * 依赖：window.dataAdapter (来自 cloud_data_adapter.js)
 *      window.cloud (来自 cloud_sync.js)
 */
(function () {
  'use strict';

  var DIFF_STARTED = false;

  function _deepEqual(a, b, path, diffs) {
    path = path || '$';
    diffs = diffs || [];
    if (a === b) return diffs;
    if (typeof a !== typeof b) { diffs.push({ path: path, static: a, cloud: b, reason: 'type' }); return diffs; }
    if (a === null || b === null || typeof a !== 'object') {
      // 数值类差异容忍 0.01
      if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.01) return diffs;
      diffs.push({ path: path, static: a, cloud: b });
      return diffs;
    }
    if (Array.isArray(a) !== Array.isArray(b)) { diffs.push({ path: path, reason: 'array-vs-obj' }); return diffs; }
    if (Array.isArray(a)) {
      if (a.length !== b.length) diffs.push({ path: path + '.length', static: a.length, cloud: b.length });
      var n = Math.max(a.length, b.length);
      for (var i = 0; i < n && diffs.length < 20; i++) _deepEqual(a[i], b[i], path + '[' + i + ']', diffs);
    } else {
      var keys = Object.keys(a).concat(Object.keys(b));
      var seen = {};
      for (var j = 0; j < keys.length && diffs.length < 20; j++) {
        var k = keys[j];
        if (seen[k]) continue; seen[k] = true;
        _deepEqual(a[k], b[k], path + '.' + k, diffs);
      }
    }
    return diffs;
  }

  function _fetchCloud(action) {
    return new Promise(function (resolve, reject) {
      if (!window.cloud || typeof window.cloud.callFunction !== 'function') {
        reject(new Error('cloud SDK missing'));
        return;
      }
      window.cloud.callFunction(action, {}).then(function (r) {
        if (r && r.ok) resolve(r.data);
        else reject(new Error('cloud fail: ' + (r && r.error && r.error.message)));
      }).catch(reject);
    });
  }

  function runOnce() {
    if (DIFF_STARTED) return;
    DIFF_STARTED = true;

    console.info('[diff-probe] starting double-read comparison ...');
    // 各字段对比目标: [staticVar, cloudSnapKey, label]
    var PROBES = [
      ['__CENTER_DAILY_KPI__',         'centerDailyKpi',       'kpi'],
      ['__CENTER_QUARTER_SUMMARY__',   'centerQuarterSummary', 'quarterSummary'],
      ['__TOP80_EFFECTIVE_METRICS__',  'top80Metrics',         'top80'],
      ['__TOP_RISING_DATA__',          'topRisingData',        'topRising'],
      ['__TOP_STATUS_DATA__',          'topStatusData',        'topStatus'],
      ['__DASHBOARD_RUNTIME_SUMMARY__','dashboardRuntime',     'runtime'],
      ['__REDBLACK_DATA__',            'redblack',             'redblack'],
    ];

    _fetchCloud('getKpiSnapshot').then(function (data) {
      var cloudSnap = (data && data.snapshot) || data;
      if (!cloudSnap) { console.warn('[diff-probe] cloud snap empty'); return; }

      var overall = { dataDate: cloudSnap.dataDate, version: cloudSnap.version, byField: {} };
      var totalDiff = 0;
      var totalSamples = [];

      for (var i = 0; i < PROBES.length; i++) {
        var s = window[PROBES[i][0]];
        var c = cloudSnap[PROBES[i][1]];
        var lbl = PROBES[i][2];
        if (s === undefined) { overall.byField[lbl] = 'static-missing'; continue; }
        if (c === undefined) { overall.byField[lbl] = 'cloud-missing'; continue; }
        var diffs = _deepEqual(s, c, '$' + lbl);
        overall.byField[lbl] = diffs.length;
        totalDiff += diffs.length;
        if (diffs.length && totalSamples.length < 10) {
          totalSamples = totalSamples.concat(diffs.slice(0, 3));
        }
      }

      overall.totalDiff = totalDiff;
      overall.samples = totalSamples.slice(0, 10);
      overall.userAgent = navigator.userAgent.slice(0, 80);
      overall.checkedAt = new Date().toISOString();

      if (totalDiff === 0) {
        console.info('[diff-probe] ✅ ALL FIELDS static == cloud', overall);
      } else {
        console.warn('[diff-probe] ⚠️ diff found', overall);
      }

      try {
        window.cloud && window.cloud.callFunction && window.cloud.callFunction('logDoubleReadDiff', overall).catch(function (e) {
          console.debug('[diff-probe] report skipped:', e && e.message);
        });
      } catch (_) {}
    }).catch(function (e) {
      console.warn('[diff-probe] cloud fetch fail:', e && e.message);
    });
  }

  // 3s idle 后再跑，不影响首屏
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (window.requestIdleCallback) {
        window.requestIdleCallback(runOnce, { timeout: 5000 });
      } else {
        runOnce();
      }
    }, 3000);
  });

  window.__runDiffProbe = runOnce;  // 方便手动触发
})();
