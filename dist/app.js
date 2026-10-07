import {
  DEFAULT_PROFILE,
  createCheckLink,
  createDemoXml,
  decodeProfile,
  exportResultText,
  parseInvoiceXml,
  profileCompleteness,
  resultSummary,
  validateInvoice
} from "./core.js";

const STORAGE_KEY = "eurule-checklink-v1";
const TITLES = {
  overview: ["CHECKLINK", "Vue d’ensemble"],
  profile: ["CONFIGURATION", "Mon CheckLink"],
  checker: ["PRÉVALIDATION", "Tester une facture"],
  history: ["DIAGNOSTICS", "Contrôles"],
  sources: ["TRANSPARENCE", "Sources & règles"]
};
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const clone = (value) => JSON.parse(JSON.stringify(value));

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      profile: { ...clone(DEFAULT_PROFILE), ...(saved?.profile || {}) },
      history: Array.isArray(saved?.history) ? saved.history.slice(0, 50) : [],
      lastResult: saved?.lastResult || null
    };
  } catch {
    return { profile: clone(DEFAULT_PROFILE), history: [], lastResult: null };
  }
}

const state = loadState();
let publicProfile = null;
let currentView = "overview";

function activeProfile() { return publicProfile || state.profile; }
function initials(name) { return String(name || "EU").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatDate(value) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: state.profile, history: state.history, lastResult: state.lastResult }));
}

function toast(title, detail = "") {
  const item = document.createElement("div");
  item.className = "toast";
  item.innerHTML = `<span>✓</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>`;
  $("#toast-stack").append(item);
  window.setTimeout(() => item.remove(), 3500);
}

