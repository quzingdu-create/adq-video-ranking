'use strict';

const ENV_ID = 'adq-tuoke-2-d9gktr9mn2e462acd';
const VERSION = 'v6.1-audit-log-20260625';
const DEFAULT_V2_VERSION = '20260622_v2_light';
const DEFAULT_V3_VERSION = '20260622_v3_big';
const COLLECTIONS = {
  snapshot: 'sc_snapshot_daily',
  top: 'sc_top_metrics',
  records: 'sc_customer_records',
  lookup: 'sc_customer_lookup',
  index: 'sc_customer_index',
  jobs: 'sc_import_jobs',
  progress: 'redspot_progress',
  legacyRecords: 'tuoke_records',
  sessions: 'user_sessions',
  customers: 'sc_customers',
  attributionLog: 'sc_attribution_log',
  // R5.2 KPI 快照集合（不可变，append-only）
  kpiSnapshots: 'sc_kpi_snapshots'
};
const SALES = ['brownfan', 'Jonzhu', 'kaikaigenli', 'kinsleyjin', 'lijunwu', 'ruilingzhan', 'yvaineechen'];

let cloudbase = null;
try { cloudbase = require('@cloudbase/node-sdk'); } catch (err) { cloudbase = null; }
let app = null;
let db = null;

function ok(action, data, meta) {
  return { ok: true, action, data: data || {}, meta: Object.assign({ env: ENV_ID, version: VERSION, ts: Date.now() }, meta || {}) };
}
function fail(action, code, message, detail) {
  return { ok: false, action, error: { code, message, detail: detail || null }, meta: { env: ENV_ID, version: VERSION, ts: Date.now() } };
}
function getDb() {
  if (!cloudbase) { const err = new Error('@cloudbase/node-sdk is not installed.'); err.code = 'DB_SDK_NOT_AVAILABLE'; throw err; }
  if (!app) app = cloudbase.init({ env: ENV_ID });
  if (!db) db = app.database();
  return db;
}
function rowsToMap(rows) { const out = {}; (rows || []).forEach((row) => { if (row && row.type) out[row.type] = row.payload; }); return out; }
function cleanChunk(row) { if (!row) return row; const out = Object.assign({}, row); delete out.payload; delete out.keys; return out; }
function cleanDoc(row) { if (!row) return row; return Object.assign({}, row); }
function safeLimit(n, def, max) { n = Number(n || def); if (!Number.isFinite(n)) n = def; return Math.min(max, Math.max(1, Math.floor(n))); }
function getActor(params, context) {
  return String((params && (params.operator || params.rtx || params.user || params._rtx)) || (context && context.OPENID) || 'unknown').trim() || 'unknown';
}

