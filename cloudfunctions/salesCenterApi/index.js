'use strict';

const ENV_ID = 'adq-tuoke-2-d9gktr9mn2e462acd';
const VERSION = 'v2-light-read-skeleton-20260622';
const COLLECTIONS = {
  snapshot: 'sc_snapshot_daily',
  top: 'sc_top_metrics',
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
    error: {
      code,
      message,
      detail: detail || null
    },
    meta: {
      env: ENV_ID,
      version: VERSION,
      ts: Date.now()
    }
  };
}

function planned(action) {
  return ok(action, {
    status: 'planned',
    message: 'This action is reserved for V3/V4 and is not enabled in V2 light migration.'
  });
}

function getDb() {
  if (!cloudbase) {
    const err = new Error('@cloudbase/node-sdk is not installed in this local skeleton. Add it before CloudBase deployment.');
    err.code = 'DB_SDK_NOT_AVAILABLE';
    throw err;
  }
  if (!app) app = cloudbase.init({ env: ENV_ID });
  if (!db) db = app.database();
  return db;
}

function rowsToMap(rows) {
  const out = {};
  (rows || []).forEach((row) => {
    if (!row || !row.type) return;
    out[row.type] = row.payload;
  });
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

async function getLatestVersion() {
  const database = getDb();
  const res = await database.collection(COLLECTIONS.jobs).orderBy('generatedAt', 'desc').limit(1).get();
  const list = res && res.data ? res.data : [];
  return list[0] || null;
}

async function getBootstrap(params) {
  params = params || {};
  const types = params.types || [
    'center_daily_kpi',
    'center_quarter_summary',
    'dashboard_runtime_summary',
    'center_sales_summary',
    'current_rising'
  ];
  const rows = await queryByTypes(COLLECTIONS.snapshot, types, params);
  return ok('getBootstrap', {
    mode: 'cloud',
    records: rows,
    payload: rowsToMap(rows),
    count: rows.length
  }, {
    collection: COLLECTIONS.snapshot
  });
}

async function getTopMetrics(params) {
  params = params || {};
  const types = params.types || [
    'top80_effective_metrics',
    'top_status_data',
    'top_status_list',
    'redblack_data',
    'top_rising_data',
    'yest_new_customer_tasks',
    'enough_candidates'
  ];
  const rows = await queryByTypes(COLLECTIONS.top, types, params);
  return ok('getTopMetrics', {
    mode: 'cloud',
    records: rows,
    payload: rowsToMap(rows),
    count: rows.length
  }, {
    collection: COLLECTIONS.top
  });
}

async function listVersions() {
  const latest = await getLatestVersion();
  return ok('listVersions', {
    latest: latest ? latest.snapshotVersion : null,
    versions: latest ? [latest] : [],
    collection: COLLECTIONS.jobs
  });
}

async function handle(action, params, context) {
  switch (action) {
    case 'healthcheck':
      return ok(action, {
        status: 'ok',
        service: 'salesCenterApi',
        mode: 'v2-light-read-skeleton',
        collections: COLLECTIONS,
        cloudbaseSdkReady: !!cloudbase,
        received: params || {}
      }, {
        requestId: context && context.requestId ? context.requestId : undefined
      });

    case 'listVersions':
      return await listVersions();

    case 'getBootstrap':
      return await getBootstrap(params);

    case 'getTopMetrics':
      return await getTopMetrics(params);

    case 'queryRecords':
    case 'getCustomerDetail':
    case 'queryLookup':
    case 'getProgress':
    case 'updateProgress':
    case 'upsertRecord':
    case 'deleteRecord':
    case 'exportRecords':
      return planned(action);

    default:
      return fail(action, 'UNKNOWN_ACTION', 'Unsupported action: ' + action);
  }
}

exports.main = async function (event, context) {
  const action = event && event.action ? String(event.action) : 'healthcheck';
  const params = event && event.params ? event.params : {};
  try {
    return await handle(action, params, context || {});
  } catch (err) {
    return fail(action, err && err.code ? err.code : 'INTERNAL_ERROR', err && err.message ? err.message : String(err));
  }
};
