/*!
 * sc_logger.js — 销售作战中心统一日志分级
 * 建立于 2026-07-27 晚（架构优化阶段 1-b）
 *
 * 用法（保持与 console 兼容签名，直接替换）:
 *   SC.log.debug('module.func', '状态', payload)   // 生产静默
 *   SC.log.info(...)   // 生产可见（成功状态、里程碑）
 *   SC.log.warn(...)   // 生产可见（可自愈异常）
 *   SC.log.error(...)  // 生产可见（严重异常，未来接 Sentry）
 *
 * 生产级别切换：
 *   localStorage.setItem('sc_log_level', 'debug')  // 打开全量
 *   localStorage.setItem('sc_log_level', 'warn')   // 只看 warn+error
 *   默认 = 'info'（生产环境）
 *
 * 死规矩：
 *   1. 不新增 console.* 到生产代码；新代码统一走 SC.log
 *   2. logger 本身不允许 throw，任何异常静默吞（避免因日志把主流程挂了）
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 99 };
  var DEFAULT_LEVEL = 'info';

  function _getLevel() {
    try {
      var l = localStorage.getItem('sc_log_level');
      if (l && LEVELS.hasOwnProperty(l)) return l;
    } catch (_) {}
    // 本地开发（localhost / 127.0.0.1 / file://）自动 debug
    try {
      var h = String(location.hostname || '');
      if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'debug';
    } catch (_) {}
    return DEFAULT_LEVEL;
  }

  function _shouldLog(lv) {
    return LEVELS[lv] >= LEVELS[_getLevel()];
  }

  function _fmt(mod) {
    var ts = new Date().toISOString().slice(11, 19);
    return '[' + ts + '][' + (mod || 'sc') + ']';
  }

  var SC = window.__SC = window.__SC || {};
  SC.log = {
    debug: function (mod) {
      if (!_shouldLog('debug')) return;
      try {
        var args = Array.prototype.slice.call(arguments, 1);
        console.debug.apply(console, [_fmt(mod)].concat(args));
      } catch (_) {}
    },
    info: function (mod) {
      if (!_shouldLog('info')) return;
      try {
        var args = Array.prototype.slice.call(arguments, 1);
        console.info.apply(console, [_fmt(mod)].concat(args));
      } catch (_) {}
    },
    warn: function (mod) {
      if (!_shouldLog('warn')) return;
      try {
        var args = Array.prototype.slice.call(arguments, 1);
        console.warn.apply(console, [_fmt(mod)].concat(args));
      } catch (_) {}
    },
    error: function (mod) {
      if (!_shouldLog('error')) return;
      try {
        var args = Array.prototype.slice.call(arguments, 1);
        console.error.apply(console, [_fmt(mod)].concat(args));
      } catch (_) {}
      // 未来 Sentry 挂钩（预留）
      try {
        if (typeof SC.onError === 'function') {
          SC.onError(mod, Array.prototype.slice.call(arguments, 1));
        }
      } catch (_) {}
    },
    // 兼容别名
    setLevel: function (lv) {
      if (!LEVELS.hasOwnProperty(lv)) return false;
      try { localStorage.setItem('sc_log_level', lv); } catch (_) {}
      return true;
    },
    getLevel: _getLevel
  };

  // 便利入口：window.SCLog.info(...) 简写
  window.SCLog = SC.log;

  // ===== 安全 HTML 转义（防 XSS）=====
  // 用法：SC.esc(userInput) — 拼 innerHTML 时对用户可控字段必须转义
  var _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;' };
  SC.esc = function (s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"'`/]/g, function (c) { return _ESC_MAP[c] || c; });
  };
  // 兼容别名
  window.__scEsc = SC.esc;

  // ===== 生产降噪 =====
  // 生产环境（非 localhost 且未主动设 sc_log_level=debug）静默 console.log / console.debug
  // 保留 warn/error 以便销售侧问题排查
  try {
    var lvl = _getLevel();
    if (LEVELS[lvl] > LEVELS.debug) {
      // 备份原始 console，供 SC.log 内部使用
      SC._origConsole = {
        log: console.log,
        info: console.info,
        debug: console.debug,
        warn: console.warn,
        error: console.error
      };
      // 拦截噪音
      var noop = function () {};
      if (LEVELS[lvl] > LEVELS.debug) console.debug = noop;
      if (LEVELS[lvl] > LEVELS.info)  {
        console.log = noop;
        console.info = noop;
      }
    }
  } catch (_) {}
})();
