'use strict';
// 灌 customers + attribution_log seed 到 CloudBase（首次 add 自动建集合）
const path = require('path');
const fs = require('fs');
const cloudbase = require('@cloudbase/node-sdk');

const ENV_ID = 'adq-tuoke-2-d9gktr9mn2e462acd';
const SEED = process.argv[2] || '/Users/duziqing/WorkBuddy/2026-06-24-10-53-06/customers_seed/customers.seed.json';

(async () => {
  const app = cloudbase.init({ env: ENV_ID });
  const db = app.database();
  const customers = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  console.log('待灌 customers:', customers.length);

  const COL = 'sc_customers';
  // 先清空(replace模式): 查已有, 若有则删. 空库直接灌.
  let existing = 0;
  try { const c = await db.collection(COL).count(); existing = c.total || 0; } catch (e) { console.log('集合不存在,将自动创建'); }
  console.log('云端现有 customers:', existing);
  if (existing > 0) {
    console.log('⚠️ 已有数据,replace模式: 全部删除后重灌');
    let removed = 0;
    while (true) {
      const res = await db.collection(COL).limit(100).get();
      const rows = (res && res.data) || [];
      if (!rows.length) break;
      for (const r of rows) { await db.collection(COL).doc(r._id).remove(); removed++; }
      process.stdout.write('\r已删除 ' + removed);
    }
    console.log('\n删除完成:', removed);
  }

  // 批量 add (CloudBase 单次 add 一条; 用并发控制)
  let done = 0, failed = 0;
  const BATCH = 20;
  for (let i = 0; i < customers.length; i += BATCH) {
    const slice = customers.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(c => db.collection(COL).add(c)));
    results.forEach(r => { if (r.status === 'fulfilled') done++; else failed++; });
    process.stdout.write('\r已灌入 ' + done + ' 失败 ' + failed);
  }
  console.log('\n=== 灌库完成 ===');
  const finalCount = await db.collection(COL).count();
  console.log('云端 sc_customers 最终条数:', finalCount.total);
  console.log('期望:', customers.length, finalCount.total === customers.length ? '✅ 对账一致' : '❌ 不一致');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
