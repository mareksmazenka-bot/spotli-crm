/* =============================================================
   Spotli App v3
   Tri časti v jednej appke: CRM (klienti, denník práce, prehľady,
   plánovanie), Faktúry a Cenové ponuky.

   Tento súbor: jadro (dáta, synchronizácia, PIN, smerovanie) a CRM.
   Faktúry a ponuky: js/invoices.js.

   Dáta: localStorage v prehliadači + voliteľne súkromné GitHub repo.
   ============================================================= */
"use strict";

/* ===================== KONŠTANTY ===================== */

const SERVICE_TYPES = {
  "lokalne-seo": "Lokálne SEO",
  "gbp": "Google Business Profil",
  "linkedin": "Správa LinkedIn profilu",
  "sprava-webu": "Správa webu",
  "tvorba-app": "Tvorba webovej aplikácie",
  "jednorazove-seo": "Jednorazové SEO",
  "ine": "Iné"
};

const SERVICE_STATUS = { aktivna: "Aktívna", pozastavena: "Pozastavená", dokoncena: "Dokončená" };

const TASK_COLS = [
  { id: "planned", label: "Naplánované" },
  { id: "inprogress", label: "Rozbehnuté" },
  { id: "done", label: "Hotové" }
];

const MONTHS = ["Január", "Február", "Marec", "Apríl", "Máj", "Jún", "Júl", "August", "September", "Október", "November", "December"];
const MONTHS_GEN = ["januára", "februára", "marca", "apríla", "mája", "júna", "júla", "augusta", "septembra", "októbra", "novembra", "decembra"];
const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "máj", "jún", "júl", "aug", "sep", "okt", "nov", "dec"];

const KEYS = {
  data: "spotli_crm_data_v2",
  meta: "spotli_crm_meta_v2",
  settings: "spotli_crm_settings_v2",
  prefs: "spotli_crm_prefs_v2",
  pin: "spotli_crm_pin_hash",
  unlocked: "spotli_crm_unlocked",
  v1data: "spotli_crm_data_v1",
  v1settings: "spotli_crm_settings_v1"
};

/* PIN sa neukladá ako text, ale ako SHA-256 odtlačok (soľ + PIN).
   Samotný PIN v kóde nie je. Zmeniť sa dá v Nastaveniach. */
const PIN_SALT = "spotli-crm:";
const DEFAULT_PIN_HASH = "09d6fd859e075965325aef0415a630728f1823aee9f72317be7fc9ed2f00deba";
const AUTO_LOCK_MINUTES = 30;

const SPOTLI_S_PATH = "M154 0 L104 0 L0 82 L0 136 L61 136 Q67 136 67 142 Q67 148 64 151 L0 202 L0 252 L50 252 L154 170 L154 116 L93 116 Q87 116 87 110 Q87 104 90 101 L154 50 Z";

/* ===================== POMOCNÉ FUNKCIE ===================== */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function parseNum(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return NaN;
  return /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}

/* "1,5" | "1.5" | "1:30" → 1.5 */
function parseHours(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d+):([0-5]?\d)$/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  return parseNum(s);
}

const nf0 = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfH = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 2 });

function fmtMoney(n) {
  const v = round2(n);
  return (Number.isInteger(v) ? nf0.format(v) : nf2.format(v)) + " €";
}
function fmtHours(h) { return nfH.format(round2(h)) + " h"; }
function fmtNumInput(n) { return (n === null || n === undefined || n === "") ? "" : String(n).replace(".", ","); }

