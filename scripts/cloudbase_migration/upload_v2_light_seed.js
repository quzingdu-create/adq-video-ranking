#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ENV_ID = process.env.TCB_ENV_ID || process.env.CLOUDBASE_ENV_ID || 'adq-tuoke-2-d9gktr9mn2e462acd';
const DEFAULT_SEED_DIR = '/Users/duziqing/WorkBuddy/2026-06-22-14-07-33/cloudbase_v2_seed';
const COLLECTIONS = {
  snapshot: 'sc_snapshot_daily',
  top: 'sc_top_metrics',
  jobs: 'sc_import_jobs'
};
const COLLECTION_NAMES = [COLLECTIONS.snapshot, COLLECTIONS.top, COLLECTIONS.jobs];

function parseArgs(argv) {
  const args = { seedDir: DEFAULT_SEED_DIR, dryRun: false, replace: false, verifyOnly: false };
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

function createDb(envId) {
  let cloudbase;
  try {
    cloudbase = require('@cloudbase/node-sdk');
  } catch (err) {
    throw new Error('Missing @cloudbase/node-sdk. Run npm install in the managed node workspace or cloudfunction directory first. ' + err.message);
  }
  const app = cloudbase.init({ env: envId || ENV_ID });
  return app.database();
}

async function ensureCollections(db) {
  const results = [];
  for (const name of COLLECTION_NAMES) {
    try {
      if (typeof db.createCollection === 'function') {
        await db.createCollection(name);
        results.push({ name, status: 'created' });
      } else {
        results.push({ name, status: 'skipped_create_method_missing' });
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/exist|already|duplicate|E11000|collection/i.test(msg)) {
        results.push({ name, status: 'exists' });
      } else {
        results.push({ name, status: 'create_failed', message: msg });
      }
    }
  }
  return results;
}

async function getByVersion(db, collection, snapshotVersion) {
  const res = await db.collection(collection).where({ snapshotVersion }).limit(100).get();
  return res && res.data ? res.data : [];
}

async function removeByVersion(db, collection, snapshotVersion) {
  const rows = await getByVersion(db, collection, snapshotVersion);
  let removed = 0;
  for (const row of rows) {
    if (row && row._id) {
      await db.collection(collection).doc(row._id).remove();
      removed += 1;
    }
  }
  return removed;
}

async function addRows(db, collection, rows) {
  let added = 0;
  for (const row of rows) {
    const payload = Object.assign({}, row);
    delete payload.collection;
    await db.collection(collection).add(payload);
    added += 1;
  }
  return added;
}

async function addJob(db, job) {
  const payload = Object.assign({}, job, { uploadedAt: new Date().toISOString(), uploadStatus: 'uploaded' });
  await db.collection(COLLECTIONS.jobs).add(payload);
  return 1;
}

async function verify(db, manifest) {
  const snapshotVersion = manifest.snapshotVersion;
  const snapshots = await getByVersion(db, COLLECTIONS.snapshot, snapshotVersion);
  const tops = await getByVersion(db, COLLECTIONS.top, snapshotVersion);
  const jobs = await getByVersion(db, COLLECTIONS.jobs, snapshotVersion);
  return {
    snapshotVersion,
    expected: manifest.counts,
    actual: {
      snapshotRecords: snapshots.length,
      topRecords: tops.length,
      importJobs: jobs.length
    },
    ok: snapshots.length === manifest.counts.snapshotRecords && tops.length === manifest.counts.topRecords && jobs.length >= 1
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const envId = args.envId || ENV_ID;
  const seeds = loadSeeds(args.seedDir);
  const rows = [
    { collection: COLLECTIONS.snapshot, items: seeds.snapshots },
    { collection: COLLECTIONS.top, items: seeds.tops }
  ];

  const plan = {
    envId,
    seedDir: seeds.dir,
    dryRun: args.dryRun,
    replace: args.replace,
    verifyOnly: args.verifyOnly,
    snapshotVersion: seeds.manifest.snapshotVersion,
    counts: seeds.manifest.counts,
    collections: COLLECTIONS
  };

  if (args.dryRun) {
    console.log(JSON.stringify({ ok: true, plan }, null, 2));
    return;
  }

  const db = createDb(envId);
  plan.collectionsReady = await ensureCollections(db);

  if (!args.verifyOnly) {
    if (args.replace) {
      plan.removed = {};
      plan.removed[COLLECTIONS.snapshot] = await removeByVersion(db, COLLECTIONS.snapshot, seeds.manifest.snapshotVersion);
      plan.removed[COLLECTIONS.top] = await removeByVersion(db, COLLECTIONS.top, seeds.manifest.snapshotVersion);
      plan.removed[COLLECTIONS.jobs] = await removeByVersion(db, COLLECTIONS.jobs, seeds.manifest.snapshotVersion);
    }
    plan.added = {};
    for (const group of rows) {
      plan.added[group.collection] = await addRows(db, group.collection, group.items);
    }
    plan.added[COLLECTIONS.jobs] = await addJob(db, seeds.job);
  }

  const verification = await verify(db, seeds.manifest);
  console.log(JSON.stringify({ ok: verification.ok, plan, verification }, null, 2));
  if (!verification.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }, null, 2));
  process.exit(1);
});
