// app.js — 看板共享逻辑（角色切换 + 数据加载 + 渲染工具）
window.DATA = null;
window.ROLE = { type: "internal", id: "all", label: "内部 · 全量", key: "internal:all" };

async function loadData(){
  if(window.DATA) return window.DATA;
  const r = await fetch("data.json");
  window.DATA = await r.json();
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
const INDUSTRY_PALETTE = [
  "#E8734A", "#4C9BE8", "#7C6BD9", "#22916B",
  "#E0A92B", "#D95F8E", "#35B0A7", "#98A2B3"
];
const INDUSTRY_FIXED = {
  "贴身衣物":   "#E8734A",
  "其他":       "#98A2B3",
  "跑品客户":   "#4C9BE8",
  "鞋靴":       "#22916B",
  "运动鞋服":   "#E0A92B",
  "男装":       "#7C6BD9",
  "女装":       "#D95F8E",
  "配饰闭环":   "#35B0A7",
  "箱包":       "#B5733A",
  "本土品牌服饰":"#5B8FD9",
};
const _indColorCache = {};
function industryColor(name){
  if(!name) return INDUSTRY_PALETTE[7];
  if(INDUSTRY_FIXED[name]) return INDUSTRY_FIXED[name];
  if(_indColorCache[name]) return _indColorCache[name];
  const used = new Set([...Object.values(INDUSTRY_FIXED), ...Object.values(_indColorCache)]);
  let c = null;
  for(let i=0;i<INDUSTRY_PALETTE.length;i++){
    const cand = INDUSTRY_PALETTE[(i + _indFallbackSeq) % INDUSTRY_PALETTE.length];
    if(!used.has(cand)){ c = cand; break; }
  }
  if(!c) c = INDUSTRY_PALETTE[0];
  _indColorCache[name] = c;
  return c;
}
let _indFallbackSeq = 0;
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
    currentKey = key;
    localStorage.setItem(lsKey, key);
    applyRole(key, roleSet);
    closeMenu();
    if(window.onRoleChanged) window.onRoleChanged();
  });

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
  // —— P0：紧急 ——
  if(c.consume < 100){
    a.push({level:"P0", tag:"未起量", reason:`QTD 消耗仅 ¥${Math.round(c.consume)}`, action:"渠道经理 3 日内介入排查小店链路+素材，推动首次跑量"});
  }
  // —— P1：严重超标 ——
  if(c.roi != null && c.roi < 2 && c.consume >= 100){
    a.push({level:"P1", tag:"ROI 偏低", reason:`ROI=${c.roi.toFixed(2)}，低于健康线 2.0`, action:"运营复盘素材+定向；建议开启艾米智投并接入分产品出价"});
  }
  if(c.ret != null && c.ret > 1){
    a.push({level:"P1", tag:"品退率超标", reason:`品退率 ${c.ret.toFixed(2)}% > 1% 红线`, action:"客户侧优化 SKU 描述/客服响应/发货时效，必要时培训介入"});
  }
  if(c.bad != null && c.bad > 15){
    a.push({level:"P1", tag:"差评率超标", reason:`差评率 ${c.bad.toFixed(1)}% > 15% 红线`, action:"复盘高频差评，针对性改进 SKU/物流/客服话术"});
  }
  if(c.dispute != null && c.dispute > 0.5){
    a.push({level:"P1", tag:"商责纠纷超标", reason:`纠纷率 ${c.dispute.toFixed(2)}% > 0.5% 红线`, action:"法务/客服介入，排查根因并完善售后流程"});
  }
  // —— P2：优化建议 ——
  if(c.roi != null && c.roi >= 2 && c.roi < 3 && c.consume >= 100){
    a.push({level:"P2", tag:"ROI 待优化", reason:`ROI=${c.roi.toFixed(2)}，接近达标线 3.0`, action:`对标行业头部 P75 ${b.roi_p75!=null?b.roi_p75.toFixed(2):'?'}，继续优化素材和定向`});
  }
  if(c.ads != null && c.ads < 50 && c.consume >= 1000){
    a.push({level:"P2", tag:"广告基建薄", reason:`日均广告数仅 ${Math.round(c.ads)}`, action:`补计划到行业 Top10 P75 ${b.ads_p75!=null?Math.round(b.ads_p75):'?'} 水位`});
  }
  if(c.new_ratio != null && c.new_ratio < 5 && c.consume >= 1000){
    a.push({level:"P2", tag:"素材更新慢", reason:`新广告占比 ${c.new_ratio.toFixed(1)}% < 5%`, action:"每周至少新增 3-5 条素材，防止素材疲劳"});
  }
  if(c.new_ratio != null && c.new_ratio >= 5 && c.new_ratio < 20 && c.consume >= 1000){
    a.push({level:"P2", tag:"素材节奏偏慢", reason:`新广告占比 ${c.new_ratio.toFixed(1)}%，建议 ≥ 20%`, action:"提升素材产出节奏，目标 ≥ 30%"});
  }
  if(c.auto_ratio != null && c.auto_ratio < 10 && c.consume >= 1000){
    a.push({level:"P2", tag:"一键起量占比偏低", reason:`一键起量 ${c.auto_ratio.toFixed(1)}% < 10%`, action:`加大一键起量预算占比（行业 P75 ${b.auto_ratio_p75!=null?b.auto_ratio_p75.toFixed(1):'?'}%）`});
  }
  if(c.amy_ratio != null && c.amy_ratio < 10 && c.consume >= 1000){
    a.push({level:"P2", tag:"艾米智投使用低", reason:`艾米智投占比 ${c.amy_ratio.toFixed(1)}% < 10%`, action:"接入艾米场景化智投，自动选品+定向+出价"});
  }
  if(c.aov != null && c.aov < 30 && c.consume >= 100){
    a.push({level:"P2", tag:"客单价偏低", reason:`客单价 ¥${Math.round(c.aov)} < 30`, action:"考虑组合销售或升级 SKU，提升客单价"});
  }
  if(c.refund14 != null && c.refund14 > 15){
    a.push({level:"P2", tag:"14日退款率高", reason:`14日退款 ${c.refund14.toFixed(1)}% > 15%`, action:"排查商品描述/品质/物流问题，降低退款率"});
  }
  const qy = (c.link || []).some(l => l.quan_yu_tong === "是");
  if(!qy && c.consume >= 1000){
    a.push({level:"P2", tag:"未开全域通", reason:"未识别到全域通投放", action:"接入全域通，扩大流量池（大盘 Top 客户 94% 已开）"});
  }
  if(!c.bidding || !c.bidding.length){
    a.push({level:"P2", tag:"未用分产品出价", reason:"未启用小店潜客优投出价", action:"启用分产品出价，提升单品 ROI"});
  }
  return a;
}

