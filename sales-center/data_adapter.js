(function (window) {
  'use strict';

  var VERSION = 'v1-skeleton-20260622';
  var STATIC_KEYS = [
    '__CENTER_DAILY_KPI__',
    '__CENTER_QUARTER_SUMMARY__',
    '__DASHBOARD_RUNTIME_SUMMARY__',
    '__TOP80_EFFECTIVE_METRICS__',
    '__TOP_STATUS_DATA__',
    '__TOP_STATUS_LIST__',
    '__REDBLACK_DATA__',
    '__TOP_RISING_DATA__',
    '__YEST_NEW_CUSTOMER_TASKS__'
  ];

  function getMode() {
    if (window.SalesCenterApi && typeof window.SalesCenterApi.getMode === 'function') {
      return window.SalesCenterApi.getMode();
    }
    return window.__SALES_CENTER_DATA_MODE__ || 'static';
  }

  function readStaticSnapshot() {
    var data = {};
    STATIC_KEYS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(window, key)) data[key] = window[key];
    });
    return {
      ok: true,
      mode: 'static',
      version: VERSION,
      data: data,
      keys: Object.keys(data)
    };
  }

  function getBootstrap(options) {
    options = options || {};
    var mode = getMode();
    if (mode === 'static') return Promise.resolve(readStaticSnapshot());

    if (!window.SalesCenterApi) return Promise.resolve(readStaticSnapshot());

    return window.SalesCenterApi.call('getBootstrap', options.params || {}, {
      fallback: true,
      forceCloud: mode === 'cloud' || mode === 'dual'
    }).then(function (res) {
      if (mode === 'dual') {
        return {
          ok: true,
          mode: 'dual',
          static: readStaticSnapshot(),
          cloud: res
        };
      }
      if (!res || res.ok === false || !res.data || res.data.mode === 'static-fallback') {
        return readStaticSnapshot();
      }
      return res;
    }).catch(function () {
      return readStaticSnapshot();
    });
  }

  function reportMode() {
    var mode = getMode();
    if (window.console && console.info) {
      console.info('[sales-center-data] mode=' + mode + ' adapter=' + VERSION);
    }
    return mode;
  }

  window.SalesCenterDataAdapter = {
    version: VERSION,
    staticKeys: STATIC_KEYS.slice(),
    getMode: getMode,
    readStaticSnapshot: readStaticSnapshot,
    getBootstrap: getBootstrap,
    reportMode: reportMode
  };

  reportMode();
})(window);
