(function (window) {
  'use strict';

  var VERSION = 'v3.2-big-dual-adapter-20260623';
  var DEFAULT_V3_VERSION = '20260622_v3_big';
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
    if (window.SalesCenterApi && typeof window.SalesCenterApi.getMode === 'function') return window.SalesCenterApi.getMode();
    return window.__SALES_CENTER_DATA_MODE__ || 'static';
  }

  function readStaticSnapshot() {
    var data = {};
    STATIC_KEYS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(window, key)) data[key] = window[key];
    });
    return { ok: true, mode: 'static', version: VERSION, data: data, keys: Object.keys(data) };
  }

  function staticRecordsPage(params) {
    params = params || {};
    var list = Array.isArray(window.__TUOKE_REAL_RECORDS__) ? window.__TUOKE_REAL_RECORDS__ : [];
    var page = Math.max(1, Number(params.page || 1));
    var pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 50)));
    var start = (page - 1) * pageSize;
    return {
      ok: true,
      action: 'queryRecords',
      data: {
        mode: 'static',
        snapshotVersion: params.snapshotVersion || DEFAULT_V3_VERSION,
        page: page,
        pageSize: pageSize,
        count: list.slice(start, start + pageSize).length,
        totalRecords: list.length,
        rows: list.slice(start, start + pageSize)
      },
      meta: { adapterVersion: VERSION, ts: Date.now() }
    };
  }

  function staticLookup(params) {
    params = params || {};
    var type = params.type || 'mapping_data';
    var dictMap = {
      mapping_data: window.__MAPPING_DATA__ || {},
      customer_link_data: window.__CUSTOMER_LINK_DATA__ || {},
      customer_main_product: window.__CUSTOMER_MAIN_PRODUCT__ || {}
    };
    var dict = dictMap[type] || {};
    var keys = Array.isArray(params.keys) ? params.keys : (params.key ? [params.key] : []);
    var payload = {};
    keys.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(dict, key)) payload[key] = dict[key];
    });
    return {
      ok: true,
      action: 'queryLookup',
      data: {
        mode: 'static',
        snapshotVersion: params.snapshotVersion || DEFAULT_V3_VERSION,
        type: type,
        requested: keys.length,
        foundCount: Object.keys(payload).length,
        payload: payload
      },
      meta: { adapterVersion: VERSION, ts: Date.now() }
    };
  }

  function staticCustomerDetail(params) {
    params = params || {};
    var name = params.name || params.shortName || params.customerName || '';
    var link = (window.__CUSTOMER_LINK_DATA__ || {})[name];
    var product = (window.__CUSTOMER_MAIN_PRODUCT__ || {})[name];
    var records = Array.isArray(window.__TUOKE_REAL_RECORDS__) ? window.__TUOKE_REAL_RECORDS__ : [];
    var record = records.find(function (r) { return r.shortName === name || r.name === name || r.brand === name; }) || null;
    return {
      ok: true,
      action: 'getCustomerDetail',
      data: {
        mode: 'static',
        snapshotVersion: params.snapshotVersion || DEFAULT_V3_VERSION,
        detail: { name: name, lookup: { customer_link_data: link, customer_main_product: product }, record: record },
        foundLookup: typeof link !== 'undefined' || typeof product !== 'undefined',
        foundRecord: !!record
      },
      meta: { adapterVersion: VERSION, ts: Date.now() }
    };
  }

  function callBigAction(action, params, staticBuilder, options) {
    params = params || {};
    options = options || {};
    var mode = getMode();
    if (mode === 'static' || !window.SalesCenterApi || typeof window.SalesCenterApi.callCloud !== 'function') {
      return Promise.resolve(staticBuilder(params));
    }
    var cloudParams = Object.assign({ snapshotVersion: DEFAULT_V3_VERSION }, params);
    return window.SalesCenterApi.callCloud(action, cloudParams, { functionName: 'salesCenterApi' }).then(function (cloudRes) {
      if (mode === 'dual') {
        return { ok: true, mode: 'dual', action: action, static: staticBuilder(params), cloud: cloudRes };
      }
      if (!cloudRes || cloudRes.ok === false) return staticBuilder(params);
      return cloudRes;
    }).catch(function (err) {
      var fallback = staticBuilder(params);
      fallback.meta = fallback.meta || {};
      fallback.meta.cloudError = err && err.message ? err.message : String(err);
      return fallback;
    });
  }

  function getBootstrap(options) {
    options = options || {};
    var mode = getMode();
    if (mode === 'static') return Promise.resolve(readStaticSnapshot());
    if (!window.SalesCenterApi) return Promise.resolve(readStaticSnapshot());
    return window.SalesCenterApi.call('getBootstrap', options.params || {}, { fallback: true, forceCloud: mode === 'cloud' || mode === 'dual' }).then(function (res) {
      if (mode === 'dual') return { ok: true, mode: 'dual', static: readStaticSnapshot(), cloud: res };
      if (!res || res.ok === false || !res.data || res.data.mode === 'static-fallback') return readStaticSnapshot();
      return res;
    }).catch(function () { return readStaticSnapshot(); });
  }

  function queryRecords(params, options) { return callBigAction('queryRecords', params, staticRecordsPage, options); }
  function queryLookup(params, options) { return callBigAction('queryLookup', params, staticLookup, options); }
  function getCustomerDetail(params, options) { return callBigAction('getCustomerDetail', params, staticCustomerDetail, options); }

  function reportMode() {
    var mode = getMode();
    if (window.console && console.info) console.info('[sales-center-data] mode=' + mode + ' adapter=' + VERSION);
    return mode;
  }

  window.SalesCenterDataAdapter = {
    version: VERSION,
    defaultV3Version: DEFAULT_V3_VERSION,
    staticKeys: STATIC_KEYS.slice(),
    getMode: getMode,
    readStaticSnapshot: readStaticSnapshot,
    staticRecordsPage: staticRecordsPage,
    staticLookup: staticLookup,
    staticCustomerDetail: staticCustomerDetail,
    getBootstrap: getBootstrap,
    queryRecords: queryRecords,
    queryLookup: queryLookup,
    getCustomerDetail: getCustomerDetail,
    reportMode: reportMode
  };

  reportMode();
})(window);
