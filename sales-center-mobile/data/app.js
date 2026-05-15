(function(){
  const sales = ["合计", "Jonzhu", "brownfan", "kaikaigenli", "kinsleyjin", "lijunwu", "ruilingzhan", "yvaineechen", "其他"];
  const summary = Array.isArray(window.__CENTER_QUARTER_SUMMARY__) ? window.__CENTER_QUARTER_SUMMARY__ : [];
  const daily = window.__CENTER_DAILY_KPI__ || {};
  const topRows = Array.isArray(window.__TOP80_EFFECTIVE_METRICS__) ? window.__TOP80_EFFECTIVE_METRICS__ : [];
  const records = Array.isArray(window.__TUOKE_REAL_RECORDS__) ? window.__TUOKE_REAL_RECORDS__ : [];
  let view = "mine";
  let currentSale = localStorage.getItem("mobile_sale") || "kinsleyjin";
  let currentQuarter = "2026Q2";
  let topFilter = "all";
  let topSaleTab = "all";
  let growthSale = localStorage.getItem("mobile_growth_sale") || "all";
  let growthLimit = 20;

  const $ = id => document.getElementById(id);
  const moneyWan = yuan => {
    const n = Number(yuan || 0);
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + "万";
    return "¥" + Math.round(n).toLocaleString("zh-CN");
  };
  const wan = v => `${Number(v || 0).toFixed(1)}万`;
  const pct = v => {
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "—";
    return (Number(v) >= 0 ? "+" : "") + (Number(v) * 100).toFixed(1) + "%";
  };
  const delta = v => {
    const n = Number(v || 0);
    return (n > 0 ? "+" : "") + n.toFixed(0);
  };
  const clsTrend = v => Number(v || 0) > 0 ? "trend-up" : Number(v || 0) < 0 ? "trend-down" : "trend-flat";
  const parsePct = v => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    const s = String(v).replace("%", "").replace("+", "").trim();
    if (!s || s === "~" || s === "—") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const normQ = q => String(q || "").replace("/", "");
  const rowFor = (q, sale) => summary.find(r => r.quarter === q && r.sale === sale) || null;
  const visibleSale = () => view === "team" ? "合计" : currentSale;
  const doneKey = name => "mobile_done_" + name;
  const isDone = name => !!localStorage.getItem(doneKey(name));
  const doneRecord = name => {
    const raw = localStorage.getItem(doneKey(name));
    if (!raw) return null;
    if (raw === "1") return { tag: "", note: "" };
    try { return JSON.parse(raw); } catch { return { tag: "", note: "" }; }
  };
  const setDone = (name, payload) => {
    const data = JSON.stringify({ tag: payload.tag || "", note: payload.note || "", at: Date.now() });
    localStorage.setItem(doneKey(name), data);
    renderTop();
  };
  const undoDone = name => { localStorage.removeItem(doneKey(name)); renderTop(); };

  function initFilters(){
    const quarters = [...new Set(summary.map(r => r.quarter).filter(Boolean))].sort();
    currentQuarter = quarters.includes("2026Q2") ? "2026Q2" : (quarters[quarters.length - 1] || "2026Q2");
    // 季度下拉
    $("quarterSel").innerHTML = quarters.map(q => `<option value="${q}">${q}</option>`).join("");
    $("quarterSel").value = currentQuarter;
    // 够一够的销售下拉
    const saleOpts = ["all", ...sales.filter(s => s !== "合计" && s !== "其他")];
    const saleLabel = s => s === "all" ? "全部销售" : s;
    $("growthSaleSel").innerHTML = saleOpts.map(s => `<option value="${s}">${saleLabel(s)}</option>`).join("");
    $("growthSaleSel").value = growthSale;
    // 初始化 Top 销售 tab：默认 all（全部 74 家）
    topSaleTab = "all";
    document.querySelectorAll("#salesTabs button").forEach(b => b.classList.toggle("active", b.dataset.sale === "all"));
    // 事件
    $("quarterSel").addEventListener("change", e => { currentQuarter = e.target.value; renderAll(); });
    $("growthSaleSel").addEventListener("change", e => { growthSale = e.target.value; localStorage.setItem("mobile_growth_sale", growthSale); renderGrowth(); });
    $("btnMine").addEventListener("click", () => { view = "mine"; $("btnMine").classList.add("active"); $("btnTeam").classList.remove("active"); renderAll(); });
    $("btnTeam").addEventListener("click", () => { view = "team"; $("btnTeam").classList.add("active"); $("btnMine").classList.remove("active"); renderAll(); });
    document.querySelectorAll("#salesTabs button").forEach(btn => btn.addEventListener("click", () => {
      document.querySelectorAll("#salesTabs button").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      topSaleTab = btn.dataset.sale;
      renderTop();
    }));
    document.querySelectorAll("#todoChips .chip").forEach(btn => btn.addEventListener("click", () => { document.querySelectorAll("#todoChips .chip").forEach(x => x.classList.remove("active")); btn.classList.add("active"); topFilter = btn.dataset.filter; renderTop(); }));
    document.querySelectorAll("#growthChips .chip").forEach(btn => btn.addEventListener("click", () => { document.querySelectorAll("#growthChips .chip").forEach(x => x.classList.remove("active")); btn.classList.add("active"); growthLimit = Number(btn.dataset.limit); renderGrowth(); }));
  }

  function renderKpis(){
    // KPI 4 卡永远显示服饰中心全量（增长组+其他=合计），不随销售切换变化
    const r = rowFor(currentQuarter, "合计") || {};
    const centerCost = daily.centerCost || 0;
    const centerChg = daily.centerCostChg;
    $("updateText") && ($("updateText").textContent = `${currentQuarter}`);
    $("homeSub").textContent = `${currentQuarter} · 服饰中心全量`;
    $("kpiGrid").innerHTML = `
      <div class="kpi wide"><div class="label">服饰中心日耗</div><div class="value">${moneyWan(centerCost)}</div><div class="sub">环比前一天 <span class="${clsTrend(centerChg / 100)}">${centerChg === undefined ? "—" : (Number(centerChg) >= 0 ? "+" : "") + Number(centerChg).toFixed(1) + "%"}</span></div></div>
      <div class="kpi"><div class="label">新客数</div><div class="value">${Number(r.newCount || 0).toLocaleString("zh-CN")}</div><div class="sub">较前一天 <span class="${clsTrend(r.newDayDelta)}">${delta(r.newDayDelta)}</span></div><div class="sub" style="border-top:1px dashed #e5e7eb;padding-top:3px;margin-top:3px;color:#9ca3af;font-size:10px;">含 ${r.validCount} 有效 / ${r.risingCount} 新锐</div></div>
      <div class="kpi"><div class="label">有效新客</div><div class="value">${Number(r.validCount || 0).toLocaleString("zh-CN")}</div><div class="sub">较前一天 <span class="${clsTrend(r.validDayDelta)}">${delta(r.validDayDelta)}</span></div><div class="sub" style="border-top:1px dashed #e5e7eb;padding-top:3px;margin-top:3px;color:#9ca3af;font-size:10px;">占新客 ${r.newCount > 0 ? (r.validCount/r.newCount*100).toFixed(1) : 0}% · 季耗>¥1k</div></div>
      <div class="kpi"><div class="label">新锐客户</div><div class="value">${Number(r.risingCount || 0).toLocaleString("zh-CN")}</div><div class="sub">较前一天 <span class="${clsTrend(r.risingDayDelta)}">${delta(r.risingDayDelta)}</span></div><div class="sub" style="border-top:1px dashed #e5e7eb;padding-top:3px;margin-top:3px;color:#9ca3af;font-size:10px;">占有效 ${r.validCount > 0 ? (r.risingCount/r.validCount*100).toFixed(1) : 0}% · 新锐+经销商</div></div>
      <div class="kpi"><div class="label">新客昨耗</div><div class="value">${moneyWan(r.yestCost)}</div><div class="sub">日环比 <span class="${clsTrend(r.dayCostRate)}">${pct(r.dayCostRate)}</span></div><div class="sub" style="border-top:1px dashed #e5e7eb;padding-top:3px;margin-top:3px;color:#9ca3af;font-size:10px;">本季新客昨日 daily</div></div>
    `;
  }

  function renderSales(){
    const rows = summary.filter(r => r.quarter === currentQuarter && r.sale !== "\u589e\u957f\u7ec4").sort((a,b) => Number(b.yestCost || 0) - Number(a.yestCost || 0));
    const pendingBySale = {};
    topRows.forEach(r => {
      const s = r.sale;
      if (!pendingBySale[s]) pendingBySale[s] = 0;
      if (!isDone(r.name)) {
        const st = statusOf(r);
        if (st.status === "alarm" || st.status === "focus") pendingBySale[s]++;
      }
    });
    $("salesList").innerHTML = rows.map(r => {
      const n = pendingBySale[r.sale] || 0;
      const dotHtml = `<span class="s-dot${n === 0 ? ' zero' : ''}">${n}</span>`;
      return `<div class="sale-row">
        <div><div class="sname">${r.sale}${dotHtml}</div><div class="snums"><span>\u65b0\u5ba2 ${r.newCount}</span><span>\u6709\u6548 ${r.validCount}</span><span>\u65b0\u9510 ${r.risingCount}</span><span class="${clsTrend(r.dayCostRate)}">\u6628\u65e5 ${pct(r.dayCostRate)}</span></div></div>
        <div class="scost">${moneyWan(r.yestCost)}</div>
      </div>`;
    }).join("") || `<div class="empty">\u6682\u65e0\u6570\u636e</div>`;
  }
  function statusOf(row){
    const cost = parsePct(row.costRate);
    const roi = parsePct(row.roiRate);
    const creative = parsePct(row.creativeRate);
    let status = "stable";
    let label = "基本稳定";
    let headline = "指标平稳";
    if (String(row.matchStatus || "").includes("无投放")) {
      status = "alarm"; label = "需告警"; headline = "近两日无投放";
    } else if ((cost !== null && cost <= -20) || (roi !== null && roi <= -30)) {
      status = "alarm"; label = "需告警";
      if (cost !== null && cost <= -20) headline = `日耗剧烈下滑 ▼${Math.abs(cost).toFixed(0)}%`;
      else headline = `ROI 跳水 ▼${Math.abs(roi).toFixed(0)}%`;
    } else if ((cost !== null && cost <= -10) || (roi !== null && roi <= -15) || (creative !== null && creative <= -20)) {
      status = "focus"; label = "需关注";
      if (cost !== null && cost <= -10) headline = `日耗下滑 ▼${Math.abs(cost).toFixed(0)}%`;
      else if (roi !== null && roi <= -15) headline = `ROI 走弱 ▼${Math.abs(roi).toFixed(0)}%`;
      else headline = `创意减少 ▼${Math.abs(creative).toFixed(0)}%`;
    }
    return {status, label, headline};
  }

  function filteredTopRows(includeStable){
    const sale = visibleSale();
    return topRows.filter(r => (sale === "合计" || r.sale === sale)).map(r => ({...r, _s: statusOf(r)})).filter(r => includeStable || r._s.status !== "stable");
  }

  function renderTop(){
    let rows = topRows.map(r => ({...r, _s: statusOf(r)}));
    if (topSaleTab !== "all") rows = rows.filter(r => r.sale === topSaleTab);
    $("topTotal").textContent = `${rows.length} \u5bb6`;
    rows.sort((a,b) => Number(b.yestCostWan || 0) - Number(a.yestCostWan || 0));
    rows = rows.map((r, i) => ({...r, _rank: i}));
    // \u8ba1\u7b97\u5404\u7b5b\u9009\u72b6\u6001\u7684\u6570\u91cf\uff08\u672a\u5904\u7406\uff09
    const counts = {all: 0, alarm: 0, focus: 0, stable: 0, done: 0};
    rows.forEach(r => {
      const done = isDone(r.name);
      if (done) counts.done++;
      else {
        counts.all++;
        if (r._s.status === "alarm") counts.alarm++;
        else if (r._s.status === "focus") counts.focus++;
        else if (r._s.status === "stable") counts.stable++;
      }
    });
    // \u66f4\u65b0 chip \u6c14\u6ce1
    document.querySelectorAll("#todoChips .chip").forEach(btn => {
      const f = btn.dataset.filter;
      const n = counts[f] || 0;
      const dot = btn.querySelector(".c-dot");
      if (dot) dot.textContent = n;
    });
    // \u7b5b\u9009
    if (topFilter === "alarm") rows = rows.filter(r => r._s.status === "alarm" && !isDone(r.name));
    else if (topFilter === "focus") rows = rows.filter(r => r._s.status === "focus" && !isDone(r.name));
    else if (topFilter === "stable") rows = rows.filter(r => r._s.status === "stable" && !isDone(r.name));
    else if (topFilter === "done") rows = rows.filter(r => isDone(r.name));
    else rows = rows.filter(r => !isDone(r.name));
    $("topList").innerHTML = rows.map(r => cardTop(r, r._rank)).join("") || `<div class="empty">\u6682\u65e0\u6570\u636e</div>`;
    document.querySelectorAll("[data-handle]").forEach(btn =>
      btn.addEventListener("click", () => openHandleModal(btn.dataset.handle))
    );
    document.querySelectorAll("[data-undo]").forEach(btn =>
      btn.addEventListener("click", () => undoDone(btn.dataset.undo))
    );
    // \u7ed9PC iframe\u53d1\u7ea2\u70b9\u6570\uff08alarm+focus\u672a\u5904\u7406\uff09
    try {
      const allWithStatus = topRows.map(r => ({...r, _s: statusOf(r)}));
      const pendingCount = allWithStatus.filter(r =>
        (r._s.status === "alarm" || r._s.status === "focus") && !isDone(r.name)
      ).length;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "todo-redpoint", count: pendingCount }, "*");
      }
    } catch(e){}
  }
  function openHandleModal(name){
    const tags = ["已电联沟通","客户已知晓","暂无意向","转其他渠道","客户搁置"];
    let pickedTag = "";
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-title">✓ 标记 <span class="modal-target">${name}</span> 为已处理</div>
        <div class="modal-sub">可选：简短记录这次的处理情况（攒3个月就是你的客户运营史）</div>
        <div class="modal-tags">
          ${tags.map(t => `<button class="tag-btn" data-tag="${t}">${t}</button>`).join("")}
        </div>
        <textarea class="modal-input" placeholder="可写具体细节，如「客户反馈ROI不达预期，准备调整出价」（非必填）"></textarea>
        <div class="modal-actions">
          <button class="m-btn" data-act="cancel">取消</button>
          <button class="m-btn ghost" data-act="skip">跳过原因</button>
          <button class="m-btn primary" data-act="ok">完成</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll(".tag-btn").forEach(b =>
      b.addEventListener("click", () => {
        overlay.querySelectorAll(".tag-btn").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        pickedTag = b.dataset.tag;
      })
    );
    overlay.querySelectorAll(".m-btn").forEach(b =>
      b.addEventListener("click", () => {
        const act = b.dataset.act;
        if (act === "cancel") { overlay.remove(); return; }
        const note = overlay.querySelector(".modal-input").value.trim();
        if (act === "skip") setDone(name, { tag: "", note: "" });
        else setDone(name, { tag: pickedTag, note });
        overlay.remove();
      })
    );
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  }

  function rateChip(rateStr){
    const n = parsePct(rateStr);
    if (n === null) return `<span class="rate-flat">~</span>`;
    const cls = n > 0 ? "rate-up" : n < 0 ? "rate-down" : "rate-flat";
    const sign = n > 0 ? "+" : "";
    return `<span class="${cls}">${sign}${n.toFixed(0)}%</span>`;
  }

  function cardTop(r, idx){
    const done = isDone(r.name);
    const doneInfo = doneRecord(r.name);
    return `
      <div class="work-card ${done ? "done" : ""}" data-card="${escapeAttr(r.name)}">
        <div class="card-head">
          <div class="card-name">${r.name}</div>
          <span class="badge ${r._s.status}">${done ? "已处理" : `Top${idx + 1} ${r._s.label}`}</span>
        </div>
        <div class="card-headline ${r._s.status}">${done && doneInfo ? `已处理 · ${doneInfo.tag || "已沟通"}` : r._s.headline}</div>
        <div class="card-metrics">
          <span class="m-item"><i>日耗</i><b>${wan(r.yestCostWan)}</b>${rateChip(r.costRate)}</span>
          <span class="m-item"><i>ROI</i><b>${r.roi || "—"}</b>${rateChip(r.roiRate)}</span>
          <span class="m-item"><i>创意</i><b>${r.creativeIds || "—"}</b>${rateChip(r.creativeRate)}</span>
        </div>
        <div class="card-foot">
          <span class="card-sub">${r.sale || "—"} · ${r.deliverySide || "—"} · 季累 ${wan(r.quarterCostWan)}</span>
          ${done
            ? `<button class="btn-mini ghost" data-undo="${escapeAttr(r.name)}">撤销</button>`
            : `<button class="btn-mini primary" data-handle="${escapeAttr(r.name)}">去处理</button>`}
        </div>
        ${done && doneInfo && doneInfo.note ? `<div class="done-note">📝 ${doneInfo.note}</div>` : ""}
      </div>`;
  }

  function escapeAttr(s){ return String(s || "").replace(/"/g, "&quot;"); }

  function renderGrowth(){
    let rows = records.filter(r => normQ(r.firstQuarter) === currentQuarter && Number(r.quarterCost || 0) > 0 && Number(r.quarterCost || 0) < 1000 && !r.isLaoke && !r.old24);
    // 销售下拉：all=全部、否则按销售筛
    if (growthSale !== "all") rows = rows.filter(r => r.sale === growthSale);
    rows = rows.map(r => ({...r, gap: 1000 - Number(r.quarterCost || 0)})).sort((a,b) => a.gap - b.gap || Number(b.yestCost || 0) - Number(a.yestCost || 0));
    $("growthCount").textContent = `${rows.length} 个候选`;
    $("growthList").innerHTML = rows.slice(0, growthLimit).map(r => `
      <div class="work-card">
        <div class="work-top"><div class="name">${r.shortName || r.name}</div><span class="badge blue">还差 ¥${Math.ceil(r.gap).toLocaleString("zh-CN")}</span></div>
        <div class="meta-grid">
          <div class="meta"><b>${r.sale || "—"}</b><span>销售</span></div>
          <div class="meta"><b>¥${Math.round(Number(r.quarterCost || 0)).toLocaleString("zh-CN")}</b><span>季累消耗</span></div>
          <div class="meta"><b>${moneyWan(r.yestCost)}</b><span>昨日消耗</span></div>
          <div class="meta"><b>${r.cat || "—"}</b><span>类目</span></div>
          <div class="meta"><b>${r.deliverySide || "—"}</b><span>投放端</span></div>
          <div class="meta"><b>${r.source || "—"}</b><span>来源</span></div>
        </div>
        <div class="reason">建议：优先推动预算补量到 1000 门槛；若昨日有消耗，今天适合催预算/素材/链路复盘。</div>
      </div>
    `).join("") || `<div class="empty">当前筛选下暂无够一够客户</div>`;
  }

  function renderTop_OLD(){
    const rows = filteredTopRows(true).sort((a,b) => Number(b.yestCostWan || 0) - Number(a.yestCostWan || 0));
    $("topList").innerHTML = rows.slice(0, 60).map(r => cardTop(r, false)).join("") || `<div class="empty">暂无 Top 有效新客数据</div>`;
  }

  function renderAll(){
    renderKpis();
    renderSales();
    renderTop();
    renderGrowth();
  }

  initFilters();
  renderAll();
})();
