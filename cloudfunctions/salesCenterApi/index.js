'use strict';

const ENV_ID = 'adq-tuoke-2-d9gktr9mn2e462acd';
const VERSION = 'v4-read-write-bff-20260623';
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
  sessions: 'user_sessions'
};

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
  if (updated) return ok('upsertRecord', { updated: true, id: updatedId, record }, { collection: COLLECTIONS.legacyRecords });
  const addRes = await database.collection(COLLECTIONS.legacyRecords).add(record);
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
    default: return fail(action, 'UNKNOWN_ACTION', 'Unsupported action: ' + action);
  }
}
exports.main = async function (event, context) { const action = event && event.action ? String(event.action) : 'healthcheck'; const params = event && event.params ? event.params : {}; try { return await handle(action, params, context || {}); } catch (err) { return fail(action, err && err.code ? err.code : 'INTERNAL_ERROR', err && err.message ? err.message : String(err)); } };