async function queryByTypes(collectionName, types, params) {
  const database = getDb();
  const _ = database.command;
  const where = {};
  if (params && params.snapshotVersion) where.snapshotVersion = params.snapshotVersion;
  if (params && params.dataDate) where.dataDate = params.dataDate;
  if (types && types.length) where.type = _.in(types);
  const res = await database.collection(collectionName).where(where).limit(100).get();
  return res && res.data ? res.data : [];
}
async function getLatestVersion(phase) {
  const database = getDb();
  const where = phase ? { phase } : {};
  const res = await database.collection(COLLECTIONS.jobs).where(where).orderBy('generatedAt', 'desc').limit(1).get();
  const list = res && res.data ? res.data : [];
  return list[0] || null;
}
async function getBootstrap(params) {
  params = params || {}; params.snapshotVersion = params.snapshotVersion || DEFAULT_V2_VERSION;
  const types = params.types || ['center_daily_kpi', 'center_quarter_summary', 'dashboard_runtime_summary', 'center_sales_summary', 'current_rising'];
  const rows = await queryByTypes(COLLECTIONS.snapshot, types, params);
  return ok('getBootstrap', { mode: 'cloud', records: rows, payload: rowsToMap(rows), count: rows.length }, { collection: COLLECTIONS.snapshot });
}
async function getTopMetrics(params) {
  params = params || {}; params.snapshotVersion = params.snapshotVersion || DEFAULT_V2_VERSION;
  const types = params.types || ['top80_effective_metrics', 'top_status_data', 'top_status_list', 'redblack_data', 'top_rising_data', 'yest_new_customer_tasks', 'enough_candidates'];
  const rows = await queryByTypes(COLLECTIONS.top, types, params);
  return ok('getTopMetrics', { mode: 'cloud', records: rows, payload: rowsToMap(rows), count: rows.length }, { collection: COLLECTIONS.top });
}
async function queryRecords(params) {
  params = params || {};
  const database = getDb();
  const snapshotVersion = params.snapshotVersion || DEFAULT_V3_VERSION;
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = safeLimit(params.pageSize, 50, 500);
  const chunkSize = 500;
  const offset = (page - 1) * pageSize;
  const firstChunk = Math.floor(offset / chunkSize);
  const lastOffset = offset + pageSize - 1;
  const lastChunk = Math.floor(lastOffset / chunkSize);
  const rows = [];
  let totalRecords = 0;
  let chunksMeta = [];
  for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
    const res = await database.collection(COLLECTIONS.records).where({ snapshotVersion, type: 'tuoke_real_records', chunkIndex }).limit(1).get();
    const chunk = res && res.data && res.data[0] ? res.data[0] : null;
    if (!chunk) continue;
    totalRecords = chunk.totalRecords || totalRecords;
    const payload = Array.isArray(chunk.payload) ? chunk.payload : [];
    const start = chunkIndex === firstChunk ? offset % chunkSize : 0;
    const need = pageSize - rows.length;
    rows.push.apply(rows, payload.slice(start, start + need));
    chunksMeta.push(cleanChunk(chunk));
    if (rows.length >= pageSize) break;
  }
  return ok('queryRecords', { mode: 'cloud', snapshotVersion, page, pageSize, chunkIndex: firstChunk, count: rows.length, totalRecords, rows, chunks: chunksMeta }, { collection: COLLECTIONS.records });
}
async function getLookupRows(type, snapshotVersion, key, chunkIndex) {
  const database = getDb();
  const where = { snapshotVersion };
  if (type) where.type = type;
  if (key) where.keys = key;
  if (typeof chunkIndex !== 'undefined' && chunkIndex !== null) where.chunkIndex = Number(chunkIndex);
  const res = await database.collection(COLLECTIONS.lookup).where(where).limit(key || typeof chunkIndex !== 'undefined' ? 5 : 100).get();
  return res && res.data ? res.data : [];
}
async function queryLookup(params) {
  params = params || {};
  const snapshotVersion = params.snapshotVersion || DEFAULT_V3_VERSION;
  const type = params.type || 'mapping_data';
  const includePayload = !!params.includePayload;
  const keys = Array.isArray(params.keys) ? params.keys : (params.key ? [params.key] : []);
  if (!keys.length) {
    const chunks = await getLookupRows(type, snapshotVersion, null, params.chunkIndex);
    return ok('queryLookup', { mode: 'cloud', snapshotVersion, type, count: chunks.length, chunks: chunks.map(includePayload ? cleanDoc : cleanChunk) }, { collection: COLLECTIONS.lookup });
  }
  const found = {};
  for (const key of keys) {
    const chunks = await getLookupRows(type, snapshotVersion, key);
    chunks.forEach((chunk) => {
      const payload = chunk && chunk.payload ? chunk.payload : {};
      if (Object.prototype.hasOwnProperty.call(payload, key)) found[key] = payload[key];
    });
  }
  return ok('queryLookup', { mode: 'cloud', snapshotVersion, type, requested: keys.length, foundCount: Object.keys(found).length, payload: found }, { collection: COLLECTIONS.lookup });
}
async function getCustomerIndex(name, snapshotVersion) {
  const database = getDb();
  const res = await database.collection(COLLECTIONS.index).where({ snapshotVersion, type: 'customer_name_index', keys: name }).limit(5).get();
  const chunks = res && res.data ? res.data : [];
  for (const chunk of chunks) { const payload = chunk && chunk.payload ? chunk.payload : {}; if (Object.prototype.hasOwnProperty.call(payload, name)) return { refs: payload[name], chunk: cleanChunk(chunk) }; }
  return { refs: [], chunk: null };
}
async function getRecordByRef(ref, snapshotVersion) {
  if (!ref || typeof ref.chunkIndex === 'undefined') return null;
  const database = getDb();
  const res = await database.collection(COLLECTIONS.records).where({ snapshotVersion, type: 'tuoke_real_records', chunkIndex: ref.chunkIndex }).limit(1).get();
  const chunk = res && res.data && res.data[0] ? res.data[0] : null;
  const payload = chunk && Array.isArray(chunk.payload) ? chunk.payload : [];
  let row = payload[ref.rowIndex];
  if (!row || (ref._id && row._id !== ref._id)) row = payload.find((r) => (ref._id && r._id === ref._id) || (ref.id && r.id === ref.id)) || null;
  return row ? { row, chunk: cleanChunk(chunk) } : null;
}
async function getCustomerDetail(params) {
  params = params || {};
  const name = params.name || params.shortName || params.customerName;
  if (!name) return fail('getCustomerDetail', 'MISSING_NAME', 'name/shortName is required');
  const snapshotVersion = params.snapshotVersion || DEFAULT_V3_VERSION;
  const lookupTypes = params.lookupTypes || ['mapping_data', 'customer_link_data', 'customer_main_product'];
  const detail = { name, lookup: {} };
  for (const type of lookupTypes) { const res = await queryLookup({ snapshotVersion, type, keys: [name] }); detail.lookup[type] = res.data && res.data.payload ? res.data.payload[name] : undefined; }
  const indexResult = await getCustomerIndex(name, snapshotVersion);
  detail.indexRefs = indexResult.refs || []; detail.indexChunk = indexResult.chunk;
  if (detail.indexRefs.length) { const recordResult = await getRecordByRef(detail.indexRefs[0], snapshotVersion); detail.record = recordResult ? recordResult.row : null; detail.recordChunk = recordResult ? recordResult.chunk : null; }
  return ok('getCustomerDetail', { mode: 'cloud', snapshotVersion, detail, foundLookup: Object.values(detail.lookup).some((v) => typeof v !== 'undefined'), foundRecord: !!detail.record, indexRefCount: detail.indexRefs.length }, { collection: COLLECTIONS.index });
}
async function getProgress(params) {
  params = params || {};
  const database = getDb();
  const where = {};
  if (params.dateKey) where.dateKey = String(params.dateKey);
  if (params.taskKey) where.taskKey = String(params.taskKey);
  if (params.taskType) where.taskType = String(params.taskType);
  const limit = safeLimit(params.limit, 200, 500);
  const res = await database.collection(COLLECTIONS.progress).where(where).orderBy('ts', 'desc').limit(limit).get();
  const rows = res && res.data ? res.data : [];
  return ok('getProgress', { rows, count: rows.length, query: where }, { collection: COLLECTIONS.progress });
}
async function updateProgress(params, context) {
  params = params || {};
  const database = getDb();
  const taskKey = params.taskKey || (params.customerName ? 'mobile:' + params.customerName : '');
  if (!taskKey) return fail('updateProgress', 'MISSING_TASK_KEY', 'taskKey or customerName is required');
  const doc = Object.assign({}, params.payload || {}, {
    taskKey: String(taskKey),
    customerName: params.customerName || (params.payload && params.payload.customerName) || '',
    taskType: params.taskType || (params.payload && params.payload.taskType) || 'top_drop_customer',
    status: params.status || (params.payload && params.payload.status) || 'done',
    dateKey: params.dateKey || (params.payload && params.payload.dateKey) || new Date().toISOString().slice(0, 10),
    operator: getActor(params, context),
    ts: Date.now(),
    source: 'salesCenterApi'
  });
  const res = await database.collection(COLLECTIONS.progress).add(doc);
  return ok('updateProgress', { id: res && res.id, record: doc }, { collection: COLLECTIONS.progress });
}
async function upsertRecord(params, context) {
  params = params || {};
  const database = getDb();
  const record = Object.assign({}, params.record || params.payload || {});
  if (!record.name && !record.shortName) return fail('upsertRecord', 'MISSING_NAME', 'record.name or record.shortName is required');
  const now = Date.now();
  record.name = record.name || record.shortName;
  record.shortName = record.shortName || record.name;
  record._updatedAt = now;
  record._recorded_by = record._recorded_by || record.sale || getActor(params, context);
  record._rtx = record._rtx || record.sale || getActor(params, context);
  if (!record.id) record.id = now;
  if (!record._createdAt) record._createdAt = now;
  let updated = false;
  let updatedId = '';
  if (params._id || record._id) {
    const id = params._id || record._id;
    try { await database.collection(COLLECTIONS.legacyRecords).doc(id).update(record); updated = true; updatedId = id; } catch (_) {}
  }
  if (!updated && params.id) {
    const res = await database.collection(COLLECTIONS.legacyRecords).where({ id: params.id }).limit(1).get();
    const row = res && res.data && res.data[0];
    if (row && row._id) { await database.collection(COLLECTIONS.legacyRecords).doc(row._id).update(record); updated = true; updatedId = row._id; }
  }
  if (updated) {
    // R6.3 审计日志: 如果 record 改了 sale, 自动 append attribution_log
    try {
      if (record.sale || record._rtx) {
        await database.collection(COLLECTIONS.attributionLog).add({
          customerId: record.customerId || '', primaryName: record.name || record.shortName || '',
          shortName: record.shortName || '', fromSale: '', toSale: record.sale || record._rtx || '',
          operator: getActor(params, context), reason: 'upsertRecord:update',
          ts: now, action: 'upsertRecord', source: 'tuoke_records', _id_target: updatedId
        });
      }
    } catch (_) { /* 不阻断主流程 */ }
    return ok('upsertRecord', { updated: true, id: updatedId, record }, { collection: COLLECTIONS.legacyRecords });
  }
  const addRes = await database.collection(COLLECTIONS.legacyRecords).add(record);
  // R6.3 审计日志: 新增登记也记一条
  try {
    if (record.sale || record._rtx) {
      await database.collection(COLLECTIONS.attributionLog).add({
        customerId: record.customerId || '', primaryName: record.name || record.shortName || '',
        shortName: record.shortName || '', fromSale: '', toSale: record.sale || record._rtx || '',
        operator: getActor(params, context), reason: 'upsertRecord:insert',
        ts: now, action: 'upsertRecord', source: 'tuoke_records', _id_target: addRes && addRes.id
      });
    }
  } catch (_) { /* 不阻断 */ }
  return ok('upsertRecord', { updated: false, id: addRes && addRes.id, record }, { collection: COLLECTIONS.legacyRecords });
}
async function deleteRecord(params, context) {
  params = params || {};
  if (!params._id) return fail('deleteRecord', 'MISSING_ID', '_id is required');
  const database = getDb();
  const soft = params.soft !== false;
  if (soft) {
    const patch = { _deleted: true, _deletedAt: Date.now(), _deletedBy: getActor(params, context) };
    await database.collection(COLLECTIONS.legacyRecords).doc(params._id).update(patch);
    return ok('deleteRecord', { soft: true, id: params._id }, { collection: COLLECTIONS.legacyRecords });
  }
  await database.collection(COLLECTIONS.legacyRecords).doc(params._id).remove();
  return ok('deleteRecord', { soft: false, id: params._id }, { collection: COLLECTIONS.legacyRecords });
}
async function exportRecords(params) {
  params = params || {};
  const database = getDb();
  const limit = safeLimit(params.limit, 100, 500);
  const page = Math.max(1, Number(params.page || 1));
  const skip = (page - 1) * limit;
  const res = await database.collection(COLLECTIONS.legacyRecords).skip(skip).limit(limit).get();
  const rows = res && res.data ? res.data : [];
  return ok('exportRecords', { page, limit, rows, count: rows.length }, { collection: COLLECTIONS.legacyRecords });
}
async function listVersions() {
  const latest = await getLatestVersion(); const latestV2 = await getLatestVersion('v2_light'); const latestV3 = await getLatestVersion('v3_big'); const latestV31 = await getLatestVersion('v3_1_customer_index');
  return ok('listVersions', { latest: latest ? latest.snapshotVersion : null, latestV2: latestV2 ? latestV2.snapshotVersion : DEFAULT_V2_VERSION, latestV3: latestV3 ? latestV3.snapshotVersion : DEFAULT_V3_VERSION, latestV31: latestV31 ? latestV31.snapshotVersion : DEFAULT_V3_VERSION, versions: [latest, latestV2, latestV3, latestV31].filter(Boolean), collection: COLLECTIONS.jobs });
}