function pad(n) { return String(n).padStart(2, "0"); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function curMonth() { return todayStr().slice(0, 7); }
function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthIdx(month) { return Number(month.split("-")[1]) - 1; }
function monthLabel(month) { return `${MONTHS[monthIdx(month)]} ${month.slice(0, 4)}`; }
function monthGen(month) { return `${MONTHS_GEN[monthIdx(month)]} ${month.slice(0, 4)}`; }
function lastDayOf(month) { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).getDate(); }
function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${Number(day)}. ${Number(m)}. ${y}`;
}
function fmtDateShort(d) {
  if (!d) return "—";
  const [, m, day] = d.split("-");
  return `${Number(day)}. ${Number(m)}.`;
}
function nowTime() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtStamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} o ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* Kompaktná SHA-256 (bez závislostí, funguje aj pri otvorení súboru lokálne) */
const SHA = (() => {
  const K = [], H = [];
  const isPrime = n => { for (let f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
  const frac = x => ((x - Math.floor(x)) * 0x100000000) >>> 0;
  for (let n = 2, c = 0; c < 64; n++) {
    if (!isPrime(n)) continue;
    if (c < 8) H[c] = frac(Math.pow(n, 1 / 2));
    K[c] = frac(Math.pow(n, 1 / 3));
    c++;
  }
  return { K, H };
})();
function sha256Hex(str) {
  const ror = (x, n) => (x >>> n) | (x << (32 - n));
  const bytes = Array.from(new TextEncoder().encode(str));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
  const h = SHA.H.slice();
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA.K[i] + w[i]) | 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(String(b64 || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* bezpečný prístup k úložisku prehliadača */
function lsGet(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}
function ssGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
function ssSet(key, v) { try { if (v === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, v); } catch (e) { /* nič */ } }

function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ===================== DÁTA ===================== */

/* Údaje dodávateľa (teba) a predvolené hodnoty dokladov. Nie sú v kóde,
   ukladajú sa spolu s ostatnými dátami do súkromného repa. */
function emptyProfile() {
  return {
    name: "", street: "", zip: "", city: "", country: "Slovensko",
    ico: "", dic: "", icdph: "", vatNote: "Neplatiteľ DPH",
    issuedBy: "", bank: "", iban: "", swift: "",
    email: "", phone: "", web: "",
    dueDays: 14, paymentMethod: "Prevodom", defaultUnit: "hod.", defaultNote: "",
    invoicePrefix: "M", invoiceStart: 53, quotePrefix: "CP", quoteStart: 1,
    numberingYear: new Date().getFullYear(),
    quoteValidDays: 30, quoteNote: "Cenová ponuka nie je daňový doklad.", signature: ""
  };
}

function emptyData() {
  return {
    version: 3, clients: [], services: [], logs: [], tasks: [], billed: {},
    invoices: [], quotes: [], profile: emptyProfile(), updatedAt: null
  };
}

function normalizeData(raw) {
  if (!raw || typeof raw !== "object") return emptyData();
  if (raw.version >= 2) {
    const d = Object.assign(emptyData(), raw);
    ["clients", "services", "logs", "tasks", "invoices", "quotes"].forEach(k => { if (!Array.isArray(d[k])) d[k] = []; });
    if (!d.billed || typeof d.billed !== "object" || Array.isArray(d.billed)) d.billed = {};
    d.profile = Object.assign(emptyProfile(), (raw.profile && typeof raw.profile === "object") ? raw.profile : {});
    d.version = 3;
    return d;
  }
  return migrateV1(raw);
}

/* prevod dát z prvej verzie appky */
function migrateV1(v1) {
  const d = emptyData();
  const jobs = Array.isArray(v1.jobs) ? v1.jobs : [];
  (v1.clients || []).forEach(c => d.clients.push({
    id: c.id || uid(), name: c.name || "Bez názvu", contact: c.contact || "", note: c.note || "", archived: false
  }));
  jobs.forEach(j => d.services.push({
    id: j.id || uid(), clientId: j.clientId,
    type: SERVICE_TYPES[j.service] ? j.service : "ine",
    pricing: j.pricing === "pevna" ? "dielo" : "hodina",
    rate: Number(j.rate) || 0, price: Number(j.fixedPrice) || 0,
    status: j.status === "ukoncena" ? "dokoncena" : (j.status === "pozastavena" ? "pozastavena" : "aktivna"),
    doneDate: null, note: j.note || ""
  }));
  (v1.logs || []).forEach(l => {
    const job = jobs.find(j => j.id === l.jobId);
    let rate = null;
    if (job && job.pricing === "hodinovka") rate = Number(job.rate) || 0;
    else if (l.amount && l.hours) rate = round2(l.amount / l.hours);
    d.logs.push({
      id: l.id || uid(), date: l.date, clientId: l.clientId, serviceId: l.jobId || null,
      hours: Number(l.hours) || 0, rate, description: l.description || ""
    });
  });
  (v1.tasks || []).forEach(t => d.tasks.push({
    id: t.id || uid(), title: t.title || "Úloha", clientId: t.clientId || null, note: t.description || "",
    dueDate: t.dueDate || null, status: ["planned", "inprogress", "done"].includes(t.status) ? t.status : "planned"
  }));
  return d;
}

function isEmptyData(d) {
  return !d.clients.length && !d.services.length && !d.logs.length && !d.tasks.length &&
    !d.invoices.length && !d.quotes.length && !(d.profile && (d.profile.name || d.profile.iban));
}
function contentKey(d) {
  return JSON.stringify([d.clients, d.services, d.logs, d.tasks, d.billed, d.invoices, d.quotes, d.profile]);
}

let data = emptyData();
let meta = { rev: 0, dirty: false, sha: null, lastSync: null, lastError: null };
let settings = { token: "", owner: "", repo: "spotli-crm-data", branch: "main", path: "data.json" };
let prefs = { lastClientId: null, lastServiceByClient: {} };

function loadAll() {
  const v2 = lsGet(KEYS.data, null);
  if (v2) {
    data = normalizeData(v2);
  } else {
    const v1 = lsGet(KEYS.v1data, null);
    if (v1) { data = normalizeData(v1); meta.dirty = !isEmptyData(data); lsSet(KEYS.data, data); }
  }
  meta = Object.assign(meta, lsGet(KEYS.meta, {}));
  const s2 = lsGet(KEYS.settings, null);
  if (s2) settings = Object.assign(settings, s2);
  else {
    const s1 = lsGet(KEYS.v1settings, null);
    if (s1 && s1.token) settings = Object.assign(settings, { token: s1.token, owner: s1.owner || "", repo: s1.repo || "", branch: s1.branch || "main", path: s1.path || "data.json" });
  }
  prefs = Object.assign(prefs, lsGet(KEYS.prefs, {}));
}
function saveData() { lsSet(KEYS.data, data); }
function saveMeta() { lsSet(KEYS.meta, meta); }
function saveSettings() { lsSet(KEYS.settings, settings); }
function savePrefs() { lsSet(KEYS.prefs, prefs); }

/* Každá zmena dát ide cez commit: uloží lokálne, prekreslí a naplánuje sync. */
function commit(msg, toastOpts) {
  data.updatedAt = new Date().toISOString();
  meta.rev = (meta.rev || 0) + 1;
  meta.dirty = true;
  saveData();
  saveMeta();
  render();
  updateSyncBadge();
  schedulePush();
  if (msg) toast(msg, toastOpts);
}

function withUndo(msg, mutate) {
  const snapshot = clone(data);
  mutate();
  commit(msg, { action: "Späť", onAction: () => { data = snapshot; commit("Vrátené späť"); } });
}

/* ===================== VÝPOČTY ===================== */

const clientById = id => data.clients.find(c => c.id === id) || null;
const serviceById = id => data.services.find(s => s.id === id) || null;
const servicesOf = clientId => data.services.filter(s => s.clientId === clientId);
const clientName = id => { const c = clientById(id); return c ? c.name : "Neznámy klient"; };
const serviceLabel = s => s ? (SERVICE_TYPES[s.type] || "Iné") : "Bez služby";

function priceLabel(s) {
  return s.pricing === "dielo" ? `${fmtMoney(s.price)} za dielo` : `${fmtMoney(s.rate)}/h`;
}

/* suma záznamu = hodiny × sadzba platná v čase zápisu (pri práci za dielo 0) */
function logAmount(l) {
  return (l.rate !== null && l.rate !== undefined) ? round2((Number(l.hours) || 0) * Number(l.rate)) : 0;
}

/* zákazky za dielo sa započítajú do mesiaca, v ktorom boli dokončené */
function doneInMonth(s, month) {
  return s.pricing === "dielo" && s.status === "dokoncena" && s.doneDate && s.doneDate.slice(0, 7) === month;
}

function monthSummary(month) {
  const perClient = new Map();
  const perType = {};
  let hours = 0, amount = 0, hourlyHours = 0, hourlyAmount = 0;
  const pc = id => {
    if (!perClient.has(id)) perClient.set(id, { hours: 0, amount: 0, logs: [], done: [] });
    return perClient.get(id);
  };
  const pt = t => (perType[t] = perType[t] || { hours: 0, amount: 0 });

  data.logs.forEach(l => {
    if (!l.date || l.date.slice(0, 7) !== month) return;
    const h = Number(l.hours) || 0, a = logAmount(l);
    const c = pc(l.clientId);
    c.hours += h; c.amount += a; c.logs.push(l);
    hours += h; amount += a;
    if (l.rate !== null && l.rate !== undefined) { hourlyHours += h; hourlyAmount += a; }
    const s = serviceById(l.serviceId);
    const t = pt(s ? s.type : "ine");
    t.hours += h; t.amount += a;
  });
  data.services.forEach(s => {
    if (!doneInMonth(s, month)) return;
    const p = Number(s.price) || 0;
    const c = pc(s.clientId);
    c.amount += p; c.done.push(s);
    amount += p;
    pt(s.type).amount += p;
  });
  return { month, hours, amount: round2(amount), hourlyHours, hourlyAmount: round2(hourlyAmount), perClient, perType };
}

function clientMonth(clientId, month) {
  return monthSummary(month).perClient.get(clientId) || { hours: 0, amount: 0, logs: [], done: [] };
}

function clientAllTime(clientId) {
  let hours = 0, amount = 0;
  data.logs.forEach(l => { if (l.clientId === clientId) { hours += Number(l.hours) || 0; amount += logAmount(l); } });
  data.services.forEach(s => {
    if (s.clientId === clientId && s.pricing === "dielo" && s.status === "dokoncena" && s.doneDate) amount += Number(s.price) || 0;
  });
  return { hours, amount: round2(amount) };
}

function serviceHours(serviceId) {
  return data.logs.reduce((sum, l) => sum + (l.serviceId === serviceId ? (Number(l.hours) || 0) : 0), 0);
}

const billedKey = (clientId, month) => `${clientId}|${month}`;
const billedOn = (clientId, month) => data.billed[billedKey(clientId, month)] || null;

/* ===================== UI: STAV, SMEROVANIE, VYKRESLENIE ===================== */

const ui = {
  route: "start", param: null, module: "crm",
  month: curMonth(), logClient: "", showArchived: false,
  year: new Date().getFullYear(), invStatus: "all", quoteStatus: "all",
  settingsTab: "doklady", editing: null
};
let lastRendered = "";
let locked = true;

/* ktorá časť appky patrí ku ktorej adrese */
const ROUTE_MODULE = {
  start: "home",
  prehlad: "crm", klienti: "crm", klient: "crm", dennik: "crm", planovanie: "crm",
  faktury: "faktury", faktura: "faktury",
  ponuky: "ponuky", ponuka: "ponuky",
  nastavenia: null
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/");
  return { route: parts[0] || "start", param: parts[1] ? decodeURIComponent(parts[1]) : null };
}
function go(path) { location.hash = "#/" + path; }

function currentViews() {
  return {
    start: viewHome,
    prehlad: viewDashboard, klienti: viewClients, klient: viewClient,
    dennik: viewLogs, planovanie: viewPlanning,
    faktury: viewInvoices, faktura: viewDocEditor,
    ponuky: viewQuotes, ponuka: viewDocEditor,
    nastavenia: viewSettings
  };
}

function render(force) {
  if (locked) return;
  const views = currentViews();
  const route = views[ui.route] ? ui.route : "start";
  const mod = ROUTE_MODULE[route];
  if (mod && mod !== "home") ui.module = mod;
  const isEditor = route === "faktura" || route === "ponuka";
  const key = route + "/" + (ui.param || "");

  $("#app").classList.toggle("home", route === "start");
  renderSidebar(route);

  // rozpísaný doklad sa pri synchronizácii na pozadí nesmie prekresliť pod rukami
  const edRoot = $("#edRoot");
  if (isEditor && !force && edRoot && edRoot.dataset.key === key && ui.editing) return;
  if (!isEditor) ui.editing = null;

  $("#view").innerHTML = `<div class="page ${isEditor ? "page-wide" : ""}">${views[route]()}</div>`;
  if (key !== lastRendered) { window.scrollTo(0, 0); lastRendered = key; }
  if (isEditor && typeof afterEditorRender === "function") afterEditorRender();
  if (route === "start") updateSyncBadge();
}

/* bočný panel: tri časti appky, CRM sa rozbalí na svoje stránky */
function renderSidebar(route) {
  const m = route === "start" ? null : (ROUTE_MODULE[route] || ui.module);
  const crmPages = [
    ["prehlad", "Prehľad", "layout-dashboard"], ["klienti", "Klienti", "users"],
    ["dennik", "Denník", "notebook-pen"], ["planovanie", "Plánovanie", "square-kanban"]
  ];
  const activeCrm = route === "klient" ? "klienti" : route;
  const nav = `
    <a class="nav-mod ${m === "crm" ? "active" : ""}" href="#/prehlad">${icon("briefcase-business")}CRM</a>
    ${m === "crm" ? `<div class="nav-sub">${crmPages.map(([r, label, ic]) =>
      `<a href="#/${r}" class="${activeCrm === r ? "active" : ""}">${icon(ic, 16)}${label}</a>`).join("")}</div>` : ""}
    <a class="nav-mod ${m === "faktury" ? "active" : ""}" href="#/faktury">${icon("receipt")}Faktúry</a>
    <a class="nav-mod ${m === "ponuky" ? "active" : ""}" href="#/ponuky">${icon("tag")}Cenové ponuky</a>`;
  $("#sideNav").innerHTML = nav;

  const quick = { crm: ["Zapísať prácu", "plus"], faktury: ["Nová faktúra", "plus"], ponuky: ["Nová ponuka", "plus"] }[m || ui.module];
  $("#quickBtn").innerHTML = `${icon(quick[1])} ${quick[0]}${m === "crm" || (!m && ui.module === "crm") ? `<span class="kbd">N</span>` : ""}`;
  $("#navSettings").classList.toggle("active", route === "nastavenia");
}

/* ---------- ROZCESTNÍK ---------- */

function viewHome() {
  const cur = curMonth();
  const sum = monthSummary(cur);
  const overdueTasks = data.tasks.filter(t => t.status !== "done" && t.dueDate && t.dueDate < todayStr()).length;
  const st = typeof invoiceTotals === "function" ? invoiceTotals() : { open: 0, openCount: 0, lateCount: 0 };
  const qs = typeof quoteTotals === "function" ? quoteTotals() : { sent: 0, sentSum: 0, draft: 0 };
  const profileMissing = !(data.profile.name && data.profile.iban);

  const plural = (n, one, few, many) => n === 1 ? one : (n >= 2 && n <= 4 ? few : many);

  const card = (href, iconName, title, desc, statBig, statSmall, foot) => `
    <div class="mod-card">
      <a class="mod-main" href="${href}">
        <span class="mod-ico">${icon(iconName, 26)}</span>
        <h2>${title}</h2>
        <p>${desc}</p>
        <div class="mod-stat"><b>${statBig}</b><span>${statSmall}</span></div>
      </a>
      <div class="mod-foot">${foot}</div>
    </div>`;

  return `
  <div class="home-wrap">
    <header class="home-head">
      <div class="home-brand">
        <svg class="brand-s" viewBox="-3 -3 160 258" aria-hidden="true"><use href="#spotli-s" /></svg>
        <span class="brand-word">Spotli</span><span class="brand-tag">App</span>
      </div>
      <div class="home-tools">
        <button class="sync home-sync js-sync-btn" data-action="sync-now" title="Synchronizovať teraz">
          <span class="sync-dot js-sync-dot"></span><span class="sync-text js-sync-text"></span></button>
        <a class="btn btn-ghost btn-sm" href="#/nastavenia">${icon("settings")} Nastavenia</a>
        <button class="btn btn-ghost btn-sm" data-action="lock">${icon("lock")} Zamknúť</button>
      </div>
    </header>

    <h1 class="home-title">Čo budeš robiť?</h1>
    <div class="mod-grid">
      ${card("#/prehlad", "briefcase-business", "CRM",
        "Klienti, denník práce, mesačné prehľady a plánovanie.",
        fmtMoney(sum.amount),
        `zarobené v mesiaci ${MONTHS[monthIdx(cur)].toLowerCase()} · ${fmtHours(sum.hours)}${overdueTasks ? ` · ${overdueTasks} ${plural(overdueTasks, "úloha", "úlohy", "úloh")} po termíne` : ""}`,
        `<button class="btn btn-teal btn-sm" data-action="new-log">${icon("plus")} Zapísať prácu</button>`)}
      ${card("#/faktury", "receipt", "Faktúry",
        "Vystavovanie faktúr s QR kódom na platbu a prehľad úhrad.",
        fmtMoney(st.open),
        st.openCount ? `čaká na úhradu · ${st.openCount} ${plural(st.openCount, "faktúra", "faktúry", "faktúr")}${st.lateCount ? ` · ${st.lateCount} po splatnosti` : ""}` : "všetko uhradené",
        `<button class="btn btn-teal btn-sm" data-action="new-invoice">${icon("plus")} Nová faktúra</button>`)}
      ${card("#/ponuky", "tag", "Cenové ponuky",
        "Ponuky pre klientov so stavmi a prechodom na zákazku alebo faktúru.",
        String(qs.sent),
        qs.sent ? `${plural(qs.sent, "ponuka čaká", "ponuky čakajú", "ponúk čaká")} na odpoveď · ${fmtMoney(qs.sentSum)}` : "žiadna ponuka nečaká na odpoveď",
        `<button class="btn btn-teal btn-sm" data-action="new-quote">${icon("plus")} Nová ponuka</button>`)}
    </div>
    ${profileMissing ? `<div class="notice info home-note">${icon("triangle-alert")}<span>Na faktúry a ponuky ešte chýbajú tvoje údaje (meno, IBAN). <a href="#/nastavenia">Doplň ich v Nastaveniach</a>, stačí raz.</span></div>` : ""}
  </div>`;
}

function hydrateIcons(root) {
  $$("[data-icon]", root).forEach(el => { el.outerHTML = icon(el.dataset.icon); });
}

function monthSwitch(month, prevAct, nextAct, todayAct) {
  const isCur = month === curMonth();
  return `<div class="month-switch">
    <button type="button" class="icon-btn" data-action="${prevAct}" aria-label="Predchádzajúci mesiac">${icon("chevron-left")}</button>
    <span class="label">${monthLabel(month)}</span>
    <button type="button" class="icon-btn" data-action="${nextAct}" aria-label="Nasledujúci mesiac">${icon("chevron-right")}</button>
    ${isCur || !todayAct ? "" : `<button type="button" class="today" data-action="${todayAct}">Tento mesiac</button>`}
  </div>`;
}
const globalMonthSwitch = () => monthSwitch(ui.month, "month-prev", "month-next", "month-today");

/* faktúra vystavená z CRM pre klienta a mesiac (ak existuje) */
const invoiceOfMonth = (clientId, month) =>
  data.invoices.find(i => i.crm && i.crm.clientId === clientId && i.crm.month === month) || null;

function billedButton(clientId, month, amount) {
  const inv = invoiceOfMonth(clientId, month);
  if (inv) {
    const st = invoiceState(inv);
    const label = st === "paid" ? "uhradená" : st === "late" ? "po splatnosti" : "čaká na úhradu";
    return `<a class="billed-btn on ${st === "late" ? "late" : ""}" href="#/faktura/${encodeURIComponent(inv.id)}" title="Otvoriť faktúru">
      ${icon(st === "paid" ? "circle-check-big" : (st === "late" ? "triangle-alert" : "receipt"))} ${esc(inv.number)} · ${label}</a>`;
  }
  const on = billedOn(clientId, month);
  if (!on && !amount) return `<span class="muted">—</span>`;
  return `<button type="button" class="billed-btn ${on ? "on" : ""}" data-action="toggle-billed" data-client="${esc(clientId)}" data-month="${month}"
    title="${on ? "Vyfakturované " + fmtDate(on) + " – kliknutím zrušíš" : "Označiť ako vyfakturované (bez faktúry v appke)"}">
    ${icon(on ? "circle-check-big" : "receipt")} ${on ? "Vyfakturované" : "Nevyfakturované"}</button>`;
}

/* tlačidlo „Vystaviť faktúru“ ponúkame len tam, kde je čo fakturovať a ešte sa nefakturovalo */
function canInvoiceMonth(clientId, month, amount) {
  return amount > 0 && !invoiceOfMonth(clientId, month) && !billedOn(clientId, month);
}

function dueBadge(t) {
  if (!t.dueDate || t.status === "done") return "";
  const today = todayStr();
  if (t.dueDate < today) return `<span class="badge danger">${icon("triangle-alert")}Po termíne · ${fmtDateShort(t.dueDate)}</span>`;
  if (t.dueDate === today) return `<span class="badge warn">${icon("clock")}Dnes</span>`;
  return `<span class="badge">${icon("calendar")}${fmtDateShort(t.dueDate)}</span>`;
}

/* ---------- PREHĽAD ---------- */

function viewDashboard() {
  if (!data.clients.length) {
    return `
    <div class="welcome">
      <svg class="deco" viewBox="-3 -3 160 258" aria-hidden="true"><use href="#spotli-s" /></svg>
      <h2>Vitaj v Spotli CRM</h2>
      <p>Prehľad o klientoch, odpracovaných hodinách a zárobku na jednom mieste. Začni v troch krokoch:</p>
      <div class="steps">
        <div class="step"><b>1</b><span>Pridaj klienta a jeho službu s cenou</span></div>
        <div class="step"><b>2</b><span>Priebežne zapisuj, čo si preňho robil</span></div>
        <div class="step"><b>3</b><span>Na konci mesiaca pošli report a označ faktúru</span></div>
      </div>
      <button class="btn btn-teal" data-action="new-client">${icon("plus")} Pridať prvého klienta</button>
    </div>`;
  }

  const m = ui.month;
  const sum = monthSummary(m);
  const prevM = addMonths(m, -1);
  const prev = monthSummary(prevM);

  let delta;
  if (prev.amount > 0) {
    const pct = Math.round((sum.amount - prev.amount) / prev.amount * 100);
    const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    const sign = pct > 0 ? "▲ +" : pct < 0 ? "▼ " : "";
    delta = `<span class="delta-pill ${cls}">${sign}${pct} %</span><span>${MONTHS[monthIdx(prevM)]}: ${fmtMoney(prev.amount)}</span>`;
  } else {
    delta = `<span>${MONTHS[monthIdx(prevM)]}: bez príjmu</span>`;
  }

  // 12 mesiacov končiacich vybraným mesiacom
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(addMonths(m, -i));
  const series = months.map(mm => { const s = monthSummary(mm); return { m: mm, amount: s.amount, hours: s.hours }; });
  const max = Math.max(...series.map(v => v.amount), 1);
  const cols = series.map(v => {
    const pctH = v.amount > 0 ? Math.max((v.amount / max) * 100, 2) : 0;
    const sel = v.m === m;
    return `<button type="button" class="trend-col ${sel ? "sel" : ""}" data-action="set-month" data-month="${v.m}"
        aria-label="${monthLabel(v.m)}: ${fmtMoney(v.amount)}, ${fmtHours(v.hours)}">
        <span class="trend-tip"><b>${monthLabel(v.m)}</b>${fmtMoney(v.amount)} · ${fmtHours(v.hours)}</span>
        ${sel && v.amount > 0 ? `<span class="trend-cap" style="bottom:${pctH}%">${fmtMoney(v.amount)}</span>` : ""}
        <span class="trend-bar" style="height:${pctH}%"></span>
      </button>`;
  }).join("");
  const labels = series.map(v => `<span class="${v.m === m ? "sel" : ""}">${MONTHS_SHORT[monthIdx(v.m)]}</span>`).join("");

  // tabuľka klientov v mesiaci: aktívni klienti + archivovaní, ak v mesiaci niečo mali
  const rows = data.clients
    .filter(c => !c.archived || sum.perClient.has(c.id))
    .map(c => ({ c, v: sum.perClient.get(c.id) || { hours: 0, amount: 0 } }))
    .sort((a, b) => b.v.amount - a.v.amount || b.v.hours - a.v.hours || a.c.name.localeCompare(b.c.name, "sk"));

  let unbilled = 0, unbilledCount = 0;
  rows.forEach(r => { if (r.v.amount > 0 && !billedOn(r.c.id, m)) { unbilled += r.v.amount; unbilledCount++; } });
  const monthOver = m < curMonth();

  const avg = sum.hourlyHours > 0 ? sum.hourlyAmount / sum.hourlyHours : null;

  const tableRows = rows.map(({ c, v }) => `
    <tr class="row-link" data-href="#/klient/${encodeURIComponent(c.id)}">
      <td><a class="client-link" href="#/klient/${encodeURIComponent(c.id)}">${esc(c.name)}</a></td>
      <td class="r ${v.hours ? "" : "muted"}">${v.hours ? fmtHours(v.hours) : "—"}</td>
      <td class="r ${v.amount ? "" : "muted"}"><b>${v.amount ? fmtMoney(v.amount) : "—"}</b></td>
      <td>${billedButton(c.id, m, v.amount)}</td>
      <td class="actions">${canInvoiceMonth(c.id, m, v.amount) ? `<button type="button" class="btn btn-teal btn-sm" data-action="invoice-from-crm" data-client="${esc(c.id)}" data-month="${m}">${icon("receipt")} Faktúra</button> ` : ""}${(v.hours || v.amount) ? `<button type="button" class="btn btn-ghost btn-sm" data-action="open-report" data-client="${esc(c.id)}">${icon("file-text")} Report</button>` : ""}</td>
    </tr>`).join("");

  // podľa typu služby
  const types = Object.entries(sum.perType).filter(([, v]) => v.amount > 0 || v.hours > 0).sort((a, b) => b[1].amount - a[1].amount);
  const tmax = Math.max(...types.map(([, v]) => v.amount), 1);
  const typeBars = types.length ? types.map(([k, v]) => `
    <div>
      <div class="hbar-top"><span class="name">${esc(SERVICE_TYPES[k] || "Iné")}</span><span class="val">${fmtMoney(v.amount)} · ${fmtHours(v.hours)}</span></div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${v.amount > 0 ? Math.max(v.amount / tmax * 100, 1) : 0}%"></div></div>
    </div>`).join("") : `<p class="empty">V tomto mesiaci zatiaľ nič.</p>`;

  // najbližšie úlohy
  const upcoming = data.tasks.filter(t => t.status !== "done")
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0, 6);
  const taskList = upcoming.length ? upcoming.map(t => `
    <div class="list-row">
      <div class="grow"><div class="title">${esc(t.title)}</div>
        <div class="meta">${t.clientId ? esc(clientName(t.clientId)) : "Bez klienta"} · ${t.status === "inprogress" ? "rozbehnuté" : "naplánované"}</div></div>
      ${dueBadge(t)}
    </div>`).join("") : `<p class="empty">Žiadne otvorené úlohy.</p>`;

  return `
  <div class="page-head">
    <div><h1>Prehľad</h1><div class="sub">Ako sa ti darí v mesiaci ${monthLabel(m).toLowerCase()}</div></div>
    <div class="head-actions">${globalMonthSwitch()}</div>
  </div>

  <section class="hero" aria-label="Zárobok">
    <div>
      <div class="hero-label">Zarobené · ${monthLabel(m)}</div>
      <div class="hero-value">${fmtMoney(sum.amount)}</div>
      <div class="hero-delta">${delta}</div>
    </div>
    <div>
      <div class="trend">${cols}</div>
      <div class="trend-labels">${labels}</div>
    </div>
  </section>

  <div class="tiles">
    <div class="tile">
      <div class="tile-label">${icon("clock")}Odpracované</div>
      <div class="tile-value">${fmtHours(sum.hours)}</div>
      <div class="tile-note">${sum.perClient.size} ${sum.perClient.size === 1 ? "klient" : (sum.perClient.size >= 2 && sum.perClient.size <= 4 ? "klienti" : "klientov")} v mesiaci</div>
    </div>
    <div class="tile">
      <div class="tile-label">${icon("receipt")}Priemerná hodinovka</div>
      <div class="tile-value">${avg === null ? "—" : fmtMoney(avg)}</div>
      <div class="tile-note">z práce na hodinu</div>
    </div>
    <div class="tile ${monthOver && unbilled > 0 ? "warn" : ""}">
      <div class="tile-label">${icon(unbilled > 0 ? (monthOver ? "triangle-alert" : "receipt") : "circle-check-big")}Nevyfakturované</div>
      <div class="tile-value">${fmtMoney(unbilled)}</div>
      <div class="tile-note">${unbilledCount ? `${unbilledCount} ${unbilledCount === 1 ? "klient" : (unbilledCount <= 4 ? "klienti" : "klientov")} čaká na faktúru` : "všetko vyfakturované"}</div>
    </div>
  </div>

  <div class="grid grid-3-1">
    <div class="card">
      <div class="card-head"><span class="card-title">Klienti v mesiaci</span></div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Klient</th><th class="r">Hodiny</th><th class="r">Suma</th><th>Faktúra</th><th></th></tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot><tr><td>Spolu</td><td class="r">${fmtHours(sum.hours)}</td><td class="r">${fmtMoney(sum.amount)}</td><td colspan="2"></td></tr></tfoot>
      </table></div>
    </div>
    <div class="stack">
      <div class="card">
        <div class="card-head"><span class="card-title">Podľa služby</span></div>
        <div class="hbars">${typeBars}</div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Najbližšie úlohy</span><a class="btn btn-plain btn-sm" href="#/planovanie">Plánovanie ${icon("chevron-right")}</a></div>
        <div class="list">${taskList}</div>
      </div>
    </div>
  </div>`;
}

/* ---------- KLIENTI ---------- */

function viewClients() {
  const m = ui.month;
  const sum = monthSummary(m);
  const active = data.clients.filter(c => !c.archived).sort((a, b) => a.name.localeCompare(b.name, "sk"));
  const archived = data.clients.filter(c => c.archived).sort((a, b) => a.name.localeCompare(b.name, "sk"));

  const card = c => {
    const v = sum.perClient.get(c.id) || { hours: 0, amount: 0 };
    const svcs = servicesOf(c.id).filter(s => s.status !== "dokoncena");
    const chips = svcs.length
      ? svcs.map(s => `<span class="badge ${s.status === "aktivna" ? "teal" : ""}">${esc(serviceLabel(s))} · ${priceLabel(s)}</span>`).join("")
      : `<span class="badge">Žiadna aktívna služba</span>`;
    const on = billedOn(c.id, m);
    const billBadge = on ? `<span class="badge teal">${icon("check")}Vyfakturované</span>`
      : (v.amount > 0 && m < curMonth() ? `<span class="badge warn">Nevyfakturované</span>` : "");
    return `
    <a class="client-card ${c.archived ? "archived" : ""}" href="#/klient/${encodeURIComponent(c.id)}">
      <div>
        <h3>${esc(c.name)}</h3>
        ${c.contact ? `<div class="tile-note">${esc(c.contact)}</div>` : ""}
      </div>
      <div class="chips">${chips}</div>
      <div class="month-line">
        <span>${MONTHS[monthIdx(m)]}: <b>${fmtMoney(v.amount)}</b> · ${fmtHours(v.hours)}</span>
        ${billBadge}
      </div>
    </a>`;
  };

  return `
  <div class="page-head">
    <div><h1>Klienti</h1><div class="sub">${active.length} ${active.length === 1 ? "aktívny klient" : (active.length >= 2 && active.length <= 4 ? "aktívni klienti" : "aktívnych klientov")}</div></div>
    <div class="head-actions">${globalMonthSwitch()}<button class="btn btn-dark" data-action="new-client">${icon("plus")} Nový klient</button></div>
  </div>
  ${active.length ? `<div class="client-grid">${active.map(card).join("")}</div>`
    : `<div class="card empty"><p>Zatiaľ tu nie je žiadny klient.</p><button class="btn btn-teal" data-action="new-client">${icon("plus")} Pridať klienta</button></div>`}
  ${archived.length ? `
    <div style="margin-top:24px">
      <button class="btn btn-plain" data-action="toggle-archived">${icon("archive")} ${ui.showArchived ? "Skryť" : "Zobraziť"} archivovaných (${archived.length})</button>
      ${ui.showArchived ? `<div class="client-grid" style="margin-top:12px">${archived.map(card).join("")}</div>` : ""}
    </div>` : ""}`;
}

/* ---------- KARTA KLIENTA ---------- */

function viewClient() {
  const c = clientById(ui.param);
  if (!c) {
    return `<a class="back-link" href="#/klienti">${icon("arrow-left")} Klienti</a>
      <div class="card empty"><p>Tento klient neexistuje alebo bol zmazaný.</p></div>`;
  }
  const m = ui.month;
  const cm = clientMonth(c.id, m);
  const all = clientAllTime(c.id);
  const svcs = servicesOf(c.id).sort((a, b) => (a.status === "dokoncena") - (b.status === "dokoncena"));

  const svcRows = svcs.length ? svcs.map(s => {
    let extra = "";
    if (s.pricing === "dielo") {
      const h = serviceHours(s.id);
      extra = ` · odpracované ${fmtHours(h)}${h > 0 && s.price ? ` · reálne ${fmtMoney(s.price / h)}/h` : ""}`;
      if (s.status === "dokoncena" && s.doneDate) extra += ` · dokončené ${fmtDate(s.doneDate)}`;
    }
    const stBadge = s.status === "aktivna" ? `<span class="badge teal">Aktívna</span>`
      : s.status === "pozastavena" ? `<span class="badge warn">Pozastavená</span>` : `<span class="badge">Dokončená</span>`;
    return `
    <div class="svc">
      <div class="svc-top">
        <span class="title">${esc(serviceLabel(s))}</span>
        ${stBadge}
        <button class="icon-btn" data-action="edit-service" data-id="${esc(s.id)}" aria-label="Upraviť službu">${icon("pencil")}</button>
        <button class="icon-btn danger" data-action="delete-service" data-id="${esc(s.id)}" aria-label="Zmazať službu">${icon("trash-2")}</button>
      </div>
      <div class="meta">${priceLabel(s)}${extra}${s.note ? " · " + esc(s.note) : ""}</div>
      ${s.pricing === "dielo" && s.status !== "dokoncena" ? `<button class="btn btn-ghost btn-sm svc-done" data-action="complete-service" data-id="${esc(s.id)}">${icon("check")} Zákazka je hotová</button>` : ""}
    </div>`;
  }).join("") : `<p class="empty">Klient zatiaľ nemá službu. Pridaj ju, aby si mohol zapisovať prácu.</p>`;

  const logs = cm.logs.slice().sort((a, b) => b.date.localeCompare(a.date));
  const workRows = [
    ...cm.done.map(s => `
      <tr>
        <td>${fmtDateShort(s.doneDate)}</td>
        <td>${esc(serviceLabel(s))}</td>
        <td class="desc"><span class="badge dark">Dokončená zákazka za dielo</span></td>
        <td class="r muted">—</td>
        <td class="r">${fmtMoney(s.price)}</td>
        <td class="actions"></td>
      </tr>`),
    ...logs.map(l => logRow(l, false))
  ].join("");

  const openTasks = data.tasks.filter(t => t.clientId === c.id && t.status !== "done")
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const taskRows = openTasks.length ? openTasks.map(t => `
    <div class="list-row">
      <button class="icon-btn" data-action="task-done" data-id="${esc(t.id)}" aria-label="Označiť ako hotové" title="Hotovo">${icon("circle-check-big")}</button>
      <div class="grow"><div class="title">${esc(t.title)}</div>${t.note ? `<div class="meta">${esc(t.note)}</div>` : ""}</div>
      ${dueBadge(t)}
      <button class="icon-btn" data-action="edit-task" data-id="${esc(t.id)}" aria-label="Upraviť úlohu">${icon("pencil")}</button>
    </div>`).join("") : `<p class="empty">Žiadne otvorené úlohy.</p>`;

  const on = billedOn(c.id, m);

  return `
  <a class="back-link" href="#/klienti">${icon("arrow-left")} Klienti</a>
  <div class="page-head">
    <div>
      <h1>${esc(c.name)} ${c.archived ? `<span class="badge">Archivovaný</span>` : ""}</h1>
      <div class="sub">${[c.contact, c.note].filter(Boolean).map(esc).join(" · ") || "Bez kontaktu"}</div>
    </div>
    <div class="head-actions">
      <button class="btn btn-ghost btn-sm" data-action="edit-client" data-id="${esc(c.id)}">${icon("pencil")} Upraviť</button>
      ${c.archived
        ? `<button class="btn btn-ghost btn-sm" data-action="unarchive-client" data-id="${esc(c.id)}">${icon("archive-restore")} Obnoviť</button>
           <button class="btn btn-ghost btn-sm" data-action="delete-client" data-id="${esc(c.id)}">${icon("trash-2")} Zmazať natrvalo</button>`
        : `<button class="btn btn-ghost btn-sm" data-action="archive-client" data-id="${esc(c.id)}">${icon("archive")} Archivovať</button>`}
    </div>
  </div>

  <div class="filters">
    ${globalMonthSwitch()}
    <span style="flex:1"></span>
    <button class="btn btn-ghost" data-action="open-report" data-client="${esc(c.id)}">${icon("file-text")} Report za ${MONTHS[monthIdx(m)].toLowerCase()}</button>
    ${c.archived ? "" : `<button class="btn btn-teal" data-action="new-log" data-client="${esc(c.id)}">${icon("plus")} Zapísať prácu</button>`}
  </div>

  <div class="tiles four">
    <div class="tile"><div class="tile-label">${icon("clock")}Odpracované</div><div class="tile-value">${fmtHours(cm.hours)}</div><div class="tile-note">${cm.logs.length} ${cm.logs.length === 1 ? "záznam" : (cm.logs.length >= 2 && cm.logs.length <= 4 ? "záznamy" : "záznamov")}</div></div>
    <div class="tile"><div class="tile-label">${icon("receipt")}Zarobené</div><div class="tile-value">${fmtMoney(cm.amount)}</div><div class="tile-note">${monthLabel(m)}</div></div>
    <div class="tile"><div class="tile-label">${icon(on || invoiceOfMonth(c.id, m) ? "circle-check-big" : "receipt")}Faktúra</div>
      ${invoiceOfMonth(c.id, m)
        ? `<div style="margin-top:8px">${billedButton(c.id, m, cm.amount)}</div>
           <div class="tile-note" style="margin-top:6px">vystavená ${fmtDate(invoiceOfMonth(c.id, m).issueDate)}</div>`
        : on
          ? `<div style="margin-top:8px">${billedButton(c.id, m, cm.amount)}</div><div class="tile-note" style="margin-top:6px">dňa ${fmtDate(on)}</div>`
          : cm.amount > 0
            ? `<div style="margin-top:8px"><button type="button" class="btn btn-teal btn-sm" data-action="invoice-from-crm" data-client="${esc(c.id)}" data-month="${m}">${icon("receipt")} Vystaviť faktúru</button></div>
               <div class="tile-note" style="margin-top:6px"><button type="button" class="link-btn" data-action="toggle-billed" data-client="${esc(c.id)}" data-month="${m}">označiť ako vyfakturované bez faktúry</button></div>`
            : `<div style="margin-top:8px"><span class="tile-note">Tento mesiac nie je čo fakturovať</span></div>`}</div>
    <div class="tile"><div class="tile-label">${icon("calendar")}Od začiatku spolupráce</div><div class="tile-value">${fmtMoney(all.amount)}</div><div class="tile-note">${fmtHours(all.hours)}</div></div>
  </div>

  <div class="grid grid-3-1">
    <div class="card">
      <div class="card-head"><span class="card-title">Práca · ${monthLabel(m)}</span></div>
      ${workRows ? `<div class="table-wrap"><table class="t">
        <thead><tr><th>Dátum</th><th>Služba</th><th>Čo som robil</th><th class="r">Hodiny</th><th class="r">Suma</th><th></th></tr></thead>
        <tbody>${workRows}</tbody>
        <tfoot><tr><td colspan="3">Spolu</td><td class="r">${fmtHours(cm.hours)}</td><td class="r">${fmtMoney(cm.amount)}</td><td></td></tr></tfoot>
      </table></div>` : `<div class="empty"><p>V tomto mesiaci zatiaľ žiadna práca.</p>${c.archived ? "" : `<button class="btn btn-teal btn-sm" data-action="new-log" data-client="${esc(c.id)}">${icon("plus")} Zapísať prácu</button>`}</div>`}
    </div>
    <div class="stack">
      <div class="card">
        <div class="card-head"><span class="card-title">Služby a ceny</span>
          <button class="btn btn-plain btn-sm" data-action="new-service" data-client="${esc(c.id)}">${icon("plus")} Pridať</button></div>
        <div class="list">${svcRows}</div>
      </div>
      <div class="card">
        <div class="card-head"><span class="card-title">Úlohy</span>
          <button class="btn btn-plain btn-sm" data-action="new-task" data-client="${esc(c.id)}">${icon("plus")} Pridať</button></div>
        <div class="list">${taskRows}</div>
      </div>
    </div>
  </div>`;
}

function logRow(l, withClient) {
  const s = serviceById(l.serviceId);
  const a = logAmount(l);
  return `
    <tr>
      <td>${fmtDateShort(l.date)}</td>
      ${withClient ? `<td><a class="client-link" href="#/klient/${encodeURIComponent(l.clientId)}">${esc(clientName(l.clientId))}</a></td>` : ""}
      <td>${esc(serviceLabel(s))}</td>
      <td class="desc">${esc(l.description) || `<span class="muted">bez popisu</span>`}</td>
      <td class="r">${fmtHours(l.hours)}</td>
      <td class="r">${l.rate !== null && l.rate !== undefined ? fmtMoney(a) : `<span class="muted" title="Zahrnuté v cene za dielo">za dielo</span>`}</td>
      <td class="actions">
        <button class="icon-btn" data-action="edit-log" data-id="${esc(l.id)}" aria-label="Upraviť záznam">${icon("pencil")}</button>
        <button class="icon-btn danger" data-action="delete-log" data-id="${esc(l.id)}" aria-label="Zmazať záznam">${icon("trash-2")}</button>
      </td>
    </tr>`;
}

/* ---------- DENNÍK ---------- */

function viewLogs() {
  const m = ui.month;
  let logs = data.logs.filter(l => l.date && l.date.slice(0, 7) === m);
  if (ui.logClient) logs = logs.filter(l => l.clientId === ui.logClient);
  logs.sort((a, b) => b.date.localeCompare(a.date));
  const hours = logs.reduce((s, l) => s + (Number(l.hours) || 0), 0);
  const amount = logs.reduce((s, l) => s + logAmount(l), 0);
  const clientOpts = data.clients.slice().sort((a, b) => a.name.localeCompare(b.name, "sk"))
    .map(c => `<option value="${esc(c.id)}" ${ui.logClient === c.id ? "selected" : ""}>${esc(c.name)}${c.archived ? " (archivovaný)" : ""}</option>`).join("");

  return `
  <div class="page-head">
    <div><h1>Denník práce</h1><div class="sub">Všetko, čo si urobil, pekne po dňoch</div></div>
    <div class="head-actions"><button class="btn btn-teal" data-action="new-log">${icon("plus")} Zapísať prácu</button></div>
  </div>
  <div class="filters">
    ${globalMonthSwitch()}
    <select data-change="log-client" aria-label="Filter podľa klienta">
      <option value="">Všetci klienti</option>${clientOpts}
    </select>
  </div>
  <div class="card">
    ${logs.length ? `<div class="table-wrap"><table class="t">
      <thead><tr><th>Dátum</th><th>Klient</th><th>Služba</th><th>Čo som robil</th><th class="r">Hodiny</th><th class="r">Suma</th><th></th></tr></thead>
      <tbody>${logs.map(l => logRow(l, true)).join("")}</tbody>
      <tfoot><tr><td colspan="4">Spolu · ${logs.length} ${logs.length === 1 ? "záznam" : (logs.length <= 4 ? "záznamy" : "záznamov")}</td><td class="r">${fmtHours(hours)}</td><td class="r">${fmtMoney(amount)}</td><td></td></tr></tfoot>
    </table></div>
    <p class="hint" style="margin:12px 0 0">Suma nezahŕňa zákazky za dielo – tie sa započítajú v mesiaci dokončenia (vidíš ich v Prehľade a na karte klienta).</p>`
    : `<div class="empty"><p>V mesiaci ${monthLabel(m).toLowerCase()} zatiaľ nie sú žiadne záznamy${ui.logClient ? " pre tohto klienta" : ""}.</p>
       <button class="btn btn-teal btn-sm" data-action="new-log" ${ui.logClient ? `data-client="${esc(ui.logClient)}"` : ""}>${icon("plus")} Zapísať prácu</button></div>`}
  </div>`;
}

/* ---------- PLÁNOVANIE ---------- */

function viewPlanning() {
  const colHtml = col => {
    const items = data.tasks.filter(t => t.status === col.id)
      .sort((a, b) => col.id === "done"
        ? (b.doneAt || "").localeCompare(a.doneAt || "")
        : (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    const idx = TASK_COLS.findIndex(x => x.id === col.id);
    const prevCol = TASK_COLS[idx - 1], nextCol = TASK_COLS[idx + 1];
    const cards = items.map(t => `
      <div class="task" draggable="true" data-id="${esc(t.id)}">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">${t.clientId ? `<span>${esc(clientName(t.clientId))}</span>` : `<span>Bez klienta</span>`}${dueBadge(t)}</div>
        ${t.note ? `<div class="task-note">${esc(t.note)}</div>` : ""}
        <div class="task-actions">
          ${prevCol ? `<button class="icon-btn" data-action="move-task" data-id="${esc(t.id)}" data-to="${prevCol.id}" aria-label="Presunúť do: ${prevCol.label}" title="Do: ${prevCol.label}">${icon("chevron-left")}</button>` : ""}
          ${nextCol ? `<button class="icon-btn" data-action="move-task" data-id="${esc(t.id)}" data-to="${nextCol.id}" aria-label="Presunúť do: ${nextCol.label}" title="Do: ${nextCol.label}">${icon("chevron-right")}</button>` : ""}
          <button class="icon-btn" data-action="edit-task" data-id="${esc(t.id)}" aria-label="Upraviť úlohu">${icon("pencil")}</button>
          <button class="icon-btn danger" data-action="delete-task" data-id="${esc(t.id)}" aria-label="Zmazať úlohu">${icon("trash-2")}</button>
        </div>
      </div>`).join("");
    return `
    <div class="kcol">
      <div class="kcol-head">
        <span class="card-title">${col.label} <span class="kcount">${items.length}</span></span>
        ${col.id === "done" && items.length ? `<button class="btn btn-plain btn-sm" data-action="clear-done">Vyčistiť</button>` : ""}
      </div>
      <div class="kcards" data-status="${col.id}">
        ${cards || `<div class="kempty">${col.id === "planned" ? "Sem pridaj, čo ťa čaká" : "Sem potiahni úlohu"}</div>`}
      </div>
    </div>`;
  };
  return `
  <div class="page-head">
    <div><h1>Plánovanie</h1><div class="sub">Úlohy potiahni myšou alebo posuň šípkami</div></div>
    <div class="head-actions"><button class="btn btn-dark" data-action="new-task">${icon("plus")} Nová úloha</button></div>
  </div>
  <div class="kanban">${TASK_COLS.map(colHtml).join("")}</div>`;
}

/* ---------- NASTAVENIA ---------- */

function viewSettings() {
  const tab = ui.settingsTab === "system" ? "system" : "doklady";
  return `
  <div class="page-head">
    <div><h1>Nastavenia</h1></div>
    <div class="seg-ctl" role="tablist">
      <button type="button" role="tab" data-action="settings-tab" data-tab="doklady" aria-pressed="${tab === "doklady"}">Faktúry a ponuky</button>
      <button type="button" role="tab" data-action="settings-tab" data-tab="system" aria-pressed="${tab === "system"}">Pripojenie a zabezpečenie</button>
    </div>
  </div>
  ${tab === "doklady" ? viewDocSettings() : settingsSystemHtml()}`;
}

function settingsSystemHtml() {
  return `
  <div class="card">
    <div class="card-head"><span class="card-title">Ukladanie na GitHub</span></div>
    <p class="hint">Dáta sa ukladajú do <b>samostatného súkromného repa</b> (napr. <code>spotli-crm-data</code>), nie do repa s appkou, ktoré je verejné kvôli GitHub Pages. Appka do verejného repa dáta nikdy neuloží. Token sa ukladá len v tomto prehliadači.</p>
    <div class="form" style="max-width:560px">
      <label class="field"><span>GitHub token (fine-grained, Contents: Read and write)</span>
        <input type="password" id="ghToken" value="${esc(settings.token)}" placeholder="github_pat_…" autocomplete="off" spellcheck="false" /></label>
      <div class="row2">
        <label class="field"><span>Používateľ / vlastník</span><input type="text" id="ghOwner" value="${esc(settings.owner)}" placeholder="tvoj-github-nick" spellcheck="false" /></label>
        <label class="field"><span>Súkromné repo na dáta</span><input type="text" id="ghRepo" value="${esc(settings.repo)}" placeholder="spotli-crm-data" spellcheck="false" /></label>
      </div>
      <div class="row2">
        <label class="field"><span>Branch</span><input type="text" id="ghBranch" value="${esc(settings.branch)}" placeholder="main" spellcheck="false" /></label>
        <label class="field"><span>Súbor</span><input type="text" id="ghPath" value="${esc(settings.path)}" placeholder="data.json" spellcheck="false" /></label>
      </div>
    </div>
    <div id="ghStatus">${ghStatusHtml()}</div>
    <div class="head-actions" style="margin-top:16px">
      <button class="btn btn-dark" data-action="gh-save">${icon("cloud")} Uložiť a pripojiť</button>
      ${ghReady() ? `<button class="btn btn-ghost" data-action="sync-now">Synchronizovať teraz</button>
      <button class="btn btn-plain" data-action="gh-disconnect">Odpojiť</button>` : ""}
    </div>
  </div>

  <div class="grid grid-2" style="margin-top:16px">
    <div class="card">
      <div class="card-head"><span class="card-title">PIN</span></div>
      <p class="hint">PIN chráni appku pred náhodným pohľadom. Zmena platí pre tento prehliadač. Appka sa sama zamkne po ${AUTO_LOCK_MINUTES} minútach nečinnosti.</p>
      <div class="form">
        <label class="field"><span>Súčasný PIN</span><input type="password" id="pinOld" inputmode="numeric" maxlength="8" autocomplete="off" /></label>
        <div class="row2">
          <label class="field"><span>Nový PIN (4–8 číslic)</span><input type="password" id="pinNew" inputmode="numeric" maxlength="8" autocomplete="off" /></label>
          <label class="field"><span>Zopakuj nový PIN</span><input type="password" id="pinNew2" inputmode="numeric" maxlength="8" autocomplete="off" /></label>
        </div>
      </div>
      <div class="head-actions" style="margin-top:14px"><button class="btn btn-ghost" data-action="pin-change">${icon("lock")} Zmeniť PIN</button></div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">Záloha</span></div>
      <p class="hint">Kedykoľvek si môžeš stiahnuť všetky dáta do súboru alebo ich zo súboru obnoviť.</p>
      <div class="head-actions">
        <button class="btn btn-ghost" data-action="export">${icon("download")} Stiahnuť zálohu</button>
        <label class="btn btn-ghost" style="cursor:pointer">${icon("upload")} Nahrať zálohu
          <input type="file" id="importInput" accept="application/json,.json" hidden /></label>
      </div>
    </div>
  </div>`;
}

function ghStatusHtml() {
  if (!ghReady()) {
    return `<div class="notice info">${icon("cloud-off")}<span>Dáta sú zatiaľ uložené len v tomto prehliadači.</span></div>`;
  }
  if (meta.lastError) {
    return `<div class="notice err">${icon("triangle-alert")}<span>${esc(meta.lastError)}</span></div>`;
  }
  if (meta.lastSync) {
    return `<div class="notice ok">${icon("cloud")}<span>Pripojené k súkromnému repu <b>${esc(settings.owner)}/${esc(settings.repo)}</b>. Naposledy synchronizované ${fmtStamp(meta.lastSync)}.${meta.dirty ? " Čakajú neuložené zmeny." : ""}</span></div>`;
  }
  return `<div class="notice info">${icon("cloud")}<span>Nastavené, synchronizácia ešte neprebehla.</span></div>`;
}

/* v Nastaveniach obnoví len stavový riadok, aby sa nezmazalo, čo práve píšeš */
function refreshGhStatus() {
  const el = $("#ghStatus");
  if (el) el.innerHTML = ghStatusHtml();
}

/* ===================== MODÁLNE OKNÁ ===================== */

let modalState = null;

function openModal({ title, body, foot, wide, onSubmit, onClose }) {
  const box = $("#modalBox");
  box.className = "modal" + (wide ? " wide" : "");
  box.innerHTML = `
    <form id="modalForm" novalidate>
      <div class="modal-head"><h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-action="modal-close" aria-label="Zavrieť">${icon("x")}</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${foot}</div>
    </form>`;
  $("#modalRoot").hidden = false;
  modalState = { onClose };
  const form = $("#modalForm");
  form.addEventListener("submit", e => {
    e.preventDefault();
    if (onSubmit) onSubmit(form, e.submitter || null);
  });
  const first = box.querySelector("[autofocus]") || box.querySelector(".modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea");
  if (first) setTimeout(() => first.focus(), 30);
  return form;
}

function closeModal() {
  if ($("#modalRoot").hidden) return;
  $("#modalRoot").hidden = true;
  $("#modalBox").innerHTML = "";
  $("#modalBox").className = "modal";
  const cb = modalState && modalState.onClose;
  modalState = null;
  if (cb) cb();
}

function confirmDialog({ title, text, ok, danger }) {
  return new Promise(resolve => {
    let done = false;
    openModal({
      title,
      body: `<p style="margin:0 0 6px">${text}</p>`,
      foot: `<button type="button" class="btn btn-ghost" data-action="modal-close">Zrušiť</button>
             <button type="submit" class="btn ${danger ? "btn-danger" : "btn-dark"}" autofocus>${esc(ok || "Potvrdiť")}</button>`,
      onSubmit: () => { done = true; closeModal(); resolve(true); },
      onClose: () => { if (!done) resolve(false); }
    });
  });
}

function fieldError(form, msg) {
  let el = form.querySelector(".form-error");
  if (!el) {
    el = document.createElement("div");
    el.className = "notice err form-error";
    form.querySelector(".modal-body").appendChild(el);
  }
  el.innerHTML = `${icon("triangle-alert")}<span>${esc(msg)}</span>`;
}

const serviceTypeOptions = sel => Object.entries(SERVICE_TYPES)
  .map(([k, v]) => `<option value="${k}" ${sel === k ? "selected" : ""}>${v}</option>`).join("");

function pricingFields(prefix, pricing, rate, price) {
  return `
    <div class="field"><span>Ako ju fakturuješ</span>
      <div class="seg">
        <label><input type="radio" name="${prefix}pricing" value="hodina" ${pricing !== "dielo" ? "checked" : ""}><span>Na hodinu</span></label>
        <label><input type="radio" name="${prefix}pricing" value="dielo" ${pricing === "dielo" ? "checked" : ""}><span>Za dielo</span></label>
      </div>
    </div>
    <label class="field" data-show="${prefix}hodina" ${pricing === "dielo" ? "hidden" : ""}><span>Hodinová sadzba (€/h)</span>
      <input type="text" inputmode="decimal" name="${prefix}rate" value="${esc(fmtNumInput(rate))}" placeholder="napr. 30" /></label>
    <label class="field" data-show="${prefix}dielo" ${pricing === "dielo" ? "" : "hidden"}><span>Cena za celé dielo (€)</span>
      <input type="text" inputmode="decimal" name="${prefix}price" value="${esc(fmtNumInput(price))}" placeholder="napr. 800" />
      <small>Započíta sa do mesiaca, v ktorom zákazku označíš ako dokončenú.</small></label>`;
}
function wirePricing(form, prefix) {
  const upd = () => {
    const v = (form.querySelector(`input[name="${prefix}pricing"]:checked`) || {}).value;
    $$(`[data-show="${prefix}hodina"]`, form).forEach(el => { el.hidden = v === "dielo"; });
    $$(`[data-show="${prefix}dielo"]`, form).forEach(el => { el.hidden = v !== "dielo"; });
  };
  form.addEventListener("change", e => { if (e.target.name === prefix + "pricing") upd(); });
}
function readPricing(form, prefix) {
  const pricing = (form.querySelector(`input[name="${prefix}pricing"]:checked`) || {}).value === "dielo" ? "dielo" : "hodina";
  const rate = parseNum(form.elements[prefix + "rate"].value);
  const price = parseNum(form.elements[prefix + "price"].value);
  if (pricing === "hodina" && !(rate >= 0)) return { error: "Zadaj hodinovú sadzbu (napr. 30)." };
  if (pricing === "dielo" && !(price >= 0)) return { error: "Zadaj cenu za dielo (napr. 800)." };
  return { pricing, rate: pricing === "hodina" ? round2(rate) : 0, price: pricing === "dielo" ? round2(price) : 0 };
}

/* ---------- klient ---------- */

const BILLING_FIELDS = ["ico", "dic", "icdph", "street", "zip", "city", "country"];

/* fakturačné údaje klienta: jeden zoznam klientov pre CRM, faktúry aj ponuky */
function billingFieldsHtml(c, open) {
  const has = BILLING_FIELDS.some(k => c[k] && k !== "country");
  return `
    <details class="more" ${open || has ? "open" : ""}>
      <summary>Fakturačné údaje (na faktúry a ponuky)</summary>
      <div class="form" style="margin-top:12px">
        <label class="field"><span>Ulica a číslo</span><input type="text" name="street" value="${esc(c.street || "")}" /></label>
        <div class="row2">
          <label class="field"><span>PSČ</span><input type="text" name="zip" value="${esc(c.zip || "")}" /></label>
          <label class="field"><span>Mesto</span><input type="text" name="city" value="${esc(c.city || "")}" /></label>
        </div>
        <label class="field"><span>Štát</span><input type="text" name="country" value="${esc(c.country || "Slovensko")}" /></label>
        <div class="row3">
          <label class="field"><span>IČO</span><input type="text" name="ico" inputmode="numeric" value="${esc(c.ico || "")}" /></label>
          <label class="field"><span>DIČ</span><input type="text" name="dic" inputmode="numeric" value="${esc(c.dic || "")}" /></label>
          <label class="field"><span>IČ DPH</span><input type="text" name="icdph" value="${esc(c.icdph || "")}" /></label>
        </div>
      </div>
    </details>`;
}
function readBilling(form) {
  const out = {};
  BILLING_FIELDS.forEach(k => { out[k] = (form.elements[k] ? form.elements[k].value : "").trim(); });
  if (!out.country) out.country = "Slovensko";
  return out;
}

function openClientModal(existing) {
  const c = existing || { name: "", contact: "", note: "" };
  openModal({
    title: existing ? "Upraviť klienta" : "Nový klient",
    body: `<div class="form">
      <label class="field"><span>Názov klienta / firmy</span><input type="text" name="name" value="${esc(c.name)}" placeholder="napr. Kaviareň Milka s.r.o." autofocus /></label>
      <label class="field"><span>Kontakt</span><input type="text" name="contact" value="${esc(c.contact)}" placeholder="e-mail alebo telefón" /></label>
      <label class="field"><span>Poznámka</span><input type="text" name="note" value="${esc(c.note)}" placeholder="nepovinné" /></label>
      ${billingFieldsHtml(c, false)}
      ${existing ? "" : `
        <div class="subhead">Služba, ktorú preňho robíš</div>
        <label class="field"><span>Typ služby</span><select name="type">${serviceTypeOptions("lokalne-seo")}</select></label>
        ${pricingFields("", "hodina", "", "")}`}
    </div>`,
    foot: `<button type="button" class="btn btn-ghost" data-action="modal-close">Zrušiť</button>
           <button type="submit" class="btn btn-dark">${existing ? "Uložiť" : "Pridať klienta"}</button>`,
    onSubmit: form => {
      const name = form.elements.name.value.trim();
      if (!name) return fieldError(form, "Zadaj názov klienta.");
      const contact = form.elements.contact.value.trim();
      const note = form.elements.note.value.trim();
      if (existing) {
        Object.assign(existing, { name, contact, note }, readBilling(form));
        closeModal();
        commit("Klient uložený");
        return;
      }
      const p = readPricing(form, "");
      if (p.error) return fieldError(form, p.error);
      const client = Object.assign({ id: uid(), name, contact, note, archived: false, createdAt: todayStr() }, readBilling(form));
      data.clients.push(client);
      data.services.push({ id: uid(), clientId: client.id, type: form.elements.type.value, pricing: p.pricing, rate: p.rate, price: p.price, status: "aktivna", doneDate: null, note: "" });
      closeModal();
      go("klient/" + encodeURIComponent(client.id));
      commit("Klient pridaný");
    }
  });
  if (!existing) wirePricing($("#modalForm"), "");
}

/* ---------- služba ---------- */

function openServiceModal(existing, clientId) {
  const s = existing || { clientId, type: "lokalne-seo", pricing: "hodina", rate: "", price: "", status: "aktivna", doneDate: null, note: "" };
  const form = openModal({
    title: existing ? "Upraviť službu" : "Nová služba",
    body: `<div class="form">
      <div class="tile-note">Klient: <b>${esc(clientName(s.clientId))}</b></div>
      <label class="field"><span>Typ služby</span><select name="type">${serviceTypeOptions(s.type)}</select></label>
      ${pricingFields("", s.pricing, s.rate, s.price)}
      <div class="row2">
        <label class="field"><span>Stav</span><select name="status">
          ${Object.entries(SERVICE_STATUS).map(([k, v]) => `<option value="${k}" ${s.status === k ? "selected" : ""}>${v}</option>`).join("")}
        </select></label>
        <label class="field" data-show="done" ${s.pricing === "dielo" && s.status === "dokoncena" ? "" : "hidden"}><span>Dokončené dňa</span>
          <input type="date" name="doneDate" value="${esc(s.doneDate || todayStr())}" /></label>
      </div>
      <label class="field"><span>Poznámka</span><input type="text" name="note" value="${esc(s.note)}" placeholder="nepovinné, napr. rozsah zákazky" /></label>
      ${existing && s.pricing === "hodina" ? `<label class="check" data-show="hodina"><input type="checkbox" name="recalc"> Novú sadzbu použiť aj na už zapísané, nevyfakturované záznamy</label>` : ""}
    </div>`,
    foot: `<button type="button" class="btn btn-ghost" data-action="modal-close">Zrušiť</button>
           <button type="submit" class="btn btn-dark">Uložiť</button>`,
    onSubmit: form => {
      const p = readPricing(form, "");
      if (p.error) return fieldError(form, p.error);
      const status = form.elements.status.value;
      const doneDate = (p.pricing === "dielo" && status === "dokoncena") ? (form.elements.doneDate.value || todayStr()) : null;
      const vals = { type: form.elements.type.value, pricing: p.pricing, rate: p.rate, price: p.price, status, doneDate, note: form.elements.note.value.trim() };
      if (existing) {
        const oldRate = existing.rate;
        Object.assign(existing, vals);
        if (form.elements.recalc && form.elements.recalc.checked && p.pricing === "hodina" && p.rate !== oldRate) {
          data.logs.forEach(l => {
            if (l.serviceId === existing.id && l.date && !billedOn(l.clientId, l.date.slice(0, 7))) l.rate = p.rate;
          });
        }
      } else {
        data.services.push(Object.assign({ id: uid(), clientId: s.clientId }, vals));
      }
      closeModal();
      commit("Služba uložená");
    }
  });
  wirePricing(form, "");
  const updDone = () => {
    const pricing = (form.querySelector('input[name="pricing"]:checked') || {}).value;
    $$('[data-show="done"]', form).forEach(el => { el.hidden = !(pricing === "dielo" && form.elements.status.value === "dokoncena"); });
    $$('label.check[data-show="hodina"]', form).forEach(el => { el.hidden = pricing === "dielo"; });
  };
  form.addEventListener("change", updDone);
}

/* ---------- záznam práce ---------- */

function servicesForLog(clientId, currentId) {
  return servicesOf(clientId).filter(s => s.status !== "dokoncena" || s.id === currentId);
}

function openLogModal(existing, preset) {
  preset = preset || {};
  const usable = data.clients.filter(c => !c.archived || (existing && c.id === existing.clientId))
    .sort((a, b) => a.name.localeCompare(b.name, "sk"));
  if (!usable.length) { toast("Najprv pridaj klienta"); openClientModal(null); return; }

  let clientId = existing ? existing.clientId : (preset.clientId && clientById(preset.clientId) ? preset.clientId
    : (prefs.lastClientId && usable.some(c => c.id === prefs.lastClientId) ? prefs.lastClientId : usable[0].id));

  const pickService = cid => {
    const list = servicesForLog(cid, existing && existing.serviceId);
    if (existing && existing.clientId === cid && list.some(s => s.id === existing.serviceId)) return existing.serviceId;
    if (preset.serviceId && list.some(s => s.id === preset.serviceId)) return preset.serviceId;
    const last = (prefs.lastServiceByClient || {})[cid];
    if (last && list.some(s => s.id === last && s.status === "aktivna")) return last;
    const act = list.find(s => s.status === "aktivna");
    return act ? act.id : (list[0] ? list[0].id : "");
  };
  const serviceOptions = (cid, sel) => {
    const list = servicesForLog(cid, existing && existing.serviceId);
    if (!list.length) return `<option value="">— klient nemá službu —</option>`;
    return list.map(s => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(serviceLabel(s))} · ${priceLabel(s)}${s.status === "pozastavena" ? " (pozastavená)" : ""}</option>`).join("");
  };

  const sel = pickService(clientId);
  const form = openModal({
    title: existing ? "Upraviť záznam" : "Zapísať prácu",
    body: `<div class="form">
      <div class="row2">
        <label class="field"><span>Klient</span><select name="clientId">
          ${usable.map(c => `<option value="${esc(c.id)}" ${c.id === clientId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Dátum</span><input type="date" name="date" value="${esc(existing ? existing.date : (preset.date || todayStr()))}" /></label>
      </div>
      <label class="field"><span>Služba</span><select name="serviceId">${serviceOptions(clientId, sel)}</select></label>
      <label class="field"><span>Čo si robil</span><textarea name="description" rows="3" placeholder="napr. Aktualizácia otváracích hodín a nové fotky v Google profile">${esc(existing ? existing.description : "")}</textarea></label>
      <label class="field"><span>Odpracované hodiny</span>
        <input type="text" inputmode="decimal" name="hours" value="${esc(existing ? fmtNumInput(round2(existing.hours)) : "")}" placeholder="napr. 1,5 alebo 1:30" ${existing ? "" : "autofocus"} /></label>
      <div class="calc-line muted" id="calcLine">Zadaj hodiny a appka dopočíta sumu.</div>
    </div>`,
    foot: `<button type="button" class="btn btn-ghost left" data-action="modal-close">Zrušiť</button>
           ${existing ? "" : `<button type="button" class="btn btn-ghost" id="saveAgain">Uložiť a pridať ďalší</button>`}
           <button type="submit" class="btn btn-dark">Uložiť</button>`,
    onSubmit: form => {
      const cid = form.elements.clientId.value;
      const sid = form.elements.serviceId.value;
      const date = form.elements.date.value;
      const hours = parseHours(form.elements.hours.value);
      if (!date) return fieldError(form, "Vyber dátum.");
      if (!sid) return fieldError(form, "Klient nemá žiadnu službu. Pridaj ju na karte klienta.");
      if (!(hours > 0)) return fieldError(form, "Zadaj odpracované hodiny, napr. 1,5 alebo 1:30.");
      const svc = serviceById(sid);
      const fresh = svc.pricing === "hodina" ? Number(svc.rate) || 0 : null;
      const vals = { clientId: cid, serviceId: sid, date, hours: round2(hours), description: form.elements.description.value.trim() };
      if (existing) {
        // sadzba ostáva z času zápisu, mení sa len pri zmene služby
        const rate = existing.serviceId === sid ? existing.rate : fresh;
        Object.assign(existing, vals, { rate: rate === undefined ? fresh : rate });
      } else {
        data.logs.push(Object.assign({ id: uid(), rate: fresh, createdAt: new Date().toISOString() }, vals));
      }
      prefs.lastClientId = cid;
      prefs.lastServiceByClient = Object.assign({}, prefs.lastServiceByClient, { [cid]: sid });
      savePrefs();
      const again = form.dataset.again === "1";
      closeModal();
      commit(existing ? "Záznam upravený" : `Zapísané: ${fmtHours(hours)} pre ${clientName(cid)}`);
      if (again) openLogModal(null, { clientId: cid, serviceId: sid, date });
    }
  });

  const updateCalc = () => {
    const svc = serviceById(form.elements.serviceId.value);
    const h = parseHours(form.elements.hours.value);
    const line = $("#calcLine");
    if (!svc) { line.className = "calc-line muted"; line.textContent = "Klient nemá žiadnu službu – pridaj ju na karte klienta."; return; }
    if (svc.pricing === "dielo") { line.className = "calc-line muted"; line.textContent = `Za dielo (${fmtMoney(svc.price)}) – hodiny sa evidujú, suma sa započíta pri dokončení zákazky.`; return; }
    const rate = (existing && existing.serviceId === svc.id && existing.rate !== null && existing.rate !== undefined) ? existing.rate : svc.rate;
    if (h > 0) { line.className = "calc-line"; line.textContent = `= ${fmtMoney(h * rate)}  (${fmtHours(h)} × ${fmtMoney(rate)}/h)`; }
    else { line.className = "calc-line muted"; line.textContent = `Sadzba ${fmtMoney(rate)}/h – zadaj hodiny a appka dopočíta sumu.`; }
  };
  const againBtn = $("#saveAgain");
  if (againBtn) againBtn.addEventListener("click", () => { form.dataset.again = "1"; form.requestSubmit(); form.dataset.again = ""; });
  form.addEventListener("input", updateCalc);
  form.addEventListener("change", e => {
    if (e.target.name === "clientId") {
      form.elements.serviceId.innerHTML = serviceOptions(e.target.value, pickService(e.target.value));
    }
    updateCalc();
  });
  updateCalc();
}

/* ---------- úloha ---------- */

function openTaskModal(existing, clientId) {
  const t = existing || { title: "", clientId: clientId || "", note: "", dueDate: "" };
  const clients = data.clients.filter(c => !c.archived || c.id === t.clientId).sort((a, b) => a.name.localeCompare(b.name, "sk"));
  openModal({
    title: existing ? "Upraviť úlohu" : "Nová úloha",
    body: `<div class="form">
      <label class="field"><span>Čo treba urobiť</span><input type="text" name="title" value="${esc(t.title)}" placeholder="napr. Pripraviť návrh článkov na december" autofocus /></label>
      <div class="row2">
        <label class="field"><span>Klient</span><select name="clientId"><option value="">Bez klienta</option>
          ${clients.map(c => `<option value="${esc(c.id)}" ${c.id === t.clientId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Termín</span><input type="date" name="dueDate" value="${esc(t.dueDate || "")}" /></label>
      </div>
      <label class="field"><span>Poznámka</span><textarea name="note" rows="3" placeholder="nepovinné">${esc(t.note)}</textarea></label>
    </div>`,
    foot: `<button type="button" class="btn btn-ghost" data-action="modal-close">Zrušiť</button>
           <button type="submit" class="btn btn-dark">Uložiť</button>`,
    onSubmit: form => {
      const title = form.elements.title.value.trim();
      if (!title) return fieldError(form, "Napíš, čo treba urobiť.");
      const vals = { title, clientId: form.elements.clientId.value || null, dueDate: form.elements.dueDate.value || null, note: form.elements.note.value.trim() };
      if (existing) Object.assign(existing, vals);
      else data.tasks.push(Object.assign({ id: uid(), status: "planned", createdAt: new Date().toISOString() }, vals));
      closeModal();
      commit("Úloha uložená");
    }
  });
}

function moveTask(id, to) {
  const t = data.tasks.find(x => x.id === id);
  if (!t || t.status === to || !TASK_COLS.some(c => c.id === to)) return;
  t.status = to;
  t.doneAt = to === "done" ? new Date().toISOString() : null;
  commit(to === "done" ? "Hotovo" : null);
}

/* ---------- konflikt pri synchronizácii ---------- */

function conflictDialog(remote) {
  const desc = d => `${d.clients.length} klientov, ${d.logs.length} záznamov, ${d.tasks.length} úloh, ${d.invoices.length} faktúr, ${d.quotes.length} ponúk` +
    (d.updatedAt ? ` · posledná zmena ${fmtDate(d.updatedAt.slice(0, 10))} ${d.updatedAt.slice(11, 16)} UTC` : "");
  return new Promise(resolve => {
    let done = false;
    openModal({
      title: "Na GitHube je iná verzia dát",
      body: `<p class="hint" style="margin-top:0">Dáta na GitHube sa zmenili inde (napr. na inom počítači) a tento prehliadač má zároveň neuložené zmeny. Vyber, ktorú verziu ponechať. Druhú ti appka stiahne ako záložný súbor, takže sa nič nestratí.</p>
        <div class="list">
          <div class="list-row"><div class="grow"><div class="title">V tomto prehliadači</div><div class="meta">${desc(data)}</div></div></div>
          <div class="list-row"><div class="grow"><div class="title">Na GitHube</div><div class="meta">${desc(remote.data)}</div></div></div>
        </div>`,
      foot: `<button type="submit" class="btn btn-ghost" name="choice" value="remote">Načítať z GitHubu</button>
             <button type="submit" class="btn btn-dark" name="choice" value="local">Ponechať z tohto prehliadača</button>`,
      onSubmit: (form, submitter) => {
        done = true;
        const choice = submitter && submitter.value === "remote" ? "remote" : "local";
        closeModal();
        resolve(choice);
      },
      onClose: () => { if (!done) resolve(null); }
    });
  });
}

/* ===================== REPORT PRE KLIENTA ===================== */

function reportGroups(clientId, month) {
  const groups = new Map();
  const grp = (key, s) => { if (!groups.has(key)) groups.set(key, { service: s, rows: [], done: null }); return groups.get(key); };
  data.logs.filter(l => l.clientId === clientId && l.date && l.date.slice(0, 7) === month)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(l => grp(l.serviceId || "none", serviceById(l.serviceId)).rows.push(l));
  data.services.filter(s => s.clientId === clientId && doneInMonth(s, month))
    .forEach(s => { grp(s.id, s).done = s; });
  return Array.from(groups.values());
}

function reportTotals(groups) {
  let hours = 0, amount = 0;
  groups.forEach(g => {
    g.rows.forEach(l => { hours += Number(l.hours) || 0; amount += logAmount(l); });
    if (g.done) amount += Number(g.done.price) || 0;
  });
  return { hours, amount: round2(amount) };
}

function reportDocHtml(c, month, opt) {
  const groups = reportGroups(c.id, month);
  const tot = reportTotals(groups);
  const ncol = 2 + (opt.hours ? 1 : 0) + (opt.amounts ? 1 : 0);
  let body = "";
  groups.forEach(g => {
    const s = g.service;
    const sub = s ? (s.pricing === "hodina" ? (opt.amounts ? ` · ${fmtMoney(s.rate)}/h` : "") : " · za dielo") : "";
    body += `<tr class="svc-row"><td colspan="${ncol}">${esc(serviceLabel(s))}${sub}</td></tr>`;
    g.rows.forEach(l => {
      const hourly = l.rate !== null && l.rate !== undefined;
      body += `<tr><td>${fmtDateShort(l.date)}</td><td>${esc(l.description) || "—"}</td>
        ${opt.hours ? `<td class="r">${fmtHours(l.hours)}</td>` : ""}
        ${opt.amounts ? `<td class="r">${hourly ? fmtMoney(logAmount(l)) : "—"}</td>` : ""}</tr>`;
    });
    if (g.done) {
      body += `<tr><td>${fmtDateShort(g.done.doneDate)}</td><td><b>Zákazka dokončená</b>${g.done.note ? " – " + esc(g.done.note) : ""}</td>
        ${opt.hours ? `<td class="r"></td>` : ""}
        ${opt.amounts ? `<td class="r"><b>${fmtMoney(g.done.price)}</b></td>` : ""}</tr>`;
    }
  });

  const totals = (opt.hours || opt.amounts) && groups.length ? `
    <div class="totals"><table>
      ${opt.hours ? `<tr class="${opt.amounts ? "" : "grand"}"><td>Odpracované hodiny</td><td class="r">${fmtHours(tot.hours)}</td></tr>` : ""}
      ${opt.amounts ? `<tr class="grand"><td>Spolu</td><td class="r">${fmtMoney(tot.amount)}</td></tr>` : ""}
    </table></div>` : "";

  return `
  <div class="doc">
    <div class="doc-head">
      <div class="doc-brand"><svg viewBox="-3 -3 160 258" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round" d="${SPOTLI_S_PATH}"/></svg><span>Spotli</span></div>
      <div class="doc-kicker">Mesačný report<br>${monthLabel(month)}</div>
    </div>
    <h1>${esc(c.name)}</h1>
    <div class="doc-period">Prehľad práce za obdobie 1. – ${lastDayOf(month)}. ${monthGen(month)}</div>
    ${groups.length ? `<table>
      <thead><tr><th style="width:70px">Dátum</th><th>Čo sme urobili</th>${opt.hours ? `<th class="r">Hodiny</th>` : ""}${opt.amounts ? `<th class="r">Suma</th>` : ""}</tr></thead>
      <tbody>${body}</tbody>
    </table>${totals}` : `<p class="doc-empty">V tomto mesiaci nie je zapísaná žiadna práca.</p>`}
    <div class="doc-foot"><span>Spotli · www.spotli.sk</span><span>Vystavené ${fmtDate(todayStr())}</span></div>
  </div>`;
}

function reportText(c, month, opt) {
  const groups = reportGroups(c.id, month);
  const tot = reportTotals(groups);
  const lines = [`Mesačný report – ${c.name}`, `Obdobie: ${monthLabel(month)}`, ""];
  if (!groups.length) lines.push("V tomto mesiaci nie je zapísaná žiadna práca.");
  groups.forEach(g => {
    lines.push(serviceLabel(g.service));
    g.rows.forEach(l => {
      const parts = [];
      if (opt.hours) parts.push(fmtHours(l.hours));
      if (opt.amounts && l.rate !== null && l.rate !== undefined) parts.push(fmtMoney(logAmount(l)));
      lines.push(`– ${fmtDateShort(l.date)} ${l.description || "(bez popisu)"}${parts.length ? ` (${parts.join(", ")})` : ""}`);
    });
    if (g.done) lines.push(`– ${fmtDateShort(g.done.doneDate)} Zákazka dokončená${opt.amounts ? ` (${fmtMoney(g.done.price)})` : ""}`);
    lines.push("");
  });
  if (groups.length && (opt.hours || opt.amounts)) {
    const t = [];
    if (opt.hours) t.push(`odpracované ${fmtHours(tot.hours)}`);
    if (opt.amounts) t.push(`suma ${fmtMoney(tot.amount)}`);
    lines.push(`Spolu: ${t.join(" · ")}`, "");
  }
  lines.push("Spotli · www.spotli.sk");
  return lines.join("\n").replace(/ | /g, " ");
}

function openReport(clientId, startMonth) {
  const c = clientById(clientId);
  if (!c) return;
  let m = startMonth || ui.month;
  const opt = () => Object.assign({ hours: true, amounts: true }, c.report || {});
  const form = openModal({
    title: `Report · ${c.name}`,
    wide: true,
    body: `<div class="report-layout">
      <div class="report-opts">
        <div class="field"><span>Obdobie</span><div id="repMonth"></div></div>
        <div class="field"><span>Zobraziť v reporte</span>
          <label class="check"><input type="checkbox" id="repHours" ${opt().hours ? "checked" : ""}> Hodiny</label>
          <label class="check"><input type="checkbox" id="repAmounts" ${opt().amounts ? "checked" : ""}> Sumy</label>
        </div>
        <div class="field"><span>Faktúra</span><div id="repBilled"></div></div>
        <p class="hint" style="margin:0">Tip: v okne tlače zvoľ <b>Uložiť ako PDF</b> a report pošli klientovi.</p>
      </div>
      <div class="report-paper"><div id="repDoc"></div></div>
    </div>`,
    foot: `<button type="button" class="btn btn-ghost left" data-action="modal-close">Zavrieť</button>
      <button type="button" class="btn btn-ghost" id="repCopy">${icon("copy")} Kopírovať ako text</button>
      <button type="button" class="btn btn-dark" id="repPrint">${icon("printer")} Vytlačiť / PDF</button>`
  });
  const draw = () => {
    $("#repMonth").innerHTML = monthSwitch(m, "rep-prev", "rep-next", null);
    const v = clientMonth(c.id, m);
    $("#repBilled").innerHTML = (v.amount > 0 || billedOn(c.id, m) || invoiceOfMonth(c.id, m))
      ? billedButton(c.id, m, v.amount) +
        (canInvoiceMonth(c.id, m, v.amount)
          ? `<div style="margin-top:8px"><button type="button" class="btn btn-teal btn-sm" data-action="invoice-from-crm" data-client="${esc(c.id)}" data-month="${m}">${icon("receipt")} Vystaviť faktúru</button></div>` : "")
      : `<span class="tile-note">Nie je čo fakturovať</span>`;
    $("#repDoc").innerHTML = reportDocHtml(c, m, opt());
  };
  draw();
  form.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.action === "rep-prev") { m = addMonths(m, -1); draw(); }
    else if (b.dataset.action === "rep-next") { m = addMonths(m, 1); draw(); }
    else if (b.dataset.action === "toggle-billed") { setTimeout(draw, 0); }
    else if (b.id === "repPrint") {
      $("#printArea").innerHTML = reportDocHtml(c, m, opt());
      window.print();
    } else if (b.id === "repCopy") {
      copyText(reportText(c, m, opt()));
    }
  });
  form.addEventListener("change", e => {
    if (e.target.id === "repHours" || e.target.id === "repAmounts") {
      c.report = { hours: $("#repHours").checked, amounts: $("#repAmounts").checked };
      commit(null);
      draw();
    }
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e2) { /* nič */ }
    ta.remove();
  }
  toast("Report skopírovaný – vlož ho do e-mailu");
}

