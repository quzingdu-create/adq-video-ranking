/**
 * 🎯 靶向名单跟进看板 · CloudBase 共享数据层
 * 复用销售作战中心同一套 CloudBase 环境与登录态（cloud_sync.js 已登录则直接复用 token）
 *
 * 集合：
 *   pursuit_customers  客户跟进记录（id / name / contact / phone / industry / sales / entity / source / stage / note / updatedAt / createdAt / history[]）
 *   pursuit_meta       元数据（key=stages 阶段配置；key=seed 种子标记）
 *
 * 暴露：window.pursuitCloud
 *   .ready()                  → Promise，确保 CloudBase 已就绪（复用 cloud_sync 登录态）
 *   .loadAll()                → Promise<{customers, stages, seeded}>
 *   .seedIfEmpty(seedArr, defaultStages) → 云端为空则批量灌种子（带 meta 标记防重复）
 *   .saveCustomer(rec)        → upsert 单条（按 id）
 *   .deleteCustomer(id)       → 删除单条
 *   .saveStages(stages)       → 保存阶段配置
 *   .isReady()                → bool
 *
 * 依赖：先引入 CloudBase SDK（cloudbase.full.js）+ cloud_sync.js
 */
(function (global) {
  'use strict';

  var ENV_ID = 'adq-tuoke-2-d9gktr9mn2e462acd';
  var COLL_CUST = 'pursuit_customers';
  var COLL_META = 'pursuit_meta';
  var PAGE = 100;

  var _db = null, _ready = null, _ok = false;

  // 确保 CloudBase 就绪：完全复用 cloud_sync.js 的同一登录态 + 同一数据库句柄
  // 关键修复(2026-06-13)：不再自己 SDK.init（那会创建第二个 app 实例、登录态为空→连不上云）
  //   改为 cloud.requireLogin 触发/复用登录，再 cloud.getDb() 拿作战中心同一个 _db。
  function ready() {
    if (_ready) return _ready;
    _ready = new Promise(function (resolve, reject) {
      if (!global.cloud || typeof global.cloud.getDb !== 'function') {
        reject(new Error('cloud_sync.js 未就绪或版本过旧（缺 getDb）'));
        return;
      }
      function grab() {
        global.cloud.getDb().then(function (db) {
          _db = db; _ok = true; resolve();
        }).catch(reject);
      }
      // requireLogin：已登录直接回调；未登录弹作战中心选人/密码框
      if (typeof global.cloud.requireLogin === 'function') {
        global.cloud.requireLogin(function () { grab(); });
      } else {
        grab();
      }
    });
    return _ready;
  }

  function isReady() { return _ok; }

  // 拉全部客户（分页）
  function fetchAllCustomers() {
    var coll = _db.collection(COLL_CUST);
    var all = [];
    function page(skip) {
      return coll.skip(skip).limit(PAGE).get().then(function (res) {
        var list = res.data || [];
        all = all.concat(list);
        if (list.length === PAGE) return page(skip + PAGE);
        return all;
      });
    }
    return page(0);
  }

  function loadAll() {
    return ready().then(function () {
      return Promise.all([
        fetchAllCustomers(),
        _db.collection(COLL_META).where({ key: 'stages' }).get().catch(function () { return { data: [] }; }),
        _db.collection(COLL_META).where({ key: 'seed' }).get().catch(function () { return { data: [] }; })
      ]).then(function (r) {
        var customers = (r[0] || []).map(function (d) {
          // 去掉 CloudBase 内部 _id，保留业务字段
          var o = {}; for (var k in d) { if (k !== '_id' && k !== '_openid') o[k] = d[k]; }
          return o;
        });
        var stages = (r[1].data && r[1].data[0] && r[1].data[0].stages) || null;
        var seeded = !!(r[2].data && r[2].data.length);
        return { customers: customers, stages: stages, seeded: seeded };
      });
    });
  }

  // 云端为空（无 seed 标记且无客户）→ 批量灌种子
  function seedIfEmpty(seedArr, defaultStages) {
    return ready().then(function () {
      return _db.collection(COLL_META).where({ key: 'seed' }).get().then(function (res) {
        if (res.data && res.data.length) return { seeded: false, reason: 'already' };
        // 二次确认客户表是否真空，避免并发重复灌
        return _db.collection(COLL_CUST).limit(1).get().then(function (c) {
          if (c.data && c.data.length) {
            // 已有数据，只补 seed 标记
            return _db.collection(COLL_META).add({ key: 'seed', at: Date.now() }).then(function () {
              return { seeded: false, reason: 'has_data' };
            });
          }
          // 真空 → 批量写入
          var docs = seedArr.map(function (s) {
            var c = JSON.parse(JSON.stringify(s));
            return c;
          });
          return batchAdd(COLL_CUST, docs).then(function () {
            var metaJobs = [_db.collection(COLL_META).add({ key: 'seed', at: Date.now(), count: docs.length })];
            if (defaultStages) metaJobs.push(_db.collection(COLL_META).add({ key: 'stages', stages: defaultStages, at: Date.now() }));
            return Promise.all(metaJobs).then(function () { return { seeded: true, count: docs.length }; });
          });
        });
      });
    });
  }

  // 分批 add（CloudBase 单次 add 仅一条；这里串行控制并发，每批 20 条 Promise.all）
  function batchAdd(coll, docs) {
    var c = _db.collection(coll);
    var i = 0, BATCH = 20;
    function step() {
      if (i >= docs.length) return Promise.resolve();
      var slice = docs.slice(i, i + BATCH);
      i += BATCH;
      return Promise.all(slice.map(function (d) { return c.add(d).catch(function (e) { console.warn('add fail', e); }); })).then(step);
    }
    return step();
  }

  // upsert 单条（按业务 id）
  function saveCustomer(rec) {
    return ready().then(function () {
      var coll = _db.collection(COLL_CUST);
      return coll.where({ id: rec.id }).get().then(function (res) {
        if (res.data && res.data.length) {
          var docId = res.data[0]._id;
          var patch = {}; for (var k in rec) { if (k !== '_id') patch[k] = rec[k]; }
          return coll.doc(docId).update(patch).then(function () { return { updated: 1 }; });
        }
        return coll.add(rec).then(function () { return { created: 1 }; });
      });
    });
  }

  function deleteCustomer(id) {
    return ready().then(function () {
      var coll = _db.collection(COLL_CUST);
      return coll.where({ id: id }).get().then(function (res) {
        if (!res.data || !res.data.length) return { deleted: 0 };
        return coll.doc(res.data[0]._id).remove().then(function () { return { deleted: 1 }; });
      });
    });
  }

  function saveStages(stages) {
    return ready().then(function () {
      var coll = _db.collection(COLL_META);
      return coll.where({ key: 'stages' }).get().then(function (res) {
        if (res.data && res.data.length) {
          return coll.doc(res.data[0]._id).update({ stages: stages, at: Date.now() });
        }
        return coll.add({ key: 'stages', stages: stages, at: Date.now() });
      });
    });
  }

  global.pursuitCloud = {
    ready: ready,
    isReady: isReady,
    loadAll: loadAll,
    seedIfEmpty: seedIfEmpty,
    saveCustomer: saveCustomer,
    deleteCustomer: deleteCustomer,
    saveStages: saveStages,
    envId: ENV_ID
  };
})(window);
