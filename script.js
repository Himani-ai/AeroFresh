/* AeroFresh dashboard.
   DEMO CONFIGURATION: replace this section only when you have validated hardware data.
   No live sensor values are claimed. MQTT is deliberately disabled until configured.
*/
(() => {
  "use strict";

  const DEMO_CONFIG = {
    mode: "demo",
    refreshIntervalMs: 12000,
    mqtt: {
      enabled: false,
      brokerUrl: "wss://broker.freemqtt.com:8084/mqtt",
      topic: "aerofresh/himani-ai/device01/telemetry",
      deviceId: "aerofresh-esp32-01",
      username: "freemqtt",
      password: "public",
      reconnectPeriodMs: 3000,
      staleTimeoutMs: 90000
    },
    demoLatest: { temperature: 28.4, humidity: 61.2, gas_adc: 1240, ldr_adc: 2100 },
    demoSeed: 42
  };

  const SENSOR_META = {
    temperature: { label: "Temperature", unit: "°C", sensor: "DHT22", icon: "thermometer", iconClass: "temperature", color: "#53d5bd", min: 20, max: 34 },
    humidity: { label: "Relative humidity", unit: "%", sensor: "DHT22", icon: "droplets", iconClass: "humidity", color: "#50c8e8", min: 35, max: 85 },
    gas_adc: { label: "MQ-135 gas response", unit: "ADC", sensor: "MQ-135", icon: "wind", iconClass: "gas", color: "#a995ed", min: 0, max: 4095 },
    ldr_adc: { label: "LDR light level", unit: "ADC", sensor: "LDR", icon: "sun", iconClass: "light", color: "#f4bd69", min: 0, max: 4095 }
  };

  const EDGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const EDGE_SAMPLE_INTERVAL_MS = 60 * 1000;
  const state = { mode: "demo", connection: "demo", latest: { ...DEMO_CONFIG.demoLatest }, history: [], alerts: [], charts: {}, range: "1h", lastUpdated: new Date(), mqttClient: null, refreshTimer: null, lastLiveUpdate: null, mqttConfig: { ...DEMO_CONFIG.mqtt }, door: { status: "closed", pending: null, timer: null, confirmedLive: false }, edge: { database: null, lastSavedAt: 0, history: [] } };
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const fmtTime = d => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
  const fmtDateTime = d => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  // Experimental environmental score, deliberately not a food-spoilage probability.
  // Inputs: current temperature/humidity, relative gas-response shift, and persistence.
  function calculateEnvironmentalRisk(reading, history) {
    const temp = clamp((Math.abs(reading.temperature - 24) / 9) * 100, 0, 100);
    const humidity = clamp((Math.max(0, reading.humidity - 55) / 30) * 100, 0, 100);
    const recent = history.slice(-12);
    const baseline = recent.length ? recent.reduce((s, p) => s + p.gas_adc, 0) / recent.length : reading.gas_adc;
    const gas = clamp((Math.abs(reading.gas_adc - baseline) / Math.max(250, baseline * .28)) * 100, 0, 100);
    const unusual = history.slice(-12).filter(p => p.temperature > 29 || p.humidity > 70 || p.gas_adc > 1350).length;
    const persistence = clamp(unusual / 12 * 100, 0, 100);
    const score = Math.round(temp * .30 + humidity * .25 + gas * .25 + persistence * .20);
    return { score, factors: [
      { label: "Temperature deviation", value: Math.round(temp), weight: "30%" },
      { label: "Humidity deviation", value: Math.round(humidity), weight: "25%" },
      { label: "Gas-response variation", value: Math.round(gas), weight: "25%" },
      { label: "Unusual-condition persistence", value: Math.round(persistence), weight: "20%" }
    ] };
  }

  function initialize() {
    state.history = [];
    state.latest = {};
    state.alerts = [];
    state.lastUpdated = null;
    state.lid = null;
    state.lidLocalCount = 0;
    renderAll();
    initEdgeArchive();
    initNavigation();
    initChat();
    initRangeControls();
    initMqttAdapter();
    initDoorControl();
    setInterval(tickLid, 1000);
    loadBananaDataset();
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(checkLiveStaleness, 5000);
    $("#refreshBtn").addEventListener("click", () => { renderAll(); showToast("Refreshed"); });
    $("#alertFilter").addEventListener("change", renderAllAlerts);
    $("#clearChat").addEventListener("click", clearChat);
    window.addEventListener("resize", debounce(() => Object.values(state.charts).forEach(c => c.resize()), 120));
  }

  function initEdgeArchive() {
    const status = $("#edgeArchiveStatus");
    if (!window.indexedDB) {
      if (status) status.textContent = "Browser storage unavailable";
      return;
    }
    const request = indexedDB.open("aerofresh-edge-archive", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("readings")) {
        const store = database.createObjectStore("readings", { keyPath: "timestamp" });
        store.createIndex("timestamp", "timestamp", { unique: true });
      }
    };
    request.onsuccess = () => {
      state.edge.database = request.result;
      state.edge.lastSavedAt = Date.now();
      const count = state.edge.database.transaction("readings", "readonly").objectStore("readings").count();
      count.onsuccess = () => {
        const purge = state.edge.database.transaction("readings", "readwrite");
        const cur = purge.objectStore("readings").openCursor();
        cur.onsuccess = () => { const c = cur.result; if (c) { if (c.value.mode === "demo") c.delete(); c.continue(); } };
        purge.oncomplete = loadEdgeArchive;
      };
      pruneEdgeArchive();
      setInterval(pruneEdgeArchive, 60 * 1000);
    };
    request.onerror = () => {
      if (status) status.textContent = "Could not open browser storage";
    };
  }

  function archiveReadings(readings, mode) {
    if (!state.edge.database || !readings.length) return;
    const transaction = state.edge.database.transaction("readings", "readwrite");
    const store = transaction.objectStore("readings");
    readings.forEach(reading => store.put({ ...reading, timestamp: new Date(reading.timestamp).toISOString(), mode }));
    transaction.oncomplete = loadEdgeArchive;
  }

  function archiveReading(reading) {
    if (!state.edge.database || Date.now() - state.edge.lastSavedAt < EDGE_SAMPLE_INTERVAL_MS) return;
    state.edge.lastSavedAt = Date.now();
    archiveReadings([reading], state.mode);
  }

  function pruneEdgeArchive() {
    const database = state.edge.database;
    if (!database) return;
    const cutoff = new Date(Date.now() - EDGE_RETENTION_MS).toISOString();
    const transaction = database.transaction("readings", "readwrite");
    const request = transaction.objectStore("readings").index("timestamp").openCursor(window.IDBKeyRange.upperBound(cutoff, true));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    transaction.oncomplete = loadEdgeArchive;
  }

  function loadEdgeArchive() {
    const database = state.edge.database;
    const countLabel = $("#edgeArchiveCount");
    const status = $("#edgeArchiveStatus");
    if (!database) return;
    const request = database.transaction("readings", "readonly").objectStore("readings").getAll();
    request.onsuccess = () => {
      state.edge.history = request.result
        .map(reading => ({ ...reading, timestamp: new Date(reading.timestamp) }))
        .sort((left, right) => left.timestamp - right.timestamp);
      if (countLabel) countLabel.textContent = state.edge.history.length.toLocaleString();
      if (status) status.textContent = "Active · this browser";
      if (state.range === "7d") { renderCharts(); renderCorrelation(); }
    };
  }

  function renderAll() {
    if ($("#lastUpdated")) $("#lastUpdated").textContent = state.lastUpdated ? fmtTime(state.lastUpdated) : "—";
    renderSensorCards("#sensorCards");
    renderSensorCards("#monitorSensorCards");
    renderRisk();
    renderAlerts();
    renderCharts();
    renderCorrelation();
    renderAnomalySummary();
    renderAllAlerts();
    renderConnectionState();
    renderDoorControl();
    renderLid();
    if (window.lucide) lucide.createIcons();
  }

  function renderSensorCards(selector) {
    const root = $(selector);
    if (!root) return;
    root.innerHTML = Object.entries(SENSOR_META).map(([key, meta]) => {
      const value = state.latest[key];
      const missing = value == null;
  const display = missing ? "—" : (["gas_adc", "ldr_adc"].includes(key) ? Math.round(value).toLocaleString() : Number(value).toFixed(1));
      const trend = getTrend(key);
      return `<article class="sensor-card">
        <div class="sensor-card-top"><span class="sensor-icon ${meta.iconClass}"><i data-lucide="${meta.icon}"></i></span><span class="sensor-state"><b class="status-dot ${state.mode === "mqtt" ? "live-dot" : "demo-dot"}"></b>${missing ? "NO DATA" : state.mode === "mqtt" ? "LIVE DATA" : "LAST READING"}</span></div>
        <div class="sensor-name">${meta.label}</div><div class="sensor-value">${display} <small>${meta.unit}</small></div>
        <div class="sensor-foot"><span>${meta.sensor} · ${missing ? "No signal" : trend.label}</span><span class="${trend.className}">${trend.symbol}</span></div>
        <div class="sensor-foot" style="border:0;margin-top:0;padding-top:5px"><span>Last updated</span><span>${state.lastUpdated ? fmtTime(state.lastUpdated) : "—"}</span></div>
      </article>`;
    }).join("");
    if (window.lucide) lucide.createIcons();
  }

  function getTrend(key) {
    const h = state.history;
    if (!SENSOR_META[key] || state.latest[key] == null) return { label: "Unavailable", symbol: "—", className: "trend-neutral" };
    if (h.length < 2) return { label: "Stable", symbol: "•", className: "trend-neutral" };
    const previous = h[h.length - 2][key];
    if (!Number.isFinite(previous)) return { label: "New reading", symbol: "•", className: "trend-neutral" };
    const delta = state.latest[key] - previous;
    const threshold = ["gas_adc", "ldr_adc"].includes(key) ? 25 : .25;
    if (Math.abs(delta) < threshold) return { label: "Stable", symbol: "→", className: "trend-neutral" };
    return delta > 0 ? { label: "Trending up", symbol: "↗", className: "trend-up" } : { label: "Trending down", symbol: "↘", className: "trend-down" };
  }

  function riskCategory(score) {
    if (score < 30) return { label: "Low", color: "#71d69b", headline: "Lower signal activity", text: "Current readings give a low environmental risk indicator." };
    if (score < 60) return { label: "Moderate", color: "#e7c16e", headline: "Some conditions merit attention", text: "One or more readings are outside the reference bands. Review the trends." };
    if (score < 80) return { label: "High", color: "#ed9a69", headline: "Elevated environmental signals", text: "Several readings push the score up. Check storage conditions." };
    return { label: "Very High", color: "#ef7882", headline: "Multiple unusual signals", text: "The score is very high. Check storage conditions and sensor data." };
  }

  function renderRisk() {
    if (state.latest.temperature == null) {
      ["#overviewGauge", "#detailGauge"].forEach(sel => { const el = $(sel); if (el) el.style.setProperty("--score", 0); });
      ["#overviewRiskScore", "#detailRiskScore"].forEach(sel => { if ($(sel)) $(sel).textContent = "—"; });
      ["#overviewRiskLabel", "#detailRiskLabel"].forEach(sel => { if ($(sel)) $(sel).textContent = "No data"; });
      if ($("#riskSummaryLabel")) $("#riskSummaryLabel").textContent = "Waiting for readings";
      if ($("#detailRiskHeadline")) $("#detailRiskHeadline").textContent = "Waiting for readings";
      if ($("#detailRiskText")) $("#detailRiskText").textContent = "The risk indicator is calculated once readings arrive.";
      if ($("#riskFactors")) $("#riskFactors").innerHTML = "";
      return;
    }
    const result = calculateEnvironmentalRisk(state.latest, state.history);
    const category = riskCategory(result.score);
    ["#overviewGauge", "#detailGauge"].forEach(sel => { const el = $(sel); if (el) { el.style.setProperty("--score", result.score); el.style.setProperty("--gauge-color", category.color); } });
    ["#overviewRiskScore", "#detailRiskScore"].forEach(sel => { if ($(sel)) $(sel).textContent = result.score; });
    ["#overviewRiskLabel", "#detailRiskLabel"].forEach(sel => { if ($(sel)) $(sel).textContent = category.label; });
    $("#riskSummaryLabel").textContent = `${category.label} · risk signal`;
    $("#riskStatusDot").style.background = category.color;
    $("#detailRiskHeadline").textContent = category.headline;
    $("#detailRiskText").textContent = category.text;
    $("#riskFactors").innerHTML = result.factors.map((f, i) => `<div class="factor-row"><div class="factor-label"><span>${f.label} <small>(${f.weight})</small></span><strong>${f.value}/100</strong></div><div class="factor-track"><div class="factor-fill ${i % 2 ? "alt" : ""}" style="width:${f.value}%"></div></div></div>`).join("");
  }

  function renderAlerts() {
    const root = $("#recentAlerts");
    if (!root) return;
    root.innerHTML = state.alerts.slice(0, 4).map(alert => alertMarkup(alert, false)).join("");
  }
  function alertMarkup(a, full) {
    const icon = a.severity === "high" ? "alert-octagon" : a.severity === "medium" ? "alert-triangle" : "info";
    return `<div class="${full ? "full-alert" : "alert-row"}"><span class="alert-symbol ${a.severity}"><i data-lucide="${icon}"></i></span><div class="alert-content"><strong>${esc(a.title)}</strong><p>${esc(a.description)}</p></div>${full ? `<div class="alert-meta"><span class="severity-label ${a.severity}">${a.severity}</span><time>${fmtDateTime(a.timestamp)}</time><small>${esc(a.source)}</small></div>` : `<time class="alert-time">${fmtTime(a.timestamp)}</time>`}</div>`;
  }
  function renderAnomalySummary() {
    const counts = ["high", "medium", "low"].map(s => state.alerts.filter(a => a.severity === s).length);
    $("#anomalySummary").innerHTML = `<div class="anomaly-stat"><span>High severity</span><strong style="color:var(--red)">${counts[0]}</strong><small>Rule-based alerts</small></div><div class="anomaly-stat"><span>Medium severity</span><strong style="color:var(--amber)">${counts[1]}</strong><small>Rule-based alerts</small></div><div class="anomaly-stat"><span>Low severity</span><strong style="color:var(--cyan)">${counts[2]}</strong><small>System events</small></div>`;
  }
  function renderAllAlerts() {
    const filter = $("#alertFilter")?.value || "all";
    const list = state.alerts.filter(a => filter === "all" || a.severity === filter);
    $("#allAlerts").innerHTML = list.length ? list.map(a => alertMarkup(a, true)).join("") : `<div class="empty-alerts">No alerts match this severity filter.</div>`;
    if (window.lucide) lucide.createIcons();
  }

  function chartBaseOptions(yTitle, beginAtZero = false) {
    return {
      responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#071724", borderColor: "rgba(133,185,198,.2)", borderWidth: 1, titleColor: "#d9e8ed", bodyColor: "#a9c0ca", padding: 10, displayColors: true } },
      scales: {
        x: { grid: { color: "rgba(150,180,198,.055)" }, ticks: { color: "#718b9d", maxTicksLimit: 7, font: { size: 9 } }, border: { display: false } },
        y: { beginAtZero, grid: { color: "rgba(150,180,198,.08)" }, ticks: { color: "#718b9d", font: { size: 9 } }, border: { display: false }, title: { display: true, text: yTitle, color: "#7893a5", font: { size: 9, weight: "normal" } } }
      }
    };
  }
  function gradient(ctx, color) { const g = ctx.createLinearGradient(0, 0, 0, 220); g.addColorStop(0, color + "35"); g.addColorStop(1, color + "00"); return g; }
  function makeDataset(label, data, color, ctx, tension = .36) {
    return { label, data, borderColor: color, backgroundColor: gradient(ctx, color), fill: true, tension, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 };
  }
  function chartFor(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    if (state.charts[id]) state.charts[id].destroy();
    state.charts[id] = new Chart(canvas.getContext("2d"), config);
  }
  function getRangeHistory(range) {
    const all = state.history;
    if (range === "7d") return state.edge.history;
    const span = { "1h": 3600e3, "6h": 6 * 3600e3, "24h": 24 * 3600e3 }[range] || 3600e3;
    const cutoff = Date.now() - span;
    return all.filter(p => p.timestamp >= cutoff);
  }
  function decimate(rows) { const step = Math.ceil(rows.length / 600); return step > 1 ? rows.filter((_, i) => i % step === 0) : rows; }
  function renderCharts() {
    if (!window.Chart) return;
    const rows = decimate(getRangeHistory(state.range));
    const labels = rows.map(p => fmtTime(p.timestamp));
    const chartIds = ["combinedChart", "temperatureChart", "humidityChart", "gasChart", "ldrChart", "historyTempChart", "historyHumidityChart", "historyGasChart", "historyLdrChart", "historyCombinedChart"];
    chartIds.forEach(id => { if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; } });
    const combined = $("#combinedChart");
    if (combined) {
      const ctx = combined.getContext("2d");
      chartFor("combinedChart", { type: "line", data: { labels, datasets: [
        makeDataset("Temperature °C", rows.map(p => p.temperature), "#53d5bd", ctx),
        makeDataset("Humidity %", rows.map(p => p.humidity), "#50c8e8", ctx),
        makeDataset("Gas response ADC", rows.map(p => p.gas_adc / 30), "#a995ed", ctx),
        makeDataset("LDR light ADC", rows.map(p => p.ldr_adc / 30), "#f4bd69", ctx)
      ] }, options: chartBaseOptions("Scaled sensor signals · ADC ÷ 30") });
      state.charts.combinedChart.options.plugins.legend.display = true;
      state.charts.combinedChart.options.plugins.legend.labels = { color: "#91a9b8", boxWidth: 7, boxHeight: 7, usePointStyle: true, font: { size: 9 } };
      state.charts.combinedChart.update();
    }
    const defs = [
      ["temperatureChart", "Temperature °C", "temperature", "#53d5bd"],
      ["humidityChart", "Humidity %", "humidity", "#50c8e8"],
      ["gasChart", "Gas response ADC", "gas_adc", "#a995ed"],
      ["ldrChart", "LDR light level ADC", "ldr_adc", "#f4bd69"],
      ["historyTempChart", "Temperature °C", "temperature", "#53d5bd"],
      ["historyHumidityChart", "Humidity %", "humidity", "#50c8e8"],
      ["historyGasChart", "Gas response ADC", "gas_adc", "#a995ed"],
      ["historyLdrChart", "LDR light level ADC", "ldr_adc", "#f4bd69"]
    ];
    defs.forEach(([id, label, key, color]) => {
      const el = $("#" + id); if (!el) return;
      const data = rows.map(p => p[key]);
      chartFor(id, { type: "line", data: { labels, datasets: [makeDataset(label, data, color, el.getContext("2d"))] }, options: chartBaseOptions(label) });
    });
    const histCombined = $("#historyCombinedChart");
    if (histCombined) {
      const norm = (key, min, max) => rows.map(p => +((p[key] - min) / (max - min) * 100).toFixed(1));
      const ctx = histCombined.getContext("2d");
      chartFor("historyCombinedChart", { type: "line", data: { labels, datasets: [
        makeDataset("Temperature index", norm("temperature", 18, 36), "#53d5bd", ctx),
        makeDataset("Humidity index", norm("humidity", 25, 90), "#50c8e8", ctx),
        makeDataset("Gas-response index", norm("gas_adc", 400, 1900), "#a995ed", ctx),
        makeDataset("Light-level index", norm("ldr_adc", 0, 4095), "#f4bd69", ctx)
      ] }, options: chartBaseOptions("Normalized index (0–100)", true) });
      state.charts.historyCombinedChart.options.plugins.legend.display = true;
      state.charts.historyCombinedChart.options.plugins.legend.labels = { color: "#91a9b8", boxWidth: 7, boxHeight: 7, usePointStyle: true, font: { size: 9 } };
      state.charts.historyCombinedChart.update();
    }
  }

  function pearson(a, b) {
    const pairs = a.map((value, i) => [value, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const n = pairs.length; if (n < 2) return 0;
    const aa = pairs.map(pair => pair[0]), bb = pairs.map(pair => pair[1]);
    const ma = aa.reduce((x,y)=>x+y,0)/n, mb = bb.reduce((x,y)=>x+y,0)/n;
    let num = 0, da = 0, db = 0;
    for (let i=0;i<n;i++){num+=(aa[i]-ma)*(bb[i]-mb);da+=(aa[i]-ma)**2;db+=(bb[i]-mb)**2;}
    return da && db ? num / Math.sqrt(da*db) : 0;
  }
  function renderCorrelation() {
    const root = $("#correlationGrid"); if (!root) return;
    const keys = ["temperature", "humidity", "gas_adc"];
    const names = ["Temp", "Humidity", "Gas ADC"];
    const h = getRangeHistory(state.range);
    const matrix = keys.map(a => keys.map(b => pearson(h.map(p=>p[a]),h.map(p=>p[b]))));
    root.innerHTML = `<div class="corr-cell header-cell"><strong>Signal</strong></div>${names.map(n=>`<div class="corr-cell header-cell"><strong>${n}</strong></div>`).join("")}${matrix.map((row,i)=>`<div class="corr-cell header-cell"><strong>${names[i]}</strong></div>${row.map(v=>{const opacity=.07+Math.abs(v)*.27;const color=v>=0?`rgba(55,214,189,${opacity})`:`rgba(169,149,237,${opacity})`;return `<div class="corr-cell" style="background:${color}"><strong>${v.toFixed(2)}</strong><span>${v>.65?"Positive":v<-.65?"Negative":"Weak / mixed"}</span></div>`}).join("")}`).join("")}`;
  }

  function initRangeControls() {
    $$(".range-btn").forEach(btn => btn.addEventListener("click", () => {
      $$(".range-btn").forEach(b => b.classList.toggle("active", b === btn));
      state.range = btn.dataset.range;
      renderCharts(); renderCorrelation();
    }));
  }

  function initNavigation() {
    const sidebar = $("#sidebar"), backdrop = $("#mobileBackdrop"), toggle = $("#menuToggle");
    function closeMenu() { sidebar.classList.remove("open"); backdrop.classList.remove("visible"); toggle.setAttribute("aria-expanded", "false"); }
    toggle.addEventListener("click", () => {
      const open = sidebar.classList.toggle("open"); backdrop.classList.toggle("visible", open); toggle.setAttribute("aria-expanded", String(open));
    });
    backdrop.addEventListener("click", closeMenu);
    $$(".nav-link").forEach(link => link.addEventListener("click", e => {
      e.preventDefault();
      const id = link.dataset.section;
      $$(".page-section").forEach(section => section.classList.toggle("active-section", section.id === id));
      $$(".nav-link").forEach(item => item.classList.toggle("active", item === link));
      $("#pageCrumb").textContent = link.querySelector("span").textContent;
      history.replaceState(null, "", `#${id}`);
      closeMenu(); window.scrollTo({ top: 0, behavior: "smooth" });
      if (Object.values(state.charts).length) setTimeout(() => Object.values(state.charts).forEach(c => c.resize()), 60);
    }));
    const initial = location.hash.slice(1);
    const initialLink = $(`.nav-link[data-section="${initial}"]`);
    if (initialLink) initialLink.click();
  }

  function updateClock() { $("#clock").textContent = fmtTime(new Date()); }
  function showToast(message) { const t=$("#toast");t.textContent=message;t.classList.add("show");clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove("show"),2800); }

  // Local, rule-based assistant. Replace this module with a secure backend API call later.
  function initChat() {
    $("#chatForm").addEventListener("submit", e => { e.preventDefault(); const input=$("#chatInput"); const q=input.value.trim(); if(!q)return; appendMessage(q,"user"); input.value=""; setTimeout(()=>appendMessage(answerQuestion(q),"assistant"),220); });
    $$(".suggested-questions button").forEach(btn => btn.addEventListener("click",()=>{ $("#chatInput").value=btn.textContent; $("#chatForm").requestSubmit(); }));
  }
  function appendMessage(text, role) {
    const root=$("#chatMessages"), div=document.createElement("div");
    div.className=`message ${role==="user"?"user-message":"assistant-message"}`;
    const icon=role==="user"?"user-round":"sparkles";
    div.innerHTML=`<div class="message-avatar"><i data-lucide="${icon}"></i></div><div class="message-body"><p>${esc(text).replace(/\n/g,"<br>")}</p><small>${role==="user"?"You":"AeroFresh"} · ${fmtTime(new Date())}</small></div>`;
    root.appendChild(div);root.scrollTop=root.scrollHeight;if(window.lucide)lucide.createIcons();
  }
  function src() { return state.mode === "mqtt" ? `live readings received since ${fmtTime(state.history[0]?.timestamp || new Date())}` : "stored readings"; }
  function answerQuestion(question) {
    const q=question.toLowerCase(), h=state.history, latest=state.latest;
    if(!h.length)return "No readings have arrived yet. Connect live MQTT, then ask again.";
    const maxTemp=Math.max(...h.map(p=>p.temperature)), maxHum=Math.max(...h.map(p=>p.humidity)), maxGas=Math.max(...h.map(p=>p.gas_adc));
    if(q.includes("maximum")&&q.includes("temperature"))return `The maximum temperature in the ${src()} is ${maxTemp.toFixed(1)} °C.`;
    if(q.includes("humidity")&&(q.includes("increase")||q.includes("when")||q.includes("rise"))){const first=h.findIndex((p,i)=>i>0&&p.humidity-h[i-1].humidity>1.2);return first>=0?`A noticeable upward step appears around ${fmtDateTime(h[first].timestamp)} in the ${src()}. Current humidity is ${latest.humidity.toFixed(1)}%.`:`No single sharp humidity increase was found in the ${src()}. Current humidity is ${latest.humidity.toFixed(1)}%.`;}
    if(q.includes("gas")||q.includes("adc"))return `The latest MQ-135 reading is ${latest.gas_adc} raw ADC units. The maximum in the ${src()} is ${maxGas} ADC. This is a raw sensor response, not a calibrated gas concentration.`;
    if(q.includes("ldr")||q.includes("light"))return `The latest LDR reading is ${latest.ldr_adc} raw ADC units (lid ${state.door.status}). The LDR is not calibrated to lux.`;
    if(q.includes("risk")||q.includes("indicator")){const r=calculateEnvironmentalRisk(latest,h),c=riskCategory(r.score);return `The risk indicator is ${r.score}/100 (${c.label}). It combines illustrative temperature deviation, humidity deviation, gas-response variation and persistence weights. It is not a spoilage probability or food-safety measurement.`;}
    if(q.includes("unusual")||q.includes("sensor")||q.includes("alert"))return (state.alerts.length ? `There are ${state.alerts.length} alerts. Most recent: ${state.alerts[0].title} at ${fmtTime(state.alerts[0].timestamp)}.` : "No unusual readings have been flagged so far.");
    if(q.includes("humidity"))return `Latest humidity is ${latest.humidity.toFixed(1)}%. The highest value in the ${src()} is ${maxHum.toFixed(1)}%.`;
    if(q.includes("temperature")||q.includes("warm"))return `Latest temperature is ${latest.temperature.toFixed(1)} °C. The highest value in the ${src()} is ${maxTemp.toFixed(1)} °C.`;
    return "I can answer questions about DHT22 temperature and humidity, MQ-135 gas response, LDR light readings, maxima, trend changes, alerts and the risk indicator. Try one of the suggested prompts.";
  }
  function clearChat(){ $("#chatMessages").innerHTML=`<div class="message assistant-message"><div class="message-avatar"><i data-lucide="sparkles"></i></div><div class="message-body"><p>Conversation cleared. Ask me about the AeroFresh readings.</p><small>AeroFresh · just now</small></div></div>`;if(window.lucide)lucide.createIcons(); }

  function setConnection(connection, message) {
    state.connection = connection;
    if (connection !== "connected") { state.mode = "demo"; $("#lidToast")?.classList.remove("show"); }
    renderConnectionState(message);
  }
  function renderConnectionState(message) {
    const brokerConnected = state.connection === "connected";
    const liveData = brokerConnected && state.mode === "mqtt";
    const label = liveData ? "LIVE MQTT" : brokerConnected ? "MQTT READY" : state.connection === "connecting" ? "CONNECTING" : "OFFLINE";
    const modeLabel = $("#modeLabel");
    if (modeLabel) modeLabel.textContent = label;
    const pill = $("#modePill");
    if (pill) pill.classList.toggle("live-mode-pill", liveData);
    const notice = $("#connectionNotice");
    if (notice) {
      const title = notice.querySelector("strong");
      const detail = notice.querySelector("span");
      title.textContent = liveData ? "Live MQTT telemetry received." : brokerConnected ? "MQTT broker connected." : state.connection === "error" ? "MQTT connection error." : "ESP32 offline.";
      detail.textContent = message || (liveData ? `Receiving validated readings for ${state.mqttConfig.deviceId}.` : brokerConnected ? "Subscribed successfully; waiting for the first valid ESP32 reading." : "Connect live MQTT in System Information to receive readings.");
    }
    const status = $("#mqttState");
    if (status) status.textContent = liveData ? "Live data" : brokerConnected ? "Connected · waiting for data" : state.connection === "connecting" ? "Connecting" : state.connection === "error" ? "Error" : "Not connected";
    const summary = $("#mqttConnectionSummary");
    if (summary) summary.textContent = liveData ? "Connected · live readings active" : brokerConnected ? "Broker connected · awaiting ESP32 telemetry" : state.connection === "error" ? "Error · check configuration and broker logs" : "Not connected";
    applyLiveLabels(liveData);
    renderDoorControl();
  }
  function applyLiveLabels(live) {
    $$("[data-live]").forEach(el => { el.textContent = live ? el.dataset.live : el.dataset.off; });
    $$(".live-status-dot").forEach(d => { d.classList.toggle("live-dot", live); d.classList.toggle("demo-dot", !live); });
    $$(".demo-tag").forEach(t => t.classList.toggle("live-mode-pill", live));
    $$(".live-pill").forEach(p => { p.classList.toggle("planned-state", !live); p.classList.toggle("live-mode-pill", live); });
  }
  function renderDoorControl() {
    const connected = state.connection === "connected";
    const pending = state.door.pending;
    const stateLabel = $("#doorState");
    const dot = $("#doorStatusDot");
    const modeLabel = $("#doorModeLabel");
    const hint = $("#doorHint");
    const openButton = $("#doorOpen");
    const closeButton = $("#doorClose");
    if (!stateLabel) return;
    stateLabel.textContent = state.door.confirmedLive ? (state.door.status === "open" ? "Open" : "Closed") : (connected ? "Awaiting status" : "—");
    if (dot) dot.className = `status-dot ${connected && state.door.confirmedLive ? "live-dot" : "demo-dot"}`;
    if (modeLabel) modeLabel.textContent = connected ? state.door.confirmedLive ? "LIVE STATUS" : "MQTT READY" : "OFFLINE";
    if (hint) hint.textContent = pending
      ? `Waiting for MQTT confirmation that the door is ${pending}.`
      : connected && !state.door.confirmedLive
        ? "MQTT is connected. Waiting for door_state telemetry before showing a live status."
        : connected
        ? "Live commands are sent to the configured MQTT door-command topic. Status changes only after telemetry confirmation."
        : state.mqttClient
          ? "MQTT is connecting or unavailable. Door controls are paused until the connection is ready."
          : "Lid state is reported by the ESP32.";
    if (openButton) openButton.disabled = Boolean(pending || (state.door.confirmedLive && state.door.status === "open") || (state.mqttClient && !connected));
    if (closeButton) closeButton.disabled = Boolean(pending || (state.door.confirmedLive && state.door.status === "closed") || (state.mqttClient && !connected));
  }
  function initDoorControl() {
    $("#doorOpen")?.addEventListener("click", () => setDoorState("open"));
    $("#doorClose")?.addEventListener("click", () => setDoorState("closed"));
    renderDoorControl();
  }
  function setDoorState(nextState) {
    const client = state.mqttClient;
    if (client && state.connection !== "connected") {
      showToast("Door control is paused until MQTT connects");
      return;
    }
    if (state.connection === "connected" && client) {
      const command = JSON.stringify({ device_id: state.mqttConfig.deviceId, command: "door.set", door_state: nextState, timestamp: new Date().toISOString() });
      state.door.pending = nextState;
      renderDoorControl();
      client.publish(`${state.mqttConfig.topic}/door/command`, command, { qos: 0 }, error => {
        if (!error || state.door.pending !== nextState) return;
        clearTimeout(state.door.timer);
        state.door.pending = null;
        renderDoorControl();
        showToast("MQTT door command could not be published");
      });
      state.door.timer = setTimeout(() => {
        if (state.door.pending !== nextState) return;
        state.door.pending = null;
        renderDoorControl();
        showToast("No door state confirmation received");
      }, 10000);
      return;
    }
    state.door.status = nextState;
    state.door.confirmedLive = false;
    renderDoorControl();
    showToast(`Door ${nextState}`);
  }
  function readMqttForm() {
    return {
      brokerUrl: $("#mqttBrokerUrl")?.value.trim() || "",
      topic: $("#mqttTopic")?.value.trim() || "",
      deviceId: $("#mqttDeviceId")?.value.trim() || "",
      username: $("#mqttUsername")?.value || "",
      password: $("#mqttPassword")?.value || "",
      reconnectPeriodMs: 3000,
      staleTimeoutMs: 90000
    };
  }
  function initMqttAdapter() {
    const saved = localStorage.getItem("aerofresh-mqtt-config");
    if (saved) {
      try { state.mqttConfig = { ...state.mqttConfig, ...JSON.parse(saved), password: state.mqttConfig.password, username: state.mqttConfig.username, enabled: false }; } catch (error) { console.warn("[AeroFresh] Ignored invalid saved MQTT settings", error); }
    }
    populateMqttForm();
    $("#mqttForm")?.addEventListener("submit", event => { event.preventDefault(); connectMqtt(readMqttForm()); });
    $("#mqttDisconnect")?.addEventListener("click", disconnectMqtt);
    if ($("#mqttBrokerSummary")) $("#mqttBrokerSummary").textContent = state.mqttConfig.brokerUrl || "Not configured";
    // Connection starts only when the user presses "Connect live MQTT".
  }
  function populateMqttForm() {
    ["brokerUrl", "topic", "deviceId", "username", "password"].forEach(key => {
      const input = $(`#mqtt${key[0].toUpperCase()}${key.slice(1)}`);
      if (input) input.value = state.mqttConfig[key] || "";
    });
    if ($("#mqttTopicSummary")) $("#mqttTopicSummary").textContent = state.mqttConfig.topic || "Not configured";
  }
  function connectMqtt(config) {
    const errorEl = $("#mqttError");
    if (!window.mqtt) { if (errorEl) errorEl.textContent = "MQTT.js could not be loaded. Check the CDN connection."; setConnection("error", "MQTT.js is unavailable."); return; }
    if (!/^wss:\/\//i.test(config.brokerUrl) || !config.topic || !config.deviceId) {
      if (errorEl) errorEl.textContent = "Use a wss:// broker URL, topic and device ID.";
      setConnection("error", "Enter a secure WSS broker URL, topic and device ID.");
      return;
    }
    disconnectMqtt(false);
    state.mqttConfig = { ...config, enabled: true };
    if ($("#mqttRemember")?.checked) { const safeConfig = { brokerUrl: config.brokerUrl, topic: config.topic, deviceId: config.deviceId }; localStorage.setItem("aerofresh-mqtt-config", JSON.stringify(safeConfig)); } else { localStorage.removeItem("aerofresh-mqtt-config"); }
    if ($("#mqttBrokerSummary")) $("#mqttBrokerSummary").textContent = config.brokerUrl;
    if ($("#mqttTopicSummary")) $("#mqttTopicSummary").textContent = config.topic;
    state.lastLiveUpdate = null;
    setConnection("connecting", "Connecting securely to the configured MQTT broker.");
    try {
      const client = window.mqtt.connect(config.brokerUrl, { username: config.username || undefined, password: config.password || undefined, reconnectPeriod: config.reconnectPeriodMs, connectTimeout: 10000, clean: true });
      state.mqttClient = client;
      client.on("connect", () => client.subscribe(config.topic, { qos: 0 }, error => {
        if (error) { console.error("[AeroFresh] MQTT subscribe failed", error); setConnection("error", "Connected, but subscription was refused. Check topic permissions."); return; }
        setConnection("connected", "Broker connected and subscribed; waiting for the first valid ESP32 reading."); showToast("MQTT broker connected · waiting for ESP32 data");
      }));
      client.on("message", (topic, payload) => {
        if (topic !== config.topic) return;
        try { const text = typeof payload === "string" ? payload : new TextDecoder("utf-8").decode(payload); handleIncomingReading(JSON.parse(text)); } catch (error) { console.warn("[AeroFresh] Invalid MQTT JSON message", error); showToast("Ignored malformed MQTT JSON"); }
      });
      client.on("reconnect", () => setConnection("connecting", "MQTT connection interrupted; retrying securely."));
      client.on("offline", () => setConnection("offline", "MQTT is offline; data is marked stale until a valid reading arrives."));
      client.on("error", error => { console.error("[AeroFresh] MQTT error", error); setConnection("error", "MQTT reported an error. Verify WSS, credentials and topic permissions."); });
      client.on("close", () => setConnection("offline", "MQTT connection closed; reconnecting."));
    } catch (error) { console.error("[AeroFresh] MQTT connection setup failed", error); setConnection("error", "MQTT connection could not be started."); }
  }
  function disconnectMqtt(showMessage = true) {
    if (state.mqttClient) { state.mqttClient.end(true); state.mqttClient = null; }
    clearTimeout(state.door.timer);
    state.door.pending = null;
    state.mqttConfig.enabled = false;
    setConnection("demo", "Live connection stopped.");
    renderDoorControl();
    if (showMessage) showToast("MQTT disconnected");
  }
  function checkLiveStaleness() {
    if (state.connection === "connected" && state.lastLiveUpdate && Date.now() - state.lastLiveUpdate > state.mqttConfig.staleTimeoutMs) {
      state.mode = "demo";
      setConnection("stale", "No valid reading arrived within the configured timeout; live data is stale.");
    }
  }
  function handleIncomingReading(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return console.warn("[AeroFresh] Ignored non-object telemetry");
    const cfg = state.mqttConfig;
    if (payload.device_id !== cfg.deviceId) return console.warn("[AeroFresh] Ignored telemetry for another device");
    const required = { temperature: [-40, 85], humidity: [0, 100], gas_adc: [0, 4095], ldr_adc: [0, 4095] };
    const values = {};
    for (const [key, [min, max]] of Object.entries(required)) {
      const value = Number(payload[key]);
      if (!Number.isFinite(value) || value < min || value > max) { console.warn(`[AeroFresh] Ignored invalid required field: ${key}`); return; }
      values[key] = value;
    }
    const timestamp = new Date(payload.timestamp);
    if (!payload.timestamp || Number.isNaN(timestamp.getTime())) return console.warn("[AeroFresh] Ignored telemetry with invalid timestamp");
    const doorState = typeof payload.door_state === "string" ? payload.door_state.toLowerCase() : "";
    if (doorState === "open" || doorState === "closed") {
      state.door.status = doorState;
      state.door.pending = null;
      state.door.confirmedLive = true;
      clearTimeout(state.door.timer);
    }
    const reading = { timestamp, ...values };
    if (state.mode !== "mqtt") { state.history = []; state.alerts = []; }
    detectLiveAlerts(reading, payload);
    updateLidState(payload);
    state.history.push(reading); if (state.history.length > 5000) state.history.shift();
    state.latest = { ...reading }; state.lastUpdated = new Date(); state.lastLiveUpdate = Date.now(); state.mode = "mqtt"; setConnection("connected"); renderAll();
    archiveReading(reading);
  }
  function fmtDur(sec) { const s = Math.max(0, Math.round(sec)), m = Math.floor(s / 60); return m ? `${m} min ${s % 60} s` : `${s} s`; }
  function lidOpenSeconds() { const l = state.lid; return l && l.status === "open" ? l.openForSec + (Date.now() - l.receivedAt) / 1000 : 0; }
  function updateLidState(payload) {
    const door = typeof payload.door_state === "string" ? payload.door_state.toLowerCase() : "";
    if (door !== "open" && door !== "closed") return;
    const prev = state.lid;
    let count = Number(payload.lid_open_count);
    if (!Number.isFinite(count)) { if (door === "open" && prev?.status !== "open") state.lidLocalCount++; count = state.lidLocalCount; }
    const dur = Number(payload.lid_duration_seconds), d = Number.isFinite(dur) ? dur : null;
    state.lid = { status: door, count, openForSec: door === "open" ? (d ?? 0) : 0,
      lastDurationSec: door === "closed" ? (count > 0 && d !== null ? d : null) : (prev?.lastDurationSec ?? null), receivedAt: Date.now() };
  }
  function renderLid() {
    const set = (id, t) => { const e = $("#" + id); if (e) e.textContent = t; };
    const l = state.lid;
    if (!l) { set("lidOpenFor", "—"); set("lidCount", "—"); set("lidLast", "—"); updateLidNotice(); return; }
    set("lidOpenFor", l.status === "open" ? fmtDur(lidOpenSeconds()) : "Closed");
    set("lidCount", String(l.count));
    set("lidLast", l.lastDurationSec != null ? fmtDur(l.lastDurationSec) : "—");
    updateLidNotice();
  }
  function updateLidNotice() {
    const t = $("#lidToast"); if (!t) return;
    const sec = state.mode === "mqtt" ? lidOpenSeconds() : 0;
    if (sec >= 30) { t.textContent = `Lid open for ${fmtDur(sec)}`; t.classList.add("show"); } else t.classList.remove("show");
  }
  function tickLid() { if (state.lid && state.lid.status === "open") renderLid(); else updateLidNotice(); }
  function detectLiveAlerts(r, payload) {
    const h = state.history, now = r.timestamp;
    const add = (key, severity, title, description) => {
      const recent = state.alerts.find(a => a.key === key && now - a.timestamp < 120000);
      if (recent) return;
      state.alerts.unshift({ id: `${key}-${now.getTime()}`, key, severity, title, description, timestamp: now, source: "LIVE" });
      if (state.alerts.length > 100) state.alerts.pop();
    };
    const prev = h[h.length - 1];
    const base = h.slice(-12);
    const avg = k => base.reduce((s, p) => s + p[k], 0) / base.length;
    if (r.temperature > 30) add("temp-high", "high", "High temperature", `Temperature reached ${r.temperature.toFixed(1)} °C, above the 30 °C reference.`);
    if (r.humidity > 75) add("hum-high", "medium", "High humidity", `Humidity reached ${r.humidity.toFixed(1)} %, above the 75 % reference.`);
    if (prev && r.temperature - prev.temperature >= 0.8) add("temp-jump", "medium", "Sudden temperature rise", `Temperature rose ${(r.temperature - prev.temperature).toFixed(1)} °C between readings.`);
    if (base.length >= 6) { const g = avg("gas_adc"); if (Math.abs(r.gas_adc - g) > Math.max(150, g * 0.25)) add("gas-shift", "high", "Unusual gas-response change", `MQ-135 reading ${r.gas_adc} ADC vs recent average ${Math.round(g)} ADC.`); }
    const door = typeof payload.door_state === "string" ? payload.door_state.toLowerCase() : "";
    const openFor = Number(payload.lid_duration_seconds);
    if (door === "open" && state.lid?.status !== "open") add("lid-open", "low", "Lid opened", `The lid was opened (open count ${payload.lid_open_count ?? "?"}).`);
    if (door === "open" && openFor >= 30) add("lid-long", "medium", "Lid left open", `The lid has been open for ${openFor} s.`);
  }

  // Banana-ripeness research dataset (University of Bath, CC BY 4.0): summary from the repository's report files.
  const STAGE_INFO = [
    ["unripe", "Whole banana is green"],
    ["ripe", "Whole banana is yellow"],
    ["beyond_ripe", "Yellow with some browning on a minority of the visible surface"],
    ["overripe", "Majority of the visible surface is brown or has brown spots"],
    ["gone_off", "Whole banana is black or brown"]
  ];
  async function loadBananaDataset() {
    const root = $("#bananaSplits");
    if (!root) return;
    const nice = k => k.replace("_", " ");
    try {
      const [prep, model] = await Promise.all([
        fetch("reports/banana_ripeness_preprocessing.json").then(r => { if (!r.ok) throw new Error("prep"); return r.json(); }),
        fetch("tinyml/reports/voc_baseline_metrics.json").then(r => { if (!r.ok) throw new Error("model"); return r.json(); })
      ]);
      root.innerHTML = prep.data_splits.map(d => `<div class="anomaly-stat"><span>${esc(d.name.replace("_", " "))}</span><strong>${d.rows.toLocaleString()}</strong><small>${d.features} features · ${d.missing} missing values</small></div>`).join("");
      const train = prep.data_splits.filter(d => d.name.endsWith("train"));
      $("#bananaClasses").innerHTML = train.map(d => {
        const max = Math.max(...Object.values(d.class_counts));
        return `<div class="class-row"><div class="factor-label"><span>${esc(d.name.replace("_", " "))}</span><strong>${d.rows.toLocaleString()} rows</strong></div>${Object.entries(d.class_counts).map(([k, v]) => `<div class="factor-label" style="margin-top:8px"><span>${esc(nice(k))}</span><strong>${v.toLocaleString()}</strong></div><div class="factor-track"><div class="factor-fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div>`).join("")}</div>`;
      }).join("");
      $("#bananaModelName").textContent = `${model.model.split("(")[0]} on the ${model.dataset.replace("University of Bath ", "")} subset`;
      const pct = v => (v * 100).toFixed(1) + " %";
      $("#bananaMetrics").innerHTML = [
        ["Test accuracy", pct(model.accuracy)], ["Balanced accuracy", pct(model.balanced_accuracy)],
        ["Training rows", model.train_rows.toLocaleString()], ["Test rows", model.test_rows.toLocaleString()],
        ["Tree depth", model.tree_depth], ["Leaves", model.leaf_count], ["Input features", model.features.join(", ")]
      ].map(([a, b]) => `<div><span>${a}</span><strong>${esc(b)}</strong></div>`).join("");
      const m = model.confusion_matrix_labels_1_to_5, names = STAGE_INFO.map(x => nice(x[0]));
      const rowMax = m.map(r => r.reduce((x, y) => x + y, 0));
      $("#bananaConfusion").innerHTML = `<div class="cm-cell cm-head">True \\ Predicted</div>${names.map(n => `<div class="cm-cell cm-head">${esc(n)}</div>`).join("")}` +
        m.map((row, i) => `<div class="cm-cell cm-head">${esc(names[i])}</div>${row.map((v, j) => { const f = rowMax[i] ? v / rowMax[i] : 0; const bg = i === j ? `rgba(55,214,189,${.08 + f * .35})` : `rgba(239,120,130,${f * .5})`; return `<div class="cm-cell" style="background:${bg}">${v.toLocaleString()}<small>${(f * 100).toFixed(0)} %</small></div>`; }).join("")}`).join("");
      $("#bananaNote").textContent = model.evaluation_note;
    } catch (error) {
      console.warn("[AeroFresh] Banana dataset reports could not be loaded", error);
      root.innerHTML = '<div class="anomaly-stat"><span>Dataset reports</span><strong>—</strong><small>Could not load the report files</small></div>';
    }
    $("#bananaStages").innerHTML = STAGE_INFO.map(([k, d], i) => `<div><span class="method-number">0${i + 1}</span><strong style="text-transform:capitalize">${esc(k.replace("_", " "))}</strong><p>${esc(d)}</p></div>`).join("");
    if (window.lucide) lucide.createIcons();
  }
  function debounce(fn,wait){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait);};}

  document.addEventListener("DOMContentLoaded", initialize);
  // Expose only a narrow integration surface for future testing / backend adapters.
  window.AeroFresh = { calculateEnvironmentalRisk, handleIncomingReading, getState: () => ({ mode: state.mode, latest: { ...state.latest }, historyLength: state.history.length }) };
})();
