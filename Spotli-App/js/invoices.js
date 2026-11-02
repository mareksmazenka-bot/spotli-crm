/* =============================================================
   Spotli App – Faktúry a Cenové ponuky
   Používa jadro z app.js (dáta, commit, modály, synchronizácia).
   Údaje dodávateľa sú v data.profile (súkromné repo), nie v kóde.
   ============================================================= */
"use strict";

const PAY_METHODS = ["Prevodom", "Hotovosť", "Kartou", "Dobierka"];
const UNITS = ["hod.", "ks", "deň", "mesiac", "km", "bal.", "m²", "projekt"];
const QUOTE_STATUS = { draft: "Rozpracovaná", sent: "Odoslaná", accepted: "Prijatá", rejected: "Zamietnutá" };

/* ===================== POMOCNÉ FUNKCIE ===================== */

const moneyDoc = v => nf2.format(Number(v) || 0) + " €";
const qtyFmt = v => nfH.format(numOf(v));
function numOf(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseNum(v);
  return isNaN(n) ? 0 : n;
}
const lineTotal = it => round2(numOf(it.qty) * numOf(it.price));
const docTotal = d => round2((d.items || []).reduce((s, it) => s + lineTotal(it), 0));
const docYear = d => Number(String(d.issueDate || "").slice(0, 4)) || 0;
const isOverdue = d => d.type === "invoice" && !d.paid && !!d.dueDate && d.dueDate < todayStr();
const invoiceState = d => d.paid ? "paid" : (isOverdue(d) ? "late" : "wait");
const qStatus = q => QUOTE_STATUS[q.status] ? q.status : "draft";
const listOf = type => type === "invoice" ? data.invoices : data.quotes;
const docById = (type, id) => listOf(type).find(d => d.id === id) || null;
const docRoute = type => type === "invoice" ? "faktura" : "ponuka";
const profileReady = () => !!(data.profile.name && data.profile.iban);
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function safeId(s) {
  return String(s || "").replace(/[^A-Za-z0-9_\-.~]/g, "-").slice(0, 120) || ("d" + Date.now());
}
function addDaysStr(iso, n) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + Number(n || 0));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function docFileName(doc) {
  return (doc.type === "invoice" ? "Faktura-" : "Cenova-ponuka-") + safeId(doc.number);
}
const plural = (n, one, few, many) => n === 1 ? one : (n >= 2 && n <= 4 ? few : many);

/* ===================== ČÍSLOVANIE ===================== */

/* Predpona + rok + 4-miestne poradie (napr. M20260053). Číslo „začať od“ platí len
   pre rok, v ktorom sa číslovanie nastavilo, v nasledujúcich rokoch sa začína od 1. */
function nextNumber(type, year) {
  const p = data.profile;
  const y = year || new Date().getFullYear();
  const prefix = type === "invoice" ? (p.invoicePrefix || "") : (p.quotePrefix || "");
  const start = Math.max(1, Number(type === "invoice" ? p.invoiceStart : p.quoteStart) || 1);
  const base = y === Number(p.numberingYear) ? start - 1 : 0;
  let max = base;
  listOf(type).forEach(d => {
    const s = seqOf(d, type, y);
    if (s !== null) max = Math.max(max, s);
  });
  const seq = max + 1;
  return { number: prefix + y + String(seq).padStart(4, "0"), vs: String(y) + String(seq).padStart(4, "0"), seq };
}

/* poradové číslo dokladu v danom roku (alebo null, ak číslo nemá štandardný tvar) */
function seqOf(d, type, year) {
  const prefix = type === "invoice" ? (data.profile.invoicePrefix || "") : (data.profile.quotePrefix || "");
  const m = new RegExp("^" + escRe(prefix) + year + "(\\d{1,6})$").exec(String(d.number || ""));
  return m ? parseInt(m[1], 10) : null;
}

/* zmazať sa dá len posledná faktúra v rade, aby v číslovaní nevznikla diera */
function isLastInvoice(d) {
  const y = docYear(d);
  const s = seqOf(d, "invoice", y);
  if (s === null) return true;
  return !data.invoices.some(o => o.id !== d.id && docYear(o) === y && (seqOf(o, "invoice", y) || 0) > s);
}

/* ===================== NOVÝ DOKLAD ===================== */

function customerFromClient(c) {
  return {
    name: c.name, ico: c.ico || "", dic: c.dic || "", icdph: c.icdph || "",
    street: c.street || "", zip: c.zip || "", city: c.city || "",
    country: c.country || "Slovensko", customerId: c.id
  };
}
function emptyCustomer() {
  return { name: "", ico: "", dic: "", icdph: "", street: "", zip: "", city: "", country: "Slovensko", customerId: "" };
}

function blankDoc(type, year) {
  const p = data.profile, today = todayStr();
  const y = year || Number(today.slice(0, 4));
  const n = nextNumber(type, y);
  const doc = {
    id: safeId(n.number), type, number: n.number,
    issueDate: today,
    customer: emptyCustomer(),
    items: [{ qty: 1, unit: p.defaultUnit || "hod.", desc: "", price: "" }],
    note: type === "invoice" ? (p.defaultNote || "") : (p.quoteNote || ""),
    createdAt: new Date().toISOString()
  };
  if (type === "invoice") {
    Object.assign(doc, {
      vs: n.vs, deliveryDate: today, dueDate: addDaysStr(today, p.dueDays || 14),
      paymentMethod: p.paymentMethod || "Prevodom", paid: false, paidAt: null, locked: false
    });
  } else {
    Object.assign(doc, { validUntil: addDaysStr(today, p.quoteValidDays || 30), status: "draft" });
  }
  return doc;
}

/* otvorí editor s novým dokladom (prípadne s predvyplneným návrhom) */
function openNew(type, draft) {
  if (ui.editing && ui.editing.dirty && !confirm("Rozpracovaný doklad sa zahodí. Pokračovať?")) return;
  ui.draft = draft || null;
  ui.parked = null;
  ui.editing = null;
  const target = "#/" + docRoute(type) + "/nova";
  if (location.hash === target) render(true); else location.hash = target;
}

/* faktúra z CRM: množstvá a ceny z denníka, popis položky si dopíšeš sám */
function invoiceDraftFromCrm(clientId, month) {
  const c = clientById(clientId);
  const cm = clientMonth(clientId, month);
  const doc = blankDoc("invoice", Number(todayStr().slice(0, 4)));
  doc.customer = customerFromClient(c);
  const groups = new Map();
  cm.logs.forEach(l => {
    if (l.rate === null || l.rate === undefined) return; // práca za dielo sa neúčtuje po hodinách
    const key = (l.serviceId || "") + "|" + l.rate;
    if (!groups.has(key)) groups.set(key, { service: serviceById(l.serviceId), rate: l.rate, hours: 0 });
    groups.get(key).hours += Number(l.hours) || 0;
  });
  const items = [];
  groups.forEach(g => items.push({
    qty: round2(g.hours), unit: "hod.", desc: "", price: g.rate,
    hint: `${serviceLabel(g.service)} · ${monthLabel(month).toLowerCase()}`
  }));
  cm.done.forEach(s => items.push({
    qty: 1, unit: "ks", desc: "", price: s.price,
    hint: `${serviceLabel(s)}${s.note ? " – " + s.note : ""}`
  }));
  if (items.length) doc.items = items;
  doc.crm = { clientId, month };
  doc.deliveryDate = month < curMonth() ? `${month}-${pad(lastDayOf(month))}` : todayStr();
  return doc;
}

/* ===================== QR KÓD (Pay by Square) ===================== */

const qrCache = {};
function qrDataUri(text) {
  if (qrCache[text]) return qrCache[text];
  const qr = qrcode(0, "M");
  qr.addData(text, "Alphanumeric");
  qr.make();
  const n = qr.getModuleCount(), pad2 = 2, size = n + pad2 * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.isDark(r, c)) {
        let run = 1;
        while (c + run < n && qr.isDark(r, c + run)) run++;
        d += `M${c + pad2} ${r + pad2}h${run}v1h-${run}z`;
        c += run;
      } else c++;
    }
  }
  // width a height musia byť uvedené, inak sa SVG pri prevode do PDF nevykreslí správne
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#ffffff"/><path fill="#142826" d="${d}"/></svg>`;
  return (qrCache[text] = "data:image/svg+xml;base64," + btoa(svg));
}

function docQr(doc) {
  if (doc.type !== "invoice") return "";
  const total = docTotal(doc);
  if (!(total > 0)) return "";
  try {
    return qrDataUri(payBySquare({
      iban: data.profile.iban, bic: data.profile.swift, amount: total,
      variableSymbol: doc.vs, dueDate: doc.dueDate, invoiceId: doc.number,
      beneficiaryName: data.profile.name
    }));
  } catch (e) { return ""; }
}

/* ===================== DOKLAD (to, čo sa vytlačí) ===================== */

