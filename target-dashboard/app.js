// app.js — 看板共享逻辑（角色切换 + 数据加载 + 渲染工具）
window.DATA = null;
window.ROLE = { type: "internal", id: "all", label: "内部 · 全量", key: "internal:all" };

// ============================================================
// SOP 一键复制 = 企微链接（子青 9.3 拍板：复制出来是链接）
// ============================================================
const SOP_KEY_MAP = {
  '4+m': 'four_plus_m',
  '潜客优投': 'latent_qianke',
  '多商品聚合页': 'aggregate_page',
  '小店艾米智投': 'xiaodian_aimi',
  '原生推广': 'native_promote'
  // '全店托管' 子青未给链接，不显示按钮
};
window.SOP_KEY_MAP = SOP_KEY_MAP;

function copySOP(sopKey){
  const d = window.__DATA__ || window.DATA || {};
  const sop = (d.sops||{})[sopKey];
  if(!sop){ alert('未找到该产品 SOP 文档（key='+sopKey+'）'); return; }
  // 子青原话"复制出来不是连接"→ 复制 = 纯链接（可粘贴即用）
  const url = sop.url || '';
  const full = url ? `【${sop.name}】\n${url}` : `【${sop.name}】（暂无链接）`;
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(url || full).then(
      ()=>showToast('✅ 已复制 ' + sop.name + ' 链接'),
      (e)=>showToast('❌ 复制失败：'+e.message)
    );
  } else {
    const ta = document.createElement('textarea');
    ta.value = url || full; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('✅ 已复制 ' + sop.name + ' 链接'); }
    catch(e){ showToast('❌ 复制失败：'+e.message); }
    document.body.removeChild(ta);
  }
}
window.copySOP = copySOP;

function showToast(msg){
  let t = document.getElementById('__toast');
  if(!t){
    t = document.createElement('div');
    t.id = '__toast';
    t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1F1F1D;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 4px 18px rgba(0,0,0,0.2);opacity:0;transition:opacity .25s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t.__T);
  t.__T = setTimeout(()=>{ t.style.opacity='0'; }, 2400);
}

async function loadData(){
  if(window.DATA) return window.DATA;
  const r = await fetch("data.json");
  window.DATA = await r.json();
  window.__DATA__ = window.DATA;     // SOP 复制按钮需要访问 data.sops
  return window.DATA;
  return window.DATA;
}

function fmtMoney(v, digit=0){
  if(v==null || isNaN(v)) return "-";
  if(Math.abs(v)>=1e8) return (v/1e8).toFixed(2)+" 亿";
  if(Math.abs(v)>=1e4) return (v/1e4).toFixed(digit>=0?digit:1)+" 万";
  return v.toFixed(0);
}
function fmtNum(v, d=2){
  if(v==null || isNaN(v)) return "-";
  return Number(v).toFixed(d);
}
function fmtPct(v, d=1){
  if(v==null || isNaN(v)) return "-";
  return Number(v).toFixed(d) + "%";
}
function fmtInt(v){ if(v==null||isNaN(v)) return "-"; return Math.round(v).toLocaleString(); }

/* ============================================================
   角色系统
   - 动态从 data.json 生成（不再硬编码）
   - 按页面类型分集：partner 页含 internal + 全量代理商；customer 页含全量客户
   - 搜索式下拉 + 实时过滤
   - per-page localStorage 存选中（互不干扰）
   ============================================================ */
function roleColor(t){
  return ({internal:"#4C5FD7", partner:"#22916B", customer:"#E08B24"})[t] || "#8695A8";
}

/* ============================================================
   行业色带 · 8 色循环
   ============================================================ */
// 行业名 → 颜色：子青截图发现 贴身衣物+珠宝配饰 都是橙红（#E8734A vs #D9744A 色相几乎一致）
// 修法：7 行业一一对应独立色（色相差 ≥ 30°），不用 palette 顺序
const INDUSTRY_FIXED = {
  "贴身衣物":   "#E8734A",  // 橙红
  "箱包鞋靴":   "#4C9BE8",  // 蓝
  "珠宝配饰":   "#7C6BD9",  // 紫
  "运动户外":   "#22916B",  // 绿
  "男装":       "#E0A92B",  // 黄
  "服饰配件":   "#D95F8E",  // 粉红
  "其他":       "#98A2B3",  // 灰
  // 兼容旧名字（之前 v1 用过，避免 0 显示）
  "跑品客户":   "#4C9BE8",
  "鞋靴":       "#4C9BE8",
  "运动鞋服":   "#22916B",
  "女装":       "#D95F8E",
  "配饰闭环":   "#7C6BD9",
  "箱包":       "#4C9BE8",
  "本土品牌服饰":"#E0A92B"
};
const _indColorCache = {};
const INDUSTRY_PALETTE = [
  "#E8734A", "#4C9BE8", "#7C6BD9", "#22916B",
  "#E0A92B", "#D95F8E", "#35B0A7", "#98A2B3",
  // 扩展：8 个高饱和色（覆盖未在 FIXED 里的行业）
  "#5B8FD9", "#B5733A", "#8E6CB3", "#D9744A",
  "#5BA0C2", "#C25BB3", "#7AC25B", "#C2B45B"
];
function industryColor(name){
  if(!name) return INDUSTRY_FIXED['其他'];
  if(INDUSTRY_FIXED[name]) return INDUSTRY_FIXED[name];
  // 兜底：hash 字符串 → HSL（保证任何新行业名都有独立色）
  let h = 0;
  for(let i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) % 360;
  const c = `hsl(${h}, 65%, 52%)`;
  _indColorCache[name] = c;
  return c;
}
function indDot(name){
  return `<span class="ind-dot"><i style="background:${industryColor(name)}"></i>${name}</span>`;
}

/* ============================================================
   风险分级 · 取该客户命中建议中的最高等级
   ============================================================ */
const RISK_META = {
  p0: {label:"立即介入", bar:"b-danger", chip:"c-danger", desc:"未起量 / 高危，需 3 日内介入"},
  p1: {label:"需关注",   bar:"b-warn",   chip:"c-warn",   desc:"ROI 偏低或服务质量红灯，7 日内跟进"},
  p2: {label:"可优化",   bar:"b-info",   chip:"",         desc:"基建 / 素材 / 工具未用满"},
  ok: {label:"健康",     bar:"b-ok",     chip:"c-ok",     desc:"未触发任何预警规则"},
};
function riskLevel(c){
  const lv = (c.advice||[]).map(a=>a.level);
  if(lv.includes("P0")) return "p0";
  if(lv.includes("P1")) return "p1";
  if(lv.includes("P2")) return "p2";
  return "ok";
}
function groupByRisk(list){
  const g = {p0:[],p1:[],p2:[],ok:[]};
  list.forEach(c=>g[riskLevel(c)].push(c));
  Object.values(g).forEach(a=>a.sort((x,y)=>y.consume-x.consume));
  return g;
}

