/* 第三方库按需加载器 v1.0（2026-06-13 性能优化）
 * 把 xlsx / echarts 等大 CDN 脚本从首屏同步加载改为按需异步加载。
 * 用法：
 *   await window.ensureXLSX();    // 用户点导出/导入前调用
 *   await window.ensureEcharts(); // 渲染图表前调用
 * 每个库只会真正加载一次（结果缓存为 Promise），重复调用直接复用。
 */
(function () {
  if (window.__LIB_LOADER_BOUND__) return;
  window.__LIB_LOADER_BOUND__ = true;

  var CDN = {
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    echarts: 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js'
  };

  var _cache = {};

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('CDN 加载失败: ' + src)); };
      document.head.appendChild(s);
    });
  }

  // 通用：确保某个库已就绪（globalCheck 返回 true 表示已加载）
  function ensure(key, globalCheck) {
    if (globalCheck()) return Promise.resolve();        // 已存在（如被其他页面同步引入）
    if (_cache[key]) return _cache[key];                // 正在加载，复用 Promise
    _cache[key] = loadScript(CDN[key]).then(function () {
      if (!globalCheck()) throw new Error(key + ' 加载后仍不可用');
    });
    return _cache[key];
  }

  window.ensureXLSX = function () {
    return ensure('xlsx', function () { return typeof XLSX !== 'undefined'; });
  };

  window.ensureEcharts = function () {
    return ensure('echarts', function () { return typeof echarts !== 'undefined'; });
  };
})();