function download(filename, content, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function linkFor(profile = state.profile) { return createCheckLink(profile, window.location); }

async function copyCheckLink() {
  const link = linkFor(state.profile);
  try { await navigator.clipboard.writeText(link); }
  catch {
    const input = document.createElement("textarea"); input.value = link; document.body.append(input); input.select(); document.execCommand("copy"); input.remove();
  }
  toast("CheckLink copié", "Vous pouvez maintenant l’envoyer à un fournisseur.");
}

function setView(view, { updateHash = true } = {}) {
  if (!TITLES[view]) return;
  currentView = view;
  $$(".view").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$("[data-route]", $("#sidebar")).forEach((item) => item.classList.toggle("active", item.dataset.route === view));
  $("#page-eyebrow").textContent = TITLES[view][0];
  $("#page-title").textContent = TITLES[view][1];
  if (updateHash && !publicProfile) history.replaceState(null, "", `#${view}`);
  document.body.classList.remove("menu-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "profile") fillProfileForm();
}

function parseLocation() {
  const hash = location.hash || "#overview";
  if (hash.startsWith("#check/")) {
    const parts = hash.split("/");
    const decoded = decodeProfile(parts.at(-1));
    if (decoded) {
      publicProfile = decoded;
      document.body.classList.add("public-mode");
      currentView = "checker";
      $$(".view").forEach((item) => item.classList.toggle("active", item.dataset.view === "checker"));
      renderProfileSurface(decoded);
      return;
    }
  }
  publicProfile = null;
  document.body.classList.remove("public-mode");
  const route = hash.slice(1);
  setView(TITLES[route] ? route : "overview", { updateHash: false });
}

function renderProfileSurface(profile) {
  const avatar = initials(profile.companyName);
  $("#workspace-name").textContent = profile.companyName;
  $("#workspace-avatar").textContent = avatar;
  $("#preview-company-name").textContent = profile.companyName;
  $("#preview-legal-name").textContent = profile.legalName;
  $("#preview-vat").textContent = profile.vatId || "TVA non renseignée";
  $("#preview-country").textContent = profile.country;
  $("#preview-avatar").textContent = avatar;
  $("#side-avatar").textContent = avatar;
  $("#side-company").textContent = profile.companyName;
  $("#checker-avatar").textContent = avatar;
  $("#checker-company").textContent = profile.companyName;
  $("#checker-legal").textContent = `${profile.legalName} · ${profile.vatId || "TVA non renseignée"}`;
  $("#checker-instructions").textContent = profile.instructions || "Aucune instruction complémentaire.";

  const rules = [
    ...(profile.acceptedFormats || []).map((format) => `<span>${escapeHtml(format)}</span>`),
    profile.requirePurchaseOrder ? "<span>Commande requise</span>" : "",
    profile.requireEndpoint ? "<span>Routage vérifié</span>" : ""
  ].filter(Boolean).join("");
  $("#preview-rules").innerHTML = rules;
  $("#checker-pills").innerHTML = `${(profile.acceptedFormats || []).map((format) => `<span>${escapeHtml(format)}</span>`).join("")}<span>${escapeHtml((profile.acceptedCurrencies || []).join(" · "))}</span>`;

  const requirements = [
    ["ID", "Bonne entité légale", `${profile.legalName} · ${profile.vatId || "TVA à confirmer"}`],
    ["↗", "Adresse de réception", profile.requireEndpoint ? (profile.peppolId || "Adresse électronique requise") : "Adresse électronique recommandée"],
    ["PO", "Numéro de commande", profile.requirePurchaseOrder ? "Obligatoire dans BT-13" : "Facultatif"],
    ["€", "Devise", (profile.acceptedCurrencies || ["EUR"]).join(", ")]
  ];
  if (profile.requireBuyerReference) requirements.push(["BR", "Référence acheteur", "Obligatoire dans BT-10"]);
  if (profile.requireAttachment) requirements.push(["＋", "Pièce justificative", "À joindre lors de la soumission"]);
  $("#requirements-list").innerHTML = requirements.map(([icon, title, detail]) => `<div class="requirement"><span>${icon}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div></div>`).join("");
}

function renderDashboard() {
  const profile = state.profile;
  const completeness = profileCompleteness(profile);
  const ready = state.history.filter((item) => item.outcome === "ready").length;
  const errors = state.history.reduce((sum, item) => sum + (item.counts?.error || 0), 0);
  $("#metric-profile").textContent = `${completeness}%`;
  $("#metric-profile-copy").textContent = completeness === 100 ? "prêt à partager" : "configuration à compléter";
  $("#metric-checks").textContent = state.history.length;
  $("#metric-ready").textContent = ready;
  $("#metric-ready-rate").textContent = state.history.length ? `${Math.round((ready / state.history.length) * 100)}% des contrôles` : "Aucun contrôle";
  $("#metric-errors").textContent = errors;
  $("#profile-score-pill").textContent = `${completeness}%`;
  $("#history-count-pill").textContent = state.history.length;
  $("#overview-link").textContent = linkFor(profile);
  $("#side-link").textContent = linkFor(profile);
  $("#completion-value").textContent = `${completeness}%`;
  $("#completion-ring").style.setProperty("--value", completeness);

  const readiness = [
    [Boolean(profile.legalName && profile.vatId), "Identité légale", profile.legalName || "À compléter"],
    [Boolean(profile.acceptedFormats?.length), "Formats acceptés", (profile.acceptedFormats || []).join(", ") || "À choisir"],
    [Boolean(profile.instructions), "Instructions fournisseur", profile.instructions ? "Publiées dans le lien" : "À rédiger"],
    [Boolean(profile.peppolId), "Routage électronique", profile.peppolId || "À renseigner"]
  ];
  $("#readiness-list").innerHTML = readiness.map(([ok, label, detail]) => `<div class="readiness-item ${ok ? "" : "missing"}"><span class="status-icon">${ok ? "✓" : "!"}</span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></div>`).join("");

  const recent = state.history.slice(0, 4);
  $("#recent-list").innerHTML = recent.length ? recent.map((item) => {
    const label = resultSummary(item).label;
    return `<div class="recent-row"><div><strong>${escapeHtml(item.invoice.invoiceNumber || "Sans numéro")}</strong><small>${escapeHtml(item.invoice.syntax || "XML")} · ${escapeHtml(item.recipient)}</small></div><div><strong>${escapeHtml(item.invoice.supplierName || "Fournisseur inconnu")}</strong><small>${escapeHtml(item.invoice.supplierVat || "TVA non lue")}</small></div><span class="result-tag ${item.outcome}">${escapeHtml(label)}</span><small>${formatDate(item.checkedAt)}</small></div>`;
  }).join("") : `<div class="empty-inline">Aucun contrôle. Lancez l’exemple pour voir le diagnostic en action.</div>`;
}

function fillProfileForm() {
  const form = $("#profile-form");
  if (!form) return;
  const profile = state.profile;
  ["companyName", "legalName", "country", "vatId", "peppolId", "routingProvider", "submissionEmail", "instructions"].forEach((name) => { form.elements[name].value = profile[name] || ""; });
  form.elements.acceptedCurrencies.value = (profile.acceptedCurrencies || []).join(", ");
  $$('input[name="formats"]', form).forEach((input) => { input.checked = profile.acceptedFormats?.includes(input.value); });
  ["requirePurchaseOrder", "requireBuyerReference", "requireEndpoint", "requireAttachment"].forEach((name) => { form.elements[name].checked = Boolean(profile[name]); });
}

function profileFromForm(form) {
  const data = new FormData(form);
  return {
    companyName: String(data.get("companyName") || "").trim(), legalName: String(data.get("legalName") || "").trim(),
    country: String(data.get("country") || "FR"), vatId: String(data.get("vatId") || "").trim().toUpperCase(),
    peppolId: String(data.get("peppolId") || "").trim(), routingProvider: String(data.get("routingProvider") || "").trim(),
    acceptedFormats: data.getAll("formats"),
    acceptedCurrencies: String(data.get("acceptedCurrencies") || "EUR").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean),
    requirePurchaseOrder: data.has("requirePurchaseOrder"), requireBuyerReference: data.has("requireBuyerReference"),
    requireEndpoint: data.has("requireEndpoint"), requireAttachment: data.has("requireAttachment"),
    submissionEmail: String(data.get("submissionEmail") || "").trim(), instructions: String(data.get("instructions") || "").trim()
  };
}

function renderHistory() {
  const list = $("#history-list");
  const empty = $("#history-empty");
  empty.hidden = state.history.length > 0;
  list.innerHTML = state.history.map((item) => `<div class="history-row"><div><strong>${escapeHtml(item.invoice.invoiceNumber || "Sans numéro")}</strong><small>${escapeHtml(item.invoice.syntax || "XML")} · ${escapeHtml(item.recipient)}</small></div><div><strong>${escapeHtml(item.invoice.supplierName || "Inconnu")}</strong><small>${escapeHtml(item.invoice.supplierVat || "TVA non lue")}</small></div><span class="result-tag ${item.outcome}">${escapeHtml(resultSummary(item).label)}</span><div class="score-bar"><i style="--score:${item.score}%"></i><strong>${item.score}</strong></div><small>${formatDate(item.checkedAt)}</small></div>`).join("");
}

function renderResult(result) {
  const summary = resultSummary(result);
  const area = $("#result-area");
  area.hidden = false;
  $("#result-summary").className = `result-summary ${result.outcome}`;
  $("#result-summary").innerHTML = `<div><span class="section-label">${escapeHtml(result.id)}</span><h3>${escapeHtml(summary.label)}</h3><p>${escapeHtml(summary.headline)}</p></div><div class="score-orb"><strong>${result.score}</strong><span>sur 100</span></div>`;
  $("#checks-list").innerHTML = result.checks.map((item) => `<article class="check-row ${item.status}"><span class="check-status">${item.status === "pass" ? "✓" : item.status === "error" ? "×" : item.status === "warning" ? "!" : "i"}</span><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.message)}</p>${item.fix ? `<div class="fix"><strong>Comment corriger :</strong> ${escapeHtml(item.fix)}</div>` : ""}</div><span class="field-code">${escapeHtml(item.field)}</span></article>`).join("");
  $("#result-side").innerHTML = `<span class="section-label">Document analysé</span><h3>${escapeHtml(result.invoice.invoiceNumber || "Sans numéro")}</h3><div class="result-fact"><span>Fournisseur</span><strong>${escapeHtml(result.invoice.supplierName || "Non lu")}</strong></div><div class="result-fact"><span>Destinataire</span><strong>${escapeHtml(result.invoice.buyerName || "Non lu")}</strong></div><div class="result-fact"><span>Format</span><strong>${escapeHtml(result.invoice.syntax)}</strong></div><div class="result-fact"><span>Montant</span><strong>${result.invoice.payableAmount != null ? `${result.invoice.payableAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${escapeHtml(result.invoice.currency)}` : "Non lu"}</strong></div><button class="button primary full" type="button" id="download-report">Télécharger le rapport</button><button class="button ghost full" type="button" id="new-check">Contrôler une autre facture</button><p class="disclaimer">Aide à la préparation. Ce résultat ne constitue pas une certification juridique.</p>`;
  $("#download-report").addEventListener("click", () => download(`eurule-${result.invoice.invoiceNumber || result.id}.txt`, exportResultText(result)));
  $("#new-check").addEventListener("click", () => { area.hidden = true; $("#upload-panel").scrollIntoView({ behavior: "smooth" }); });
  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

function analyze(xmlText) {
  try {
    const invoice = parseInvoiceXml(xmlText);
    const result = validateInvoice(invoice, activeProfile());
    state.lastResult = result;
    state.history.unshift(result);
    state.history = state.history.slice(0, 50);
    persist(); renderResult(result); renderDashboard(); renderHistory();
    toast("Contrôle terminé", resultSummary(result).headline);
  } catch (error) {
    toast("Fichier non analysé", error.message || "Le document ne peut pas être lu.");
  }
}

async function analyzeFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast("Fichier trop volumineux", "La limite du MVP est fixée à 5 Mo.");
  if (!/\.(xml|ubl|cii)$/i.test(file.name) && !/xml/i.test(file.type)) return toast("Format non pris en charge", "Utilisez un fichier XML UBL ou CII pour ce MVP.");
  analyze(await file.text());
}

function renderAll() {
  renderProfileSurface(activeProfile());
  renderDashboard();
  renderHistory();
}

function setupEvents() {
  document.addEventListener("click", (event) => {
    const route = event.target.closest("[data-route]")?.dataset.route;
    if (route) { event.preventDefault(); setView(route); }
    if (event.target.closest("[data-copy-link]")) copyCheckLink();
  });
  $("#copy-link").addEventListener("click", copyCheckLink);
  $("#preview-link").addEventListener("click", () => window.open(linkFor(state.profile), "_blank", "noopener"));
  $("#mobile-menu").addEventListener("click", () => document.body.classList.toggle("menu-open"));

  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = profileFromForm(event.currentTarget);
    if (!profile.acceptedFormats.length) return toast("Choisissez un format", "Sélectionnez au moins UBL, CII ou Factur-X.");
    state.profile = profile; persist(); renderAll(); fillProfileForm();
    $("#save-status").textContent = `Enregistré à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
    toast("CheckLink actualisé", "Les nouvelles exigences sont intégrées au lien.");
  });

  const drop = $("#drop-area");
  drop.addEventListener("click", () => $("#invoice-file").click());
  drop.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") $("#invoice-file").click(); });
  ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("dragging"); }));
  drop.addEventListener("drop", (event) => analyzeFile(event.dataTransfer.files[0]));
  $("#invoice-file").addEventListener("change", (event) => analyzeFile(event.target.files[0]));
  $("#demo-invalid").addEventListener("click", () => analyze(createDemoXml({ valid: false, profile: activeProfile() })));
  $("#demo-valid").addEventListener("click", () => analyze(createDemoXml({ valid: true, profile: activeProfile() })));
  $("#paste-toggle").addEventListener("click", () => { $("#paste-box").hidden = !$("#paste-box").hidden; });
  $("#analyze-pasted").addEventListener("click", () => analyze($("#xml-input").value));
  $("#clear-history").addEventListener("click", () => { state.history = []; state.lastResult = null; persist(); renderDashboard(); renderHistory(); toast("Historique effacé", "Les contrôles locaux ont été supprimés."); });
  window.addEventListener("hashchange", parseLocation);
}

setupEvents();
parseLocation();
renderAll();
fillProfileForm();