/* 用前端规则引擎覆盖后端 advice（在 render 入口调用） */
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
  return `<div class="cg-card lv-${lv}" onclick="location.href='detail.html?sub=${encodeURIComponent(c.sub)}'">
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

  return `
    <div class="detail-head" style="border-left:3px solid var(${riskLevel(c)==='p0'?'--danger':riskLevel(c)==='p1'?'--warn':riskLevel(c)==='p2'?'--info':'--ok'})">
      <div class="detail-title">
        <h1>${c.sub}</h1>
        ${consumeTag(c.consume)}
        ${(c.advice||[]).some(a=>a.level==='P0')?'<span class="tag bad">P0 高危</span>':''}
        ${(c.advice||[]).some(a=>a.level==='P1')?'<span class="tag warn">P1 关注</span>':''}
      </div>
      <div class="detail-meta">
        <span class="chip static" style="background:transparent;padding-left:0">${indDot(c.industry)} <b style="margin-left:4px">${c.industry}</b></span>
        <span class="chip">代理商 <b>${c.agent}</b></span>
        <span class="chip">视频号 <b>${c.shops.length}</b></span>
        <span class="chip">下单单价 <b>¥${fmtNum(c.aov,0)}</b></span>
        <span class="chip">14日退款率 <b>${fmtPct(c.refund14,1)}</b></span>
      </div>
    </div>

    <div class="section-h">① 结果层</div>
    <div class="kpi-grid">
      <div class="kpi k-brand"><div class="kpi-label">QTD 消耗</div>
        <div class="kpi-val">${fmtMoney(c.consume,1)}<span class="unit">元</span></div>
        <div class="kpi-hint">艾米智投占比 ${fmtPct(c.amy_ratio,1)}</div></div>
      <div class="kpi k-info"><div class="kpi-label">下单 GMV</div>
        <div class="kpi-val">${fmtMoney(c.gmv,1)}<span class="unit">元</span></div>
        <div class="kpi-hint">${c.shops.length} 个视频号贡献</div></div>
      <div class="kpi ${c.roi==null?'k-warn':c.roi<2?'k-danger':c.roi<3?'k-warn':'k-ok'}"><div class="kpi-label">下单 ROI</div>
        <div class="kpi-val">${fmtNum(c.roi,2)}</div>
        <div class="kpi-hint">行业P50 ${fmtNum(b.roi_p50,2)} · P75 ${fmtNum(b.roi_p75,2)}</div></div>
      <div class="kpi k-brand"><div class="kpi-label">下单单价</div>
        <div class="kpi-val">${fmtNum(c.aov,0)}<span class="unit">元</span></div>
        <div class="kpi-hint">行业P50 ¥${fmtNum(b.aov_p50,0)}</div></div>
      <div class="kpi ${c.refund14!=null && c.refund14>15?'k-danger':'k-ok'}"><div class="kpi-label">14日退款率</div>
        <div class="kpi-val">${fmtNum(c.refund14,1)}<span class="unit">%</span></div>
        <div class="kpi-hint">${c.refund14!=null && c.refund14>15?'高于警戒线 15%':'处于正常区间'}</div></div>
    </div>

    <div class="section-h">② 与行业头部对标</div>
    <div class="card">
      <div class="sub">同二级行业「${c.industry}」消耗前 10 名客户的 P75 分位值 · 您（彩色） vs 行业 P75（灰色）</div>
      ${cmpChartBig(c, b)}
    </div>

    <div class="section-h">③ 广告基建 & 小店三率</div>
    <div class="grid-2">
      <div class="card compact">
        <h2>广告基建</h2>
        <div class="sub">计划数 / 新广告 / 一键起量</div>
        ${renderMiniKPI([
          ["日均广告数", c.ads, "", 0, "higher", 50],
          ["新广告占比", c.new_ratio, "%", 1, "higher", 5],
          ["一键起量%", c.auto_ratio, "%", 1, "higher", 10],
          ["曝光创意", c.creative_show, "", 0, "plain"],
          ["新建创意", c.creative_new, "", 0, "plain"],
        ])}
        <div class="divider"></div>
        <div class="detail-chips">
          <span class="chip">链路 <b>${c.link.length}</b></span>
          <span class="chip">全域通 <b>${c.link.some(l=>l.quan_yu_tong==="是")?"已接入":"未接入"}</b></span>
          <span class="chip">分产品出价 <b>${c.bidding.length?"已启用":"未启用"}</b></span>
          <span class="chip">艾米智投 <b>${fmtPct(c.amy_ratio,1)}</b></span>
        </div>
      </div>
      <div class="card compact">
        <h2>小店三率</h2>
        <div class="sub">品退率 / 差评率 / 商责纠纷率 / 14日退款率</div>
        ${renderMiniKPI([
          ["品退率", c.ret, "%", 2, "lower", 1],
          ["差评率", c.bad, "%", 2, "lower", 15],
          ["纠纷率", c.dispute, "%", 2, "lower", 0.5],
          ["14日退款率", c.refund14, "%", 1, "lower", 15],
        ])}
      </div>
    </div>

    ${(c.link.length || c.bidding.length) ? `
    <div class="section-h">④ 链路拆分 & 分产品出价</div>
    <div class="grid-2">
      ${c.link.length ? `
      <div class="card compact">
        <h2>链路拆分（B 表）</h2>
        <div class="sub">按全域通 × 商品消费链路</div>
        <table class="tbl">
          <thead><tr>
            <th>全域通</th><th>链路</th><th class="num">消耗</th><th>ROI</th><th class="num">广告数</th>
          </tr></thead>
          <tbody>${c.link.map(l=>`<tr>
            <td>${l.quan_yu_tong}</td>
            <td>${l.link}</td>
            <td class="num">${fmtMoney(l.consume,1)}</td>
            <td>${roiTag(l.roi)}</td>
            <td class="num">${fmtInt(l.ads)}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
      ` : '<div class="card compact"><h2>链路拆分（B 表）</h2><div class="empty">无链路数据</div></div>'}
      ${c.bidding.length ? `
      <div class="card compact">
        <h2>分产品出价（C 表）</h2>
        <div class="sub">当前使用的出价方式</div>
        <table class="tbl">
          <thead><tr><th>出价方式</th><th class="num">消耗</th><th>ROI</th></tr></thead>
          <tbody>${c.bidding.map(x=>`<tr>
            <td>${x.product}</td>
            <td class="num">${fmtMoney(x.consume,2)}</td>
            <td>${roiTag(x.roi)}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
      ` : '<div class="card compact"><h2>分产品出价（C 表）</h2><div class="empty">未启用分产品出价</div></div>'}
    </div>
    ` : ''}

    <div class="section-h">⑤ 提升建议</div>
    <div class="card">
      <div class="sub">基于数据自动诊断 · 请与您的渠道经理协同落实</div>
      ${renderAdvice(c.advice)}
    </div>

    <div class="section-h">⑥ 视频号明细</div>
    <div class="card">
      <div class="sub">${c.shops.length} 个视频号 · 按消耗排序</div>
      <table class="tbl">
        <thead><tr>
          <th>视频号</th><th>微信小店</th><th>代理商</th>
          <th class="num">消耗</th><th class="num">GMV</th><th>ROI</th><th class="num">广告数</th>
          <th class="num">品退%</th><th class="num">差评%</th><th class="num">纠纷%</th>
        </tr></thead>
        <tbody>${c.shops.map(s=>`<tr>
          <td class="sub-name">${s.shop}</td>
          <td>${s.wx_id||"—"}</td>
          <td>${s.agent||"—"}</td>
          <td class="num">${fmtMoney(s.consume,2)}</td>
          <td class="num">${fmtMoney(s.gmv,2)}</td>
          <td>${roiTag(s.roi)}</td>
          <td class="num">${fmtInt(s.ads)}</td>
          <td class="num">${riskTag(s.ret,1)}</td>
          <td class="num">${riskTag(s.bad,15)}</td>
          <td class="num">${riskTag(s.dispute,0.5)}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}