/* 转义 */
function escHtml(s){ return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function escAttr(s){ return escHtml(s); }

/* 动态构建角色集 */
async function buildRoleSet(type){
  const d = await loadData();
  if(type === "partner"){
    const agents = [...new Set(d.customers.map(c=>c.agent).filter(a=>a && a!=="空"))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    return {
      type: "partner",
      name: "服务商",
      searchHint: "搜索服务商（如：创亿方舟、沃虎）",
      items: [
        { key: "internal:all", type:"internal", label:"内部 · 全量（销售/运营/渠道经理）", id:"all" },
        ...agents.map(a => ({ key: `partner:${a}`, type:"partner", label:`服务商 · ${a}`, id:a, meta:`${d.customers.filter(c=>c.agent===a).length} 家` }))
      ]
    };
  }
  if(type === "customer"){
    return {
      type: "customer",
      name: "客户",
      searchHint: "搜索客户主体名称",
      items: d.customers
        .slice().sort((a,b)=>b.consume-a.consume)
        .map(c => ({ key: `customer:${c.sub}`, type:"customer", label:c.sub, id:c.sub, meta:fmtMoney(c.consume,0)+" 元" }))
    };
  }
  return null;
}

/* 渲染菜单项（带过滤） */
function renderRoleMenu(roleSet, currentKey, filter=""){
  const q = (filter||"").trim().toLowerCase();
  const filtered = q
    ? roleSet.items.filter(it => it.label.toLowerCase().includes(q) || (it.id||"").toLowerCase().includes(q))
    : roleSet.items;
  if(!filtered.length){
    return `<div class="rm-empty">无匹配项</div>`;
  }
  // 按 type 分组
  const groups = {};
  filtered.forEach(it=>{
    (groups[it.type] = groups[it.type] || []).push(it);
  });
  const order = ["internal","partner","customer"];
  let html = "";
  order.forEach(t=>{
    if(!groups[t]) return;
    const gh = ({internal:"内部员工", partner:"渠道服务商", customer:"靶向客户"})[t];
    html += `<div class="rm-group"><div class="rm-gh">${gh} <span class="rm-count">${groups[t].length}</span></div>`;
    groups[t].forEach(it=>{
      const on = it.key === currentKey;
      html += `<div class="rm-item ${on?'on':''}" data-key="${escAttr(it.key)}">
        <span class="rm-dot" style="background:${roleColor(it.type)}"></span>
        <span class="rm-label">
          <span class="rm-label-text">${escHtml(it.label)}</span>
          ${it.meta?`<span class="rm-meta">${escHtml(it.meta)}</span>`:''}
        </span>
        ${on?'<span class="rm-check">✓</span>':''}
      </div>`;
    });
    html += `</div>`;
  });
  return html;
}

/* 角色过滤客户（无变化） */
function filterByRole(customers, role){
  if(role.type === "partner"){
    return customers.filter(c => c.agent === role.id ||
      (c.shops && c.shops.some(s => s.agent === role.id)));
  }
  if(role.type === "customer"){
    return customers.filter(c => c.sub === role.id);
  }
  return customers;
}

/* ============================================================
   顶部初始化（异步）
   currentPage: 'index' | 'partner' | 'customer' | 'detail'
   - index / detail: 不显示身份切换
   - partner: 显示「内部·全量 + 全量服务商」可搜索下拉
   - customer: 显示全量客户可搜索下拉
   ============================================================ */
async function initTopbar(currentPage){
  const el = document.getElementById("topbar");
  if(!el) return;

  // 按页面类型构建角色集
  let roleSet = null;
  if(currentPage === "partner"){
    roleSet = await buildRoleSet("partner");
  } else if(currentPage === "customer" || currentPage === "detail"){
    roleSet = await buildRoleSet("customer");
  }

  const rightHTML = roleSet
    ? `<span class="role-lbl">当前${roleSet.name}</span>
       <div class="role-switcher" id="roleSwitcher">
         <button class="role-chip" id="roleChip" type="button">
           <span class="rc-dot" id="rcDot" style="background:${roleColor('internal')}"></span>
           <span class="rc-text" id="rcText">-</span>
           <span class="rc-arrow">▾</span>
         </button>
         <div class="role-menu" id="roleMenu">
           <div class="rm-search">
             <span class="rm-search-icon">🔍</span>
             <input type="text" id="rmSearchInput" placeholder="${roleSet.searchHint}" autocomplete="off" />
             <button class="rm-search-clear" id="rmSearchClear" type="button" aria-label="清除">×</button>
           </div>
           <div class="rm-list" id="rmList">${renderRoleMenu(roleSet, '')}</div>
         </div>
       </div>`
    : `<span class="role-lbl-static"><span class="rls-dot"></span>内部全局视角</span>`;

  el.innerHTML = `
    <div class="brand">
      <div class="brand-mark">靶</div>
      <div>
        <div class="brand-name">靶向客户监控看板 <span class="brand-sub">/ Target Customer Monitor</span></div>
      </div>
    </div>
    <div class="nav">
      <a href="index.html" class="${currentPage==='index'?'active':''}">总览</a>
      <a href="customer.html" class="${currentPage==='customer'?'active':''}">客户视图</a>
    </div>
    <div class="topbar-right">
      ${rightHTML}
    </div>
  `;

  if(!roleSet) return;

  const chip = document.getElementById("roleChip");
  const menu = document.getElementById("roleMenu");
  const searchInput = document.getElementById("rmSearchInput");
  const searchClear = document.getElementById("rmSearchClear");
  const rmList = document.getElementById("rmList");
  const switcher = document.getElementById("roleSwitcher");

  // 读取/对齐当前角色（per-page localStorage）
  const lsKey = `dash_role_${roleSet.type}`;
  let currentKey = localStorage.getItem(lsKey);
  if(!roleSet.items.find(it => it.key === currentKey)){
    currentKey = roleSet.items[0].key;
    localStorage.setItem(lsKey, currentKey);
  }

  function openMenu(){
    menu.classList.add("open");
    chip.classList.add("open");
    rmList.innerHTML = renderRoleMenu(roleSet, currentKey, searchInput.value);
    searchClear.style.display = searchInput.value ? "block" : "none";
    setTimeout(()=>searchInput.focus(), 50);
  }
  function closeMenu(){
    menu.classList.remove("open");
    chip.classList.remove("open");
  }

  chip.addEventListener("click", e=>{
    e.stopPropagation();
    menu.classList.contains("open") ? closeMenu() : openMenu();
  });
  document.addEventListener("click", e=>{
    if(!switcher.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", e=>{
    if(e.key === "Escape") closeMenu();
  });

  searchInput.addEventListener("input", ()=>{
    rmList.innerHTML = renderRoleMenu(roleSet, currentKey, searchInput.value);
    searchClear.style.display = searchInput.value ? "block" : "none";
  });
  searchInput.addEventListener("keydown", e=>{
    if(e.key === "Enter"){
      const first = rmList.querySelector(".rm-item");
      if(first) first.click();
    }
  });
  searchClear.addEventListener("click", e=>{
    e.stopPropagation();
    searchInput.value = "";
    rmList.innerHTML = renderRoleMenu(roleSet, currentKey);
    searchClear.style.display = "none";
    searchInput.focus();
  });

  rmList.addEventListener("click", e=>{
    const item = e.target.closest(".rm-item");
    if(!item) return;
    const key = item.dataset.key;
    const pickedItem = roleSet.items.find(i=>i.key===key);
    currentKey = key;
    localStorage.setItem(lsKey, key);
    applyRole(key, roleSet);
    closeMenu();
    // 🔴 子青 9.3 拍板：customer 类型切客户时自动跳转新 detail；partner 类型留在当前页只切视角
    if(pickedItem && pickedItem.type === 'customer'){
      const newSub = pickedItem.id;
      const currentSub = new URLSearchParams(location.search).get('sub');
      if(newSub && newSub !== currentSub){
        location.href = 'detail.html?sub=' + encodeURIComponent(newSub);
        return;  // 跳转后无需 onRoleChanged
      }
    }
    if(window.onRoleChanged) window.onRoleChanged();
  });

  // 🔴 跳转时同步：URL sub → ROLE（子青 9.3 拍板，点了哪个客户 chip 顶栏就显示哪个）
  const urlSub = new URLSearchParams(location.search).get('sub');
  if(urlSub){
    const found = roleSet.items.find(it => it.id === urlSub || it.label === urlSub);
    if(found){
      currentKey = found.key;
      localStorage.setItem(lsKey, currentKey);
    }
  }

  applyRole(currentKey, roleSet);
}

function applyRole(key, roleSet){
  let it = null;
  if(roleSet){
    it = roleSet.items.find(i => i.key === key) || roleSet.items[0];
  }
  if(!it){
    window.ROLE = { key:"internal:all", type:"internal", id:"all", label:"内部 · 全量" };
  } else {
    window.ROLE = { key: it.key, type: it.type, id: it.id, label: it.label };
  }
  const textEl = document.getElementById("rcText");
  const dotEl  = document.getElementById("rcDot");
  if(textEl) textEl.textContent = window.ROLE.label;
  if(dotEl)  dotEl.style.background = roleColor(window.ROLE.type);
}

/* ============================================================
   建议卡渲染
   ============================================================ */
function renderAdvice(list){
  if(!list || !list.length) return `<div class="hint">✓ 未发现明显问题</div>`;
  return `<div class="advice">${list.map(a => `
    <div class="advice-item ${a.level.toLowerCase()}">
      <div class="advice-head">
        <span class="level">${a.level}</span>
        <span class="tag-name">${a.tag}</span>
      </div>
      <div class="advice-reason">${a.reason}</div>
      <div class="advice-action">建议 · <b>${a.action}</b></div>
    </div>`).join("")}</div>`;
}

/* 按类型分组输出（子青要求：先分类型再展示客户） */
const ADVICE_CATEGORIES = ['双率','素材质量','基建','小店三率','产品使用类型','链路','投放端'];
const CATEGORY_DESC = {
  '双率':           {icon:'📊', hint:'点击率 / 转化率 / ROI · 越接近行业头部越健康'},
  '素材质量':       {icon:'🎬', hint:'完播 / 播放时长 / 新广告 / 一键起量'},
  '基建':           {icon:'🏗', hint:'主体 / 账户 / 广告数 / 创意数'},
  '小店三率':       {icon:'🛡', hint:'品退 / 差评 / 纠纷 · 越低越好'},
  '产品使用类型':   {icon:'🧩', hint:'4+m / 多商品聚合页 / 直播 / 艾米智投'},
  '链路':           {icon:'🔗', hint:'潜客优投 / 原生推广 / 全域通'},
  '投放端':         {icon:'📡', hint:'adq / 分产品出价'},
};
function renderAdviceByCategory(list){
  if(!list || !list.length) return `<div class="hint">✓ 未发现明显问题</div>`;
  // 按类型分组
  const groups = {};
  list.forEach(a=>{ const c = a.category || '其他'; (groups[c]=groups[c]||[]).push(a); });
  const orderedCats = ADVICE_CATEGORIES.filter(c=>groups[c]);
  // 类型有建议的优先展示
  return orderedCats.map(cat=>{
    const items = groups[cat];
    const desc = CATEGORY_DESC[cat] || {icon:'·', hint:''};
    const levels = items.reduce((m,a)=>{ m[a.level]=(m[a.level]||0)+1; return m; },{});
    const lvBadge = Object.entries(levels).map(([k,v])=>`<span class="cat-badge lv-${k.toLowerCase()}">${k}×${v}</span>`).join('');
    return `<div class="cat-group">
      <div class="cat-head">
        <span class="cat-icon">${desc.icon}</span>
        <span class="cat-name">${cat}</span>
        <span class="cat-count">${items.length} 条</span>
        <span class="cat-badges">${lvBadge}</span>
      </div>
      <div class="cat-items">${items.map(a=>`
        <div class="cat-item ${a.level.toLowerCase()}">
          <div class="cat-item-head">
            <span class="cat-item-name">${a.tag}</span>
            <span class="cat-item-reason">${a.reason}</span>
          </div>
          <div class="cat-item-action">▸ ${a.action}</div>
        </div>`).join('')}</div>
    </div>`;
  }).join('') || `<div class="hint">✓ 未发现明显问题</div>`;
}

// ROI 状态
function roiTag(roi){
  if(roi==null) return `<span class="tag gray">·</span>`;
  if(roi<2) return `<span class="tag bad"><span class="dot"></span>${fmtNum(roi)}</span>`;
  if(roi<3) return `<span class="tag warn"><span class="dot"></span>${fmtNum(roi)}</span>`;
  return `<span class="tag ok"><span class="dot"></span>${fmtNum(roi)}</span>`;
}

// 消耗状态
function consumeTag(v){
  if(v<100) return `<span class="tag bad">未起量</span>`;
  if(v<1000) return `<span class="tag warn">起步</span>`;
  if(v<10000) return `<span class="tag info">成长</span>`;
  return `<span class="tag ok">成熟</span>`;
}

// 三率 warn?
function riskTag(v, threshold, label){
  if(v==null) return `<span class="hint">-</span>`;
  if(v>threshold) return `<span class="tag bad">${fmtNum(v,2)}%</span>`;
  return `<span>${fmtNum(v,2)}%</span>`;
}

/* ============================================================
   前端建议引擎（覆盖 build_data.py 的 7 条规则）
   思路：对所有"不够好"的指标都生成具体建议，不要遗漏。
   ============================================================ */
function genAdvice(c, bench){
  const a = [];
  const b = bench || {};
  // 🔴 不同客户不同阈值（核心修复）
  // 按日均消耗分阶段，ROI 阈值随阶段收紧（不是按"对标"做硬比较）
  const cons = c.main_consume || c.consume || 0;
  let stage = '新店期';      // <500 元/天
  let roiTh = 2.0;          // 红线
  if(cons >= 2000){ stage = '成熟期'; roiTh = 3.0; }
  else if(cons >= 500){ stage = '成长期'; roiTh = 2.5; }
  c._stage = stage;          // 后续 metric-cell 标头可读
  c._roiTh = roiTh;

  // —— P0：紧急 ——
  if(c.consume < 100 && c.shops.length===0){
    a.push({level:"P0", tag:"未起量", reason:`日均消耗 ¥${Math.round(c.consume)}（新店期）`, action:"3 日内介入排查小店链路+素材，推动首次跑量"});
  }
  if(c.roi != null && c.roi < roiTh && c.consume >= 1000){
    a.push({level:"P0", tag:"ROI 严重偏低", reason:`ROI ${c.roi.toFixed(2)} < ${stage}红线 ${roiTh.toFixed(1)} · 客户阶段：${stage}`, action:`▸ 紧急：① 当日关停 ROI<1.0 的计划 ② 保留 ROI≥${roiTh.toFixed(1)} 的优质计划扩量 ③ 排查主表素材与目标出价 ④ 7 天无改善考虑下线整账户`});
  }

  // —— P1：核心 ROI 治理（按客户阶段不同阈值）——
  if(c.roi != null && c.roi >= roiTh && c.roi < roiTh+0.5 && c.consume >= 100){
    a.push({level:"P1", tag:"ROI 待优化", reason:`ROI ${c.roi.toFixed(2)} 接近${stage}达标线`, action:`▸ ① 关停 ROI<${(roiTh-0.5).toFixed(1)} 的低效计划 ② 优质素材跨账户分发（3+ 账户）③ 提升客单价（关联销售/升级 SKU）④ 排查"广告主在投的消耗"占比是否 >20%`});
  }
  if(c.roi != null && c.roi >= roiTh+0.5 && c.roi < roiTh+2 && c.consume >= 1000){
    a.push({level:"P2", tag:"ROI 已达标", reason:`ROI ${c.roi.toFixed(2)} ≥ ${stage}达标线（${roiTh.toFixed(1)}）`, action:"保持节奏，可考虑优质素材+账户分发扩量"});
  }
  if(c.roi != null && c.roi >= roiTh+2){
    a.push({level:"P2", tag:"ROI 优秀", reason:`ROI ${c.roi.toFixed(2)}，超过${stage}头部线（${roiTh.toFixed(1)}）`, action:"跨账户/跨主体分发优质素材，规模化复制"});
  }

  // —— P1/P2：双率（ctr/cvr）—— 用绝对值阈值，不对标头部 ——
  // 通用标准：ctr ≥ 2% 算正常，<1% 严重偏低；cvr ≥ 4% 正常，<2% 严重偏低
  if(c.ctr != null && c.ctr > 0 && c.ctr < 1){
    a.push({level:"P1", tag:"点击率严重偏低(ctr)", reason:`ctr ${c.ctr.toFixed(2)}% < 1% 红线`, action:"视觉重构（高反差封面+大字报）、开启数据外显、人群定向洗牌、强制\"痛点+产品+承诺\"3秒结构"});
  } else if(c.ctr != null && c.ctr >= 1 && c.ctr < 2){
    a.push({level:"P2", tag:"ctr 接近健康线", reason:`ctr ${c.ctr.toFixed(2)}% 接近 2%`, action:"对标爆款素材衍生，加大换镜头频次（每 5-8 秒）"});
  }
  if(c.cvr != null && c.cvr > 0 && c.cvr < 2){
    a.push({level:"P1", tag:"转化率严重偏低(cvr)", reason:`cvr ${c.cvr.toFixed(2)}% < 2% 红线`, action:"链路一致性核查、直播间逼单话术、商详页加倒计时/限时特诱因、及时处理中差评"});
  } else if(c.cvr != null && c.cvr >= 2 && c.cvr < 4){
    a.push({level:"P2", tag:"cvr 接近健康线", reason:`cvr ${c.cvr.toFixed(2)}% 接近 4%`, action:"对标头部，丰富直播间促销玩法"});
  }

  // —— P2：目标出价 ——（子青 9.3 拍板：整块删除）
  // 历史：if(c.target_bid == null && c.consume >= 1000) a.push({...})

  // —— P1/P2：基建/规模（按客户阶段不同水位）——
  // 通用标准：广告数<50/日 算薄；<100/日 算可扩
  if(c.ads != null && c.ads < 50 && c.consume >= 1000){
    a.push({level:"P2", tag:"广告基建薄", reason:`日均广告数 ${Math.round(c.ads)} 偏少`, action:"每日新建计划数 ≥ 当前活跃计划数 × 1.5；优质素材跨账户同步"});
  }
  if(c.account != null && c.account < 2 && c.consume >= 1000){
    a.push({level:"P2", tag:"账户数过少", reason:`有消耗的账户数仅 ${c.account}`, action:"多账户分发防单点故障，优质素材至少在 2 个账户同时投放"});
  }
  if(c.creative_id != null && c.creative_id < 30 && c.consume >= 1000){
    a.push({level:"P2", tag:"创意数偏低", reason:`均曝光创意 ${Math.round(c.creative_id)} < 30`, action:"优质素材通过换封面/BGM/开头快速衍生 9 条新创意"});
  }

  // —— P1/P2：新广告/上新 ——
  if(c.new_ratio != null && c.new_ratio < 5 && c.consume >= 1000){
    a.push({level:"P1", tag:"上新严重不足", reason:`新广告占比 ${c.new_ratio.toFixed(1)}% < 5% 红线`, action:"强制上新：每日流量高峰前 2 小时批量上新计划；清理低点击、无转化老计划释放额度"});
  }
  if(c.new_ratio != null && c.new_ratio >= 5 && c.new_ratio < 20 && c.consume >= 1000){
    a.push({level:"P2", tag:"素材节奏偏慢", reason:`新广告占比 ${c.new_ratio.toFixed(1)}% 介于 5-20%`, action:"提升素材产出节奏，目标 ≥ 20%"});
  }

  // —— P1/P2：一键起量 ——
  if(c.auto_ratio != null && c.auto_ratio < 10 && c.consume >= 1000){
    a.push({level:"P1", tag:"一键起量严重不足", reason:`一键起量使用占比 ${c.auto_ratio.toFixed(1)}% < 10% 红线`, action:"为重点新计划配 200-500 元一键起量预算；新计划 1-2 小时无展现立即开启"});
  }
  if(c.auto_ratio != null && c.auto_ratio >= 10 && c.auto_ratio < 30 && c.consume >= 1000){
    a.push({level:"P2", tag:"一键起量占比偏低", reason:`一键起量 ${c.auto_ratio.toFixed(1)}% 偏低`, action:"加大一键起量预算占比"});
  }

  // —— P1/P2：3 秒完播率 ——
  if(c["3s_play"] != null && c["3s_play"] > 0 && c["3s_play"] < 20){
    const ind = c.industry || '';
    let hook = "产品惊艳特写";
    if(ind.includes("鞋")) hook = "上脚特写+脚步节奏";
    else if(ind.includes("运动")) hook = "运动中速切换+数据冲击";
    else if(ind.includes("珠宝")) hook = "光线打在产品上的特写";
    a.push({level:"P1", tag:"3秒完播率严重偏低", reason:`完播率 ${c["3s_play"].toFixed(1)}% < 20% 红线 · 行业(${ind})`,
      action: `▸ 前 0.5 秒用"${hook}" + 冲击音效 · 用反问开场（"你还不知道…"） · 数字人口播核心利益点 · 关键信息前 3 秒必须出现`});
  } else if(c["3s_play"] != null && c["3s_play"] >= 20 && c["3s_play"] < 35){
    a.push({level:"P2", tag:"完播率偏中", reason:`完播率 ${c["3s_play"].toFixed(1)}% 介于 20-35%`, action:"首 3 秒强视觉冲击+产品惊艳对比，强化悬念结构"});
  }

  // —— P1/P2：平均播放时长 ——
  if(c.avg_dur != null && c.avg_dur > 0 && c.avg_dur < 15){
    const ind = c.industry || '';
    let scene = "产品上镜为主";
    if(ind.includes("鞋") || ind.includes("包")) scene = "鞋子/包包细节特写+模特走动";
    else if(ind.includes("运动")) scene = "运动场景+功能演示+数字人旁白";
    else if(ind.includes("珠宝") || ind.includes("配饰")) scene = "近景细节+佩戴场景+试戴对比";
    else if(ind.includes("贴身") || ind.includes("男") || ind.includes("女")) scene = "模特走秀+材质细节+搭配展示";
    a.push({level:"P1", tag:"平均播放时长过短", reason:`平均时长 ${c.avg_dur.toFixed(1)} 秒 < 15 秒 · 行业(${ind})`,
      action: `▸ 建议素材侧重"${scene}"，节奏 5-8 秒换镜头 · 时长控制 45-60 秒 · 关键利益点 3-5 个 · 前 3 秒强视觉冲击`});
  } else if(c.avg_dur != null && c.avg_dur >= 15 && c.avg_dur < 30){
    a.push({level:"P2", tag:"时长偏中", reason:`平均时长 ${c.avg_dur.toFixed(1)} 秒 介于 15-30 秒`, action:"强化节点节奏控制 30-45 秒完播区间，挂钩引流转化"});
  }

  // —— P1：三率（品退/差评/纠纷）—— 绝对值阈值 ——
  if(c.ret != null && c.ret > 1){
    a.push({level:"P1", tag:"品退率超标", reason:`品退率 ${c.ret.toFixed(2)}% > 1% 红线`, action:"联系品控排查商品质量/描述一致性；必要时拉闸高品退商品"});
  }
  if(c.bad != null && c.bad > 15){
    a.push({level:"P1", tag:"差评率超标", reason:`差评率 ${c.bad.toFixed(1)}% > 15% 红线`, action:"复盘高频差评，针对性改进 SKU/物流/客服话术；个别品类话术优化"});
  }
  if(c.dispute != null && c.dispute > 0.5){
    a.push({level:"P1", tag:"商责纠纷超标", reason:`纠纷率 ${c.dispute.toFixed(2)}% > 0.5% 红线`, action:"法务/客服介入，排查根因并完善售后流程"});
  }

  // —— P2：产品使用类型（按子青 9.3 反馈，原生推广属于产品使用，不再放链路）——
  if(c.is_4m === false && c.consume >= 1000){
    a.push({level:"P2", tag:"未使用 4+m",category:"产品使用类型", reason:"未识别到 4+m 投放数据", action:"接入 4+m 投放，覆盖多层级流量场景"});
  }
  if(c.is_aggregate === false && c.consume >= 1000){
    a.push({level:"P2", tag:"未使用多商品聚合页",category:"产品使用类型", reason:"未识别到多商品聚合页投放", action:"接入多商品聚合页，提升单次曝光价值"});
  }
  if(c.is_smart_ad === false && c.consume >= 1000){
    a.push({level:"P2", tag:"未使用小店艾米智投",category:"产品使用类型", reason:"未识别到艾米智投数据", action:"接入艾米智投，自动选品+定向+出价"});
  }
  // 原生推广：已挪到产品能力，不在此处
  if(c.is_native === false && c.consume >= 1000){
    a.push({level:"P2", tag:"未使用原生推广",category:"产品使用类型", reason:"未识别到原生推广投放", action:"接入原生推广，原生信息流场景触达"});
  }

  // —— P2：产品使用类型（潜客优投/原生推广都在这里，不再放链路）——
  if(c.is_latent === false && c.consume >= 1000){
    a.push({level:"P2", tag:"未使用潜客优投",category:"产品使用类型", reason:"未识别到潜客优投投放", action:"接入潜客优投，对高潜用户重点定向"});
  }

  // === 子青 9.3 拍板：所有"标红指标"必须给具体建议 ===
  // 复用 mCell 的标红判断逻辑（mode=lower 看 val>bench；mode=higher 看 val<bench）
  function isRed(val, bench, mode){
    if(val==null || bench==null || bench<=0) return false;
    return mode==='lower' ? val>bench : val<bench;
  }
  function vsTxt(val, bench, mode){
    if(!isRed(val,bench,mode)) return '';
    const diff = ((val-bench)/bench*100);
    return `vs 行业头部 ${(diff>=0?'+':'')+diff.toFixed(0)}%`;
  }
  // ① 消耗/双率/ROI 标红
  const kpiRed = [
    {label:'ctr', val:c.ctr, bench:b.ctr_p75, mode:'higher', cat:'双率',
     rule:'① 视觉重构：封面大字报+数字人冲击开场 ② 强制痛点+产品+承诺 3秒结构 ③ 1 周素材更新 ≥ 30%'},
    {label:'cvr', val:c.cvr, bench:b.cvr_p75, mode:'higher', cat:'双率',
     rule:'① 链路一致性核查（不流失） ② 直播间话术逼单（每 30 秒一次） ③ 商详页加倒计时/限时特 ④ 处理中差评'},
  ];
  // ② 广告基建 标红
  const buildRed = [
    {label:'有消耗的账户数', val:c.account, bench:b.account_p75, mode:'higher', cat:'基建',
     rule:'多账户分发：单账户抗风险能力差，至少在 2 个账户同时投'},
    {label:'有消耗广告数', val:c.ads, bench:b.ads_p75, mode:'higher', cat:'基建',
     rule:`补计划到行业 P75 ${b.ads_p75!=null?Math.round(b.ads_p75):'?'} 水位 · 优质素材跨账户同步`},
    {label:'均曝光创意唯一性ID数', val:c.creative_id, bench:b.creative_id_p75, mode:'higher', cat:'基建',
     rule:'通过换封面/BGM/开头快速衍生 9 条新创意'},
    {label:'新广告占比', val:c.new_ratio, bench:b.new_ratio_p75, mode:'higher', cat:'素材质量',
     rule:`新广告占比 ${(c.new_ratio||0).toFixed(1)}% 低于行业 P75 ${(b.new_ratio_p75||0).toFixed(1)}% · 强制上新节奏`},
    {label:'一键起量使用占比', val:c.auto_ratio, bench:b.auto_ratio_p75, mode:'higher', cat:'素材质量',
     rule:`一键起量占比偏低 · 重点新计划配 200-500 元一键起量预算`},
  ];
  // ③ 素材质量 标红
  const matRed = [
    {label:'视频3秒完播率', val:c['3s_play'], bench:b['3s_play_p75'], mode:'higher', cat:'素材质量',
     rule:'前 0.5 秒强视觉冲击 · 反问开场 · 数字人口播核心利益点'},
    {label:'平均播放时长', val:c.avg_dur, bench:b.avg_dur_p75, mode:'higher', cat:'素材质量',
     rule:'每 5-8 秒换镜头/特效字幕/产品特写 · 时长控制 45-60 秒 · 3-5 个关键利益点'},
  ];
  // ⑤ 小店三率（mode='lower' 越低越好，>bench 标红）
  const rateRed = [
    {label:'品退率', val:c.ret, bench:1.0, mode:'lower', cat:'小店三率',
     rule:'联系品控排查商品质量/描述一致性 · 高品退商品拉闸下架'},
    {label:'差评率', val:c.bad, bench:15.0, mode:'lower', cat:'小店三率',
     rule:'复盘高频差评词 · 改进 SKU/物流/客服话术 · 重点品类运营培训'},
    {label:'纠纷率', val:c.dispute, bench:0.5, mode:'lower', cat:'小店三率',
     rule:'法务/客服介入排查根因 · 完善售后流程 · 必要时退款快返'},
  ];
  const allRed = [...kpiRed, ...buildRed, ...matRed, ...rateRed];
  allRed.forEach(r=>{
    if(isRed(r.val, r.bench, r.mode)){
      a.push({
        level:'P1', tag:`${r.label} 标红`, category:r.cat,
        reason:`${r.label} ${(r.val||0).toFixed(2)} · 行业头部 P75 ${r.bench} · ${vsTxt(r.val,r.bench,r.mode)}`,
        action: r.rule
      });
    }
  });

  return a;
}

function refreshAdvice(c){
  c.advice = genAdvice(c, c.benchmark);
}

// 对比条 · v3 柱状图 + 紧凑布局
// opts: {label, trend, self, bench, unit, digit, invert}
function cmpCard(opts){
  const {label="", trend="", self=null, bench=null, unit="", digit=2, invert=false} = opts||{};
  const sNA = self==null || isNaN(self);
  const bNA = bench==null || isNaN(bench);
  if(sNA && bNA) return "";

  let lv = "neutral", delta = null, arrow = "·";
  if(!sNA && !bNA && bench!==0){
    delta = (self - bench) / bench * 100;
    if(invert){
      if(self <= bench) lv = "ok";
      else if(self <= bench*1.5) lv = "warn";
      else lv = "bad";
      arrow = self <= bench ? "↓" : "↑";
    } else {
      if(self >= bench) lv = "ok";
      else if(self >= bench*0.7) lv = "warn";
      else lv = "bad";
      arrow = self >= bench ? "↑" : "↓";
    }
  }
  const deltaTxt = delta==null ? "—" : ((delta>=0?"+":"") + delta.toFixed(0) + "%");
  const trendIcon = invert ? "↓ 越低越好" : "↑ 越高越好";

  const max = Math.max(self||0, bench||0) || 1;
  const sH = sNA ? 0 : Math.max(6, ((self||0)/max)*100);
  const bH = bNA ? 0 : Math.max(6, ((bench||0)/max)*100);

  const sColor = sNA ? "var(--text-4)" :
    (lv==="ok"?"var(--ok)":lv==="warn"?"var(--warn)":lv==="bad"?"var(--danger)":"var(--text)");

  return `<div class="cmp-card lv-${lv==='neutral'?'':lv}">
    <div class="cmp-head">
      <span class="cmp-name">${label}</span>
      <span class="cmp-trend">${trend || trendIcon}</span>
      ${delta!=null?`<span class="cmp-badge lv-${lv}">${deltaTxt} ${arrow}</span>`:''}
    </div>
    <div class="cmp-chart">
      <div class="cmp-col">
        <div class="cmp-col-val" style="color:${sColor}">${sNA?'-':fmtNum(self,digit)}<small>${unit}</small></div>
        <div class="cmp-bar-track">
          <div class="cmp-bar cmp-bar-self" style="height:${sH}%;background:${sColor}"></div>
        </div>
        <div class="cmp-col-lb">您</div>
      </div>
      <div class="cmp-col">
        <div class="cmp-col-val" style="color:var(--text-2)">${bNA?'-':fmtNum(bench,digit)}<small>${unit}</small></div>
        <div class="cmp-bar-track">
          <div class="cmp-bar cmp-bar-bench" style="height:${bH}%;background:var(--line-2)"></div>
        </div>
        <div class="cmp-col-lb">头部 P75</div>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   对比条 · v4 一张 SVG 大图（双 Y 轴 + 完整标签）
   ============================================================ */
function cmpChartBig(c, b){
  const rows = [
    {label:"下单 ROI",      trend:"越高越好", self:c.roi,      bench:b.roi_p75,      unit:"",  digit:2, scale:"small"},
    {label:"日均广告数",    trend:"越高越好", self:c.ads,      bench:b.ads_p75,      unit:"",  digit:0, scale:"large"},
    {label:"新广告占比",    trend:"越高越好", self:c.new_ratio,bench:b.new_ratio_p75,unit:"%", digit:1, scale:"small"},
    {label:"一键起量占比",  trend:"越高越好", self:c.auto_ratio,bench:b.auto_ratio_p75,unit:"%",digit:1, scale:"small"},
    {label:"品退率",        trend:"越低越好", self:c.ret,      bench:b.ret_p75,      unit:"%",digit:2, scale:"small"},
    {label:"差评率",        trend:"越低越好", self:c.bad,      bench:b.bad_p75,      unit:"%",digit:2, scale:"small"},
    {label:"纠纷率",        trend:"越低越好", self:c.dispute,  bench:b.dispute_p75,  unit:"%",digit:2, scale:"small"},
  ];
  const W = 760, H = 288;
  const padL = 44, padR = 46, padT = 38, padB = 58;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const groupGap = 14;                        // 组间距（子青要求"每个指标隔开一点点"）
  const groupW = innerW / rows.length;
  const barW = (groupW - groupGap - 4) / 2;   // 组内两根柱子宽

  // 双 Y 轴：small 指标 vs large 指标
  const smallVals = rows.filter(r=>r.scale==="small").flatMap(r => [r.self||0, r.bench||0]).filter(v => v > 0);
  const largeVals = rows.filter(r=>r.scale==="large").flatMap(r => [r.self||0, r.bench||0]).filter(v => v > 0);
  const niceMax = arr => {
    const m = Math.max(...arr, 1);
    if(m <= 5) return 5;
    if(m <= 10) return 10;
    if(m <= 50) return Math.ceil(m/10)*10;
    if(m <= 100) return Math.ceil(m/50)*50;
    return Math.ceil(m/1000)*1000;
  };
  const sMax = niceMax(smallVals);
  const lMax = niceMax(largeVals);
  const yTicks = 4;

  // 双 Y 轴网格 + 刻度
  const yLines = [];
  const yLeft = [];   // 小值轴刻度（左）
  const yRight = [];  // 大值轴刻度（右）
  for(let i=0;i<=yTicks;i++){
    const t = i / yTicks;
    const y = padT + innerH - t * innerH;
    yLines.push(`<line x1="${padL}" x2="${W-padR}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="2 3"/>`);
    yLeft.push(`<text x="${padL-6}" y="${y+3}" text-anchor="end" fill="var(--text-3)" font-size="10" font-family="var(--font-num)">${(sMax*t).toFixed(sMax<10?1:0)}</text>`);
    yRight.push(`<text x="${W-padR+6}" y="${y+3}" text-anchor="start" fill="var(--text-3)" font-size="10" font-family="var(--font-num)">${(lMax*t).toFixed(0)}</text>`);
  }

  // 柱子（颜色统一：您=品牌蓝 / P75=灰）+ 底部达标符号
  let okCount = 0, cmpTotal = 0;
  const bars = rows.map((r, i) => {
    const grpX = padL + i * groupW + groupGap/2;
    const sx = grpX;
    const bx = grpX + barW + 4;
    const maxV = r.scale === "large" ? lMax : sMax;
    const sH = r.self != null ? (r.self / maxV) * innerH : 0;
    const bH = r.bench != null ? (r.bench / maxV) * innerH : 0;
    const sY = padT + innerH - sH;
    const bY = padT + innerH - bH;
    const cxG = grpX + barW + 2;          // 组中心 x

    // 达标判定
    let mark = "", markColor = "var(--text-4)", deltaTxt = "";
    if(r.self != null && r.bench != null && r.bench !== 0){
      cmpTotal++;
      const isLower = r.trend === "越低越好";
      const pass = isLower ? (r.self <= r.bench) : (r.self >= r.bench);
      if(pass) okCount++;
      mark = pass ? "✓" : "✗";
      markColor = pass ? "var(--ok)" : "var(--danger)";
      const d = (r.self - r.bench) / r.bench * 100;
      deltaTxt = (d>=0?"+":"") + d.toFixed(0) + "%";
    } else {
      mark = "·";
      deltaTxt = "—";
    }
    const axisHint = r.scale === "large" ? "▸" : "";

    return `
        <rect x="${sx}" y="${sY}" width="${barW}" height="${sH}" rx="3" fill="var(--brand)">
          <title>您：${r.self!=null?fmtNum(r.self, r.digit):'-'}${r.unit}</title>
        </rect>
        <rect x="${bx}" y="${bY}" width="${barW}" height="${bH}" rx="3" fill="var(--line-2)">
          <title>行业头部 P75：${r.bench!=null?fmtNum(r.bench, r.digit):'-'}${r.unit}</title>
        </rect>
        <text x="${sx + barW/2}" y="${sY - 5}" text-anchor="middle" fill="var(--brand)" font-size="10" font-weight="700" font-family="var(--font-num)">${r.self!=null?fmtNum(r.self, r.digit):'-'}</text>
        <text x="${bx + barW/2}" y="${bY - 5}" text-anchor="middle" fill="var(--text-3)" font-size="10" font-family="var(--font-num)">${r.bench!=null?fmtNum(r.bench, r.digit):'-'}</text>
        <text x="${cxG}" y="${padT + innerH + 15}" text-anchor="middle" fill="var(--text-2)" font-size="10.5" font-weight="500">${r.label}${axisHint}</text>
        <text x="${cxG}" y="${padT + innerH + 32}" text-anchor="middle" fill="${markColor}" font-size="13" font-weight="700">${mark}</text>
        <text x="${cxG}" y="${padT + innerH + 46}" text-anchor="middle" fill="${markColor}" font-size="9.5" font-weight="600" font-family="var(--font-num)">${deltaTxt}</text>
      `;
  }).join("");

  // 图例（移到左上，避开右侧 Y 轴刻度）
  const rate = cmpTotal>0 ? Math.round(okCount/cmpTotal*100) : 0;
  const rateColor = rate>=70 ? "var(--ok)" : rate>=40 ? "var(--warn)" : "var(--danger)";
  const legend = `
    <g transform="translate(${padL}, 16)">
      <rect x="0" y="-8" width="9" height="9" rx="2" fill="var(--brand)"/>
      <text x="13" y="0" fill="var(--text-2)" font-size="10">您的数据</text>
      <rect x="72" y="-8" width="9" height="9" rx="2" fill="var(--line-2)"/>
      <text x="85" y="0" fill="var(--text-2)" font-size="10">头部 P75</text>
      <text x="152" y="0" fill="var(--text-4)" font-size="9.5">▸ 读右轴</text>
    </g>
    <g transform="translate(${W-padR}, 16)">
      <text x="0" y="0" text-anchor="end" fill="var(--text-3)" font-size="10">达标 </text>
      <text x="0" y="0" text-anchor="end" fill="${rateColor}" font-size="11" font-weight="700" font-family="var(--font-num)" dx="-26">${okCount}/${cmpTotal} · ${rate}%</text>
    </g>
  `;

  return `<div class="cmp-big-wrap">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="cmp-big-svg">
      ${yLines.join("")}
      ${yLeft.join("")}
      ${yRight.join("")}
      ${bars}
      ${legend}
      <line x1="${padL}" x2="${W-padR}" y1="${padT + innerH}" y2="${padT + innerH}" stroke="var(--text-3)" stroke-width="1"/>
    </svg>
  </div>`;
}

/* ============================================================
   指标达标情况卡片（填补柱状图右侧空白）
   ============================================================ */
function renderBenchScore(rows){
  let okCount = 0, total = 0;
  const items = rows.map(r=>{
    if(r.self==null || r.bench==null || r.bench===0){
      return `<div class="bs-item na">
        <span class="bs-name">${r.label}</span>
        <span class="bs-val">—</span>
        <span class="bs-mark">·</span>
      </div>`;
    }
    total++;
    const isLower = r.trend === "越低越好";
    const pass = isLower ? (r.self <= r.bench) : (r.self >= r.bench);
    if(pass) okCount++;
    const delta = (r.self - r.bench) / r.bench * 100;
    const deltaTxt = (delta>=0?"+":"") + delta.toFixed(0) + "%";
    return `<div class="bs-item ${pass?'pass':'fail'}">
      <span class="bs-name">${r.label}</span>
      <span class="bs-val">${deltaTxt}</span>
      <span class="bs-mark">${pass?'✓':'✗'}</span>
    </div>`;
  }).join("");
  const rate = total>0 ? (okCount/total*100).toFixed(0) : 0;
  return `<div class="bench-score">
    <div class="bs-head">
      <div class="bs-title">达标情况</div>
      <div class="bs-rate ${rate>=70?'good':rate>=40?'mid':'low'}">${okCount}<span>/${total}</span></div>
      <div class="bs-sub">达标率 ${rate}%</div>
    </div>
    <div class="bs-list">${items}</div>
    <div class="bs-foot">对比同行业头部 Top10 P75</div>
  </div>`;
}

// 向后兼容：保留旧接口
function compareBar(){ return ""; }

/* ============================================================
   行业消耗 · 饼图（SVG，保留）
   ============================================================ */
function renderIndustryPie(map, total, benchMap){
  const arr = Object.entries(map).sort((a,b)=>b[1]-a[1]);
  if(!arr.length) return '<div class="empty">无数据</div>';
  const W = 200, H = 200, cx = W/2, cy = H/2, R = 80;
  const sum = arr.reduce((s,[,v])=>s+v, 0) || 1;
  let aStart = -Math.PI/2;
  const slices = arr.map(([n, v])=>{
    const ang = (v / sum) * Math.PI * 2;
    const c = industryColor(n);
    const tip = `<title>${n}：${fmtMoney(v,1)} 元（${(v/total*100).toFixed(1)}%）</title>`;
    // 单行业占 100%：arc 起止点重合会导致路径退化不绘制 → 改画整圆
    if(arr.length === 1 || ang >= Math.PI*2 - 1e-6){
      aStart += ang;
      return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${c}" stroke="var(--bg-card)" stroke-width="1.5">${tip}</circle>`;
    }
    const aEnd = aStart + ang;
    const x1 = cx + R * Math.cos(aStart), y1 = cy + R * Math.sin(aStart);
    const x2 = cx + R * Math.cos(aEnd),   y2 = cy + R * Math.sin(aEnd);
    const large = ang > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
    const r = `<path d="${d}" fill="${c}" stroke="var(--bg-card)" stroke-width="1.5">${tip}</path>`;
    aStart = aEnd;
    return r;
  }).join("");
  const legend = arr.map(([n,v])=>`<div class="ind-legend-item">
    <span class="ind-legend-dot" style="background:${industryColor(n)}"></span>
    <span class="ind-legend-name">${n}</span>
    <span class="ind-legend-val">${(v/total*100).toFixed(1)}%</span>
  </div>`).join("");
  return `<div class="ind-pie">
    <svg viewBox="0 0 ${W} ${H}" class="ind-pie-svg">${slices}
      <circle cx="${cx}" cy="${cy}" r="${R*0.45}" fill="var(--bg-card)"/>
      <text x="${cx}" y="${cy-4}" text-anchor="middle" fill="var(--text-3)" font-size="10">合计消耗</text>
      <text x="${cx}" y="${cy+12}" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="700" font-family="var(--font-num)">${fmtMoney(total,1)}</text>
    </svg>
    <div class="ind-legend">${legend}</div>
  </div>`;
}

/* ============================================================
   行业明细表（含消耗/ROI/占比/视频号数）
   与饼图并存展示
   ============================================================ */
function renderIndustryDetail(map, total, benchMap){
  const arr = Object.entries(map).sort((a,b)=>b[1]-a[1]);
  if(!arr.length) return '<div class="empty">无数据</div>';
  const max = arr[0][1] || 1;
  return `<div class="ind-d-list">
    <div class="ind-d-head">
      <span></span><span>二级行业</span><span class="num">消耗</span><span class="num">占比</span><span class="num">头部 P75 ROI</span><span class="num">分布</span>
    </div>
    ${arr.map(([n,v])=>{
      const p75 = benchMap && benchMap[n] ? benchMap[n].roi_p75 : null;
      const color = industryColor(n);
      return `<div class="ind-d-row">
        <span class="ind-d-dot" style="background:${color}"></span>
        <span class="ind-d-name">${n}</span>
        <span class="ind-d-val"><b>${fmtMoney(v,1)}</b></span>
        <span class="ind-d-val"><b>${(v/total*100).toFixed(1)}%</b></span>
        <span class="ind-d-val" style="color:var(--brand)">${p75!=null?fmtNum(p75,2):'<span class="hint">—</span>'}</span>
        <span class="ind-d-track"><span style="width:${(v/max*100).toFixed(1)}%;background:${color}"></span></span>
      </div>`;
    }).join("")}
    <div class="ind-d-foot"><span></span><span class="ind-d-name"><b>合计</b></span><span class="ind-d-val"><b>${fmtMoney(total,1)}</b></span><span class="ind-d-val"><b>100.0%</b></span><span class="ind-d-val"></span><span class="ind-d-track"></span></div>
  </div>`;
}

/* ============================================================
   客户 Card Grid 方块（3 列 × N 行）
   ============================================================ */
function customerGridCard(c){
  const lv = riskLevel(c);
  const roiColor = c.roi==null ? "var(--text-4)" : c.roi<2 ? "var(--danger)" : c.roi<3 ? "var(--warn)" : "var(--ok)";
  const advCount = (c.advice||[]).length;
  const stripeColor = lv==="p0" ? "var(--danger)" : lv==="p1" ? "var(--warn)" : lv==="p2" ? "var(--info)" : "var(--ok)";
  return `<div class="cg-card lv-${lv}" onclick="goCustomer('${(c.sub||'').replace(/'/g,"\\'")}')">
    <div class="cg-stripe" style="background:${stripeColor}"></div>
    <div class="cg-top">
      <div class="cg-name" title="${c.sub}">${c.sub}</div>
      <div class="cg-top-tags">${consumeTag(c.consume)}</div>
    </div>
    <div class="cg-stats">
      <div class="cg-stat"><div class="cg-stat-lb">消耗</div><div class="cg-stat-vl">${fmtMoney(c.consume,1)}</div></div>
      <div class="cg-stat"><div class="cg-stat-lb">GMV</div><div class="cg-stat-vl">${fmtMoney(c.gmv,1)}</div></div>
      <div class="cg-stat"><div class="cg-stat-lb">ROI</div><div class="cg-stat-vl" style="color:${roiColor}">${fmtNum(c.roi,2)}</div></div>
    </div>
    <div class="cg-foot">
      <span class="ind-dot"><i style="background:${industryColor(c.industry)}"></i>${c.industry}</span>
      <span class="cg-ads">${fmtInt(c.ads)} 广告</span>
      ${advCount>0?`<span class="cg-adv" style="color:${stripeColor}">${advCount} 建议</span>`:`<span class="cg-adv ok">无建议</span>`}
    </div>
  </div>`;
}

/* ============================================================
   折线图 · SVG（自渲染，零依赖）
   rows: [{date:"2026/08/31", value: 1234.5}, ...]
   ============================================================ */
function renderLineChart(rows, opts){
  opts = opts || {};
  if(!rows || !rows.length) return '<div class="empty">无数据</div>';
  var W = opts.w || 620, H = opts.h || 200;
  var padL=44, padR=14, padT=16, padB=26;
  var innerW = W-padL-padR, innerH = H-padT-padB;
  var vals = rows.map(function(r){return r.value;}).filter(function(v){return !isNaN(v);});
  if(!vals.length) return '<div class="empty">无数据</div>';
  var vMax = Math.max.apply(null, vals), vMin = Math.min.apply(null, vals);
  var niceMax = vMax<=100?Math.ceil(vMax/10)*10:vMax<=1000?Math.ceil(vMax/100)*100:Math.ceil(vMax/1000)*1000;
  var niceMin = vMin>=0?0:Math.floor(vMin/100)*100;
  var xs = rows.map(function(_,i){return padL + (rows.length===1?innerW/2 : i*(innerW/(rows.length-1)));});
  var ys = rows.map(function(r){return padT + innerH - ((r.value-niceMin)/(niceMax-niceMin||1))*innerH;});
  var path = rows.map(function(r,i){var x=xs[i],y=ys[i]; return (i===0?'M':'L')+' '+x+' '+y;}).join(' ');
  var area = 'M '+xs[0]+' '+(padT+innerH)+' '+rows.map(function(_,i){return 'L '+xs[i]+' '+ys[i];}).join(' ')+' L '+xs[rows.length-1]+' '+(padT+innerH)+' Z';
  var grid = [0,0.25,0.5,0.75,1].map(function(t){
    var y = padT + innerH - t*innerH;
    var v = niceMin + t*(niceMax-niceMin);
    return '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line)" stroke-dasharray="2 3"/>' +
      '<text x="'+(padL-6)+'" y="'+(y+3)+'" text-anchor="end" fill="var(--text-3)" font-size="9.5" font-family="var(--font-num)">'+(v>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0))+'</text>';
  }).join('');
  var pts = rows.map(function(r,i){return '<circle cx="'+xs[i]+'" cy="'+ys[i]+'" r="3" fill="var(--brand)"><title>'+r.date+': '+fmtNum(r.value,0)+'</title></circle>';}).join('');
  var xLabels = rows.map(function(r,i){
    var show = i===0 || i===rows.length-1 || i===Math.floor(rows.length/2);
    if(!show) return '';
    return '<text x="'+xs[i]+'" y="'+(H-8)+'" text-anchor="middle" fill="var(--text-3)" font-size="9.5">'+r.date.slice(5)+'</text>';
  }).join('');
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" class="cmp-line-svg">' +
    grid + '<path d="'+area+'" fill="var(--brand)" fill-opacity="0.08"/>' +
    '<path d="'+path+'" stroke="var(--brand)" stroke-width="2" fill="none"/>' +
    pts + xLabels + '</svg>';
}

function renderMultiLineChart(series, opts){
  opts = opts || {};
  if(!series || !series.length) return '<div class="empty">无数据</div>';
  var W = opts.w || 620, H = opts.h || 220;
  var padL=44, padR=14, padT=32, padB=26;
  var innerW = W-padL-padR, innerH = H-padT-padB;
  var vMax = 0;
  series.forEach(function(s){s.data.forEach(function(p){if(p.value>vMax) vMax=p.value;});});
  var niceMax = vMax<=100?Math.ceil(vMax/10)*10:vMax<=1000?Math.ceil(vMax/100)*100:Math.ceil(vMax/1000)*1000;
  var cols = ["#4C5FD7","#22916B","#E08B24","#D95F8E","#35B0A7","#7C6BD9","#98A2B3","#E8734A"];
  var allDates = series[0].data.map(function(p){return p.date;});
  var xAt = function(i){return padL + (allDates.length===1?innerW/2 : i*(innerW/(allDates.length-1)));};
  var yAt = function(v){return padT + innerH - (v/(niceMax||1))*innerH;};
  var grid = [0,0.5,1].map(function(t){
    var y = padT + innerH - t*innerH;
    var v = t*niceMax;
    return '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line)" stroke-dasharray="2 3"/>' +
      '<text x="'+(padL-6)+'" y="'+(y+3)+'" text-anchor="end" fill="var(--text-3)" font-size="9.5" font-family="var(--font-num)">'+(v>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0))+'</text>';
  }).join('');
  var xLabels = allDates.map(function(d,i){
    var show = i===0 || i===allDates.length-1 || i===Math.floor(allDates.length/2);
    if(!show) return '';
    return '<text x="'+xAt(i)+'" y="'+(H-8)+'" text-anchor="middle" fill="var(--text-3)" font-size="9.5">'+d.slice(5)+'</text>';
  }).join('');
  var lines = series.map(function(s,si){
    var c = cols[si%cols.length];
    var path = s.data.map(function(p,i){return (i===0?'M':'L')+' '+xAt(i)+' '+yAt(p.value);}).join(' ');
    return '<path d="'+path+'" stroke="'+c+'" stroke-width="1.8" fill="none" opacity="0.85"><title>'+s.name+'</title></path>';
  }).join('');
  var legend = series.map(function(s,i){
    var c = cols[i%cols.length];
    return '<g transform="translate('+(padL+i*78)+',14)"><rect width="9" height="9" rx="2" fill="'+c+'"/><text x="13" y="8" fill="var(--text-2)" font-size="10">'+s.name.slice(0,8)+'</text></g>';
  }).join('');
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" class="cmp-line-svg">' +
    grid + lines + legend + xLabels + '</svg>';
}