/* ===================== TOAST ===================== */

let toastTimer = null;
function toast(msg, opts) {
  opts = opts || {};
  const el = $("#toast");
  el.className = "toast" + (opts.error ? " err" : "") + (opts.action ? "" : " no-action");
  el.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button type="button">${esc(opts.action)}</button>` : ""}`;
  el.hidden = false;
  if (opts.action) {
    el.querySelector("button").onclick = () => { el.hidden = true; opts.onAction(); };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, opts.action ? 6000 : 2800);
}

/* ===================== AKCIE (delegované kliknutia) ===================== */

const ACTIONS = {
  "modal-close": () => closeModal(),
  "new-log": a => openLogModal(null, { clientId: a.dataset.client }),
  "edit-log": a => { const l = data.logs.find(x => x.id === a.dataset.id); if (l) openLogModal(l); },
  "delete-log": a => withUndo("Záznam zmazaný", () => { data.logs = data.logs.filter(x => x.id !== a.dataset.id); }),

  "new-client": () => openClientModal(null),
  "edit-client": a => { const c = clientById(a.dataset.id); if (c) openClientModal(c); },
  "archive-client": a => {
    const c = clientById(a.dataset.id); if (!c) return;
    withUndo(`${c.name} je v archíve`, () => { c.archived = true; });
  },
  "unarchive-client": a => { const c = clientById(a.dataset.id); if (c) { c.archived = false; commit("Klient obnovený"); } },
  "delete-client": async a => {
    const c = clientById(a.dataset.id); if (!c) return;
    const n = data.logs.filter(l => l.clientId === c.id).length;
    const ok = await confirmDialog({
      title: "Zmazať klienta natrvalo?",
      text: `Zmaže sa <b>${esc(c.name)}</b> spolu so službami, ${n} ${n === 1 ? "záznamom" : "záznamami"} v denníku a úlohami. Zárobky z minulých mesiacov z prehľadov zmiznú.`,
      ok: "Zmazať natrvalo", danger: true
    });
    if (!ok) return;
    go("klienti");
    withUndo("Klient zmazaný", () => {
      data.clients = data.clients.filter(x => x.id !== c.id);
      data.services = data.services.filter(x => x.clientId !== c.id);
      data.logs = data.logs.filter(x => x.clientId !== c.id);
      data.tasks = data.tasks.filter(x => x.clientId !== c.id);
      Object.keys(data.billed).forEach(k => { if (k.startsWith(c.id + "|")) delete data.billed[k]; });
    });
  },
  "toggle-archived": () => { ui.showArchived = !ui.showArchived; render(); },

  "new-service": a => openServiceModal(null, a.dataset.client),
  "edit-service": a => { const s = serviceById(a.dataset.id); if (s) openServiceModal(s); },
  "complete-service": a => {
    const s = serviceById(a.dataset.id); if (!s) return;
    withUndo(`Zákazka dokončená – ${fmtMoney(s.price)} sa započíta do ${monthGen(curMonth())}`, () => {
      s.status = "dokoncena"; s.doneDate = todayStr();
    });
  },
  "delete-service": a => {
    const s = serviceById(a.dataset.id); if (!s) return;
    if (data.logs.some(l => l.serviceId === s.id)) {
      toast("Služba má zapísanú prácu – namiesto zmazania ju pozastav alebo dokonči.", { error: true });
      return;
    }
    withUndo("Služba zmazaná", () => { data.services = data.services.filter(x => x.id !== s.id); });
  },

  "toggle-billed": a => {
    const k = billedKey(a.dataset.client, a.dataset.month);
    const on = !data.billed[k];
    if (on) data.billed[k] = todayStr(); else delete data.billed[k];
    commit(on ? `${clientName(a.dataset.client)}: vyfakturované` : "Označenie faktúry zrušené");
  },
  "open-report": a => openReport(a.dataset.client),

  "new-task": a => openTaskModal(null, a.dataset.client),
  "edit-task": a => { const t = data.tasks.find(x => x.id === a.dataset.id); if (t) openTaskModal(t); },
  "delete-task": a => withUndo("Úloha zmazaná", () => { data.tasks = data.tasks.filter(x => x.id !== a.dataset.id); }),
  "move-task": a => moveTask(a.dataset.id, a.dataset.to),
  "task-done": a => moveTask(a.dataset.id, "done"),
  "clear-done": () => withUndo("Hotové úlohy vyčistené", () => { data.tasks = data.tasks.filter(t => t.status !== "done"); }),

  "month-prev": () => { ui.month = addMonths(ui.month, -1); render(); },
  "month-next": () => { ui.month = addMonths(ui.month, 1); render(); },
  "month-today": () => { ui.month = curMonth(); render(); },
  "set-month": a => { ui.month = a.dataset.month; render(); },

  "lock": () => showLock(),
  "sync-now": () => { if (ghReady()) syncFull(true); else { ui.settingsTab = "system"; go("nastavenia"); } },
  "settings-tab": a => { ui.settingsTab = a.dataset.tab; render(true); },

  /* skratka „nový …“ podľa toho, v ktorej časti appky si */
  "quick-new": () => {
    const m = ROUTE_MODULE[ui.route] || ui.module;
    if (m === "faktury") ACTIONS["new-invoice"]();
    else if (m === "ponuky") ACTIONS["new-quote"]();
    else openLogModal(null);
  },

  "gh-save": () => {
    const next = {
      token: $("#ghToken").value.trim(),
      owner: $("#ghOwner").value.trim(),
      repo: $("#ghRepo").value.trim(),
      branch: $("#ghBranch").value.trim() || "main",
      path: $("#ghPath").value.trim().replace(/^\/+/, "") || "data.json"
    };
    if (!next.token || !next.owner || !next.repo) { toast("Vyplň token, používateľa aj repo.", { error: true }); return; }
    const target = s => [s.owner, s.repo, s.branch, s.path].join("/").toLowerCase();
    if (target(next) !== target(settings)) { meta.sha = null; meta.lastSync = null; }
    settings = next;
    sync.repoOk = null;
    meta.lastError = null;
    saveSettings(); saveMeta();
    render();
    syncFull(true);
  },
  "gh-disconnect": () => {
    settings.token = "";
    meta.sha = null; meta.lastError = null; meta.lastSync = null;
    saveSettings(); saveMeta();
    updateSyncBadge(); render();
    toast("Odpojené. Dáta ostávajú v tomto prehliadači.");
  },

  "pin-change": () => {
    const old = $("#pinOld").value, n1 = $("#pinNew").value, n2 = $("#pinNew2").value;
    if (sha256Hex(PIN_SALT + old) !== pinInfo().h) { toast("Súčasný PIN nesedí.", { error: true }); return; }
    if (!/^\d{4,8}$/.test(n1)) { toast("Nový PIN musí mať 4 až 8 číslic.", { error: true }); return; }
    if (n1 !== n2) { toast("Nové PIN-y sa nezhodujú.", { error: true }); return; }
    if (!lsSet(KEYS.pin, { h: sha256Hex(PIN_SALT + n1), n: n1.length })) { toast("PIN sa nepodarilo uložiť.", { error: true }); return; }
    $("#pinOld").value = $("#pinNew").value = $("#pinNew2").value = "";
    toast("PIN zmenený");
  },
  "export": () => downloadJson(data, "spotli-crm-zaloha")
};

