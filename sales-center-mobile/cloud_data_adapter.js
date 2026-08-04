/*
 * cloud_data_adapter.js · V1 · 云端读适配层
 *
 * 目的：给前端一个统一的数据入口 window.dataAdapter，内部根据 __USE_CLOUD_READ__ 开关
 *      决定读云端 API 还是静态 JS 文件。为V1 云端切换和双读对比铺路。
 *
 * 开关：
 *   - localStorage.getItem('sc_use_cloud_read') === '1'  → 走云端
 *   - window.__USE_CLOUD_READ__ === true → 走云端
 *   - 默认                → 走静态 JS (安全兜底)
 *
 * 灰度：URL 参数 ?cloud=1 打开当次会话（写入 localStorage）
 *      URL 参数 ?cloud=0 关闭
 *
 * 用法：
 *   const kpi = await window.dataAdapter.getKpi();
 *   const summary = await window.dataAdapter.getQuarterSummary();
 *
 * 注意：所有接口返回 Promise，与老代码同步读window.__XXX__ 的方式不完全兼容，
 *      改造前端时用 async/await 或 .then() 包裹即可。
 */
(function () {
  'use strict';

  // ============灰度开关 ============
  function _readCloudSwitch() {
    try {
      var urlParams = new URLSearchParams(window.location.search);
      var q = urlParams.get('cloud');
      if (q === '1') {
        localStorage.setItem('sc_use_cloud_read', '1');
        return true;
      }
      if (q === '0') {
        localStorage.removeItem('sc_use_cloud_read');
        return false;
      }
      if (window.__USE_CLOUD_READ__ === true) return true;
      if (window.__USE_CLOUD_READ__ === false) return false;
      return localStorage.getItem('sc_use_cloud_read') === '1';
    } catch (_) {
      return false;
    }
  }
  var USE_CLOUD = _readCloudSwitch();

  // 内存缓存（一次页面会话内，同一份数据不重复拉）
  var _cache = {};

  function _cacheKey(action, params) {
    return action + '::' + JSON.stringify(params || {});
  }

  // ============ 云端调用（走 window.cloud.callFunction，来自 cloud_sync.js） ============
  function _cloudCall(action, params) {
    return new Promise(function (resolve, reject) {
      if (!window.cloud || typeof window.cloud.callFunction !== 'function') {
        reject(new Error('cloud SDK 未初始化（cloud_sync.js 未加载？）'));
        return;
      }
      window.cloud.callFunction(action, params || {}).then(function (r) {
        if (r && r.ok) {
          resolve(r.data || r);
        } else {
          var msg = (r && r.error && r.error.message) || 'unknown';
          reject(new Error('cloud fail: ' + action + ' → ' + msg));
        }
      }).catch(reject);
    });
  }

  // ============ 静态读（老路径，从 window.__XXX__ 拿） ============
  function _staticRead(varName) {
    return new Promise(function (resolve, reject) {
      // 等待静态 JS 加载完（最多 3s）
      var start = Date.now();
      (function poll() {
        if (window[varName] !== undefined) {
          resolve(window[varName]);
          return;
        }
        if (Date.now() - start > 3000) {
          reject(new Error('static timeout: ' + varName));
          return;
        }
        setTimeout(poll, 50);
      })();
    });
  }

  // ============ 适配器方法 ============
  var adapter = {
    /**
     * KPI 全字段（对应 center_daily_kpi.js）
     * @param {string} [dataDate] 可选，默认取最新
     * @returns {Promise<Object>}
     */
    getKpi: function (dataDate) {
      var params = dataDate ? { dataDate: dataDate } : {};
      var key = _cacheKey('getKpi', params);
      if (_cache[key]) return Promise.resolve(_cache[key]);

      var p;
      if (USE_CLOUD) {
        p = _cloudCall('getKpiSnapshot', params).then(function (data) {
          var snap = data.snapshot || data;
          return snap.centerDailyKpi || snap;
        });
      } else {
        p = _staticRead('__CENTER_DAILY_KPI__');
      }
      return p.then(function (v) { _cache[key] = v; return v; });
    },

    /**
     * 各销售 Q3 quarter summary（对应 center_quarter_summary.js）
     * @returns {Promise<Array>}
     */
    getQuarterSummary: function (dataDate) {
      var params = dataDate ? { dataDate: dataDate } : {};
      var key = _cacheKey('getQuarterSummary', params);
      if (_cache[key]) return Promise.resolve(_cache[key]);

      var p;
      if (USE_CLOUD) {
        p = _cloudCall('getKpiSnapshot', params).then(function (data) {
          var snap = data.snapshot || data;
          return snap.centerQuarterSummary || [];
        });
      } else {
        p = _staticRead('__CENTER_QUARTER_SUMMARY__');
      }
      return p.then(function (v) { _cache[key] = v; return v; });
    },

    /**
     * 涨跌榜数据（对应 redblack_data.js）
     * @returns {Promise<Object>}  { q1: {...}, q2: {...} }
     */
    getRedblack: function (dataDate) {
      var params = dataDate ? { dataDate: dataDate } : {};
      var key = _cacheKey('getRedblack', params);
      if (_cache[key]) return Promise.resolve(_cache[key]);
      var p;
      if (USE_CLOUD) {
        // getTopMetricsFromSnapshot 目前只有 top80/rising/status;
        // redblack 走 getKpiSnapshot 里的 redblack 字段
        p = _cloudCall('getKpiSnapshot', params).then(function (data) {
          var snap = data.snapshot || data;
          return snap.redblack || { q1: {}, q2: {} };
        });
      } else {
        p = _staticRead('__REDBLACK_DATA__');
      }
      return p.then(function (v) { _cache[key] = v; return v; });
    },

    /**
     * Top80 有效客户名单（对应 top80_effective_metrics.js）
     * @returns {Promise<Array>}
     */
    getTop80: function (dataDate) {
      var params = { type: 'top80' };
      if (dataDate) params.dataDate = dataDate;
      var key = _cacheKey('getTop80', params);
      if (_cache[key]) return Promise.resolve(_cache[key]);
      var p;
      if (USE_CLOUD) {
        p = _cloudCall('getTopMetricsFromSnapshot', params).then(function (data) {
          return data.data || [];
        });
      } else {
        p = _staticRead('__TOP80_EFFECTIVE_METRICS__');
      }
      return p.then(function (v) { _cache[key] = v; return v; });
    },

    /**
     * 潜力起量客户（对应 top_rising_data.js）
     * @returns {Promise<Array>}
     */
    getTopRising: function (dataDate) {
      var params = { type: 'rising' };
      if (dataDate) params.dataDate = dataDate;
      var key = _cacheKey('getTopRising', params);
      if (_cache[key]) return Promise.resolve(_cache[key]);
      var p;
      if (USE_CLOUD) {
        p = _cloudCall('getTopMetricsFromSnapshot', params).then(function (data) {
          return data.data || [];
        });
      } else {
        p = _staticRead('__TOP_RISING_DATA__');
      }
      return p.then(function (v) { _cache[key] = v; return v; });
    },

    /**
     * 头部客户状态（对应 top_status_data.js）
     * @returns {Promise<Object>}
     */
    getTopStatus: function (dataDate) {
      var params = { type: 'status' };
      if (dataDate) params.dataDate = dataDate;
      var key = _cacheKey('getTopStatus', params);
      if (_cache[key]) return Promise.resolve(_cache[key]);
      var p;
      if (USE_CLOUD) {
        p = _cloudCall('getTopMetricsFromSnapshot', params).then(function (data) {
          return data.data || {};
        });
      } else {
        p = _staticRead('__TOP_STATUS_DATA__');
      }
      return p.then(function (v) { _cache[key] = v; return v; });
    },

    /**
     * 看板 runtime 汇总（对应 dashboard_runtime_summary.js）
     * @returns {Promise<Object>}
     */
    getRuntimeSummary: function (dataDate) {
      var params = dataDate ? { dataDate: dataDate } : {};
      var key = _cacheKey('getRuntimeSummary', params);
      if (_cache[key]) return Promise.resolve(_cache[key]);
      var p;
      if (USE_CLOUD) {
        p = _cloudCall('getKpiSnapshot', params).then(function (data) {
          var snap = data.snapshot || data;
          return snap.dashboardRuntime || {};
        });
      } else {
        p = _staticRead('__DASHBOARD_RUNTIME_SUMMARY__');
      }
      return p.then(function (v) { _cache[key] = v; return v; });
    },

    /**
     * 当前是否云端模式
     */
    isCloudMode: function () { return USE_CLOUD; },

    /**
     * 清缓存（重新拉取）
     */
    invalidate: function () { _cache = {}; },
  };

  window.dataAdapter = adapter;

  if (typeof console !== 'undefined') {
    console.info('[dataAdapter] initialized · mode=' + (USE_CLOUD ? 'CLOUD' : 'STATIC'));
  }
})();
