(function (window) {
  'use strict';

  var VERSION = 'v4-cloud-ready-adapter-20260623';
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
    STATIC_KEYS.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(window, key)) data[key] = window[key]; });
    return { ok: true, mode: 'static', version: VERSION, data: data, keys: Object.keys(data) };
  }

  function staticRecordsPage(params) {
    params = params || {};
    var list = Array.isArray(window.__TUOKE_REAL_RECORDS__) ? window.__TUOKE_REAL_RECORDS__ : [];
    var page = Math.max(1, Number(params.page || 1));
    var pageSize = Math.min(500, Math.max(1, Number(params.pageSize || 50)));
    var start = (page - 1) * pageSize;
    return { ok: true, action: 'queryRecords', data: { mode: 'static', snapshotVersion: params.snapshotVersion || DEFAULT_V3_VERSION, page: page, pageSize: pageSize, count: list.slice(start, start + pageSize).length, totalRecords: list.length, rows: list.slice(start, start + pageSize) }, meta: { adapterVersion: VERSION, ts: Date.now() } };
  }

  function staticLookup(params) {
    params = params || {};
    var type = params.type || 'mapping_data';
    var dictMap = { mapping_data: window.__MAPPING_DATA__ || {}, customer_link_data: window.__CUSTOMER_LINK_DATA__ || {}, customer_main_product: window.__CUSTOMER_MAIN_PRODUCT__ || {} };
    var dict = dictMap[type] || {};
    var keys = Array.isArray(params.keys) ? params.keys : (params.key ? [params.key] : []);
    var payload = {};
    keys.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(dict, key)) payload[key] = dict[key]; });
    return { ok: true, action: 'queryLookup', data: { mode: 'static', snapshotVersion: params.snapshotVersion || DEFAULT_V3_VERSION, type: type, requested: keys.length, foundCount: Object.keys(payload).length, payload: payload }, meta: { adapterVersion: VERSION, ts: Date.now() } };
  }

  function staticCustomerDetail(params) {
    params = params || {};
    var name = params.name || params.shortName || params.customerName || '';
    var link = (window.__CUSTOMER_LINK_DATA__ || {})[name];
    var product = (window.__CUSTOMER_MAIN_PRODUCT__ || {})[name];
    var records = Array.isArray(window.__TUOKE_REAL_RECORDS__) ? window.__TUOKE_REAL_RECORDS__ : [];
    var record = records.find(function (r) { return r.shortName === name || r.name === name || r.brand === name; }) || null;
    return { ok: true, action: 'getCustomerDetail', data: { mode: 'static', snapshotVersion: params.snapshotVersion || DEFAULT_V3_VERSION, detail: { name: name, lookup: { customer_link_data: link, customer_main_product: product }, record: record }, foundLookup: typeof link !== 'undefined' || typeof product !== 'undefined', foundRecord: !!record }, meta: { adapterVersion: VERSION, ts: Date.now() } };
  }

  function cloudCallable() { return window.SalesCenterApi && typeof window.SalesCenterApi.callCloud === 'function'; }
  function unwrapCloud(res) { return res && res.mode === 'dual' ? res.cloud : res; }

  function callBigAction(action, params, staticBuilder, options) {
    params = params || {}; options = options || {};
    var mode = getMode();
    if (mode === 'static' || !cloudCallable()) return Promise.resolve(staticBuilder(params));
    var cloudParams = Object.assign({ snapshotVersion: DEFAULT_V3_VERSION }, params);
    return window.SalesCenterApi.callCloud(action, cloudParams, { functionName: 'salesCenterApi' }).then(function (cloudRes) {
      if (mode === 'dual') return { ok: true, mode: 'dual', action: action, static: staticBuilder(params), cloud: cloudRes };
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

  function queryAllRecords(params, options) {
    params = Object.assign({ snapshotVersion: DEFAULT_V3_VERSION, pageSize: 500 }, params || {});
    var mode = getMode();
    if (mode === 'static' || !cloudCallable()) {
      var list = Array.isArray(window.__TUOKE_REAL_RECORDS__) ? window.__TUOKE_REAL_RECORDS__ : [];
      return Promise.resolve({ ok: true, action: 'queryAllRecords', data: { mode: 'static', rows: list, count: list.length, totalRecords: list.length } });
    }
    var rows = [];
    function loadPage(page) {
      return queryRecords(Object.assign({}, params, { page: page, pageSize: params.pageSize }), options).then(function (res) {
        var cloud = unwrapCloud(res);
        if (!cloud || cloud.ok === false || !cloud.data) throw new Error('queryRecords cloud failed');
        var part = cloud.data.rows || [];
        rows = rows.concat(part);
        var total = cloud.data.totalRecords || rows.length;
        if (rows.length < total && part.length > 0) return loadPage(page + 1);
        return { ok: true, action: 'queryAllRecords', data: { mode: 'cloud', rows: rows, count: rows.length, totalRecords: total, snapshotVersion: params.snapshotVersion } };
      });
    }
    return loadPage(1).catch(function (err) {
      var list = Array.isArray(window.__TUOKE_REAL_RECORDS__) ? window.__TUOKE_REAL_RECORDS__ : [];
      return { ok: true, action: 'queryAllRecords', data: { mode: 'static-fallback', rows: list, count: list.length, totalRecords: list.length }, meta: { cloudError: err && err.message ? err.message : String(err) } };
    });
  }

  function queryLookupAll(params, options) {
    params = Object.assign({ snapshotVersion: DEFAULT_V3_VERSION, includePayload: true }, params || {});
    var type = params.type || 'mapping_data';
    var mode = getMode();
    if (mode === 'static' || !cloudCallable()) {
      var dict = type === 'customer_link_data' ? (window.__CUSTOMER_LINK_DATA__ || {}) : type === 'customer_main_product' ? (window.__CUSTOMER_MAIN_PRODUCT__ || {}) : (window.__MAPPING_DATA__ || {});
      return Promise.resolve({ ok: true, action: 'queryLookupAll', data: { mode: 'static', type: type, payload: dict, count: Object.keys(dict).length } });
    }
    return queryLookup(Object.assign({}, params, { type: type, includePayload: true }), options).then(function (res) {
      var cloud = unwrapCloud(res);
      if (!cloud || cloud.ok === false || !cloud.data) throw new Error('queryLookup cloud failed');
      var payload = {};
      (cloud.data.chunks || []).forEach(function (chunk) {
        var p = chunk && chunk.payload ? chunk.payload : {};
        Object.keys(p).forEach(function (key) { payload[key] = p[key]; });
      });
      return { ok: true, action: 'queryLookupAll', data: { mode: 'cloud', type: type, payload: payload, count: Object.keys(payload).length, chunks: (cloud.data.chunks || []).length } };
    }).catch(function (err) {
      var dict = type === 'customer_link_data' ? (window.__CUSTOMER_LINK_DATA__ || {}) : type === 'customer_main_product' ? (window.__CUSTOMER_MAIN_PRODUCT__ || {}) : (window.__MAPPING_DATA__ || {});
      return { ok: true, action: 'queryLookupAll', data: { mode: 'static-fallback', type: type, payload: dict, count: Object.keys(dict).length }, meta: { cloudError: err && err.message ? err.message : String(err) } };
    });
  }

  function callWriteAction(action, params) {
    if (!cloudCallable()) return Promise.resolve(window.SalesCenterApi ? window.SalesCenterApi.errorResponse(action, 'CLOUDBASE_SDK_NOT_READY', 'CloudBase SDK is not ready') : { ok: false, action: action, error: { code: 'API_NOT_READY', message: 'SalesCenterApi is not ready' } });
    return window.SalesCenterApi.callCloud(action, params || {}, { functionName: 'salesCenterApi' });
  }
  function getProgress(params) { return callWriteAction('getProgress', params); }
  function updateProgress(params) { return callWriteAction('updateProgress', params); }
  function upsertRecord(params) { return callWriteAction('upsertRecord', params); }
  function deleteRecord(params) { return callWriteAction('deleteRecord', params); }
  function exportRecords(params) { return callWriteAction('exportRecords', params); }

  function reportMode() { var mode = getMode(); if (window.console && console.info) console.info('[sales-center-data] mode=' + mode + ' adapter=' + VERSION); return mode; }

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
    queryAllRecords: queryAllRecords,
    queryLookup: queryLookup,
    queryLookupAll: queryLookupAll,
    getCustomerDetail: getCustomerDetail,
    getProgress: getProgress,
    updateProgress: updateProgress,
    upsertRecord: upsertRecord,
    deleteRecord: deleteRecord,
    exportRecords: exportRecords,
    reportMode: reportMode
  };
  reportMode();
})(window);