async function importFile(file) {
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch (e) { toast("Súbor nie je platná záloha (JSON).", { error: true }); return; }
  const next = normalizeData(parsed);
  const ok = await confirmDialog({
    title: "Nahrať zálohu?",
    text: `Záloha obsahuje ${next.clients.length} klientov a ${next.logs.length} záznamov. Nahradí všetky dáta, ktoré sú teraz v appke.`,
    ok: "Nahrať zálohu"
  });
  if (!ok) return;
  withUndo("Záloha nahraná", () => { data = next; });
}

/* ===================== GITHUB SYNCHRONIZÁCIA ===================== */

class SyncError extends Error {}

const sync = { busy: false, again: false, timer: null, retry: null, repoOk: null };

function ghReady() { return !!(settings.token && settings.owner && settings.repo && settings.path); }
function ghRepoUrl() { return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`; }
function ghFileUrl() { return ghRepoUrl() + "/contents/" + settings.path.split("/").filter(Boolean).map(encodeURIComponent).join("/"); }

async function gh(url, opts) {
  opts = opts || {};
  let res;
  try {
    res = await fetch(url, {
      method: opts.method || "GET",
      cache: "no-store",
      headers: Object.assign({
        "Authorization": "Bearer " + settings.token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }, opts.body ? { "Content-Type": "application/json" } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  } catch (e) {
    throw new SyncError("Bez pripojenia na GitHub – zmeny uložím, keď bude internet.");
  }
  if (res.status === 401) throw new SyncError("GitHub token je neplatný alebo vypršal. Vlož nový v Nastaveniach.");
  return res;
}

async function ensurePrivateRepo() {
  const key = `${settings.owner}/${settings.repo}`.toLowerCase();
  if (sync.repoOk === key) return;
  const res = await gh(ghRepoUrl());
  if (res.status === 404) throw new SyncError(`Repo ${settings.owner}/${settings.repo} neexistuje alebo k nemu token nemá prístup.`);
  if (!res.ok) throw new SyncError(`GitHub vrátil chybu ${res.status}.`);
  const info = await res.json();
  if (info.private !== true) {
    throw new SyncError(`Repo ${settings.owner}/${settings.repo} je verejné – dáta tam neukladám. Nastav súkromné repo.`);
  }
  sync.repoOk = key;
}

async function getRemote() {
  const res = await gh(ghFileUrl() + "?ref=" + encodeURIComponent(settings.branch || "main"));
  if (res.status === 404) return null;
  if (!res.ok) throw new SyncError(`Načítanie z GitHubu zlyhalo (${res.status}).`);
  const j = await res.json();
  let parsed;
  try { parsed = JSON.parse(b64decode(j.content)); } catch (e) { throw new SyncError("Súbor s dátami na GitHube je poškodený (nie je to platný JSON)."); }
  return { sha: j.sha, data: normalizeData(parsed) };
}

async function putRemote(sha) {
  const body = {
    message: `Spotli App: aktualizácia dát (${todayStr()} ${nowTime()})`,
    content: b64encode(JSON.stringify(data, null, 2)),
    branch: settings.branch || "main"
  };
  if (sha) body.sha = sha;
  const res = await gh(ghFileUrl(), { method: "PUT", body });
  if (res.status === 409 || res.status === 422) return { conflict: true, status: res.status };
  if (res.status === 403 || res.status === 404) throw new SyncError("Token nemá právo zapisovať do repa (treba Contents: Read and write), alebo branch neexistuje.");
  if (!res.ok) throw new SyncError(`Uloženie na GitHub zlyhalo (${res.status}).`);
  const j = await res.json();
  return { sha: j.content.sha };
}

function adoptRemote(remote) {
  data = remote.data;
  meta.sha = remote.sha;
  meta.dirty = false;
  meta.lastSync = new Date().toISOString();
  meta.lastError = null;
  saveData(); saveMeta();
  render();
}

function syncOk() {
  meta.lastSync = new Date().toISOString();
  meta.lastError = null;
  saveMeta();
  clearTimeout(sync.retry);
}

function syncFailed(e) {
  meta.lastError = e instanceof SyncError ? e.message : "Synchronizácia zlyhala: " + (e && e.message ? e.message : e);
  saveMeta();
  clearTimeout(sync.retry);
  sync.retry = setTimeout(() => { if (meta.dirty) pushNow(); }, 60000);
}

/* Rozhodne, čo robiť, keď sa dáta na GitHube líšia od toho, čo sme naposledy videli. */
async function handleRemoteChange(remote) {
  if (!meta.dirty || isEmptyData(data)) { adoptRemote(remote); return "adopted"; }
  if (contentKey(data) === contentKey(remote.data)) {
    meta.sha = remote.sha; meta.dirty = false; syncOk(); return "same";
  }
  const unresolved = "Na GitHube je iná verzia dát. Klikni na stav synchronizácie a vyber, ktorú ponechať.";
  if (locked) { meta.lastError = unresolved; saveMeta(); return "cancel"; }
  const choice = await conflictDialog(remote);
  if (choice === "remote") {
    downloadJson(data, "spotli-crm-zalozna-kopia-z-prehliadaca");
    adoptRemote(remote);
    toast("Načítaná verzia z GitHubu. Kópiu z prehliadača som stiahol ako zálohu.");
    return "adopted";
  }
  if (choice === "local") {
    downloadJson(remote.data, "spotli-crm-zalozna-kopia-z-githubu");
    meta.sha = remote.sha; meta.dirty = true; saveMeta();
    return "push";
  }
  meta.lastError = unresolved; saveMeta();
  return "cancel";
}

function schedulePush() {
  if (!ghReady()) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(pushNow, 1500);
}

/* Odoslanie lokálnych zmien. Nikdy nebeží dvakrát naraz. */
async function pushNow() {
  if (!ghReady()) return;
  if (sync.busy) { sync.again = true; return; }
  clearTimeout(sync.timer);
  sync.busy = true;
  updateSyncBadge("busy", "Ukladám na GitHub…");
  let pushAgain = false;
  try {
    await ensurePrivateRepo();
    const sentRev = meta.rev;
    let r = await putRemote(meta.sha);
    if (r.conflict) {
      const remote = await getRemote();
      if (!remote) {
        r = await putRemote(null);
        if (r.conflict) throw new SyncError("GitHub odmietol uloženie.");
      } else if (remote.sha === meta.sha) {
        throw new SyncError(`GitHub odmietol uloženie (${r.status}).`);
      } else {
        const out = await handleRemoteChange(remote);
        pushAgain = out === "push";
        r = null;
      }
    }
    if (r) {
      meta.sha = r.sha;
      if (meta.rev === sentRev) meta.dirty = false;
      syncOk();
    }
  } catch (e) {
    syncFailed(e);
  } finally {
    sync.busy = false;
    updateSyncBadge();
    refreshGhStatus();
    const again = sync.again;
    sync.again = false;
    if (pushAgain || (again && meta.dirty)) setTimeout(pushNow, 0);
  }
}

/* Úplná synchronizácia: pri štarte, po pripojení a na požiadanie.
   Neodoslané lokálne zmeny sa nikdy potichu neprepíšu. */
async function syncFull(manual) {
  if (!ghReady() || locked) { updateSyncBadge(); return; }
  if (sync.busy) { sync.again = true; return; }
  sync.busy = true;
  updateSyncBadge("busy", "Synchronizujem…");
  let needPush = false;
  try {
    await ensurePrivateRepo();
    const remote = await getRemote();
    if (!remote) {
      if (!isEmptyData(data)) { meta.dirty = true; meta.sha = null; needPush = true; }
      else syncOk();
    } else if (remote.sha === meta.sha) {
      if (meta.dirty) needPush = true; else syncOk();
    } else {
      const out = await handleRemoteChange(remote);
      if (out === "push") needPush = true;
      else if (out !== "cancel") syncOk();
    }
    if (manual && !needPush) toast("Synchronizované s GitHubom");
  } catch (e) {
    syncFailed(e);
    if (manual) toast(meta.lastError, { error: true });
  } finally {
    sync.busy = false;
    saveMeta();
    updateSyncBadge();
    refreshGhStatus();
    const again = sync.again;
    sync.again = false;
    if (needPush || (again && meta.dirty)) pushNow();
  }
}

/* stav synchronizácie sa ukazuje v bočnom paneli aj na rozcestníku */
function updateSyncBadge(kind, text) {
  let cls = "", label = "", title = "Synchronizovať teraz";
  if (kind) { cls = kind; label = text; }
  else if (!ghReady()) { label = "Len v tomto prehliadači"; }
  else if (meta.lastError) { cls = "err"; label = "Neuložené na GitHub"; title = meta.lastError; }
  else if (meta.dirty) { cls = "busy"; label = "Čaká na uloženie…"; }
  else {
    cls = "ok";
    const t = meta.lastSync ? new Date(meta.lastSync) : null;
    label = t ? `Uložené na GitHube · ${pad(t.getHours())}:${pad(t.getMinutes())}` : "Uložené na GitHube";
  }
  $$(".js-sync-dot").forEach(d => { d.className = "sync-dot js-sync-dot" + (cls ? " " + cls : ""); });
  $$(".js-sync-text").forEach(t => { t.textContent = label; });
  $$(".js-sync-btn").forEach(b => { b.title = title; });
}

/* ===================== PIN ZÁMOK ===================== */

let pinBuf = "";
let pinFails = 0;
let pinBlockedUntil = 0;
let lastActivity = Date.now();

/* { h: odtlačok, n: počet číslic } */
function pinInfo() {
  const v = lsGet(KEYS.pin, null);
  return (v && typeof v.h === "string" && v.n >= 4 && v.n <= 8) ? v : { h: DEFAULT_PIN_HASH, n: 4 };
}

function drawPinDots() {
  const box = $("#pinDots");
  const n = pinInfo().n;
  if (box.children.length !== n) box.innerHTML = "<span></span>".repeat(n);
  $$("span", box).forEach((s, i) => s.classList.toggle("on", i < pinBuf.length));
}

function showLock() {
  locked = true;
  ssSet(KEYS.unlocked, null);
  closeModal();
  $("#view").innerHTML = "";
  $("#printArea").innerHTML = "";
  $("#app").hidden = true;
  $("#lock").hidden = false;
  pinBuf = "";
  $("#pinError").textContent = "";
  drawPinDots();
}

function unlock() {
  locked = false;
  lastActivity = Date.now();
  $("#lock").hidden = true;
  $("#app").hidden = false;
  render();
  updateSyncBadge();
  syncFull(false);
}

function pinKey(k) {
  if (Date.now() < pinBlockedUntil) return;
  if (k === "back") { pinBuf = pinBuf.slice(0, -1); drawPinDots(); return; }
  if (!/^\d$/.test(k)) return;
  const info = pinInfo();
  if (pinBuf.length >= info.n) return;
  pinBuf += k;
  $("#pinError").textContent = "";
  drawPinDots();
  if (pinBuf.length < info.n) return;
  if (sha256Hex(PIN_SALT + pinBuf) === info.h) {
    pinFails = 0;
    ssSet(KEYS.unlocked, "1");
    // po zadaní PIN-u sa vždy otvorí rozcestník
    history.replaceState(null, "", "#/start");
    Object.assign(ui, parseHash());
    unlock();
  } else {
    wrongPin();
  }
}

function wrongPin() {
  pinFails++;
  pinBuf = "";
  drawPinDots();
  const dots = $("#pinDots");
  dots.classList.remove("shake"); void dots.offsetWidth; dots.classList.add("shake");
  setTimeout(() => dots.classList.remove("shake"), 400);
  if (pinFails >= 5) {
    pinBlockedUntil = Date.now() + 30000;
    pinFails = 0;
    $("#pinError").textContent = "Priveľa pokusov. Skús znova o 30 sekúnd.";
  } else {
    $("#pinError").textContent = "Nesprávny PIN";
  }
}

/* ===================== ŠTART ===================== */

function bindGlobalEvents() {
  document.addEventListener("click", e => {
    if (e.target.id === "modalRoot") { closeModal(); return; }
    const key = e.target.closest("#keypad [data-key]");
    if (key) { pinKey(key.dataset.key); return; }
    const a = e.target.closest("[data-action]");
    if (a) {
      const fn = ACTIONS[a.dataset.action];
      if (fn) { e.preventDefault(); fn(a, e); }
      return;
    }
    const row = e.target.closest("[data-href]");
    if (row && !e.target.closest("a, button, input, select, label, textarea")) location.hash = row.dataset.href;
  });

  document.addEventListener("change", e => {
    const el = e.target;
    if (el.matches && el.matches('[data-change="log-client"]')) { ui.logClient = el.value; render(); }
    if (el.id === "importInput" && el.files && el.files[0]) { importFile(el.files[0]); el.value = ""; }
    if (typeof onDocsChange === "function") onDocsChange(e);
  });
  document.addEventListener("input", e => { if (typeof onDocsInput === "function") onDocsInput(e); });

  document.addEventListener("keydown", e => {
    if (locked) {
      if (/^\d$/.test(e.key)) pinKey(e.key);
      else if (e.key === "Backspace") pinKey("back");
      return;
    }
    if (e.key === "Escape" && !$("#modalRoot").hidden) { e.preventDefault(); closeModal(); return; }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.tagName === "TEXTAREA") {
      const f = e.target.form; if (f) { e.preventDefault(); f.requestSubmit(); }
      return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (!typing && $("#modalRoot").hidden && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      ACTIONS["quick-new"]();
    }
  });

  // drag & drop v plánovaní – poslucháči sú len raz, na celom dokumente
  document.addEventListener("dragstart", e => {
    const t = e.target.closest && e.target.closest(".task");
    if (!t) return;
    e.dataTransfer.setData("text/plain", t.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    t.classList.add("dragging");
  });
  document.addEventListener("dragend", e => {
    const t = e.target.closest && e.target.closest(".task");
    if (t) t.classList.remove("dragging");
    $$(".kcards.over").forEach(x => x.classList.remove("over"));
  });
  document.addEventListener("dragover", e => {
    const col = e.target.closest && e.target.closest(".kcards");
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    $$(".kcards.over").forEach(x => { if (x !== col) x.classList.remove("over"); });
    col.classList.add("over");
  });
  document.addEventListener("drop", e => {
    const col = e.target.closest && e.target.closest(".kcards");
    if (!col) return;
    e.preventDefault();
    col.classList.remove("over");
    moveTask(e.dataTransfer.getData("text/plain"), col.dataset.status);
  });

  window.addEventListener("hashchange", () => { Object.assign(ui, parseHash()); render(); });

  // ochrana pred zatvorením s neodoslanými zmenami
  window.addEventListener("beforeunload", e => {
    if (!locked && ((ghReady() && meta.dirty) || (ui.editing && ui.editing.dirty))) { e.preventDefault(); e.returnValue = ""; }
  });
  window.addEventListener("online", () => { if (meta.dirty) pushNow(); });
  window.addEventListener("resize", () => { if (typeof fitPaper === "function") fitPaper(); });

  // automatické zamknutie po nečinnosti
  ["mousemove", "keydown", "click", "scroll"].forEach(ev =>
    window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (!locked && Date.now() - lastActivity > AUTO_LOCK_MINUTES * 60000) showLock();
  }, 30000);
}

function init() {
  loadAll();
  Object.assign(ui, parseHash());
  hydrateIcons(document);
  $(".key-back").innerHTML = icon("delete", 22);
  bindGlobalEvents();
  if (ssGet(KEYS.unlocked) === "1") unlock();
  else showLock();
}

document.addEventListener("DOMContentLoaded", init);
