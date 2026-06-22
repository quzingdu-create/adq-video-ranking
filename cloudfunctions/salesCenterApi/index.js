'use strict';

const ENV_ID = 'adq-tuoke-2-d9gktr9mn2e462acd';
const VERSION = 'v3-big-read-skeleton-20260622';
const DEFAULT_V2_VERSION = '20260622_v2_light';
const DEFAULT_V3_VERSION = '20260622_v3_big';
const COLLECTIONS = {
  snapshot: 'sc_snapshot_daily',
  top: 'sc_top_metrics',
  records: 'sc_customer_records',
  lookup: 'sc_customer_lookup',
  jobs: 'sc_import_jobs'
};

let cloudbase = null;
try {
  cloudbase = require('@cloudbase/node-sdk');
} catch (err) {
  cloudbase = null;
}

let app = null;
let db = null;

function ok(action, data, meta) {
  return {
    ok: true,
    action,
    data: data || {},
    meta: Object.assign({
      env: ENV_ID,
      version: VERSION,
      ts: Date.now()
    }, meta || {})
  };
}

function fail(action, code, message, detail) {
  return {
    ok: false,
    action,
    error: { code, message, detail: detail || null },
    meta: { env: ENV_ID, version: VERSION, ts: Date.now() }
  };
}

function planned(action) {
  return ok(action, {
    status: 'planned',
    message: 'This action is reserved for V4 write migration and is not enabled in V3 big-data migration.'
  });
}

function getDb() {
  if (!cloudbase) {
    const err = new Error('@cloudbase/node-sdk is not installed.');
    err.code = 'DB_SDK_NOT_AVAILABLE';
    throw err;
  }
  if (!app) app = cloudbase.init({ env: ENV_ID });
  if (!db) db = app.database();
  return db;
}

function rowsToMap(rows) {
  const out = {};
  (rows || []).forEach((row) => { if (row && row.type) out[row.type] = row.payload; });
  return out;
}

function cleanChunk(row) {
  if (!row) return row;
  const out = Object.assign({}, row);
  delete out.payload;
  delete out.keys;
  return out;
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
  params = params || {};
  params.snapshotVersion = params.snapshotVersion || DEFAULT_V2_VERSION;
  const types = params.types || ['center_daily_kpi', 'center_quarter_summary', 'dashboard_runtime_summary', 'center_sales_summary', 'current_rising'];
  const rows = await queryByTypes(COLLECTIONS.snapshot, types, params);
  return ok('getBootstrap', { mode: 'cloud', records: rows, payload: rowsToMap(rows), count: rows.length }, { collection: COLLECTIONS.snapshot });
}

async function getTopMetrics(params) {
  params = params || {};
  params.snapshotVersion = params.snapshotVersion || DEFAULT_V2_VERSION;
  const types = params.types || ['top80_effective_metrics', 'top_status_data', 'top_status_list', 'redblack_data', 'top_rising_data', 'yest_new_customer_tasks', 'enough_candidates'];
  const rows = await queryByTypes(COLLECTIONS.top, types, params);
  return ok('getTopMetrics', { mode: 'cloud', records: rows, payload: rowsToMap(rows), count: rows.length }, { collection: COLLECTIONS.top });
}

async function queryRecords(params) {
  params = params || {};
  const database = getDb();
  const snapshotVersion = params.snapshotVersion || DEFAULT_V3_VERSION;
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 50)));
  const chunkSize = 500;
  const offset = (page - 1) * pageSize;
  const chunkIndex = Math.floor(offset / chunkSize);
  const innerOffset = offset % chunkSize;
  const res = await database.collection(COLLECTIONS.records).where({ snapshotVersion, type: 'tuoke_real_records', chunkIndex }).limit(1).get();
  const chunk = res && res.data && res.data[0] ? res.data[0] : null;
  const payload = chunk && Array.isArray(chunk.payload) ? chunk.payload : [];
  const rows = payload.slice(innerOffset, innerOffset + pageSize);
  return ok('queryRecords', {
    mode: 'cloud', snapshotVersion, page, pageSize, chunkIndex, count: rows.length,
    totalRecords: chunk ? chunk.totalRecords : 0,
    rows,
    chunk: cleanChunk(chunk)
  }, { collection: COLLECTIONS.records });
}