function paperHtml(doc) {
  const p = data.profile, c = doc.customer || {};
  const isInv = doc.type === "invoice";
  const total = docTotal(doc);
  const qrSrc = docQr(doc);

  const addr = [c.street, [c.zip, c.city].filter(Boolean).join(" "), c.country].filter(Boolean);
  const supAddr = [p.street, [p.zip, p.city].filter(Boolean).join(" "), p.country].filter(Boolean);

  const ids = (o, showVat) => {
    let s = "";
    if (o.ico || o.dic || o.icdph) {
      s = `<div class="p-ids">` +
        (o.ico ? `<span class="idpair"><b>IČO</b> ${esc(o.ico)}</span>` : "") +
        (o.dic ? `<span class="idpair"><b>DIČ</b> ${esc(o.dic)}</span>` : "") +
        (o.icdph ? `<span class="idpair own"><b>IČ DPH</b> ${esc(o.icdph)}</span>` : "") +
        `</div>`;
    }
    if (showVat && p.vatNote) s += `<span class="vatnote">${esc(p.vatNote)}</span>`;
    return s;
  };

  const infoCells = isInv
    ? [["Dátum vystavenia", fmtDate(doc.issueDate), "", "rowline"],
       ["Dátum dodania", fmtDate(doc.deliveryDate), "", "rowline"],
       ["Dátum splatnosti", fmtDate(doc.dueDate), "", "rowline"],
       ["Forma úhrady", esc(doc.paymentMethod || "—"), "", "rowline edge"],
       ["IBAN", esc(p.iban || "—"), esc(p.bank || ""), "wide"],
       ["SWIFT / BIC", esc(p.swift || "—"), "", ""],
       ["Variabilný symbol", esc(doc.vs || "—"), "", "edge"]]
    : [["Dátum vystavenia", fmtDate(doc.issueDate), "", ""],
       ["Platnosť ponuky do", fmtDate(doc.validUntil), "", ""],
       ["Cena celkom", moneyDoc(total), "", "edge"]];

  const infoBand = `<div class="p-info${isInv ? "" : " quote"}"><div class="p-info-main">` +
    infoCells.map(x => `<div class="${x[3]}"><div class="k">${x[0]}</div><div class="v">${x[1]}</div>${x[2] ? `<div class="sub">${x[2]}</div>` : ""}</div>`).join("") +
    `</div>` +
    (qrSrc ? `<div class="p-info-qr"><img src="${qrSrc}" alt="QR kód na platbu"><div class="cap"><b>Zaplatiť naskenovaním</b>Pay by Square</div></div>` : "") +
    `</div>`;

  const rows = (doc.items || []).filter(it => (it.desc && String(it.desc).trim()) || numOf(it.qty) || numOf(it.price))
    .map((it, i) => `<tr><td>${i + 1}</td><td class="desc">${esc(it.desc || "")}</td>` +
      `<td>${qtyFmt(it.qty)}</td><td>${esc(it.unit || "")}</td>` +
      `<td>${moneyDoc(numOf(it.price))}</td><td class="tot">${moneyDoc(lineTotal(it))}</td></tr>`).join("");

  return `
  <div class="paper">
    <div class="p-head">
      <img class="p-logo" src="${SPOTLI_LOGO_URI}" alt="Spotli">
      <div class="p-titlebox">
        <div class="p-kind">${isInv ? "Faktúra" : "Cenová ponuka"}</div>
        <div class="p-no">${esc(doc.number || "—")}</div>
      </div>
    </div>
    <div class="p-rule"></div>
    <div class="p-parties">
      <div class="p-party"><div class="p-lbl">Dodávateľ</div>
        <div class="p-name">${p.name ? esc(p.name) : `<span class="p-missing">Doplň údaje dodávateľa v Nastaveniach</span>`}</div>
        <div class="p-addr">${supAddr.map(esc).join("<br>")}</div>
        ${ids(p, true)}
      </div>
      <div class="p-party"><div class="p-lbl">Odberateľ</div>
        <div class="p-name">${c.name ? esc(c.name) : `<span class="p-missing">Doplň odberateľa</span>`}</div>
        <div class="p-addr">${addr.map(esc).join("<br>")}</div>
        ${ids(c, false)}
      </div>
    </div>
    ${infoBand}
    <table class="p-items"><thead><tr><th></th><th>Popis</th><th>Počet</th><th>MJ</th><th>Cena za MJ</th><th>Celkom</th></tr></thead>
      <tbody>${rows || `<tr><td></td><td class="desc p-missing">Zatiaľ žiadne položky</td><td></td><td></td><td></td><td></td></tr>`}</tbody></table>
    <div class="p-bottom"><div class="p-totalbox">
      <div class="k">${isInv ? "Celkom k úhrade" : "Cena celkom"}</div>
      <div class="v">${moneyDoc(total)}</div>
      ${p.vatNote ? `<div class="n">${esc(p.vatNote)}, cena je konečná.</div>` : ""}
    </div></div>
    ${doc.note ? `<div class="p-note"><div class="k">Poznámka</div>${esc(doc.note).replace(/\n/g, "<br>")}</div>` : `<div class="p-note" style="border:0"></div>`}
    <div class="p-sign">
      <div class="p-foot">
        ${p.issuedBy ? `<div class="issuer">Vystavil: <b>${esc(p.issuedBy)}</b></div>` : ""}
        ${[p.email, p.phone, p.web].filter(Boolean).length ? `<div class="contact">${[p.email, p.phone, p.web].filter(Boolean).map(esc).join(" · ")}</div>` : ""}
      </div>
      <div class="p-signbox">${p.signature ? `<img src="${esc(p.signature)}" alt="">` : `<div style="height:52px"></div>`}<div class="line">Pečiatka a podpis</div></div>
    </div>
  </div>`;
}

/* ===================== PDF A TLAČ ===================== */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error("Nepodarilo sa načítať " + src));
    document.head.appendChild(s);
  });
}
let pdfLibs = null;
function ensurePdfLibs() {
  if (window.html2canvas && window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
  if (!pdfLibs) {
    pdfLibs = Promise.all([loadScript("js/vendor/html2canvas.min.js"), loadScript("js/vendor/jspdf.umd.min.js")])
      .catch(e => { pdfLibs = null; throw e; });
  }
  return pdfLibs;
}

async function warmFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const sk = "ľščťžňďôäŕĺáéíóúýĽŠČŤŽŇĎÔÄ€";
  try {
    await Promise.all([
      document.fonts.load('400 12px "Inter Variable"', sk), document.fonts.load('600 12px "Inter Variable"', sk),
      document.fonts.load('700 12px "Inter Variable"', sk), document.fonts.load('600 14px "Sora Variable"', sk),
      document.fonts.load('600 27px "Sora Variable"', "M20260053 0123456789")
    ]);
    await document.fonts.ready;
  } catch (e) { /* nič, použije sa záložné písmo */ }
}

/* doklad sa vykreslí v plnej veľkosti mimo obrazovky a odfotí sa do PDF (A4) */
async function exportPdf(doc) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.zIndex = 450;
  overlay.innerHTML = `<div class="modal" style="width:280px;text-align:center;padding:26px"><h2 style="font-size:17px">Pripravujem PDF…</h2><p class="hint" style="margin:6px 0 0">Chvíľu to potrvá.</p></div>`;
  document.body.appendChild(overlay);
  const host = document.createElement("div");
  host.className = "capture-host";
  host.innerHTML = paperHtml(doc);
  document.body.appendChild(host);
  try {
    await ensurePdfLibs();
    await warmFonts();
    const node = host.firstElementChild;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = await window.html2canvas(node, {
      scale: 3, backgroundColor: "#ffffff", useCORS: true, logging: false,
      width: node.offsetWidth, height: node.offsetHeight, windowWidth: 1200
    });
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const pageW = 210, pageH = 297;
    const pxPerMm = canvas.width / pageW;
    const pageHpx = Math.floor(pageH * pxPerMm);
    let y = 0, first = true;
    while (y < canvas.height - 2) {
      const sliceH = Math.min(pageHpx, canvas.height - y);
      const c2 = document.createElement("canvas");
      c2.width = canvas.width; c2.height = sliceH;
      const ctx = c2.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c2.width, c2.height);
      ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      if (!first) pdf.addPage();
      pdf.addImage(c2.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, pageW, sliceH / pxPerMm, undefined, "FAST");
      first = false; y += sliceH;
    }
    const blob = pdf.output("blob");
    const filename = docFileName(doc) + ".pdf";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`PDF ${filename} je stiahnuté`);
  } catch (err) {
    toast("PDF sa nepodarilo vytvoriť. Skús tlačidlo Tlačiť a v okne tlače zvoľ Uložiť ako PDF.", { error: true });
  } finally {
    host.remove();
    overlay.remove();
  }
}