/* ============ R2: customers 主集合 (单一可信源, 归属与KPI解耦) ============ */
function normName(s) { return String(s || '').trim(); }
async function findCustomerByName(database, name) {
  const _ = database.command;
  name = normName(name);
  if (!name) return null;
  let res = await database.collection(COLLECTIONS.customers).where({ primaryName: name }).limit(1).get();
  if (res && res.data && res.data[0]) return res.data[0];
  res = await database.collection(COLLECTIONS.customers).where({ aliases: _.elemMatch(_.eq(name)) }).limit(1).get();
  if (res && res.data && res.data[0]) return res.data[0];
  return null;
}
async function checkCustomer(params) {
  params = params || {};
  const database = getDb();
  const name = normName(params.name || params.primaryName || params.shortName);
  if (!name) return fail('checkCustomer', 'MISSING_NAME', 'name is required');
  const existing = await findCustomerByName(database, name);
  return ok('checkCustomer', {
    name: name,
    exists: !!existing,
    alreadyAttributed: !!(existing && existing.sale),
    currentSale: existing ? existing.sale : '',
    customerId: existing ? existing.customerId : '',
    firstRegisterBy: existing ? existing.firstRegisterBy : '',
    firstRegisterAt: existing ? existing.firstRegisterAt : 0,
    isOld24: existing ? !!existing.isOld24 : false,
    firstQuarter: existing ? (existing.firstQuarter || '') : '',
    aliases: existing ? (existing.aliases || []) : []
  }, { collection: COLLECTIONS.customers });
}
async function registerCustomer(params, context) {
  params = params || {};
  const database = getDb();
  const name = normName(params.name || params.primaryName || params.shortName);
  const sale = normName(params.sale);
  if (!name) return fail('registerCustomer', 'MISSING_NAME', 'name is required');
  if (sale && SALES.indexOf(sale) < 0) return fail('registerCustomer', 'INVALID_SALE', 'sale not in known list: ' + sale);
  const actor = getActor(params, context);
  const now = Date.now();
  const existing = await findCustomerByName(database, name);
  if (existing) {
    const patch = {};
    const incomingAlias = normName(params.shortName);
    if (incomingAlias && incomingAlias !== existing.primaryName && (existing.aliases || []).indexOf(incomingAlias) < 0) {
      patch.aliases = (existing.aliases || []).concat([incomingAlias]);
    }
    if (Object.keys(patch).length) { patch._updatedAt = now; await database.collection(COLLECTIONS.customers).doc(existing._id).update(patch); }
    return ok('registerCustomer', {
      created: false, alreadyExists: true, alreadyAttributed: !!existing.sale,
      customerId: existing.customerId, currentSale: existing.sale,
      firstRegisterBy: existing.firstRegisterBy, message: existing.sale ? ('已被 ' + existing.sale + ' 认领, 本次不改归属') : '已存在但未归属'
    }, { collection: COLLECTIONS.customers });
  }
  const doc = {
    customerId: 'c_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    primaryName: name,
    aliases: params.shortName && normName(params.shortName) !== name ? [normName(params.shortName)] : [],
    sale: sale || '',
    saleSource: sale ? 'register_lock' : 'unassigned',
    saleLockedAt: sale ? now : 0,
    firstRegisterAt: now,
    firstRegisterBy: actor,
    cat: normName(params.cat),
    source: normName(params.source),
    channel: normName(params.channel),
    firstQuarter: normName(params.firstQuarter),
    isOld24: !!params.isOld24,
    recordCount: 1,
    legacyIds: [],
    _createdAt: now,
    _updatedAt: now
  };
  const res = await database.collection(COLLECTIONS.customers).add(doc);
  if (sale) {
    await database.collection(COLLECTIONS.attributionLog).add({
      customerId: doc.customerId, primaryName: name, fromSale: '', toSale: sale,
      operator: actor, reason: 'register_lock 首次登记锁定', ts: now, action: 'register'
    });
  }
  return ok('registerCustomer', { created: true, customerId: doc.customerId, sale: doc.sale, docId: res && res.id }, { collection: COLLECTIONS.customers });
}
async function updateAttribution(params, context) {
  params = params || {};
  const database = getDb();
  const newSale = normName(params.sale || params.newSale);
  if (newSale && SALES.indexOf(newSale) < 0) return fail('updateAttribution', 'INVALID_SALE', 'sale not in known list: ' + newSale);
  const actor = getActor(params, context);
  const now = Date.now();
  let target = null;
  if (params.customerId) {
    const res = await database.collection(COLLECTIONS.customers).where({ customerId: String(params.customerId) }).limit(1).get();
    target = res && res.data && res.data[0];
  } else if (params.name || params.primaryName || params.shortName) {
    target = await findCustomerByName(database, params.name || params.primaryName || params.shortName);
  }
  if (!target) return fail('updateAttribution', 'CUSTOMER_NOT_FOUND', 'no customer matched');
  const fromSale = target.sale || '';
  await database.collection(COLLECTIONS.customers).doc(target._id).update({
    sale: newSale, saleSource: 'manual_update', saleLockedAt: target.saleLockedAt || now, _updatedAt: now,
    _lastAttrBy: actor, _lastAttrReason: normName(params.reason) || 'manual_update'
  });
  await database.collection(COLLECTIONS.attributionLog).add({
    customerId: target.customerId, primaryName: target.primaryName, fromSale: fromSale, toSale: newSale,
    operator: actor, reason: normName(params.reason) || 'manual_update', ts: now, action: 'update'
  });
  return ok('updateAttribution', { customerId: target.customerId, primaryName: target.primaryName, fromSale: fromSale, toSale: newSale, operator: actor }, { collection: COLLECTIONS.customers });
}
async function queryCustomers(params) {
  params = params || {};
  const database = getDb();
  const _ = database.command;
  const where = {};
  if (params.sale) where.sale = String(params.sale);
  if (params.q) where.primaryName = new RegExp(String(params.q));
  const limit = safeLimit(params.pageSize, 100, 100);
  const page = Math.max(1, Number(params.page || 1));
  const skip = (page - 1) * limit;
  const cntRes = await database.collection(COLLECTIONS.customers).where(where).count();
  const res = await database.collection(COLLECTIONS.customers).where(where).skip(skip).limit(limit).get();
  const rows = res && res.data ? res.data : [];
  return ok('queryCustomers', { page, pageSize: limit, count: rows.length, total: cntRes && cntRes.total, rows }, { collection: COLLECTIONS.customers });
}
async function getAttributionLog(params) {
  params = params || {};
  const database = getDb();
  const _ = database.command;
  const where = {};
  if (params.customerId) where.customerId = String(params.customerId);
  if (params.primaryName) where.primaryName = String(params.primaryName);
  if (params.shortName) where.shortName = String(params.shortName);
  if (params.operator) where.operator = String(params.operator);
  // R6.3 时间窗
  if (params.since || params.until) {
    const range = {};
    if (params.since) range.$gte = Number(params.since);
    if (params.until) range.$lte = Number(params.until);
    where.ts = range;
  }
  const limit = safeLimit(params.limit, 50, 500);
  const res = await database.collection(COLLECTIONS.attributionLog).where(where).orderBy('ts', 'desc').limit(limit).get();
  const rows = res && res.data ? res.data : [];
  return ok('getAttributionLog', { rows, count: rows.length }, { collection: COLLECTIONS.attributionLog });
}
// R6.3 别名: getAuditLog (语义更通用, 兼容 attribution_log)
async function getAuditLog(params) {
  return getAttributionLog(params);
}
async function customersCount() {
  const database = getDb();
  const res = await database.collection(COLLECTIONS.customers).count();
  return ok('customersCount', { total: res && res.total }, { collection: COLLECTIONS.customers });
}
async function bulkImportCustomers(params) {
  params = params || {};
  const database = getDb();
  const rows = Array.isArray(params.rows) ? params.rows : [];
  const replace = !!params.replace;
  if (!rows.length && !replace) return fail('bulkImportCustomers', 'EMPTY_ROWS', 'rows is empty');
  let removed = 0;
  if (replace && params.replaceConfirm === 'YES') {
    while (true) {
      let list = [];
      try {
        const res = await database.collection(COLLECTIONS.customers).limit(100).get();
        list = (res && res.data) || [];
      } catch (e) { break; }
      if (!list.length) break;
      for (const r of list) { await database.collection(COLLECTIONS.customers).doc(r._id).remove(); removed++; }
      if (removed > 50000) break;
    }
  }
  let added = 0, failed = 0, firstErr = '';
  for (const c of rows) {
    try { await database.collection(COLLECTIONS.customers).add(c); added++; } catch (e) { failed++; if (!firstErr) firstErr = e && e.message ? e.message : String(e); }
  }
  return ok('bulkImportCustomers', { removed, added, failed, requested: rows.length, firstErr }, { collection: COLLECTIONS.customers });
}