async function getLookupRows(type, snapshotVersion, key) {
  const database = getDb();
  const where = { snapshotVersion };
  if (type) where.type = type;
  // Mongo-style array equality matches array members, so this narrows to the chunk containing key.
  if (key) where.keys = key;
  const res = await database.collection(COLLECTIONS.lookup).where(where).limit(key ? 5 : 100).get();
  return res && res.data ? res.data : [];
}

async function queryLookup(params) {
  params = params || {};
  const snapshotVersion = params.snapshotVersion || DEFAULT_V3_VERSION;
  const type = params.type || 'mapping_data';
  const keys = Array.isArray(params.keys) ? params.keys : (params.key ? [params.key] : []);
  if (!keys.length) {
    const chunks = await getLookupRows(type, snapshotVersion);
    return ok('queryLookup', {
      mode: 'cloud', snapshotVersion, type, count: chunks.length,
      chunks: chunks.map(cleanChunk)
    }, { collection: COLLECTIONS.lookup });
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

async function getCustomerDetail(params) {
  params = params || {};
  const name = params.name || params.shortName || params.customerName;
  if (!name) return fail('getCustomerDetail', 'MISSING_NAME', 'name/shortName is required');
  const snapshotVersion = params.snapshotVersion || DEFAULT_V3_VERSION;
  const lookupTypes = params.lookupTypes || ['mapping_data', 'customer_link_data', 'customer_main_product'];
  const detail = { name, lookup: {} };
  for (const type of lookupTypes) {
    const res = await queryLookup({ snapshotVersion, type, keys: [name] });
    detail.lookup[type] = res.data && res.data.payload ? res.data.payload[name] : undefined;
  }
  // Avoid scanning all 23k records by default; record-level search will be indexed in a later V3 step.
  detail.recordSearch = { skipped: true, reason: 'chunk_scan_disabled_by_default', use: 'queryRecords(page,pageSize) or future indexed search' };
  return ok('getCustomerDetail', { mode: 'cloud', snapshotVersion, detail, foundLookup: Object.values(detail.lookup).some((v) => typeof v !== 'undefined') }, { collection: COLLECTIONS.lookup });
}

async function listVersions() {
  const latest = await getLatestVersion();
  const latestV2 = await getLatestVersion('v2_light');
  const latestV3 = await getLatestVersion('v3_big');
  return ok('listVersions', {
    latest: latest ? latest.snapshotVersion : null,
    latestV2: latestV2 ? latestV2.snapshotVersion : DEFAULT_V2_VERSION,
    latestV3: latestV3 ? latestV3.snapshotVersion : DEFAULT_V3_VERSION,
    versions: [latest, latestV2, latestV3].filter(Boolean),
    collection: COLLECTIONS.jobs
  });
}

async function handle(action, params, context) {
  switch (action) {
    case 'healthcheck':
      return ok(action, { status: 'ok', service: 'salesCenterApi', mode: 'v3-big-read-skeleton', collections: COLLECTIONS, cloudbaseSdkReady: !!cloudbase, received: params || {} }, { requestId: context && context.requestId ? context.requestId : undefined });
    case 'listVersions': return await listVersions();
    case 'getBootstrap': return await getBootstrap(params);
    case 'getTopMetrics': return await getTopMetrics(params);
    case 'queryRecords': return await queryRecords(params);
    case 'queryLookup': return await queryLookup(params);
    case 'getCustomerDetail': return await getCustomerDetail(params);
    case 'getProgress':
    case 'updateProgress':
    case 'upsertRecord':
    case 'deleteRecord':
    case 'exportRecords': return planned(action);
    default: return fail(action, 'UNKNOWN_ACTION', 'Unsupported action: ' + action);
  }
}

exports.main = async function (event, context) {
  const action = event && event.action ? String(event.action) : 'healthcheck';
  const params = event && event.params ? event.params : {};
  try { return await handle(action, params, context || {}); }
  catch (err) { return fail(action, err && err.code ? err.code : 'INTERNAL_ERROR', err && err.message ? err.message : String(err)); }
};