function printDoc(doc) {
  const area = $("#printArea");
  area.innerHTML = paperHtml(doc);
  const oldTitle = document.title;
  document.title = docFileName(doc);
  const restore = () => {
    document.title = oldTitle;
    area.innerHTML = "";
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

/* ===================== SÚČTY PRE ROZCESTNÍK A PREHĽADY ===================== */

function invoiceTotals() {
  const open = data.invoices.filter(d => !d.paid);
  return {
    open: round2(open.reduce((s, d) => s + docTotal(d), 0)),
    openCount: open.length,
    lateCount: open.filter(isOverdue).length
  };
}
function quoteTotals() {
  const sent = data.quotes.filter(q => qStatus(q) === "sent");
  return {
    sent: sent.length,
    sentSum: round2(sent.reduce((s, q) => s + docTotal(q), 0)),
    draft: data.quotes.filter(q => qStatus(q) === "draft").length
  };
}

const docYears = type => {
  const ys = new Set([new Date().getFullYear()]);
  listOf(type).forEach(d => { const y = docYear(d); if (y) ys.add(y); });
  return Array.from(ys).sort((a, b) => b - a);
};
const yearSwitch = type => `<div class="seg-ctl">${docYears(type).map(y =>
  `<button type="button" data-action="doc-year" data-y="${y}" aria-pressed="${y === ui.year}">${y}</button>`).join("")}</div>`;

function missingProfileBanner() {
  if (profileReady()) return "";
  return `<div class="notice info banner">${icon("triangle-alert")}
    <span>Najprv doplň svoje údaje (meno, adresa, IČO, IBAN), objavia sa na každom doklade. Môžeš ich <b>načítať zo súboru</b> alebo vyplniť ručne.</span>
    <span class="banner-actions">
      <label class="btn btn-ghost btn-sm" style="cursor:pointer">${icon("upload")} Načítať zo súboru<input type="file" id="profileImport" accept="application/json,.json" hidden></label>
      <a class="btn btn-dark btn-sm" href="#/nastavenia" data-action="open-doc-settings">Vyplniť ručne</a>
    </span></div>`;
}

/* ===================== ZOZNAM FAKTÚR ===================== */

function statePill(d) {
  const st = invoiceState(d);
  if (st === "paid") return `<span class="badge teal">${icon("check")}Uhradená</span>`;
  if (st === "late") return `<span class="badge danger">${icon("clock")}Po splatnosti</span>`;
  return `<span class="badge">Čaká na úhradu</span>`;
}

function monthGroups(list, year) {
  const g = [];
  for (let m = 11; m >= 0; m--) {
    const items = list.filter(d => docYear(d) === year && Number(String(d.issueDate).slice(5, 7)) === m + 1);
    if (items.length) g.push({ m, items });
  }
  return g;
}
const sortDocs = list => list.slice().sort((a, b) => String(b.number).localeCompare(String(a.number), "sk", { numeric: true }));

function viewInvoices() {
  const year = ui.year;
  const inYear = data.invoices.filter(d => docYear(d) === year);
  const total = inYear.reduce((s, d) => s + docTotal(d), 0);
  const paidSum = inYear.filter(d => d.paid).reduce((s, d) => s + docTotal(d), 0);
  const lateArr = inYear.filter(isOverdue);
  const lateSum = lateArr.reduce((s, d) => s + docTotal(d), 0);

  const head = `
  <div class="page-head">
    <div><h1>Faktúry</h1><div class="sub">${inYear.length} ${plural(inYear.length, "faktúra", "faktúry", "faktúr")} za rok ${year} · ďalšia dostane číslo ${esc(nextNumber("invoice").number)}</div></div>
    <div class="head-actions">${yearSwitch("invoice")}<button class="btn btn-dark" data-action="new-invoice">${icon("plus")} Nová faktúra</button></div>
  </div>
  ${missingProfileBanner()}`;

  if (!data.invoices.length) {
    return head + `<div class="card empty"><p>Zatiaľ tu nie je žiadna faktúra. Prvá dostane číslo <b>${esc(nextNumber("invoice").number)}</b>.</p>
      <button class="btn btn-teal" data-action="new-invoice">${icon("plus")} Vytvoriť prvú faktúru</button>
      <p class="hint" style="margin:14px auto 0">Faktúru za odpracované hodiny vystavíš najrýchlejšie z CRM tlačidlom <b>Faktúra</b> pri klientovi.</p></div>`;
  }

  const months = [];
  for (let m = 0; m < 12; m++) {
    const items = inYear.filter(d => Number(String(d.issueDate).slice(5, 7)) === m + 1);
    months.push({
      m,
      paid: items.filter(d => d.paid).reduce((s, d) => s + docTotal(d), 0),
      unpaid: items.filter(d => !d.paid).reduce((s, d) => s + docTotal(d), 0)
    });
  }
  const max = Math.max(...months.map(x => x.paid + x.unpaid), 1);
  const chart = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><span class="card-title">Fakturácia po mesiacoch · ${year}</span>
        <span class="legend"><span><i style="background:var(--teal-600)"></i>Uhradené</span><span><i style="background:var(--aqua)"></i>Neuhradené</span></span></div>
      <div class="inv-chart">${months.map(x => {
        const tot = x.paid + x.unpaid;
        return `<div class="inv-col" tabindex="0" aria-label="${MONTHS[x.m]}: fakturované ${moneyDoc(tot)}, neuhradené ${moneyDoc(x.unpaid)}">
          <span class="inv-tip"><b>${MONTHS[x.m]}</b>${moneyDoc(tot)}${x.unpaid > 0 ? `<br>neuhradené ${moneyDoc(x.unpaid)}` : ""}</span>
          ${x.unpaid > 0 ? `<span class="inv-seg unpaid" style="height:${Math.max(x.unpaid / max * 100, 2)}%"></span>` : ""}
          ${x.paid > 0 ? `<span class="inv-seg paid" style="height:${Math.max(x.paid / max * 100, 2)}%"></span>` : ""}
          ${tot === 0 ? `<span class="inv-zero"></span>` : ""}
        </div>`;
      }).join("")}</div>
      <div class="inv-labels">${MONTHS_SHORT.map(s => `<span>${s}</span>`).join("")}</div>
    </div>`;

  const tiles = `
  <div class="tiles four">
    <div class="tile"><div class="tile-label">${icon("receipt")}Fakturované</div><div class="tile-value">${moneyDoc(total)}</div><div class="tile-note">${inYear.length} ${plural(inYear.length, "faktúra", "faktúry", "faktúr")} za rok ${year}</div></div>
    <div class="tile accent"><div class="tile-label">${icon("circle-check-big")}Uhradené</div><div class="tile-value">${moneyDoc(paidSum)}</div><div class="tile-note">${inYear.filter(d => d.paid).length} uhradených</div></div>
    <div class="tile"><div class="tile-label">${icon("hourglass")}Čaká na úhradu</div><div class="tile-value">${moneyDoc(total - paidSum)}</div><div class="tile-note">${inYear.filter(d => !d.paid).length} neuhradených</div></div>
    <div class="tile ${lateArr.length ? "warn" : ""}"><div class="tile-label">${icon(lateArr.length ? "triangle-alert" : "check")}Po splatnosti</div><div class="tile-value">${moneyDoc(lateSum)}</div><div class="tile-note">${lateArr.length} ${plural(lateArr.length, "faktúra", "faktúry", "faktúr")} po splatnosti</div></div>
  </div>`;

  const filters = `
  <div class="filters">
    <div class="seg-ctl">${[["all", "Všetky"], ["unpaid", "Neuhradené"], ["late", "Po splatnosti"], ["paid", "Uhradené"]].map(([k, l]) =>
      `<button type="button" data-action="inv-status" data-s="${k}" aria-pressed="${ui.invStatus === k}">${l}</button>`).join("")}</div>
  </div>`;

  const filtered = sortDocs(inYear.filter(d => {
    if (ui.invStatus === "paid") return d.paid;
    if (ui.invStatus === "unpaid") return !d.paid;
    if (ui.invStatus === "late") return isOverdue(d);
    return true;
  }));
  const groups = monthGroups(filtered, year);

  const body = groups.length ? groups.map(g => {
    const sum = g.items.reduce((s, d) => s + docTotal(d), 0);
    const paid = g.items.filter(d => d.paid).reduce((s, d) => s + docTotal(d), 0);
    return `
    <div class="card month-block">
      <div class="month-head"><h3>${MONTHS[g.m]} ${year}</h3>
        <div class="month-totals"><span>${g.items.length} ${plural(g.items.length, "faktúra", "faktúry", "faktúr")}</span>
          <span>Uhradené <b>${moneyDoc(paid)}</b></span><span>Zostáva <b>${moneyDoc(sum - paid)}</b></span><span>Spolu <b>${moneyDoc(sum)}</b></span></div></div>
      <div class="table-wrap"><table class="t docs">
        <thead><tr><th style="width:34px"></th><th>Číslo</th><th>Odberateľ</th><th>Vystavená</th><th>Splatnosť</th><th class="r">Suma</th><th>Stav</th><th></th></tr></thead>
        <tbody>${g.items.map(d => `
          <tr class="row-link" data-href="#/faktura/${encodeURIComponent(d.id)}">
            <td><input type="checkbox" class="check" data-paid="${esc(d.id)}" ${d.paid ? "checked" : ""} title="Označiť ako uhradenú" aria-label="Uhradená ${esc(d.number)}"></td>
            <td class="num"><b>${esc(d.number)}</b>${d.locked ? "" : ` <span class="badge warn" title="Doklad nie je uzamknutý">rozpracovaná</span>`}</td>
            <td>${esc((d.customer && d.customer.name) || "—")}</td>
            <td class="muted">${fmtDate(d.issueDate)}</td>
            <td class="muted">${fmtDate(d.dueDate)}</td>
            <td class="r"><b>${moneyDoc(docTotal(d))}</b></td>
            <td>${statePill(d)}</td>
            <td class="actions">
              <a class="icon-btn" href="#/faktura/${encodeURIComponent(d.id)}" title="Otvoriť" aria-label="Otvoriť ${esc(d.number)}">${icon("pencil")}</a>
              <button class="icon-btn" data-action="pdf-doc" data-type="invoice" data-id="${esc(d.id)}" title="Stiahnuť PDF" aria-label="Stiahnuť PDF ${esc(d.number)}">${icon("download")}</button>
              <button class="icon-btn" data-action="dup-doc" data-type="invoice" data-id="${esc(d.id)}" title="Duplikovať" aria-label="Duplikovať ${esc(d.number)}">${icon("copy")}</button>
              <button class="icon-btn danger" data-action="delete-doc" data-type="invoice" data-id="${esc(d.id)}" title="${isLastInvoice(d) ? "Zmazať" : "Zmazať sa dá len posledná faktúra v rade"}" aria-label="Zmazať ${esc(d.number)}" ${isLastInvoice(d) ? "" : "disabled"}>${icon("trash-2")}</button>
            </td>
          </tr>`).join("")}
        </tbody></table></div>
    </div>`;
  }).join("") : `<div class="card empty"><p>V tomto filtri nie sú žiadne faktúry.</p></div>`;

  return head + tiles + chart + filters + body;
}

/* ===================== ZOZNAM PONÚK ===================== */

function viewQuotes() {
  const year = ui.year;
  const inYear = data.quotes.filter(d => docYear(d) === year);
  const sumOf = st => round2(inYear.filter(q => qStatus(q) === st).reduce((s, q) => s + docTotal(q), 0));
  const cntOf = st => inYear.filter(q => qStatus(q) === st).length;

  const head = `
  <div class="page-head">
    <div><h1>Cenové ponuky</h1><div class="sub">${inYear.length} ${plural(inYear.length, "ponuka", "ponuky", "ponúk")} za rok ${year} · ďalšia dostane číslo ${esc(nextNumber("quote").number)}</div></div>
    <div class="head-actions">${yearSwitch("quote")}<button class="btn btn-dark" data-action="new-quote">${icon("plus")} Nová ponuka</button></div>
  </div>
  ${missingProfileBanner()}`;

  if (!data.quotes.length) {
    return head + `<div class="card empty"><p>Zatiaľ tu nie je žiadna ponuka. Prvá dostane číslo <b>${esc(nextNumber("quote").number)}</b>.</p>
      <button class="btn btn-teal" data-action="new-quote">${icon("plus")} Vytvoriť prvú ponuku</button>
      <p class="hint" style="margin:14px auto 0">Keď klient ponuku prijme, jedným klikom z nej urobíš zákazku v CRM alebo faktúru.</p></div>`;
  }

  const tiles = `
  <div class="tiles four">
    ${["draft", "sent", "accepted", "rejected"].map(st => `
      <div class="tile ${st === "accepted" ? "accent" : ""}"><div class="tile-label">${icon({ draft: "pencil", sent: "send", accepted: "circle-check-big", rejected: "circle-x" }[st])}${QUOTE_STATUS[st]}</div>
      <div class="tile-value">${cntOf(st)}</div><div class="tile-note">${moneyDoc(sumOf(st))}</div></div>`).join("")}
  </div>`;

  const filters = `<div class="filters"><div class="seg-ctl">${[["all", "Všetky"], ["draft", "Rozpracované"], ["sent", "Odoslané"], ["accepted", "Prijaté"], ["rejected", "Zamietnuté"]].map(([k, l]) =>
    `<button type="button" data-action="quote-filter" data-s="${k}" aria-pressed="${ui.quoteStatus === k}">${l}</button>`).join("")}</div></div>`;

  const filtered = sortDocs(inYear.filter(q => ui.quoteStatus === "all" || qStatus(q) === ui.quoteStatus));
  const groups = monthGroups(filtered, year);

  const body = groups.length ? groups.map(g => {
    const sum = g.items.reduce((s, d) => s + docTotal(d), 0);
    return `
    <div class="card month-block">
      <div class="month-head"><h3>${MONTHS[g.m]} ${year}</h3>
        <div class="month-totals"><span>${g.items.length} ${plural(g.items.length, "ponuka", "ponuky", "ponúk")}</span><span>Spolu <b>${moneyDoc(sum)}</b></span></div></div>
      <div class="table-wrap"><table class="t docs">
        <thead><tr><th>Číslo</th><th>Odberateľ</th><th>Vystavená</th><th>Platná do</th><th class="r">Suma</th><th>Stav</th><th></th></tr></thead>
        <tbody>${g.items.map(q => {
          const st = qStatus(q);
          const expired = st === "sent" && q.validUntil && q.validUntil < todayStr();
          const job = q.serviceId ? serviceById(q.serviceId) : null;
          return `
          <tr class="row-link" data-href="#/ponuka/${encodeURIComponent(q.id)}">
            <td class="num"><b>${esc(q.number)}</b></td>
            <td>${esc((q.customer && q.customer.name) || "—")}</td>
            <td class="muted">${fmtDate(q.issueDate)}</td>
            <td class="muted">${fmtDate(q.validUntil)}${expired ? ` <span class="badge danger">vypršala</span>` : ""}</td>
            <td class="r"><b>${moneyDoc(docTotal(q))}</b></td>
            <td><select class="status-select ${st}" data-qstatus="${esc(q.id)}" aria-label="Stav ponuky ${esc(q.number)}">
              ${Object.entries(QUOTE_STATUS).map(([k, l]) => `<option value="${k}" ${k === st ? "selected" : ""}>${l}</option>`).join("")}</select>
              ${q.invoice ? `<span class="badge teal" title="Z ponuky vznikla faktúra">${icon("receipt")}${esc(q.invoice)}</span>` : ""}
              ${job ? `<a class="badge teal" href="#/klient/${encodeURIComponent(job.clientId)}" title="Zákazka v CRM">${icon("briefcase-business")}v CRM</a>` : ""}</td>
            <td class="actions">
              ${st === "accepted" && !job ? `<button class="btn btn-teal btn-sm" data-action="quote-to-job" data-id="${esc(q.id)}">${icon("briefcase-business")} Zákazka do CRM</button>` : ""}
              ${!q.invoice ? `<button class="icon-btn" data-action="convert-quote" data-id="${esc(q.id)}" title="Premeniť na faktúru" aria-label="Premeniť na faktúru ${esc(q.number)}">${icon("receipt")}</button>` : ""}
              <a class="icon-btn" href="#/ponuka/${encodeURIComponent(q.id)}" title="Otvoriť" aria-label="Otvoriť ${esc(q.number)}">${icon("pencil")}</a>
              <button class="icon-btn" data-action="pdf-doc" data-type="quote" data-id="${esc(q.id)}" title="Stiahnuť PDF" aria-label="Stiahnuť PDF ${esc(q.number)}">${icon("download")}</button>
              <button class="icon-btn" data-action="dup-doc" data-type="quote" data-id="${esc(q.id)}" title="Duplikovať" aria-label="Duplikovať ${esc(q.number)}">${icon("copy")}</button>
              <button class="icon-btn danger" data-action="delete-doc" data-type="quote" data-id="${esc(q.id)}" title="Zmazať" aria-label="Zmazať ${esc(q.number)}">${icon("trash-2")}</button>
            </td>
          </tr>`;
        }).join("")}</tbody></table></div>
    </div>`;
  }).join("") : `<div class="card empty"><p>V tomto filtri nie sú žiadne ponuky.</p></div>`;

  return head + tiles + filters + body;
}

/* ===================== EDITOR DOKLADU ===================== */

function initEditing() {
  const type = ui.route === "faktura" ? "invoice" : "quote";
  const key = ui.route + "/" + (ui.param || "");
  if (ui.parked && ui.parked.key === key) { ui.editing = ui.parked; ui.parked = null; return; }
  if (ui.param === "nova") {
    const draft = ui.draft || blankDoc(type);
    ui.draft = null;
    ui.editing = {
      key, type, doc: clone(draft), isNew: true, origId: draft.id, readOnly: false,
      dirty: !!draft.crm || !!draft.fromQuote || draft.items.length > 1 || !!draft.customer.name,
      dueTouched: false, numberTouched: !!draft.fromQuote
    };
    return;
  }
  const d = docById(type, ui.param);
  if (!d) { ui.editing = null; return; }
  ui.editing = {
    key, type, doc: clone(d), isNew: false, origId: d.id,
    readOnly: type === "invoice" && !!d.locked, dirty: false, dueTouched: true, numberTouched: true
  };
}

function viewDocEditor() {
  const type = ui.route === "faktura" ? "invoice" : "quote";
  const key = ui.route + "/" + (ui.param || "");
  if (!ui.editing || ui.editing.key !== key) initEditing();
  if (!ui.editing) {
    return `<a class="back-link" href="#/${type === "invoice" ? "faktury" : "ponuky"}">${icon("arrow-left")} ${type === "invoice" ? "Faktúry" : "Cenové ponuky"}</a>
      <div class="card empty"><p>Tento doklad neexistuje alebo bol zmazaný.</p></div>`;
  }
  return editorHtml();
}

function clientOptions(selectedId) {
  const list = data.clients.filter(c => !c.archived || c.id === selectedId)
    .sort((a, b) => a.name.localeCompare(b.name, "sk"));
  return `<option value="">— nový odberateľ —</option>` +
    list.map(c => `<option value="${esc(c.id)}" ${c.id === selectedId ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}

function itemRowsHtml() {
  const e = ui.editing, dis = e.readOnly ? "disabled" : "";
  return e.doc.items.map((it, i) => `
    <div class="itemrow" data-row="${i}">
      <input type="text" class="idesc" data-i="${i}" data-if="desc" value="${esc(it.desc)}" placeholder="${esc(it.hint ? "napr. " + it.hint : "Popis položky")}" aria-label="Popis položky ${i + 1}" ${dis}>
      <label class="mini"><span>Počet</span><input type="text" inputmode="decimal" class="iqty" data-i="${i}" data-if="qty" value="${esc(fmtNumInput(it.qty))}" aria-label="Počet, položka ${i + 1}" ${dis}></label>
      <label class="mini"><span>MJ</span><input type="text" class="iunit" data-i="${i}" data-if="unit" list="unitlist" value="${esc(it.unit)}" aria-label="Merná jednotka, položka ${i + 1}" ${dis}></label>
      <label class="mini"><span>Cena za MJ (€)</span><input type="text" inputmode="decimal" class="iprice" data-i="${i}" data-if="price" value="${esc(fmtNumInput(it.price))}" aria-label="Cena za mernú jednotku, položka ${i + 1}" ${dis}></label>
      <span class="lt">${moneyDoc(lineTotal(it))}</span>
      ${e.readOnly ? "" : `<button type="button" class="icon-btn danger rm" data-action="ed-delitem" data-i="${i}" title="Odstrániť položku" aria-label="Odstrániť položku ${i + 1}">${icon("trash-2")}</button>`}
    </div>`).join("");
}

function editorHtml() {
  const e = ui.editing, d = e.doc, isInv = e.type === "invoice";
  const dis = e.readOnly ? "disabled" : "";
  const c = d.customer;
  const listRoute = isInv ? "faktury" : "ponuky";

  const title = e.isNew ? (isInv ? "Nová faktúra" : "Nová cenová ponuka") : esc(d.number);

  const notices = [];
  if (e.readOnly) notices.push(`<div class="notice info">${icon("lock")}<span>Faktúra je vystavená a zamknutá, aby sa omylom nezmenila. Úhradu môžeš označiť aj tak. Na úpravu klikni <b>Odomknúť</b>.</span></div>`);
  if (!profileReady()) notices.push(`<div class="notice err">${icon("triangle-alert")}<span>Chýbajú tvoje údaje dodávateľa (meno, IBAN). <a href="#/nastavenia" data-action="open-doc-settings">Doplň ich v Nastaveniach</a>, inak ich doklad nebude obsahovať.</span></div>`);
  if (d.crm) notices.push(`<div class="notice ok">${icon("link")}<span>Faktúra z CRM (<b>${esc(clientName(d.crm.clientId))}</b>, ${monthLabel(d.crm.month).toLowerCase()}). Počet hodín a ceny sú z denníka, <b>popis položiek dopíš sám</b>. Po uložení sa mesiac v CRM označí ako vyfakturovaný.</span></div>`);
  if (d.fromQuote) notices.push(`<div class="notice ok">${icon("link")}<span>Faktúra vznikla z ponuky <b>${esc(d.fromQuote)}</b>.</span></div>`);

  const docCard = `
  <div class="card" id="card-doc"><div class="card-head"><span class="card-title">${isInv ? "Faktúra" : "Cenová ponuka"}</span></div>
    <div class="form">
      <div class="row2">
        <label class="field"><span>Číslo dokladu</span><input type="text" data-df="number" value="${esc(d.number)}" ${dis}></label>
        ${isInv
          ? `<label class="field"><span>Variabilný symbol</span><input type="text" inputmode="numeric" data-df="vs" value="${esc(d.vs || "")}" ${dis}></label>`
          : `<label class="field"><span>Platnosť ponuky do</span><input type="date" data-df="validUntil" value="${esc(d.validUntil || "")}" ${dis}></label>`}
      </div>
      <div class="row2">
        <label class="field"><span>Dátum vystavenia</span><input type="date" data-df="issueDate" value="${esc(d.issueDate)}" ${dis}></label>
        ${isInv
          ? `<label class="field"><span>Dátum splatnosti</span><input type="date" data-df="dueDate" value="${esc(d.dueDate || "")}" ${dis}></label>`
          : `<label class="field"><span>Stav ponuky</span><select data-df="status" ${dis}>${Object.entries(QUOTE_STATUS).map(([k, l]) => `<option value="${k}" ${qStatus(d) === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>`}
      </div>
      ${isInv ? `<div class="row2">
        <label class="field"><span>Dátum dodania</span><input type="date" data-df="deliveryDate" value="${esc(d.deliveryDate || "")}" ${dis}></label>
        <label class="field"><span>Forma úhrady</span><select data-df="paymentMethod" ${dis}>${PAY_METHODS.map(m => `<option ${d.paymentMethod === m ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      </div>` : ""}
      ${isInv && e.readOnly ? `<label class="check"><input type="checkbox" data-paid-ed ${d.paid ? "checked" : ""}> Faktúra je uhradená${d.paid && d.paidAt ? ` (${fmtDate(d.paidAt)})` : ""}</label>` : ""}
    </div>
  </div>`;

  const custCard = `
  <div class="card" id="card-cust"><div class="card-head"><span class="card-title">Odberateľ</span></div>
    <div class="form">
      <label class="field"><span>Vybrať klienta</span><select id="f-custpick" ${dis}>${clientOptions(c.customerId)}</select></label>
      <label class="field"><span>Názov firmy / meno</span><input type="text" data-cf="name" value="${esc(c.name)}" ${dis}></label>
      <label class="field"><span>Ulica a číslo</span><input type="text" data-cf="street" value="${esc(c.street)}" ${dis}></label>
      <div class="row2">
        <label class="field"><span>PSČ</span><input type="text" data-cf="zip" value="${esc(c.zip)}" ${dis}></label>
        <label class="field"><span>Mesto</span><input type="text" data-cf="city" value="${esc(c.city)}" ${dis}></label>
      </div>
      <label class="field"><span>Štát</span><input type="text" data-cf="country" value="${esc(c.country)}" ${dis}></label>
      <div class="row3">
        <label class="field"><span>IČO</span><input type="text" inputmode="numeric" data-cf="ico" value="${esc(c.ico)}" ${dis}></label>
        <label class="field"><span>DIČ</span><input type="text" inputmode="numeric" data-cf="dic" value="${esc(c.dic)}" ${dis}></label>
        <label class="field"><span>IČ DPH</span><input type="text" data-cf="icdph" value="${esc(c.icdph)}" ${dis}></label>
      </div>
      ${e.readOnly ? "" : `<small class="muted-small">Údaje sa pri uložení pridajú medzi klientov (alebo doplnia už existujúcemu), nabudúce ich vyberieš zo zoznamu.</small>`}
    </div>
  </div>`;

  const itemsCard = `
  <div class="card" id="card-items"><div class="card-head"><span class="card-title">Položky</span></div>
    <div id="itemRows">${itemRowsHtml()}</div>
    ${e.readOnly ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-action="ed-additem">${icon("plus")} Pridať položku</button>`}
    <div class="sumline"><span class="lbl">${isInv ? "Celkom k úhrade" : "Cena celkom"}</span><span class="val" id="sumVal">${moneyDoc(docTotal(d))}</span></div>
  </div>`;

  const noteCard = `
  <div class="card" id="card-note"><div class="card-head"><span class="card-title">Poznámka</span></div>
    <textarea data-df="note" rows="3" placeholder="Napríklad: Ďakujem za spoluprácu." ${dis}>${esc(d.note || "")}</textarea></div>`;

  const tools = e.readOnly
    ? `<button type="button" class="btn btn-teal" data-action="ed-pdf">${icon("download")} Stiahnuť PDF</button>
       <button type="button" class="btn btn-ghost" data-action="ed-print">${icon("printer")} Tlačiť</button>
       <button type="button" class="btn btn-ghost" data-action="ed-unlock">${icon("lock-open")} Odomknúť</button>`
    : `<button type="button" class="btn btn-dark" data-action="ed-save">Uložiť</button>
       <button type="button" class="btn btn-teal" data-action="ed-save-pdf">${icon("download")} Uložiť a stiahnuť PDF</button>
       <button type="button" class="btn btn-ghost" data-action="ed-print">${icon("printer")} Tlačiť</button>
       <button type="button" class="btn btn-plain" data-action="ed-cancel">Zrušiť</button>`;

  const qrWarn = isInv && docTotal(d) > 0 && !docQr(d)
    ? `<div class="notice err" id="qrWarn">${icon("triangle-alert")}<span>QR kód na platbu sa nepodarilo vytvoriť. Skontroluj IBAN v Nastaveniach.</span></div>` : "";

  return `
  <div id="edRoot" data-key="${esc(e.key)}">
    <a class="back-link" href="#/${listRoute}" data-action="ed-back">${icon("arrow-left")} ${isInv ? "Faktúry" : "Cenové ponuky"}</a>
    <div class="page-head"><div><h1>${title}</h1>
      <div class="sub">${isInv ? "Faktúra" : "Cenová ponuka"}${data.profile.name ? " · " + esc(data.profile.name) : ""}</div></div></div>
    <div class="editor">
      <div class="ed-form">${notices.join("")}${docCard}${custCard}${itemsCard}${noteCard}</div>
      <div class="ed-side">
        <div class="ed-tools">${tools}<span class="hint" id="edStatus"></span></div>
        <div id="qrWarnHost">${qrWarn}</div>
        <div class="papercage"><div class="paperfit" id="paperFit">${paperHtml(d)}</div></div>
      </div>
    </div>
    <datalist id="unitlist">${UNITS.map(u => `<option value="${esc(u)}">`).join("")}</datalist>
  </div>`;
}

function afterEditorRender() {
  fitPaper();
  const e = ui.editing;
  if (e && e.isNew && !e.readOnly) {
    const first = e.doc.customer.name ? $('#edRoot [data-i="0"][data-if="desc"]') : $('#edRoot [data-cf="name"]');
    if (first) first.focus();
  }
}

function fitPaper() {
  const fit = $("#paperFit");
  if (!fit) return;
  const wrap = fit.parentElement;
  const scale = Math.min(1, (wrap.clientWidth - 32) / 794);
  fit.style.transform = `scale(${scale})`;
  const node = fit.querySelector(".paper");
  wrap.style.height = ((node ? node.offsetHeight : 1123) * scale + 32) + "px";
}

let previewTimer = null;
function schedulePreview(now) {
  clearTimeout(previewTimer);
  const run = () => {
    const e = ui.editing, fit = $("#paperFit");
    if (!e || !fit) return;
    fit.innerHTML = paperHtml(e.doc);
    fitPaper();
    const sv = $("#sumVal");
    if (sv) sv.textContent = moneyDoc(docTotal(e.doc));
    e.doc.items.forEach((it, i) => {
      const lt = $(`.itemrow[data-row="${i}"] .lt`);
      if (lt) lt.textContent = moneyDoc(lineTotal(it));
    });
    const host = $("#qrWarnHost");
    if (host && e.type === "invoice") {
      host.innerHTML = docTotal(e.doc) > 0 && !docQr(e.doc)
        ? `<div class="notice err" id="qrWarn">${icon("triangle-alert")}<span>QR kód na platbu sa nepodarilo vytvoriť. Skontroluj IBAN v Nastaveniach.</span></div>` : "";
    }
  };
  if (now) run(); else previewTimer = setTimeout(run, 120);
}

function setInputValue(sel, value) {
  const el = $(sel);
  if (el && el.value !== value) el.value = value;
}

/* zmena dátumu vystavenia posunie splatnosť / platnosť a pri novom roku aj číslo */
function afterDateChange() {
  const e = ui.editing, d = e.doc, p = data.profile;
  if (!e.dueTouched) {
    if (e.type === "invoice") { d.dueDate = addDaysStr(d.issueDate, p.dueDays || 14); setInputValue('[data-df="dueDate"]', d.dueDate); }
    else { d.validUntil = addDaysStr(d.issueDate, p.quoteValidDays || 30); setInputValue('[data-df="validUntil"]', d.validUntil); }
  }
  const y = Number(String(d.issueDate).slice(0, 4));
  if (e.isNew && !e.numberTouched && y > 2000 && seqOf({ number: d.number }, e.type, y) === null) {
    const n = nextNumber(e.type, y);
    d.number = n.number; if (e.type === "invoice") d.vs = n.vs;
    setInputValue('[data-df="number"]', d.number); setInputValue('[data-df="vs"]', d.vs || "");
  }
}

function onDocsInput(ev) {
  const t = ev.target, e = ui.editing;
  if (!e || !t.closest || !t.closest("#edRoot") || t.tagName === "SELECT" || e.readOnly) return;
  const d = e.doc;
  if (t.dataset.df) {
    const k = t.dataset.df;
    d[k] = t.value;
    if (k === "dueDate" || k === "validUntil") e.dueTouched = true;
    if (k === "number" || k === "vs") e.numberTouched = true;
    if (k === "issueDate") afterDateChange();
  } else if (t.dataset.cf) {
    d.customer[t.dataset.cf] = t.value;
    if (t.dataset.cf === "name" && d.customer.customerId) {
      const cl = clientById(d.customer.customerId);
      if (!cl || cl.name !== t.value) { d.customer.customerId = ""; const pick = $("#f-custpick"); if (pick) pick.value = ""; }
    }
  } else if (t.dataset.if) {
    const it = d.items[Number(t.dataset.i)];
    if (!it) return;
    it[t.dataset.if] = t.value;
  } else return;
  e.dirty = true;
  schedulePreview();
}

function onDocsChange(ev) {
  const t = ev.target;
  // zoznamy: označenie úhrady a zmena stavu ponuky
  if (t.dataset && t.dataset.paid) { markPaid(t.dataset.paid, t.checked); return; }
  if (t.dataset && t.dataset.qstatus) { setQuoteStatus(t.dataset.qstatus, t.value); return; }
  if (t.id === "profileImport" && t.files && t.files[0]) { importProfileFile(t.files[0]); t.value = ""; return; }
  if (t.id === "s-signature" && t.files && t.files[0]) { uploadSignature(t.files[0]); t.value = ""; return; }

  const e = ui.editing;
  if (!e || !t.closest || !t.closest("#edRoot")) return;
  if (t.dataset.paidEd !== undefined) { markPaid(e.origId, t.checked, true); return; }
  if (e.readOnly) return;
  const d = e.doc;
  if (t.id === "f-custpick") {
    const cl = clientById(t.value);
    d.customer = cl ? customerFromClient(cl) : Object.assign(emptyCustomer(), { name: d.customer.name });
    $$("#card-cust [data-cf]").forEach(inp => { inp.value = d.customer[inp.dataset.cf] || ""; });
  } else if (t.dataset.df && t.tagName === "SELECT") {
    d[t.dataset.df] = t.value;
  } else return;
  e.dirty = true;
  schedulePreview(true);
}

function validateEditing() {
  const e = ui.editing, d = e.doc;
  if (!String(d.number || "").trim()) return "Doklad musí mať číslo.";
  if (!String(d.customer.name || "").trim()) return "Vyplň názov odberateľa.";
  const items = d.items.filter(it => String(it.desc || "").trim() || numOf(it.qty) || numOf(it.price));
  if (!items.length) return "Pridaj aspoň jednu položku.";
  for (let i = 0; i < items.length; i++) {
    if (!String(items[i].desc || "").trim()) return `Doplň popis položky ${d.items.indexOf(items[i]) + 1}.`;
  }
  if (e.type === "invoice" && d.dueDate && d.issueDate && d.dueDate < d.issueDate) return "Splatnosť nemôže byť pred dátumom vystavenia.";
  const clash = listOf(e.type).find(x => x.number === d.number && x.id !== e.origId);
  if (clash) return `Doklad s číslom ${d.number} už existuje.`;
  return "";
}

/* odberateľ z dokladu sa pridá do klientov alebo doplní existujúcemu */
function ensureClientForDoc(d) {
  const c = d.customer;
  const name = String(c.name || "").trim();
  if (!name) return null;
  let client = c.customerId ? clientById(c.customerId) : null;
  if (!client) client = data.clients.find(x => x.name.trim().toLowerCase() === name.toLowerCase()) || null;
  let created = false;
  if (!client) {
    client = { id: uid(), name, contact: "", note: "", archived: false, createdAt: todayStr() };
    data.clients.push(client);
    created = true;
  }
  BILLING_FIELDS.forEach(k => { if (String(c[k] || "").trim()) client[k] = String(c[k]).trim(); });
  c.customerId = client.id;
  return { client, created };
}

function saveEditing(thenPdf) {
  const e = ui.editing;
  if (!e || e.readOnly) return;
  const err = validateEditing();
  if (err) {
    const st = $("#edStatus");
    if (st) { st.textContent = err; st.style.color = "var(--danger)"; }
    toast(err, { error: true });
    return;
  }
  const d = clone(e.doc);
  d.items = d.items
    .filter(it => String(it.desc || "").trim() || numOf(it.qty) || numOf(it.price))
    .map(it => ({ qty: numOf(it.qty), unit: it.unit || "", desc: String(it.desc || "").trim(), price: numOf(it.price) }));
  d.customer.name = d.customer.name.trim();
  d.total = docTotal(d);
  d.updatedAt = new Date().toISOString();

  const res = ensureClientForDoc(d);
  const list = listOf(e.type);
  d.id = safeId(d.number);
  const idx = list.findIndex(x => x.id === e.origId);
  if (idx >= 0) list.splice(idx, 1);
  list.push(d);

  if (e.type === "invoice") {
    d.locked = true;
    if (d.crm) {
      const k = billedKey(d.crm.clientId, d.crm.month);
      if (!data.billed[k]) data.billed[k] = d.issueDate;
    }
    if (d.fromQuote && e.isNew) {
      const q = data.quotes.find(x => x.number === d.fromQuote);
      if (q) { q.invoice = d.number; if (qStatus(q) !== "accepted") q.status = "accepted"; }
    }
  }
  const msg = `${e.type === "invoice" ? "Faktúra" : "Ponuka"} ${d.number} uložená` + (res && res.created ? ` · klient ${res.client.name} pridaný do CRM` : "");
  ui.editing = null; ui.parked = null;
  ui.year = docYear(d) || ui.year;
  navigate(e.type === "invoice" ? "faktury" : "ponuky");
  commit(msg);
  if (thenPdf) exportPdf(d);
}

/* nastaví adresu aj stav naraz, aby sa pri uložení nerenderoval starý pohľad */
function navigate(route, param) {
  ui.route = route; ui.param = param || null;
  const h = "#/" + route + (param ? "/" + encodeURIComponent(param) : "");
  if (location.hash !== h) history.pushState(null, "", h);
}

async function markPaid(id, checked, inEditor) {
  const d = data.invoices.find(x => x.id === id);
  if (!d) return;
  d.paid = !!checked;
  d.paidAt = checked ? todayStr() : null;
  if (inEditor && ui.editing && ui.editing.origId === id) {
    ui.editing.doc.paid = d.paid; ui.editing.doc.paidAt = d.paidAt;
    commit(checked ? `Faktúra ${d.number} označená ako uhradená` : `Úhrada zrušená pri ${d.number}`);
    render(true);
    return;
  }
  commit(checked ? `Faktúra ${d.number} označená ako uhradená` : `Úhrada zrušená pri ${d.number}`);
}

function setQuoteStatus(id, status) {
  const q = data.quotes.find(x => x.id === id);
  if (!q || !QUOTE_STATUS[status]) return;
  q.status = status;
  if (status === "accepted" && !q.serviceId) {
    commit(`Ponuka ${q.number} je prijatá`, { action: "Zákazka do CRM", onAction: () => openQuoteToJob(q.id) });
  } else commit(`Ponuka ${q.number}: ${QUOTE_STATUS[status].toLowerCase()}`);
}

/* ===================== PONUKA → ZÁKAZKA V CRM ===================== */

function openQuoteToJob(id) {
  const q = data.quotes.find(x => x.id === id);
  if (!q) return;
  const items = (q.items || []).map(it => it.desc).filter(Boolean);
  openModal({
    title: "Zákazka do CRM",
    body: `<div class="form">
      <p class="hint" style="margin:0">Z ponuky <b>${esc(q.number)}</b> pre <b>${esc(q.customer.name)}</b> vznikne zákazka za dielo v CRM. Klient sa v prípade potreby založí. Hodiny budeš zapisovať do denníka a cena sa započíta, keď zákazku označíš ako hotovú.</p>
      <label class="field"><span>Typ služby</span><select name="type">${serviceTypeOptions("tvorba-app")}</select></label>
      <label class="field"><span>Cena za celé dielo (€)</span><input type="text" inputmode="decimal" name="price" value="${esc(fmtNumInput(docTotal(q)))}" /></label>
      <label class="field"><span>Poznámka</span><input type="text" name="note" value="${esc("Ponuka " + q.number + (items[0] ? " – " + items[0] : ""))}" /></label>
    </div>`,
    foot: `<button type="button" class="btn btn-ghost" data-action="modal-close">Zrušiť</button>
           <button type="submit" class="btn btn-dark">Vytvoriť zákazku</button>`,
    onSubmit: form => {
      const price = parseNum(form.elements.price.value);
      if (!(price >= 0)) return fieldError(form, "Zadaj cenu za dielo.");
      const res = ensureClientForDoc(q);
      const svc = {
        id: uid(), clientId: res.client.id, type: form.elements.type.value, pricing: "dielo",
        rate: 0, price: round2(price), status: "aktivna", doneDate: null, note: form.elements.note.value.trim()
      };
      data.services.push(svc);
      q.serviceId = svc.id;
      if (qStatus(q) !== "accepted") q.status = "accepted";
      closeModal();
      commit(`Zákazka pridaná klientovi ${res.client.name}`, { action: "Otvoriť klienta", onAction: () => go("klient/" + encodeURIComponent(res.client.id)) });
    }
  });
}

/* ===================== NASTAVENIA: ÚDAJE DODÁVATEĽA ===================== */

function profileField(label, key, type, extra) {
  const v = data.profile[key];
  return `<label class="field"><span>${label}</span><input type="text" data-p="${key}" ${type === "num" ? 'inputmode="numeric"' : ""} value="${esc(v == null ? "" : v)}" ${extra || ""}></label>`;
}

function viewDocSettings() {
  const p = data.profile;
  const ni = nextNumber("invoice"), nq = nextNumber("quote");
  return `
  <div class="settings-doc">
    <div class="notice info" style="margin:0 0 16px">${icon("lock")}<span>Tieto údaje sa ukladajú len do tvojho súkromného repa (spolu s ostatnými dátami), nie do kódu appky.</span>
      <span class="banner-actions"><label class="btn btn-ghost btn-sm" style="cursor:pointer">${icon("upload")} Načítať zo súboru<input type="file" id="profileImport" accept="application/json,.json" hidden></label></span></div>
    <div class="grid grid-2">
      <div class="card"><div class="card-head"><span class="card-title">Fakturačné údaje</span></div>
        <div class="form">
          ${profileField("Obchodné meno", "name")}
          ${profileField("Ulica a číslo", "street")}
          <div class="row2">${profileField("PSČ", "zip")}${profileField("Mesto", "city")}</div>
          ${profileField("Štát", "country")}
          <div class="row3">${profileField("IČO", "ico", "num")}${profileField("DIČ", "dic", "num")}${profileField("IČ DPH", "icdph")}</div>
          ${profileField("Poznámka k DPH", "vatNote")}
        </div></div>
      <div class="card"><div class="card-head"><span class="card-title">Banka a platba</span></div>
        <div class="form">
          ${profileField("IBAN", "iban")}
          <div class="row2">${profileField("SWIFT / BIC", "swift")}${profileField("Banka", "bank")}</div>
          <div class="row2">
            <label class="field"><span>Predvolená forma úhrady</span><select data-p="paymentMethod">${PAY_METHODS.map(m => `<option ${p.paymentMethod === m ? "selected" : ""}>${m}</option>`).join("")}</select></label>
            ${profileField("Splatnosť (dni)", "dueDays", "num")}
          </div>
          <p class="hint" style="margin:0">QR kód na platbu sa na faktúru vytvára z IBAN-u, sumy a variabilného symbolu podľa slovenského štandardu Pay by Square.</p>
        </div></div>
      <div class="card"><div class="card-head"><span class="card-title">Číslovanie dokladov</span></div>
        <div class="form">
          <div class="row2">${profileField("Predpona faktúr", "invoicePrefix")}${profileField("Začať od čísla", "invoiceStart", "num")}</div>
          <p class="hint" style="margin:0">Ďalšia faktúra: <b>${esc(ni.number)}</b>, variabilný symbol <b>${esc(ni.vs)}</b>. Číslo „začať od“ platí pre rok ${p.numberingYear}, v ďalších rokoch sa číslovanie začína od 1.</p>
          <div class="row2">${profileField("Predpona ponúk", "quotePrefix")}${profileField("Začať od čísla", "quoteStart", "num")}</div>
          <p class="hint" style="margin:0">Ďalšia ponuka: <b>${esc(nq.number)}</b></p>
          ${profileField("Platnosť ponuky (dni)", "quoteValidDays", "num")}
          <label class="field"><span>Poznámka na ponuke (predvolená)</span><input type="text" data-p="quoteNote" value="${esc(p.quoteNote)}"></label>
        </div></div>
      <div class="card"><div class="card-head"><span class="card-title">Pätička a podpis</span></div>
        <div class="form">
          ${profileField("Vystavil (meno pod dokladom)", "issuedBy")}
          <div class="row2">${profileField("E-mail", "email")}${profileField("Telefón", "phone")}</div>
          ${profileField("Web", "web")}
          <label class="field"><span>Predvolená poznámka na faktúre</span><textarea data-p="defaultNote" rows="2">${esc(p.defaultNote)}</textarea></label>
          <div class="field"><span>Pečiatka a podpis</span>
            ${p.signature ? `<div class="sign-prev"><img src="${esc(p.signature)}" alt="Podpis"></div>` : `<small>Nahraj obrázok podpisu (najlepšie PNG s priehľadným pozadím). Zobrazí sa vpravo dole na doklade.</small>`}
            <div class="head-actions"><label class="btn btn-ghost btn-sm" style="cursor:pointer">${icon("upload")} Nahrať obrázok<input type="file" id="s-signature" accept="image/*" hidden></label>
              ${p.signature ? `<button type="button" class="btn btn-plain btn-sm" data-action="clear-signature">Odstrániť</button>` : ""}</div></div>
        </div></div>
    </div>
    <div class="head-actions" style="margin-top:18px"><button type="button" class="btn btn-dark" data-action="save-profile">Uložiť údaje</button></div>
  </div>`;
}

function saveProfileFromForm() {
  const numeric = ["dueDays", "invoiceStart", "quoteStart", "quoteValidDays"];
  const next = Object.assign({}, data.profile);
  $$("[data-p]").forEach(el => {
    const k = el.dataset.p;
    next[k] = numeric.includes(k) ? Math.max(numeric[1] === k || numeric[2] === k ? 1 : 0, Math.round(numOf(el.value))) : el.value.trim();
  });
  next.iban = next.iban.replace(/\s+/g, " ").toUpperCase();
  const ibanOk = !next.iban || /^[A-Z]{2}[0-9A-Z]{13,32}$/.test(next.iban.replace(/\s+/g, ""));
  data.profile = next;
  commit(ibanOk ? "Údaje uložené" : "Údaje uložené, ale IBAN nevyzerá správne. QR kód sa nevytvorí.", ibanOk ? undefined : { error: true });
}

/* údaje dodávateľa z JSON súboru (aby sa nemuseli prepisovať ručne) */
async function importProfileFile(file) {
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch (e) { toast("Súbor nie je platný JSON.", { error: true }); return; }
  const src = parsed && (parsed.spotli_profil || parsed.profile || parsed);
  if (!src || typeof src !== "object") { toast("V súbore som nenašiel údaje dodávateľa.", { error: true }); return; }
  const base = emptyProfile();
  const next = Object.assign({}, data.profile);
  let n = 0;
  Object.keys(base).forEach(k => {
    if (k === "numberingYear" || k === "signature") return;
    if (src[k] !== undefined && typeof src[k] === typeof base[k]) { next[k] = src[k]; n++; }
  });
  if (!n) { toast("V súbore som nenašiel údaje dodávateľa.", { error: true }); return; }
  data.profile = next;
  commit("Údaje dodávateľa načítané. Skontroluj ich a nahraj podpis.");
}

/* podpis sa zmenší, aby neťažil dáta */
function uploadSignature(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 500, k = Math.min(1, max / img.width);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      data.profile.signature = cv.toDataURL("image/png");
      commit("Podpis nahraný");
    };
    img.onerror = () => toast("Obrázok sa nepodarilo načítať.", { error: true });
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ===================== AKCIE ===================== */

Object.assign(ACTIONS, {
  "new-invoice": () => openNew("invoice"),
  "new-quote": () => openNew("quote"),
  "invoice-from-crm": a => {
    closeModal();
    const cid = a.dataset.client, month = a.dataset.month;
    if (!clientById(cid)) return;
    openNew("invoice", invoiceDraftFromCrm(cid, month));
  },
  "open-doc-settings": () => { ui.settingsTab = "doklady"; },

  "doc-year": a => { ui.year = Number(a.dataset.y); render(); },
  "inv-status": a => { ui.invStatus = a.dataset.s; render(); },
  "quote-filter": a => { ui.quoteStatus = a.dataset.s; render(); },

  "pdf-doc": a => { const d = docById(a.dataset.type, a.dataset.id); if (d) exportPdf(d); },
  "print-doc": a => { const d = docById(a.dataset.type, a.dataset.id); if (d) printDoc(d); },
  "dup-doc": a => {
    const d = docById(a.dataset.type, a.dataset.id);
    if (!d) return;
    const nd = blankDoc(d.type);
    nd.customer = clone(d.customer);
    nd.items = clone(d.items);
    nd.note = d.note || "";
    if (d.type === "invoice") nd.paymentMethod = d.paymentMethod;
    openNew(d.type, nd);
  },
  "delete-doc": async a => {
    const d = docById(a.dataset.type, a.dataset.id);
    if (!d) return;
    if (d.type === "invoice" && !isLastInvoice(d)) { toast("Zmazať sa dá len posledná faktúra v rade, aby v číslovaní nevznikla diera.", { error: true }); return; }
    const ok = await confirmDialog({
      title: d.type === "invoice" ? "Zmazať faktúru?" : "Zmazať ponuku?",
      text: `Doklad <b>${esc(d.number)}</b> pre ${esc((d.customer && d.customer.name) || "—")} (${moneyDoc(docTotal(d))}) sa vymaže.`,
      ok: "Zmazať", danger: true
    });
    if (!ok) return;
    withUndo(`Doklad ${d.number} zmazaný`, () => {
      const list = listOf(d.type);
      list.splice(list.findIndex(x => x.id === d.id), 1);
      if (d.type === "invoice") {
        if (d.crm && !data.invoices.some(x => x.crm && x.crm.clientId === d.crm.clientId && x.crm.month === d.crm.month)) {
          delete data.billed[billedKey(d.crm.clientId, d.crm.month)];
        }
        data.quotes.forEach(q => { if (q.invoice === d.number) delete q.invoice; });
      }
    });
  },
  "convert-quote": a => {
    const q = data.quotes.find(x => x.id === a.dataset.id);
    if (!q) return;
    const inv = blankDoc("invoice");
    inv.customer = clone(q.customer);
    inv.items = clone(q.items);
    inv.fromQuote = q.number;
    openNew("invoice", inv);
  },
  "quote-to-job": a => openQuoteToJob(a.dataset.id),

  /* editor */
  "ed-additem": () => {
    const e = ui.editing; if (!e || e.readOnly) return;
    e.doc.items.push({ qty: 1, unit: data.profile.defaultUnit || "hod.", desc: "", price: "" });
    $("#itemRows").innerHTML = itemRowsHtml();
    const last = $(`.itemrow[data-row="${e.doc.items.length - 1}"] .idesc`);
    if (last) last.focus();
    e.dirty = true; schedulePreview();
  },
  "ed-delitem": a => {
    const e = ui.editing; if (!e || e.readOnly) return;
    e.doc.items.splice(Number(a.dataset.i), 1);
    if (!e.doc.items.length) e.doc.items.push({ qty: 1, unit: data.profile.defaultUnit || "hod.", desc: "", price: "" });
    $("#itemRows").innerHTML = itemRowsHtml();
    e.dirty = true; schedulePreview();
  },
  "ed-save": () => saveEditing(false),
  "ed-save-pdf": () => saveEditing(true),
  "ed-cancel": () => {
    const e = ui.editing;
    const back = e && e.type === "invoice" ? "faktury" : "ponuky";
    ui.editing = null; ui.parked = null;
    go(back);
  },
  "ed-back": () => { /* odkaz sám prejde na zoznam; rozpracovaný doklad sa odloží */ },
  "ed-print": () => { if (ui.editing) printDoc(ui.editing.doc); },
  "ed-pdf": () => { if (ui.editing) exportPdf(ui.editing.doc); },
  "ed-unlock": () => {
    const e = ui.editing; if (!e) return;
    e.readOnly = false; e.dirty = false;
    render(true);
    toast("Faktúra je odomknutá na úpravu. Po uložení sa znova zamkne.");
  },

  /* nastavenia dokladov */
  "save-profile": () => saveProfileFromForm(),
  "clear-signature": () => { data.profile.signature = ""; commit("Podpis odstránený"); }
});