// ===== R5.2 (2026-06-25): KPI 快照 不可变 append-only =====
// schema 见 /Users/duziqing/WorkBuddy/2026-06-25-11-11-19/docs/sc_kpi_snapshots_schema_v1.md
function _validateKpiSnapshotPayload(payload) {
  if (!payload || typeof payload !== 'object') return 'payload must be object';
  const required = ['dataDate', 'reportDate', 'q2PassedDays', 'q2RemainDays', 'centerDailyKpi', 'centerQuarterSummary'];
  for (const k of required) {
    if (!(k in payload)) return 'missing field: ' + k;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dataDate)) return 'invalid dataDate format';
  if (!Array.isArray(payload.centerQuarterSummary)) return 'centerQuarterSummary must be array';
  if (typeof payload.centerDailyKpi !== 'object') return 'centerDailyKpi must be object';
  return null;
}

async function writeKpiSnapshot(params, context) {
  params = params || {};
  const payload = params.payload || params.snapshot;
  const err = _validateKpiSnapshotPayload(payload);
  if (err) return fail('writeKpiSnapshot', 'INVALID_PAYLOAD', err);
  const database = getDb();
  // 0. 集合不存在 → 自动建
  // CloudBase SDK 用 db.createCollection 或 app.callOpenAPI
  let createMsg = '';
  try {
    if (typeof database.createCollection === 'function') {
      await database.createCollection(COLLECTIONS.kpiSnapshots);
      createMsg = 'createCollection ok';
    } else {
      createMsg = 'createCollection method not found';
    }
  } catch (e) {
    createMsg = 'createCollection err: ' + (e && e.message ? e.message : String(e));
  }
  // 1. 查同 dataDate 的最大 version
  let nextVersion = 1;
  try {
    const res = await database.collection(COLLECTIONS.kpiSnapshots)
      .where({ dataDate: payload.dataDate })
      .orderBy('version', 'desc')
      .limit(1)
      .get();
    const rows = (res && res.data) || [];
    if (rows.length && typeof rows[0].version === 'number') {
      nextVersion = rows[0].version + 1;
    }
  } catch (e) { /* 集合首次写入时可能查询失败,忽略 */ }
  // 2. 强制元数据
  const doc = Object.assign({}, payload, {
    snapshotId: 'kpi_' + payload.dataDate + '_v' + nextVersion + '_' + Date.now(),
    version: nextVersion,
    calculatedAt: Date.now(),
    immutable: true,
    writtenBy: getActor(params, context)
  });
  let addRes;
  try {
    addRes = await database.collection(COLLECTIONS.kpiSnapshots).add(doc);
  } catch (e) {
    return fail('writeKpiSnapshot', 'ADD_FAILED', (e && e.message) || String(e), { createMsg });
  }
  return ok('writeKpiSnapshot', {
    snapshotId: doc.snapshotId,
    dataDate: payload.dataDate,
    version: nextVersion,
    _id: addRes && addRes.id,
    createMsg
  }, { collection: COLLECTIONS.kpiSnapshots });
}

