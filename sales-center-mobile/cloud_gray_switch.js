(function (window) {
  'use strict';

  var VERSION = 'cloud-gray-switch-20260623e';
  var MODE_KEY = 'sales_center_gray_data_mode';
  var FORCE_STATIC_KEY = 'sales_center_force_static';
  var DEVICE_KEY = 'sales_center_gray_device_id';
  var RTX_KEY = 'cloud_rtx_v2';
  var VALID_MODES = { static: true, dual: true, cloud: true };

  var CONFIG = window.__SALES_CENTER_CLOUD_GRAY_CONFIG__ || {
    enabled: true,
    defaultMode: 'static',
    grayMode: 'dual',
    rolloutPercent: 0,
    allowRtx: ['ziqingdu'],
    blockRtx: [],
    note: '2026-06-23 灰度开关：默认 static；子青账号先进入 dual；URL/localStorage 可覆盖；forceStatic 一键回退。'
  };
  window.__SALES_CENTER_CLOUD_GRAY_CONFIG__ = CONFIG;

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
    return VALID_MODES[mode] ? mode : '';
  }

  function readStorage(key) {
    try { return window.localStorage ? window.localStorage.getItem(key) : ''; } catch (_) { return ''; }
  }

  function writeStorage(key, value) {
    try { if (window.localStorage) window.localStorage.setItem(key, value); } catch (_) {}
  }

  function removeStorage(key) {
    try { if (window.localStorage) window.localStorage.removeItem(key); } catch (_) {}
  }

  function getRtx() {
    return String(readStorage(RTX_KEY) || '').trim().toLowerCase();
  }

  function getDeviceId() {
    var id = readStorage(DEVICE_KEY);
    if (!id) {
      id = 'd_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
      writeStorage(DEVICE_KEY, id);
    }
    return id;
  }

  function includes(list, value) {
    if (!value || !Array.isArray(list)) return false;
    value = String(value).toLowerCase();
    return list.some(function (item) { return String(item || '').toLowerCase() === value; });
  }

  function hashPercent(seed) {
    seed = String(seed || '');
    var h = 0;
    for (var i = 0; i < seed.length; i++) {
      h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % 100;
  }

  function boolFlag(v) {
    v = String(v || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }

  function decideMode() {
    var query = getQuery();
    var urlMode = normalizeMode(query.dataMode || query.scDataMode);
    var rtx = getRtx();
    var decision = {
      version: VERSION,
      mode: 'static',
      reason: 'default-static',
      rtx: rtx || '',
      config: {
        enabled: !!CONFIG.enabled,
        defaultMode: normalizeMode(CONFIG.defaultMode) || 'static',
        grayMode: normalizeMode(CONFIG.grayMode) || 'dual',
        rolloutPercent: Math.max(0, Math.min(100, Number(CONFIG.rolloutPercent || 0))),
        allowRtx: CONFIG.allowRtx || [],
        blockRtx: CONFIG.blockRtx || []
      },
      query: query
    };

    if (boolFlag(query.forceStatic) || boolFlag(query.grayOff) || readStorage(FORCE_STATIC_KEY) === '1') {
      decision.mode = 'static';
      decision.reason = boolFlag(query.forceStatic) || boolFlag(query.grayOff) ? 'url-force-static' : 'local-force-static';
      return decision;
    }

    if (urlMode) {
      decision.mode = urlMode;
      decision.reason = 'url-dataMode';
      return decision;
    }

    var localMode = normalizeMode(readStorage(MODE_KEY));
    if (localMode) {
      decision.mode = localMode;
      decision.reason = 'local-override';
      return decision;
    }

    if (!CONFIG.enabled) {
      decision.mode = decision.config.defaultMode;
      decision.reason = 'gray-disabled';
      return decision;
    }

    if (includes(CONFIG.blockRtx, rtx)) {
      decision.mode = 'static';
      decision.reason = 'rtx-blocked';
      return decision;
    }

    if (includes(CONFIG.allowRtx, rtx)) {
      decision.mode = decision.config.grayMode;
      decision.reason = 'rtx-allowlist';
      return decision;
    }

    var rolloutPercent = decision.config.rolloutPercent;
    var seed = rtx || getDeviceId();
    if (rolloutPercent > 0 && hashPercent(seed) < rolloutPercent) {
      decision.mode = decision.config.grayMode;
      decision.reason = 'percent-rollout';
      decision.rolloutBucket = hashPercent(seed);
      return decision;
    }

    decision.mode = decision.config.defaultMode;
    return decision;
  }

  var decision = decideMode();
  window.__SALES_CENTER_GRAY_DECISION__ = decision;
  window.__SALES_CENTER_DATA_MODE__ = decision.mode;

  window.SalesCenterGray = {
    version: VERSION,
    status: function () {
      window.__SALES_CENTER_GRAY_DECISION__ = decideMode();
      return window.__SALES_CENTER_GRAY_DECISION__;
    },
    enableForMe: function (mode) {
      mode = normalizeMode(mode) || 'dual';
      removeStorage(FORCE_STATIC_KEY);
      writeStorage(MODE_KEY, mode);
      return { ok: true, mode: mode, tip: '刷新页面后生效。' };
    },
    disableForMe: function () {
      removeStorage(MODE_KEY);
      return { ok: true, mode: 'config/default', tip: '刷新页面后生效。' };
    },
    forceStatic: function () {
      writeStorage(FORCE_STATIC_KEY, '1');
      removeStorage(MODE_KEY);
      return { ok: true, mode: 'static', tip: '刷新页面后生效。' };
    },
    clearForceStatic: function () {
      removeStorage(FORCE_STATIC_KEY);
      return { ok: true, tip: '刷新页面后生效。' };
    }
  };
})(window);