function goCustomer(sub){
  if(!sub) return;
  location.href = 'detail.html?sub=' + encodeURIComponent(sub);
}

/* 双 Y 轴折线：大盘 + 客户合计 by 天
   rowsA: 大盘 by 天（蓝色，左轴）
   rowsB: 客户合计 by 天（紫色，右轴） */
function renderDualLineChart(rowsA, rowsB, opts){
  opts = opts || {};
  if(!rowsA || !rowsA.length) return '<div class="empty">大盘数据待上传</div>';
  // 合并日期
  const allDates = [...new Set([...rowsA.map(r=>r.date), ...rowsB.map(r=>r.date)])].sort();
  const mapA = Object.fromEntries(rowsA.map(r=>[r.date, r.value]));
  const mapB = Object.fromEntries(rowsB.map(r=>[r.date, r.value]));
  const W = opts.w || 620, H = opts.h || 220;
  const padL=46, padR=46, padT=28, padB=26;
  const innerW = W-padL-padR, innerH = H-padT-padB;
  const xs = (i) => padL + (allDates.length===1?innerW/2 : i*(innerW/(allDates.length-1)));
  // 大盘为左轴（数值大），客户为右轴（数值小）
  const vMaxA = Math.max(...rowsA.map(r=>r.value).filter(v=>v>0)) || 1;
  const vMaxB = Math.max(...rowsB.map(r=>r.value).filter(v=>v>0)) || 1;
  const yA = (v) => padT + innerH - (v/vMaxA)*innerH;
  const yB = (v) => padT + innerH - (v/vMaxB)*innerH;
  // 网格（3 条）
  const grid = [0, 0.5, 1].map(t => {
    const y = padT + innerH - t*innerH;
    const va = (t*vMaxA), vb = (t*vMaxB);
    return '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line)" stroke-dasharray="2 3"/>' +
      '<text x="'+(padL-6)+'" y="'+(y+3)+'" text-anchor="end" fill="var(--brand)" font-size="9.5" font-family="var(--font-num)">'+ (va>=1000?(va/1000).toFixed(0)+'k':va.toFixed(0)) +'</text>' +
      '<text x="'+(W-padR+6)+'" y="'+(y+3)+'" text-anchor="start" fill="#7C6BD9" font-size="9.5" font-family="var(--font-num)">'+ (vb>=1000?(vb/1000).toFixed(1)+'k':vb.toFixed(0)) +'</text>';
  }).join('');
  // 大盘线（蓝）+ 客户线（紫）
  const lineA = allDates.map((d,i) => (i===0?'M':'L')+' '+xs(i)+' '+yA(mapA[d]||0)).join(' ');
  const lineB = allDates.map((d,i) => (i===0?'M':'L')+' '+xs(i)+' '+yB(mapB[d]||0)).join(' ');
  // 日期标签（3 个）
  const xLabels = allDates.map((d,i) => {
    const show = i===0 || i===allDates.length-1 || i===Math.floor(allDates.length/2);
    if(!show) return '';
    return '<text x="'+xs(i)+'" y="'+(H-8)+'" text-anchor="middle" fill="var(--text-3)" font-size="9.5">'+d.slice(5)+'</text>';
  }).join('');
  // 图例
  const legend = '<g transform="translate('+padL+',14)">'
    + '<rect width="9" height="9" rx="2" fill="var(--brand)"/><text x="13" y="8" fill="var(--text-2)" font-size="10">大盘日均(元)</text>'
    + '<rect x="100" width="9" height="9" rx="2" fill="#7C6BD9"/><text x="113" y="8" fill="var(--text-2)" font-size="10">靶向合计(元)</text>'
    + '</g>';
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" class="cmp-line-svg">'
    + grid + legend
    + '<path d="'+lineA+'" stroke="var(--brand)" stroke-width="2" fill="none"/>'
    + '<path d="'+lineB+'" stroke="#7C6BD9" stroke-width="1.8" fill="none" stroke-dasharray="3 2"/>'
    + xLabels + '</svg>';
}