async function getKpiSnapshot(params) {
  params = params || {};
  if (!params.dataDate) return fail('getKpiSnapshot', 'MISSING_DATA_DATE', 'dataDate is required');
  const database = getDb();
  const query = database.collection(COLLECTIONS.kpiSnapshots).where({ dataDate: params.dataDate });
  // version 不传 → 最新; 传则精确匹配
  if (typeof params.version === 'number') {
    const res = await database.collection(COLLECTIONS.kpiSnapshots)
      .where({ dataDate: params.dataDate, version: params.version })
      .limit(1)
      .get();
    const rows = (res && res.data) || [];
    if (!rows.length) return fail('getKpiSnapshot', 'NOT_FOUND', 'no snapshot for ' + params.dataDate + ' v' + params.version);
    return ok('getKpiSnapshot', { snapshot: rows[0] }, { collection: COLLECTIONS.kpiSnapshots });
  }
  // 拿最新
  const res = await query.orderBy('version', 'desc').limit(1).get();
  const rows = (res && res.data) || [];
  if (!rows.length) return fail('getKpiSnapshot', 'NOT_FOUND', 'no snapshot for ' + params.dataDate);
  return ok('getKpiSnapshot', { snapshot: rows[0] }, { collection: COLLECTIONS.kpiSnapshots });
}

