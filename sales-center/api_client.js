(function (window) {
  'use strict';

  var ENV_ID = 'adq-tuoke-2-d9gktr9mn2e462acd';
  var FUNCTION_NAME = 'salesCenterApi';
  var VERSION = 'v1-skeleton-20260622';

  function getQuery() {
    var out = {};
    try {
      var sp = new URLSearchParams(window.location.search || '');
      sp.forEach(function (value, key) { out[key] = value; });
    } catch (_) {}
    return out;
  }

  function normalizeMode(mode) {
    mode = String(mode || '').toLowerCase();
    if (mode === 'cloud' || mode === 'dual' || mode === 'static') return mode;
    return 'static';
  }

  var query = getQuery();
  var dataMode = normalizeMode(query.dataMode || query.scDataMode || window.__SALES_CENTER_DATA_MODE__);
  window.__SALES_CENTER_DATA_MODE__ = dataMode;

  function buildMeta(extra) {
    var meta = {
      clientVersion: VERSION,
      dataMode: dataMode,
      page: window.location.pathname.split('/').pop() || 'index.html',
      ts: Date.now()
    };
    if (extra) {
      Object.keys(extra).forEach(function (k) { meta[k] = extra[k]; });
    }
    return meta;
  }

  function localResponse(action, data, meta) {
    return Promise.resolve({
      ok: true,
      action: action,
      data: data || {},
      meta: buildMeta(meta)
    });
  }

  function errorResponse(action, code, message, detail) {
    return {
      ok: false,
      action: action,
      error: {
        code: code,
        message: message,
        detail: detail || null
      },
      meta: buildMeta()
    };
  }

  function getCloudbaseApp() {
    if (!window.cloudbase || typeof window.cloudbase.init !== 'function') return null;
    if (window.__SALES_CENTER_CLOUDBASE_APP__) return window.__SALES_CENTER_CLOUDBASE_APP__;
    try {
      window.__SALES_CENTER_CLOUDBASE_APP__ = window.cloudbase.init({ env: ENV_ID });
      return window.__SALES_CENTER_CLOUDBASE_APP__;
    } catch (e) {
      console.warn('[sales-center-api] cloudbase init failed', e && e.message);
      return null;
    }
  }

  function callCloud(action, params, options) {
    options = options || {};
    var app = getCloudbaseApp();
    if (!app || typeof app.callFunction !== 'function') {
      return Promise.resolve(errorResponse(action, 'CLOUDBASE_SDK_NOT_READY', 'CloudBase SDK is not ready'));
    }
    return app.callFunction({
      name: options.functionName || FUNCTION_NAME,
      data: {
        action: action,
        params: params || {},
        meta: buildMeta(options.meta)
      }
    }).then(function (res) {
      return res && (res.result || res.data || res);
    }).catch(function (e) {
      return errorResponse(action, 'CALL_FUNCTION_FAILED', e && e.message ? e.message : String(e), {
        name: options.functionName || FUNCTION_NAME
      });
    });
  }

  function call(action, params, options) {
    options = options || {};
    action = action || 'healthcheck';

    if (dataMode === 'static' && !options.forceCloud) {
      return localResponse(action, {
        mode: 'static',
        skippedCloud: true,
        reason: 'V1 keeps production on static data by default.'
      });
    }

    return callCloud(action, params, options).then(function (res) {
      if (res && res.ok !== false) return res;
      if (dataMode === 'cloud' && options.fallback !== false) {
        console.warn('[sales-center-api] cloud failed, fallback static', res && res.error);
        return localResponse(action, {
          mode: 'static-fallback',
          cloudError: res && res.error ? res.error : null
        }, { fallback: true });
      }
      return res;
    });
  }

  function healthcheck(options) {
    return call('healthcheck', {}, options || {});
  }

  window.SalesCenterApi = {
    version: VERSION,
    envId: ENV_ID,
    functionName: FUNCTION_NAME,
    getMode: function () { return dataMode; },
    setMode: function (mode) {
      dataMode = normalizeMode(mode);
      window.__SALES_CENTER_DATA_MODE__ = dataMode;
      return dataMode;
    },
    call: call,
    callCloud: callCloud,
    healthcheck: healthcheck,
    localResponse: localResponse,
    errorResponse: errorResponse
  };
})(window);