/* ============================================================
   mini KPI 网格（紧凑数字展示）
   rows: [[label, value, unit, digit, mode, bad], ...]
   ============================================================ */
function renderMiniKPI(rows){
  return `<div class="mini-kpi-grid">${rows.map(([label,v,unit,digit,mode,bad])=>{
    let cls = "is-na";
    if(v!=null && !isNaN(v)){
      if(mode==="lower"){
        if(bad!=null && v>bad) cls="is-bad";
        else if(bad!=null && v>bad*0.5) cls="is-warn";
        else cls="is-good";
      } else if(mode==="higher"){
        if(bad!=null && v<bad) cls="is-warn";
        else cls="is-good";
      } else {
        cls = "is-plain";   // 纯数字指标（曝光创意/新建创意）：统一中性底色
      }
    }
    const color = cls==="is-bad"?"var(--danger)":cls==="is-warn"?"var(--warn)":cls==="is-good"?"var(--ok)":"var(--text)";
    const val = v==null||isNaN(v) ? "-" : fmtNum(v,digit);
    return `<div class="mini-kpi ${cls}"><div class="mk-lb">${label}</div><div class="mk-vl" style="color:${color}">${val}<small>${unit||''}</small></div></div>`;
  }).join("")}</div>`;
}

/* ============================================================
   详情页 / 客户视图 共用 render（完全统一版）
   ============================================================ */