async function _fetchSnap(database, dataDate) {
  const res = await database.collection(COLLECTIONS.kpiSnapshots)
    .where({ dataDate: dataDate })
    .orderBy('version', 'desc')
    .limit(1)
    .get();
  const rows = (res && res.data) || [];
  return rows[0] || null;
}

async function diffKpiSnapshot(params) {
  params = params || {};
  if (!params.from || !params.to) return fail('diffKpiSnapshot', 'MISSING_DATES', 'from and to required');
  const database = getDb();
  const fromSnap = await _fetchSnap(database, params.from);
  const toSnap = await _fetchSnap(database, params.to);
  if (!fromSnap) return fail('diffKpiSnapshot', 'FROM_NOT_FOUND', 'from snapshot missing: ' + params.from);
  if (!toSnap) return fail('diffKpiSnapshot', 'TO_NOT_FOUND', 'to snapshot missing: ' + params.to);
  const diff = {};
  const alerts = [];
  // 中心日耗顶层关键字段
  const topKeys = ['q2NewCount', 'q2ValidCount', 'q2RisingCount', 'q2NewYestCost', 'q2NewDayDelta'];
  const fromTop = fromSnap.centerDailyKpi || {};
  const toTop = toSnap.centerDailyKpi || {};
  for (const k of topKeys) {
    const f = Number(fromTop[k] || 0);
    const t = Number(toTop[k] || 0);
    const delta = t - f;
    const deltaRate = f ? delta / f : 0;
    diff[k] = { from: f, to: t, delta: delta, deltaRate: Number(deltaRate.toFixed(4)) };
    if (Math.abs(deltaRate) > 0.2 && f > 100) {
      alerts.push({ field: k, msg: '变化超 20% (' + (deltaRate * 100).toFixed(1) + '%)', from: f, to: t });
    }
  }
  // 剩余天数变化必须 = (to.dataDate - from.dataDate)
  const fromRD = Number(fromSnap.q2RemainDays || 0);
  const toRD = Number(toSnap.q2RemainDays || 0);
  const fromDate = new Date(params.from);
  const toDate = new Date(params.to);
  const dayDelta = Math.round((toDate - fromDate) / 86400000);
  const expectedRDDelta = -dayDelta;
  diff.q2RemainDays = { from: fromRD, to: toRD, delta: toRD - fromRD, expectedDelta: expectedRDDelta };
  if (toRD - fromRD !== expectedRDDelta) {
    alerts.push({ field: 'q2RemainDays', msg: '剩余天数变化不符: 应为 ' + expectedRDDelta + ' 实际为 ' + (toRD - fromRD), from: fromRD, to: toRD });
  }
  return ok('diffKpiSnapshot', {
    from: { dataDate: fromSnap.dataDate, version: fromSnap.version },
    to: { dataDate: toSnap.dataDate, version: toSnap.version },
    diff: diff,
    alerts: alerts,
    alertCount: alerts.length
  }, { collection: COLLECTIONS.kpiSnapshots });
}

