#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ENV_ID = process.env.TCB_ENV_ID || process.env.CLOUDBASE_ENV_ID || 'adq-tuoke-2-d9gktr9mn2e462acd';
const DEFAULT_SEED_DIR = '/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v3_seed';
const TCB_BIN = process.env.TCB_BIN || '/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules/.bin/tcb';
const NODE_PATH_VALUE = process.env.NODE_PATH || '/Users/duziqing/.workbuddy/binaries/node/workspace/node_modules';
const COLLECTIONS = {
  records: 'sc_customer_records',
  lookup: 'sc_customer_lookup',
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
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function loadSeeds(seedDir) {
  const dir = path.resolve(seedDir);
  return {
    dir,
    manifest: readJson(path.join(dir, 'manifest_v3.json')),
    records: readJson(path.join(dir, 'sc_customer_records.seed.json')),
    lookup: readJson(path.join(dir, 'sc_customer_lookup.seed.json')),
    job: readJson(path.join(dir, 'sc_import_jobs.v3.seed.json'))
  };
}
function runTcb(args, options) {
  const res = spawnSync(TCB_BIN, args, {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NODE_PATH: NODE_PATH_VALUE }),
    maxBuffer: 1024 * 1024 * 20
  });
  if (res.status !== 0 && !(options && options.allowFail)) {
    const err = new Error((res.stderr || res.stdout || '').trim() || `tcb failed: ${args.join(' ')}`);
    err.stdout = res.stdout; err.stderr = res.stderr; err.status = res.status;
    throw err;
  }
  return res;
}
function mgo(collection, commandType, command, envId, allowFail) {
  const payload = [{ TableName: collection, CommandType: commandType, Command: JSON.stringify(command) }];
  const res = runTcb(['--env-id', envId, 'db', 'nosql', 'execute', '--json', '--command', JSON.stringify(payload)], { allowFail });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}
function createCollection(collection, envId) {
  const res = mgo(collection, 'COMMAND', { create: collection }, envId, true);
  return { collection, status: res.status === 0 ? 'created_or_exists' : 'ignored', stderr: (res.stderr || '').slice(0, 300) };
}
function deleteVersion(collection, snapshotVersion, envId) {
  const res = mgo(collection, 'DELETE', { delete: collection, deletes: [{ q: { snapshotVersion }, limit: 0 }] }, envId, true);
  return { collection, status: res.status === 0 ? 'ok' : 'ignored', stderr: (res.stderr || '').slice(0, 300) };
}
function insertOne(collection, doc, envId) {
  const clean = Object.assign({}, doc);
  delete clean.collection;
  mgo(collection, 'INSERT', { insert: collection, documents: [clean] }, envId, false);
}
function parseCliJson(text) {
  const s = String(text || '').trim();
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const idxs = [firstObj, firstArr].filter((x) => x >= 0).sort((a, b) => a - b);
  if (!idxs.length) return null;
  try { return JSON.parse(s.slice(idxs[0])); } catch (_) { return null; }
}
function extractCount(parsed) {
  const scan = JSON.stringify(parsed || {});
  let m = scan.match(/"(?:n|count)"\s*:\s*(\d+)/);
  if (!m) m = scan.match(/"(?:n|count)"\s*:\s*\{\s*"\$numberInt"\s*:\s*"(\d+)"\s*\}/);
  if (!m) m = scan.match(/"(?:n|count)"\s*:\s*\{\s*"\$numberLong"\s*:\s*"(\d+)"\s*\}/);
  return m ? Number(m[1]) : null;
}
function countVersion(collection, snapshotVersion, envId, extraQuery) {
  const query = Object.assign({ snapshotVersion }, extraQuery || {});
  const res = mgo(collection, 'COMMAND', { count: collection, query }, envId, true);
  const parsed = parseCliJson(res.stdout);
  return { collection, query, count: extractCount(parsed), status: res.status };
}
function main() {
  const args = parseArgs(process.argv);
  const seeds = loadSeeds(args.seedDir);
  const sv = seeds.manifest.snapshotVersion;
  const plan = { envId: args.envId, seedDir: seeds.dir, dryRun: args.dryRun, replace: args.replace, verifyOnly: args.verifyOnly, snapshotVersion: sv, counts: seeds.manifest.counts, collections: COLLECTIONS };
  if (args.dryRun) { console.log(JSON.stringify({ ok: true, plan }, null, 2)); return; }
  const actions = [];
  [COLLECTIONS.records, COLLECTIONS.lookup, COLLECTIONS.jobs].forEach((c) => actions.push(createCollection(c, args.envId)));
  if (!args.verifyOnly) {
    if (args.replace) {
      actions.push(deleteVersion(COLLECTIONS.records, sv, args.envId));
      actions.push(deleteVersion(COLLECTIONS.lookup, sv, args.envId));
      actions.push(deleteVersion(COLLECTIONS.jobs, sv, args.envId));
    }
    seeds.records.forEach((row) => insertOne(COLLECTIONS.records, row, args.envId));
    seeds.lookup.forEach((row) => insertOne(COLLECTIONS.lookup, row, args.envId));
    insertOne(COLLECTIONS.jobs, Object.assign({}, seeds.job, { uploadedAt: new Date().toISOString(), uploadStatus: 'uploaded' }), args.envId);
  }
  const verification = {
    recordChunks: countVersion(COLLECTIONS.records, sv, args.envId, { type: 'tuoke_real_records' }),
    lookupChunks: countVersion(COLLECTIONS.lookup, sv, args.envId),
    jobs: countVersion(COLLECTIONS.jobs, sv, args.envId, { phase: 'v3_big' })
  };
  const ok = verification.recordChunks.count === seeds.manifest.counts.recordChunks && verification.lookupChunks.count === seeds.manifest.counts.lookupChunks && verification.jobs.count >= 1;
  console.log(JSON.stringify({ ok, plan, actions, verification, expected: seeds.manifest.counts }, null, 2));
  if (!ok) process.exitCode = 1;
}
try { main(); } catch (err) {
  console.error(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err), stdout: err && err.stdout ? err.stdout.slice(0, 1000) : undefined, stderr: err && err.stderr ? err.stderr.slice(0, 1000) : undefined }, null, 2));
  process.exit(1);
}
