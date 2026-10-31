/* AeroFresh frontend prototype.
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
      brokerUrl: "",
      topic: "aerofresh/telemetry",
      deviceId: "",
      username: "",
      password: "",
      reconnectPeriodMs: 3000,
      staleTimeoutMs: 90000
    },
    demoLatest: { temperature: 28.4, humidity: 61.2, gas_adc: 1240, dust_raw: null, aqi: null, tvoc: null, eco2: null },
    demoSeed: 42
  };

  const SENSOR_META = {
    temperature: { label: "Temperature", unit: "°C", sensor: "DHT22", icon: "thermometer", iconClass: "temperature", color: "#53d5bd", min: 20, max: 34 },
    humidity: { label: "Relative humidity", unit: "%", sensor: "DHT22", icon: "droplets", iconClass: "humidity", color: "#50c8e8", min: 35, max: 85 },
    gas_adc: { label: "MQ-135 gas response", unit: "ADC", sensor: "MQ-135", icon: "wind", iconClass: "gas", color: "#a995ed", min: 500, max: 1800 },
    dust_raw: { label: "Particulate sensor output", unit: "ADC", sensor: "GP2Y1014", icon: "cloud-fog", iconClass: "particle", color: "#e6bd7e", min: 0, max: 4095 },
    aqi: { label: "ENS160 air-quality index", unit: "AQI", sensor: "ENS160", icon: "gauge", iconClass: "aqi", color: "#ef9b76", min: 0, max: 5 },
    tvoc: { label: "ENS160 TVOC", unit: "ppb", sensor: "ENS160", icon: "flask-conical", iconClass: "tvoc", color: "#d49be8", min: 0, max: 65000 },
    eco2: { label: "ENS160 eCO₂ estimate", unit: "ppm", sensor: "ENS160", icon: "cloud", iconClass: "eco2", color: "#8fc7ed", min: 400, max: 65000 }
  };

  const state = { mode: "demo", connection: "demo", latest: { ...DEMO_CONFIG.demoLatest }, history: [], alerts: [], charts: {}, range: "1h", lastUpdated: new Date(), mqttClient: null, refreshTimer: null, lastLiveUpdate: null, mqttConfig: { ...DEMO_CONFIG.mqtt } };
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const fmtTime = d => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
  const fmtDateTime = d => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  // Deterministic synthetic sample history. Replace with persisted/API history when available.
  function seededRandom(seed) {
    let x = seed >>> 0;
    return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  }
  function generateDemoHistory() {
    const rand = seededRandom(DEMO_CONFIG.demoSeed);
    const points = [];
    const now = Date.now();
    for (let i = 287; i >= 0; i--) {
      const t = new Date(now - i * 5 * 60 * 1000);
      const phase = (287 - i) / 287 * Math.PI * 4;
      const temperature = 27.1 + Math.sin(phase) * 1.25 + (rand() - .5) * 1.1 + (i < 28 ? .7 : 0);
      const humidity = 58 + Math.cos(phase * .8) * 5.4 + (rand() - .5) * 5 + (i < 45 ? 4 : 0);
      const gas = 1040 + Math.sin(phase * 1.2) * 130 + (rand() - .5) * 170 + (i < 30 ? 180 : 0);
      points.push({ timestamp: t, temperature: +temperature.toFixed(1), humidity: +clamp(humidity, 35, 85).toFixed(1), gas_adc: Math.round(clamp(gas, 500, 1800)) });
    }
    // Keep the final sample aligned with the visible demo configuration.
    Object.assign(points[points.length - 1], DEMO_CONFIG.demoLatest);
    return points;
  }

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

  // Demo alert objects are replaceable by backend-generated alert records.
  function buildDemoAlerts(history) {
    const now = Date.now();
    return [
      { id: "a1", severity: "high", title: "Sudden temperature rise", description: "Illustrative temperature trend moved above the prototype reference band.", timestamp: new Date(now - 8 * 60000), source: "SIMULATED" },
      { id: "a2", severity: "medium", title: "Persistent high humidity", description: "Sample humidity remained elevated across several generated readings.", timestamp: new Date(now - 31 * 60000), source: "SIMULATED" },
      { id: "a3", severity: "medium", title: "Unusual gas-response variation", description: "MQ-135 raw ADC sample varied from its recent synthetic baseline.", timestamp: new Date(now - 74 * 60000), source: "SIMULATED" },
      { id: "a4", severity: "low", title: "Particulate sensor unavailable", description: "GP2Y1014 is planned and is not installed in this prototype.", timestamp: new Date(now - 3 * 3600000), source: "SYSTEM DEMO" },
      { id: "a5", severity: "low", title: "Device offline state", description: "The dashboard remains in local demo mode; no ESP32 session is active.", timestamp: new Date(now - 5 * 3600000), source: "SYSTEM DEMO" }
    ];
  }

  function initialize() {
    state.history = generateDemoHistory();
    state.latest = { ...state.history[state.history.length - 1] };
    state.alerts = buildDemoAlerts(state.history);
    state.lastUpdated = new Date();
    renderAll();
    initNavigation();
    initChat();
    initRangeControls();
    initMqttAdapter();
    startDemoRefresh();
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(checkLiveStaleness, 5000);
    $("#refreshBtn").addEventListener("click", refreshDemo);
    $("#alertFilter").addEventListener("change", renderAllAlerts);
    $("#clearChat").addEventListener("click", clearChat);
    window.addEventListener("resize", debounce(() => Object.values(state.charts).forEach(c => c.resize()), 120));
  }

  function renderAll() {
    if ($("#lastUpdated")) $("#lastUpdated").textContent = fmtTime(state.lastUpdated);
    renderSensorCards("#sensorCards");
    renderSensorCards("#monitorSensorCards");
    renderRisk();
    renderAlerts();
    renderCharts();
    renderCorrelation();
    renderAnomalySummary();
    renderAllAlerts();
    renderConnectionState();
    if (window.lucide) lucide.createIcons();
  }

  function renderSensorCards(selector) {
    const root = $(selector);
    if (!root) return;
    root.innerHTML = Object.entries(SENSOR_META).map(([key, meta]) => {
      const value = state.latest[key];
      const missing = value == null;
      const display = missing ? "—" : (["gas_adc", "dust_raw", "aqi", "tvoc", "eco2"].includes(key) ? Math.round(value).toLocaleString() : Number(value).toFixed(1));
      const trend = getTrend(key);
      return `<article class="sensor-card">
        <div class="sensor-card-top"><span class="sensor-icon ${meta.iconClass}"><i data-lucide="${meta.icon}"></i></span><span class="sensor-state"><b class="status-dot ${state.mode === "mqtt" ? "live-dot" : "demo-dot"}"></b>${missing ? "UNAVAILABLE" : state.mode === "mqtt" ? "LIVE DATA" : "DEMO DATA"}</span></div>
        <div class="sensor-name">${meta.label}</div><div class="sensor-value">${display} <small>${meta.unit}</small></div>
        <div class="sensor-foot"><span>${meta.sensor} · ${missing ? "No signal" : trend.label}</span><span class="${trend.className}">${trend.symbol}</span></div>
        <div class="sensor-foot" style="border:0;margin-top:0;padding-top:5px"><span>Last updated</span><span>${fmtTime(state.lastUpdated)}</span></div>
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
    const threshold = key === "gas_adc" ? 25 : .25;
    if (Math.abs(delta) < threshold) return { label: "Stable", symbol: "→", className: "trend-neutral" };
    return delta > 0 ? { label: "Trending up", symbol: "↗", className: "trend-up" } : { label: "Trending down", symbol: "↘", className: "trend-down" };
  }

  function riskCategory(score) {
    if (score < 30) return { label: "Low", color: "#71d69b", headline: "Lower signal activity", text: "The current synthetic inputs produce a lower experimental environmental indicator. This does not establish food quality or safety." };
    if (score < 60) return { label: "Moderate", color: "#e7c16e", headline: "Some conditions merit attention", text: "One or more demo signals are outside the illustrative reference bands. Review trends and validate thresholds with real measurements." };
    if (score < 80) return { label: "High", color: "#ed9a69", headline: "Elevated environmental signals", text: "Several generated signals contribute to an elevated prototype score. This is an engineering prompt for investigation, not a spoilage prediction." };
    return { label: "Very High", color: "#ef7882", headline: "Multiple unusual signals", text: "The illustrative score is very high. Check sensor calibration, storage conditions and data quality; do not use this score as a food-safety decision." };
  }

  function renderRisk() {
    const result = calculateEnvironmentalRisk(state.latest, state.history);
    const category = riskCategory(result.score);
    ["#overviewGauge", "#detailGauge"].forEach(sel => { const el = $(sel); if (el) { el.style.setProperty("--score", result.score); el.style.setProperty("--gauge-color", category.color); } });
    ["#overviewRiskScore", "#detailRiskScore"].forEach(sel => { if ($(sel)) $(sel).textContent = result.score; });
    ["#overviewRiskLabel", "#detailRiskLabel"].forEach(sel => { if ($(sel)) $(sel).textContent = category.label; });
    $("#riskSummaryLabel").textContent = `${category.label} · prototype signal`;
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
    $("#anomalySummary").innerHTML = `<div class="anomaly-stat"><span>High severity</span><strong style="color:var(--red)">${counts[0]}</strong><small>Illustrative alerts</small></div><div class="anomaly-stat"><span>Medium severity</span><strong style="color:var(--amber)">${counts[1]}</strong><small>Illustrative alerts</small></div><div class="anomaly-stat"><span>Low severity</span><strong style="color:var(--cyan)">${counts[2]}</strong><small>System / demo events</small></div>`;
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
    const count = { "1h": 12, "6h": 72, "24h": 288, "7d": 288 }[range] || 12;
    let slice = all.slice(-count);
    if (range === "7d") {
      // Expand the 14-hour synthetic seed into a visually honest demo window by sampling with repeated daily labels.
      slice = Array.from({ length: 56 }, (_, i) => {
        const src = all[Math.floor(i / 56 * all.length)];
        return { ...src, timestamp: new Date(Date.now() - (55 - i) * 3 * 3600000) };
      });
    }
    return slice;
  }
  function renderCharts() {
    if (!window.Chart) return;
    const rows = getRangeHistory(state.range);
    const labels = rows.map(p => fmtTime(p.timestamp));
    const chartIds = ["combinedChart", "temperatureChart", "humidityChart", "gasChart", "historyTempChart", "historyHumidityChart", "historyGasChart", "historyCombinedChart"];
    chartIds.forEach(id => { if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; } });
    const combined = $("#combinedChart");
    if (combined) {
      const ctx = combined.getContext("2d");
      chartFor("combinedChart", { type: "line", data: { labels, datasets: [
        makeDataset("Temperature °C", rows.map(p => p.temperature), "#53d5bd", ctx),
        makeDataset("Humidity %", rows.map(p => p.humidity), "#50c8e8", ctx),
        makeDataset("Gas response ADC", rows.map(p => p.gas_adc / 30), "#a995ed", ctx)
      ] }, options: chartBaseOptions("Scaled signal · gas ADC ÷ 30") });
      state.charts.combinedChart.options.plugins.legend.display = true;
      state.charts.combinedChart.options.plugins.legend.labels = { color: "#91a9b8", boxWidth: 7, boxHeight: 7, usePointStyle: true, font: { size: 9 } };
      state.charts.combinedChart.update();
    }
    const defs = [
      ["temperatureChart", "Temperature °C", "temperature", "#53d5bd"],
      ["humidityChart", "Humidity %", "humidity", "#50c8e8"],
      ["gasChart", "Gas response ADC", "gas_adc", "#a995ed"],
      ["historyTempChart", "Temperature °C", "temperature", "#53d5bd"],
      ["historyHumidityChart", "Humidity %", "humidity", "#50c8e8"],
      ["historyGasChart", "Gas response ADC", "gas_adc", "#a995ed"]
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
        makeDataset("Gas-response index", norm("gas_adc", 400, 1900), "#a995ed", ctx)
      ] }, options: chartBaseOptions("Normalized index (0–100)", true) });
      state.charts.historyCombinedChart.options.plugins.legend.display = true;
      state.charts.historyCombinedChart.options.plugins.legend.labels = { color: "#91a9b8", boxWidth: 7, boxHeight: 7, usePointStyle: true, font: { size: 9 } };
      state.charts.historyCombinedChart.update();
    }
  }

  function pearson(a, b) {
    const n = Math.min(a.length, b.length); if (n < 2) return 0;
    const aa = a.slice(0, n), bb = b.slice(0, n);
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
  function refreshDemo() {
    if (state.mode !== "demo") { showToast("Refresh is disabled in hardware mode."); return; }
    const last = state.history[state.history.length - 1];
    const rand = Math.random;
    const next = {
      timestamp: new Date(),
      temperature: +clamp(last.temperature + (rand() - .47) * .65, 22, 34).toFixed(1),
      humidity: +clamp(last.humidity + (rand() - .48) * 2.2, 40, 82).toFixed(1),
      gas_adc: Math.round(clamp(last.gas_adc + (rand() - .48) * 95, 650, 1700))
    };
    state.history.push(next);
    if (state.history.length > 240) state.history.shift();
    state.latest = { ...next, dust_raw: null, aqi: null, tvoc: null, eco2: null };
    state.lastUpdated = new Date();
    $("#lastUpdated").textContent = fmtTime(state.lastUpdated);
    renderAll();
    showToast("Demo sample refreshed · no hardware data received");
  }
  function startDemoRefresh() {
    state.refreshTimer = setInterval(() => {
      if (state.mode === "demo") refreshDemoQuietly();
    }, DEMO_CONFIG.refreshIntervalMs);
  }
  function refreshDemoQuietly() {
    const last = state.history[state.history.length - 1], rand = Math.random;
    const next = { timestamp: new Date(), temperature: +clamp(last.temperature + (rand()-.5)*.25,22,34).toFixed(1), humidity: +clamp(last.humidity + (rand()-.5)*.8,40,82).toFixed(1), gas_adc: Math.round(clamp(last.gas_adc+(rand()-.5)*35,650,1700)) };
    state.history.push(next); if(state.history.length>240)state.history.shift();
    state.latest={...next,dust_raw:null,aqi:null,tvoc:null,eco2:null};state.lastUpdated=new Date();
    $("#lastUpdated").textContent=fmtTime(state.lastUpdated);
    renderSensorCards("#sensorCards");renderSensorCards("#monitorSensorCards");renderRisk();renderCharts();renderCorrelation();
  }
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
    div.innerHTML=`<div class="message-avatar"><i data-lucide="${icon}"></i></div><div class="message-body"><p>${esc(text).replace(/\n/g,"<br>")}</p><small>${role==="user"?"You":"Local demo response"} · ${fmtTime(new Date())}</small></div>`;
    root.appendChild(div);root.scrollTop=root.scrollHeight;if(window.lucide)lucide.createIcons();
  }
  function answerQuestion(question) {
    const q=question.toLowerCase(), h=state.history, latest=state.latest;
    const maxTemp=Math.max(...h.map(p=>p.temperature)), maxHum=Math.max(...h.map(p=>p.humidity)), maxGas=Math.max(...h.map(p=>p.gas_adc));
    if(q.includes("maximum")&&q.includes("temperature"))return `The maximum temperature in the currently retained synthetic sample is ${maxTemp.toFixed(1)} °C. This is generated demo history, not a measured daily maximum.`;
    if(q.includes("humidity")&&(q.includes("increase")||q.includes("when")||q.includes("rise"))){const first=h.findIndex((p,i)=>i>0&&p.humidity-h[i-1].humidity>1.2);return first>=0?`A noticeable upward step appears around ${fmtDateTime(h[first].timestamp)} in the synthetic sample. Current humidity is ${latest.humidity.toFixed(1)}%.`:`No single sharp humidity increase was found in the current demo sample. Current humidity is ${latest.humidity.toFixed(1)}%.`;}
    if(q.includes("gas")||q.includes("adc"))return `The latest MQ-135 demo response is ${latest.gas_adc} raw ADC units. The retained sample maximum is ${maxGas} ADC. Raw ADC is a sensor response, not a calibrated gas concentration.`;
    if(q.includes("risk")||q.includes("indicator")){const r=calculateEnvironmentalRisk(latest,h),c=riskCategory(r.score);return `The prototype indicator is ${r.score}/100 (${c.label}). It combines illustrative temperature deviation, humidity deviation, gas-response variation and persistence weights. It is not a spoilage probability or food-safety measurement.`;}
    if(q.includes("unusual")||q.includes("sensor")||q.includes("alert"))return `The demo alert list contains ${state.alerts.length} simulated/system events. Examples include a temperature rise, persistent high humidity, gas-response variation, the uninstalled particulate sensor and the inactive device state. No physical sensor has generated these events.`;
    if(q.includes("humidity"))return `Latest demo humidity is ${latest.humidity.toFixed(1)}%. The highest value in the retained synthetic sample is ${maxHum.toFixed(1)}%.`;
    if(q.includes("temperature")||q.includes("warm"))return `Latest demo temperature is ${latest.temperature.toFixed(1)} °C. The highest value in the retained synthetic sample is ${maxTemp.toFixed(1)} °C.`;
    return "I can answer questions about temperature, humidity, gas ADC, sample maxima, trend changes, simulated alerts and the prototype risk indicator. Try one of the suggested prompts. Remember: this assistant uses local demo data only.";
  }
  function clearChat(){ $("#chatMessages").innerHTML=`<div class="message assistant-message"><div class="message-avatar"><i data-lucide="sparkles"></i></div><div class="message-body"><p>Conversation cleared. Ask me about the AeroFresh demo dataset.</p><small>Local demo response · just now</small></div></div>`;if(window.lucide)lucide.createIcons(); }

  function setConnection(connection, message) {
    state.connection = connection;
    if (connection !== "connected") state.mode = "demo";
    renderConnectionState(message);
  }
  function renderConnectionState(message) {
    const connected = state.connection === "connected" && state.mode === "mqtt";
    const label = connected ? "LIVE MQTT" : state.connection === "connecting" ? "CONNECTING" : "DEMO MODE";
    const modeLabel = $("#modeLabel");
    if (modeLabel) modeLabel.textContent = label;
    const pill = $("#modePill");
    if (pill) pill.classList.toggle("live-mode-pill", connected);
    const notice = $("#connectionNotice");
    if (notice) {
      const title = notice.querySelector("strong");
      const detail = notice.querySelector("span");
      title.textContent = connected ? "Live MQTT connection established." : state.connection === "error" ? "MQTT connection error." : "Hardware is not connected.";
      detail.textContent = message || (connected ? `Receiving validated readings for ${state.mqttConfig.deviceId}.` : "These values are generated locally for demonstration. Configure MQTT in System Information to receive validated ESP32 readings.");
    }
    const status = $("#mqttState");
    if (status) status.textContent = connected ? "Connected" : state.connection === "connecting" ? "Connecting" : state.connection === "error" ? "Error" : "Not connected";
    const summary = $("#mqttConnectionSummary");
    if (summary) summary.textContent = connected ? "Connected · live readings active" : state.connection === "error" ? "Error · check configuration and broker logs" : "Demo mode · not connected";
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
      try { state.mqttConfig = { ...state.mqttConfig, ...JSON.parse(saved) }; } catch (error) { console.warn("[AeroFresh] Ignored invalid saved MQTT settings", error); }
    }
    populateMqttForm();
    $("#mqttForm")?.addEventListener("submit", event => { event.preventDefault(); connectMqtt(readMqttForm()); });
    $("#mqttDisconnect")?.addEventListener("click", disconnectMqtt);
    if ($("#mqttBrokerSummary")) $("#mqttBrokerSummary").textContent = state.mqttConfig.brokerUrl || "Not configured";
    if (state.mqttConfig.enabled && state.mqttConfig.brokerUrl) connectMqtt(state.mqttConfig);
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
    if ($("#mqttRemember")?.checked) localStorage.setItem("aerofresh-mqtt-config", JSON.stringify(state.mqttConfig));
    if ($("#mqttBrokerSummary")) $("#mqttBrokerSummary").textContent = config.brokerUrl;
    if ($("#mqttTopicSummary")) $("#mqttTopicSummary").textContent = config.topic;
    setConnection("connecting", "Connecting securely to the configured MQTT broker.");
    try {
      const client = window.mqtt.connect(config.brokerUrl, { username: config.username || undefined, password: config.password || undefined, reconnectPeriod: config.reconnectPeriodMs, connectTimeout: 10000, clean: true });
      state.mqttClient = client;
      client.on("connect", () => client.subscribe(config.topic, { qos: 0 }, error => {
        if (error) { console.error("[AeroFresh] MQTT subscribe failed", error); setConnection("error", "Connected, but subscription was refused. Check topic permissions."); return; }
        state.mode = "mqtt"; setConnection("connected"); showToast("MQTT connected · live mode active");
      }));
      client.on("message", (topic, payload) => {
        if (topic !== config.topic) return;
        try { handleIncomingReading(JSON.parse(payload.toString())); } catch (error) { console.warn("[AeroFresh] Invalid MQTT JSON message", error); showToast("Ignored malformed MQTT JSON"); }
      });
      client.on("reconnect", () => setConnection("connecting", "MQTT connection interrupted; retrying securely."));
      client.on("offline", () => setConnection("offline", "MQTT is offline; data is marked stale until a valid reading arrives."));
      client.on("error", error => { console.error("[AeroFresh] MQTT error", error); setConnection("error", "MQTT reported an error. Verify WSS, credentials and topic permissions."); });
      client.on("close", () => setConnection("offline", "MQTT connection closed; switch to demo or reconnect."));
    } catch (error) { console.error("[AeroFresh] MQTT connection setup failed", error); setConnection("error", "MQTT connection could not be started."); }
  }
  function disconnectMqtt(showMessage = true) {
    if (state.mqttClient) { state.mqttClient.end(true); state.mqttClient = null; }
    state.mqttConfig.enabled = false;
    setConnection("demo", "Live connection stopped. Demo readings are active.");
    if (showMessage) showToast("MQTT disconnected · demo mode active");
  }
  function checkLiveStaleness() {
    if (state.connection === "connected" && state.lastLiveUpdate && Date.now() - state.lastLiveUpdate > state.mqttConfig.staleTimeoutMs) {
      state.mode = "demo";
      setConnection("stale", "No valid reading arrived within the configured timeout; live data is stale.");
    }
  }
  function validateOptional(payload, key, min, max) {
    if (payload[key] == null) return null;
    const value = Number(payload[key]);
    return Number.isFinite(value) && value >= min && value <= max ? value : undefined;
  }
  function handleIncomingReading(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return console.warn("[AeroFresh] Ignored non-object telemetry");
    const cfg = state.mqttConfig;
    if (payload.device_id !== cfg.deviceId) return console.warn("[AeroFresh] Ignored telemetry for another device");
    const required = { temperature: [-40, 85], humidity: [0, 100], gas_adc: [0, 4095] };
    const values = {};
    for (const [key, [min, max]] of Object.entries(required)) {
      const value = Number(payload[key]);
      if (!Number.isFinite(value) || value < min || value > max) { console.warn(`[AeroFresh] Ignored invalid required field: ${key}`); return; }
      values[key] = value;
    }
    const timestamp = new Date(payload.timestamp);
    if (!payload.timestamp || Number.isNaN(timestamp.getTime())) return console.warn("[AeroFresh] Ignored telemetry with invalid timestamp");
    for (const [key, range] of Object.entries({ dust_raw: [0, 4095], aqi: [0, 5], tvoc: [0, 65000], eco2: [400, 65000] })) {
      const value = validateOptional(payload, key, ...range);
      if (value === undefined) { console.warn(`[AeroFresh] Ignored invalid optional field: ${key}`); return; }
      values[key] = value;
    }
    const reading = { timestamp, ...values };
    state.history.push(reading); if (state.history.length > 1000) state.history.shift();
    state.latest = { ...reading }; state.lastUpdated = new Date(); state.lastLiveUpdate = Date.now(); state.mode = "mqtt"; setConnection("connected"); renderAll();
  }
  function debounce(fn,wait){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait);};}

  document.addEventListener("DOMContentLoaded", initialize);
  // Expose only a narrow integration surface for future testing / backend adapters.
  window.AeroFresh = { calculateEnvironmentalRisk, handleIncomingReading, getState: () => ({ mode: state.mode, latest: { ...state.latest }, historyLength: state.history.length }) };
})();