async function listKpiSnapshots(params) {
  params = params || {};
  const database = getDb();
  const limit = safeLimit(params.limit, 30, 100);
  const res = await database.collection(COLLECTIONS.kpiSnapshots)
    .orderBy('dataDate', 'desc').orderBy('version', 'desc')
    .limit(limit)
    .field({ snapshotId: true, dataDate: true, version: true, calculatedAt: true, writtenBy: true, q2PassedDays: true, q2RemainDays: true })
    .get();
  return ok('listKpiSnapshots', { rows: (res && res.data) || [] }, { collection: COLLECTIONS.kpiSnapshots });
}

async function handle(action, params, context) {
  switch (action) {
    case 'healthcheck': return ok(action, { status: 'ok', service: 'salesCenterApi', mode: 'v4-read-write-bff', collections: COLLECTIONS, cloudbaseSdkReady: !!cloudbase, received: params || {} }, { requestId: context && context.requestId ? context.requestId : undefined });
    case 'listVersions': return await listVersions();
    case 'getBootstrap': return await getBootstrap(params);
    case 'getTopMetrics': return await getTopMetrics(params);
    case 'queryRecords': return await queryRecords(params);
    case 'queryLookup': return await queryLookup(params);
    case 'getCustomerDetail': return await getCustomerDetail(params);
    case 'getProgress': return await getProgress(params);
    case 'updateProgress': return await updateProgress(params, context);
    case 'upsertRecord': return await upsertRecord(params, context);
    case 'deleteRecord': return await deleteRecord(params, context);
    case 'exportRecords': return await exportRecords(params);
    case 'checkCustomer': return await checkCustomer(params);
    case 'registerCustomer': return await registerCustomer(params, context);
    case 'updateAttribution': return await updateAttribution(params, context);
    case 'queryCustomers': return await queryCustomers(params);
    case 'getAttributionLog': return await getAttributionLog(params);
    case 'getAuditLog': return await getAuditLog(params);
    case 'customersCount': return await customersCount();
    case 'bulkImportCustomers': return await bulkImportCustomers(params);
    // R5.2 KPI 快照
    case 'writeKpiSnapshot': return await writeKpiSnapshot(params, context);
    case 'getKpiSnapshot': return await getKpiSnapshot(params);
    case 'diffKpiSnapshot': return await diffKpiSnapshot(params);
    case 'listKpiSnapshots': return await listKpiSnapshots(params);
    default: return fail(action, 'UNKNOWN_ACTION', 'Unsupported action: ' + action);
  }
}
exports.main = async function (event, context) { const action = event && event.action ? String(event.action) : 'healthcheck'; const params = event && event.params ? event.params : {}; try { return await handle(action, params, context || {}); } catch (err) { return fail(action, err && err.code ? err.code : 'INTERNAL_ERROR', err && err.message ? err.message : String(err)); } };