function renderCustomerDetail(d, c){
  refreshAdvice(c);
  const b = c.benchmark || {};
  const lv = riskLevel(c);
  const headColor = lv==='p0'?'--danger':lv==='p1'?'--warn':lv==='p2'?'--info':'--ok';

  // 每指标小卡：含与行业头部对标 + 差于标红
  function mCell(label, val, unit, digit, bench, mode){
    const valid = val!=null && !isNaN(val);
    const hasBench = bench!=null && !isNaN(bench) && bench>0;
    let diff = null, vsTxt = '';
    if(valid && hasBench){
      diff = (val - bench) / bench * 100;
      const dir = mode==='lower' ? (val<=bench?'高':'低') : (val>=bench?'高':'低');
      const worse = mode==='lower' ? val>bench : val<bench;
      vsTxt = `vs 行业头部 ${dir}（${(diff>=0?'+':'')+diff.toFixed(0)}%）`;
    }
    const cellCls = !valid ? 'm-na' : (!hasBench ? '' : ((mode==='lower' ? val>bench : val<bench) ? 'm-bad' : 'm-ok'));
    return `<div class="metric-cell ${cellCls}">
      <div class="ml">${label}</div>
      <div class="mv">${valid?fmtNum(val,digit):'—'}<small>${unit}</small></div>
      ${vsTxt?`<div class="mv-vs ${cellCls}">${vsTxt}</div>`:''}
    </div>`;
  }

  // 能力类指标（是否使用 + 消耗占比 + SOP 复制按钮）
  // 6 个能力：4+m / 多商品聚合页 / 潜客优投 / 原生推广 / 小店艾米 / 全域通
  function abilityCell(label, isUsed, consume, totalConsume){
    const ok = isUsed === true;
    // 消耗占比
    let ratioTxt = '0%';
    if(ok && totalConsume>0 && consume>0){
      const pct = consume / totalConsume * 100;
      ratioTxt = `${pct.toFixed(1)}%`;
    }
    // SOP 复制按钮（4+m / 潜客优投 / 多商品聚合页 / 小店艾米 4 类有 SOP）
    const sopKey = SOP_KEY_MAP[label];
    const sopBtn = sopKey ? `<button class="btn-sop" onclick="copySOP('${sopKey}');event.stopPropagation();" title="一键复制 SOP">📋 SOP</button>` : '';
    return `<div class="metric-cell ${ok?'m-ok':'m-bad'}">
      <div class="ml">${label}${sopBtn}</div>
      <div class="mv">${ok?'已使用':'未使用'}</div>
      <div class="mv-vs ${ok?'m-ok':'m-bad'}">${ok?('已投 消耗占比 '+ratioTxt):'建议开启'}</div>
    </div>`;
  }

  // 投放端/链路 类（同 abilityCell 但不带消耗 —— 小店/直播暂无消耗数据）
  function usageCell(label, isUsed, dataNote){
    const ok = isUsed === true;
    return `<div class="metric-cell ${ok?'m-ok':'m-bad'}">
      <div class="ml">${label}</div>
      <div class="mv">${ok?'已使用':'未使用'}</div>
      <div class="mv-vs ${ok?'m-ok':'m-bad'}">${ok?(dataNote||'已在投'):'建议开启'}</div>
    </div>`;
  }

  const tot = c.consume || 0;

  // ① 消耗/双率/ROI —— 5 个核心（去目标出价，按截图）
  const kpiRows = [
    ["日均消耗(元)", c.main_consume||c.consume, "元", 1, null, null],
    ["ctr", c.ctr, "%", 2, b.ctr_p75, "higher"],
    ["cvr", c.cvr, "%", 2, b.cvr_p75, "higher"],
    // 子青 9.3 拍板：下单单价/下单ROI 不对比行业（不同客户无可比性）
    ["下单单价(元)", c.aov, "元", 0, null, null],
    ["下单ROI", c.roi, "", 2, null, null],
  ];
  // ② 广告基建
  const buildRows = [
    ["有消耗的主体数", c.main_subject, "", 0, null, null],
    ["有消耗的账户数", c.account, "", 0, b.account_p75, "higher"],
    ["有消耗广告数", c.ads, "", 0, b.ads_p75, "higher"],
    ["均曝光创意唯一性ID数", c.creative_id, "", 0, b.creative_id_p75, "higher"],
    ["新广告占比", c.new_ratio, "%", 1, b.new_ratio_p75, "higher"],
    ["一键起量使用占比", c.auto_ratio, "%", 1, b.auto_ratio_p75, "higher"],
  ];
  // ③ 素材质量/内容质量 —— 只看 3 秒完播和播放时长
  const matNumRows = [
    ["视频3秒完播率", c["3s_play"], "%", 2, b["3s_play_p75"], "higher"],
    ["平均播放时长", c.avg_dur, "秒", 1, b.avg_dur_p75, "higher"],
  ];
  // ④ 产品能力 —— 4+m / 多商品聚合页 / 潜客优投 / 原生推广 / 小店艾米（看是否使用 + 消耗占比）
  const productBools = [
    ["4+m", c.is_4m, c.consume_4m],
    ["多商品聚合页", c.is_aggregate, c.consume_aggregate],
    ["潜客优投", c.is_latent, c.consume_latent],
    ["原生推广", c.is_native, c.consume_native],
    ["小店艾米智投", c.is_smart_ad, c.consume_smart_ad],
  ];
  // ⑤ 小店三率
  const threeRateRows = [
    ["品退率", c.ret, "%", 2, b.ret_p25, "lower"],
    ["差评率", c.bad, "%", 2, b.bad_p25, "lower"],
    ["纠纷率", c.dispute, "%", 2, b.dispute_p25, "lower"],
  ];
  // ⑥ 投放端（是否都投了，消耗占比）+ 链路（不含原生推广，原生推广在产品能力里）
  // ⑥ 投放端 + 链路（子青 9.3 拍板：链路只看 小店 + 直播）
  const deliveryCells = [
    // 投放端
    abilityCell("全域通", c.is_quan_yu_tong, c.consume_quanyutong, tot),
    abilityCell("adq", c.adq, tot, tot),
    // 链路（仅 小店 + 直播）
    usageCell("小店", c.shop_count>0, c.shop_count+' 个小店'),
    usageCell("直播", c.is_live, ''),
  ];

  return `
    <div class="detail-head" style="border-left:3px solid var(${headColor})">
      <div class="detail-title">
        <h1>${c.sub}</h1>
        ${consumeTag(c.consume)}
        <span class="chip">${c.sales||'未分配'}</span>
        ${(c.advice||[]).some(a=>a.level==='P0')?'<span class="tag bad">P0 高危</span>':''}
        ${(c.advice||[]).some(a=>a.level==='P1')?'<span class="tag warn">P1 关注</span>':''}
      </div>
      <div class="detail-meta">
        <span class="chip static">行业 <b>${c.industry}</b></span>
        <span class="chip">视频号 <b>${c.shops.length}</b></span>
        <span class="chip">微信小店 <b>${c.shop_count}</b></span>
      </div>
    </div>

    <!-- ① 客户投放自查报告（6 模块） -->
    <div class="section-h">① 客户投放自查报告</div>
    <div class="grid-2">
      <div class="card compact">
        <h2>① 消耗 / 双率 / ROI</h2>
        <div class="sub">5 个核心指标 · 每个绝对值阈值</div>
        <div class="metric-grid-3">${kpiRows.map(r=>mCell(...r)).join('')}</div>
      </div>
      <div class="card compact">
        <h2>② 广告基建</h2>
        <div class="sub">规模指标 · 越高越好</div>
        <div class="metric-grid-3">${buildRows.map(r=>mCell(...r)).join('')}</div>
      </div>
      <div class="card compact">
        <h2>③ 素材质量 / 内容质量</h2>
        <div class="sub">只显示 3 秒完播和平均播放时长</div>
        <div class="metric-grid-3">${matNumRows.map(r=>mCell(...r)).join('')}</div>
      </div>
      <div class="card compact">
        <h2>④ 产品能力</h2>
        <div class="sub">是否使用 + 消耗占比（占该客户总消耗）</div>
        <div class="metric-grid-3">${productBools.map(p=>abilityCell(p[0], p[1], p[2], tot)).join('')}</div>
      </div>
      <div class="card compact">
        <h2>⑤ 小店三率</h2>
        <div class="sub">品退 / 差评 / 纠纷 · 越低越好 · 无数据显示「—」</div>
        <div class="metric-grid-3">${threeRateRows.map(r=>mCell(...r)).join('')}</div>
      </div>
      <div class="card compact">
        <h2>⑥ 投放端 + 链路</h2>
        <div class="sub">投放端看消耗占比 · 链路看是否使用</div>
        <div class="metric-grid-3">${deliveryCells.join('')}</div>
      </div>
    </div>

    <!-- ② 提升建议 -->
    <div class="section-h">② 提升建议</div>
    <div class="card">
      <div class="sub">基于数据自动诊断 · 请与您的渠道经理协同落实</div>
      ${renderAdviceByCategory(c.advice)}
    </div>

    <!-- ③ 视频号明细 -->
    <div class="section-h">③ 视频号明细</div>
    <div class="card">
      <div class="sub">${c.shops.length} 个视频号 · 按消耗排序</div>
      <table class="tbl">
        <thead><tr>
          <th>视频号</th><th>微信小店</th>
          <th class="num">消耗</th><th>ROI</th><th class="num">ctr%</th><th class="num">cvr%</th>
          <th class="num">广告数</th><th class="num">完播%</th>
        </tr></thead>
        <tbody>${c.shops.sort((a,b)=>b.consume-a.consume).map(s=>`<tr>
          <td class="sub-name">${s.video||'—'}</td>
          <td>${s.shop_id||"—"}</td>
          <td class="num">${fmtMoney(s.consume,1)}</td>
          <td>${roiTag(s.roi)}</td>
          <td class="num">${fmtNum(s.ctr,2)}</td>
          <td class="num">${fmtNum(s.cvr,2)}</td>
          <td class="num">${fmtInt(s.ads)}</td>
          <td class="num">${fmtNum(s['3s_play'],1)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

/* 微信小店 × 视频号 关系图（每店下面列出视频号+指标） */
function renderShopVideoMap(c){
  // 按 shop_id 分组
  const byShop = {};
  c.shops.forEach(s=>{
    const k = s.shop_id || '未关联小店';
    if(!byShop[k]) byShop[k] = {shop_id:k, videos:[], consume:0};
    byShop[k].videos.push(s);
    byShop[k].consume += s.consume;
  });
  const shops = Object.values(byShop).sort((a,b)=>b.consume-a.consume);
  return `<div class="sv-map">${shops.map(s=>{
    const w = c.consume > 0 ? (s.consume / c.consume * 100) : 0;
    return `<div class="sv-shop">
      <div class="sv-shop-head">
        <div class="sv-shop-name" title="${s.shop_id}">📱 ${s.shop_id.slice(-12)||'未关联小店'}</div>
        <div class="sv-shop-meta">${s.videos.length} 个视频号 · ${fmtMoney(s.consume,1)} 元（${w.toFixed(1)}%）</div>
      </div>
      <div class="sv-videos">${s.videos.sort((a,b)=>b.consume-a.consume).map(v=>`
        <div class="sv-video" style="flex:${Math.max(0.6, v.consume/Math.max(...s.videos.map(x=>x.consume)))}">
          <div class="sv-video-name">${v.video||'—'}</div>
          <div class="sv-video-bar"><span style="width:${v.consume/Math.max(1,...s.videos.map(x=>x.consume))*100}%;background:${industryColor(c.industry)}"></span></div>
          <div class="sv-video-meta">${fmtMoney(v.consume,0)} · ROI ${fmtNum(v.roi,1)}</div>
        </div>
      `).join('')}</div>
    </div>`;
  }).join('')}</div>`;
}