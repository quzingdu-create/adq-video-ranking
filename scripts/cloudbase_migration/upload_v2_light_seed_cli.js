#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ENV_ID = process.env.TCB_ENV_ID || process.env.CLOUDBASE_ENV_ID || 'adq-tuoke-2-d9gktr9mn2e462acd';
const DEFAULT_SEED_DIR = '/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed';
const TCB_BIN = process.env.TCB_BIN || '/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules/.bin/tcb';
const NODE_PATH_VALUE = process.env.NODE_PATH || '/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules';
const COLLECTIONS = {
  snapshot: 'sc_snapshot_daily',
  top: 'sc_top_metrics',
  jobs: 'sc_import_jobs'
};

function parseArgs(argv) {
  const args = { seedDir: DEFAULT_SEED_DIR, dryRun: false, replace: false, verifyOnly: false, envId: ENV_ID };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--seed-dir') args.seedDir = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--replace') args.replace = true;
    else if (a === '--verify-only') args.verifyOnly = true;
    else if (a === '--env') args.envId = argv[++i];
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadSeeds(seedDir) {
  const dir = path.resolve(seedDir);
  return {
    dir,
    manifest: readJson(path.join(dir, 'manifest.json')),
    snapshots: readJson(path.join(dir, 'sc_snapshot_daily.seed.json')),
    tops: readJson(path.join(dir, 'sc_top_metrics.seed.json')),
    job: readJson(path.join(dir, 'sc_import_jobs.seed.json'))
  };
}

function runTcb(args, options) {
  const res = spawnSync(TCB_BIN, args, {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NODE_PATH: NODE_PATH_VALUE }),
    maxBuffer: 1024 * 1024 * 10
  });
  if (res.status !== 0 && !(options && options.allowFail)) {
    const err = new Error((res.stderr || res.stdout || '').trim() || `tcb failed: ${args.join(' ')}`);
    err.stdout = res.stdout;
    err.stderr = res.stderr;
    err.status = res.status;
    throw err;
  }
  return res;
}

function mgo(collection, commandType, command, envId, allowFail) {
  const payload = [{
    TableName: collection,
    CommandType: commandType,
    Command: JSON.stringify(command)
  }];
  const res = runTcb(['--env-id', envId, 'db', 'nosql', 'execute', '--json', '--command', JSON.stringify(payload)], { allowFail });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

function parseCliJson(text) {
  const s = String(text || '').trim();
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const idxs = [firstObj, firstArr].filter((x) => x >= 0).sort((a, b) => a - b);
  if (!idxs.length) return null;
  try {
    return JSON.parse(s.slice(idxs[0]));
  } catch (_) {
    return null;
  }
}

function deleteVersion(collection, snapshotVersion, envId) {
  const command = { delete: collection, deletes: [{ q: { snapshotVersion }, limit: 0 }] };
  const res = mgo(collection, 'DELETE', command, envId, true);
  return { collection, status: res.status === 0 ? 'ok' : 'ignored', stderr: (res.stderr || '').slice(0, 500) };
}

function insertOne(collection, doc, envId) {
  const clean = Object.assign({}, doc);
  delete clean.collection;
  const command = { insert: collection, documents: [clean] };
  mgo(collection, 'INSERT', command, envId, false);
}

function countVersion(collection, snapshotVersion, envId) {
  const command = { count: collection, query: { snapshotVersion } };
  const res = mgo(collection, 'COMMAND', command, envId, true);
  const parsed = parseCliJson(res.stdout);
  let n = null;
  const scan = JSON.stringify(parsed || {});
  let m = scan.match(/"(?:n|count)"\s*:\s*(\d+)/);
  if (!m) m = scan.match(/"(?:n|count)"\s*:\s*\{\s*"\$numberInt"\s*:\s*"(\d+)"\s*\}/);
  if (!m) m = scan.match(/"(?:n|count)"\s*:\s*\{\s*"\$numberLong"\s*:\s*"(\d+)"\s*\}/);
  if (m) n = Number(m[1]);
  return { collection, count: n, raw: parsed || res.stdout.slice(0, 500), status: res.status };
}

function buildPlan(args, seeds) {
  return {
    envId: args.envId,
    seedDir: seeds.dir,
    dryRun: args.dryRun,
    replace: args.replace,
    verifyOnly: args.verifyOnly,
    snapshotVersion: seeds.manifest.snapshotVersion,
    counts: seeds.manifest.counts,
    collections: COLLECTIONS
  };
}

function main() {
  const args = parseArgs(process.argv);
  const seeds = loadSeeds(args.seedDir);
  const plan = buildPlan(args, seeds);
  if (args.dryRun) {
    console.log(JSON.stringify({ ok: true, plan }, null, 2));
    return;
  }

  const snapshotVersion = seeds.manifest.snapshotVersion;
  const actions = [];

  if (!args.verifyOnly) {
    if (args.replace) {
      actions.push(deleteVersion(COLLECTIONS.snapshot, snapshotVersion, args.envId));
      actions.push(deleteVersion(COLLECTIONS.top, snapshotVersion, args.envId));
      actions.push(deleteVersion(COLLECTIONS.jobs, snapshotVersion, args.envId));
    }

    for (const row of seeds.snapshots) insertOne(COLLECTIONS.snapshot, row, args.envId);
    for (const row of seeds.tops) insertOne(COLLECTIONS.top, row, args.envId);
    insertOne(COLLECTIONS.jobs, Object.assign({}, seeds.job, { uploadedAt: new Date().toISOString(), uploadStatus: 'uploaded' }), args.envId);
  }

  const verification = {
    snapshot: countVersion(COLLECTIONS.snapshot, snapshotVersion, args.envId),
    top: countVersion(COLLECTIONS.top, snapshotVersion, args.envId),
    jobs: countVersion(COLLECTIONS.jobs, snapshotVersion, args.envId)
  };
  const actualSnapshot = verification.snapshot.count;
  const actualTop = verification.top.count;
  const actualJobs = verification.jobs.count;
  const ok = actualSnapshot === seeds.manifest.counts.snapshotRecords && actualTop === seeds.manifest.counts.topRecords && actualJobs >= 1;

  console.log(JSON.stringify({
    ok,
    plan,
    actions,
    verification,
    expected: seeds.manifest.counts,
    actual: {
      snapshotRecords: actualSnapshot,
      topRecords: actualTop,
      importJobs: actualJobs
    }
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    error: err && err.message ? err.message : String(err),
    stdout: err && err.stdout ? err.stdout.slice(0, 1000) : undefined,
    stderr: err && err.stderr ? err.stderr.slice(0, 1000) : undefined
  }, null, 2));
  process.exit(1);
}
