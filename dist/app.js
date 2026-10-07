import {
  DEFAULT_PROFILE,
  appendValidationChecks,
  createCheckLink,
  createDemoXml,
  createProfileBundle,
  decodeProfile,
  exportHistoryCsv,
  exportResultJson,
  exportResultText,
  parseProfileBundle,
  parseInvoiceXml,
  profileCompleteness,
  resultSummary,
  validateInvoice
} from "./core.js";
import { extractFacturXXml } from "./facturx.js";
import { createNettingDemo, exportNettingCsv, nettingCsvTemplate, parseNettingCsv, simulateNetting } from "./netting.js";
import { validateEuropeanStandard } from "./standards.js";

const STORAGE_KEY = "eurule-checklink-v1";
const TITLES = {
  overview: ["CHECKLINK", "Vue d’ensemble"],
  profile: ["CONFIGURATION", "Mon CheckLink"],
  checker: ["PRÉVALIDATION", "Tester une facture"],
  netting: ["TRÉSORERIE", "SettleMesh Net"],
  history: ["DIAGNOSTICS", "Contrôles"],
  sources: ["TRANSPARENCE", "Sources & règles"]
};
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const clone = (value) => JSON.parse(JSON.stringify(value));

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const profile = { ...clone(DEFAULT_PROFILE), ...(saved?.profile || {}) };
    if (profile.peppolId === "0009:123456789") profile.peppolId = DEFAULT_PROFILE.peppolId;
    if (profile.vatId === "FR40123456789") profile.vatId = DEFAULT_PROFILE.vatId;
    return {
      profile,
      history: Array.isArray(saved?.history) ? saved.history.slice(0, 100) : [],
      lastResult: saved?.lastResult || null,
      netting: {
        obligations: Array.isArray(saved?.netting?.obligations) ? saved.netting.obligations.slice(0, 500) : [],
        source: saved?.netting?.source || ""
      }
    };
  } catch {
    return { profile: clone(DEFAULT_PROFILE), history: [], lastResult: null, netting: { obligations: [], source: "" } };
  }
}

const state = loadState();
let publicProfile = null;
let currentView = "overview";
let currentBatch = [];
let historyQuery = "";
let historyOutcome = "all";
let currentNettingSimulation = null;

function activeProfile() { return publicProfile || state.profile; }
function initials(name) { return String(name || "EU").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatDate(value) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: state.profile, history: state.history, lastResult: state.lastResult, netting: state.netting }));
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

function setValidationProgress(active, message = "") {
  const progress = $("#validation-progress");
  progress.hidden = !active;
  $("#validation-progress-text").textContent = message;
  $("#upload-panel").classList.toggle("processing", active);
  $$("button, input, textarea", $("#upload-panel")).forEach((element) => { element.disabled = active; });
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
  const query = historyQuery.trim().toLocaleLowerCase("fr");
  const filtered = state.history.filter((item) => {
    if (historyOutcome !== "all" && item.outcome !== historyOutcome) return false;
    if (!query) return true;
    return [item.id, item.invoice?.invoiceNumber, item.invoice?.supplierName, item.invoice?.supplierVat, item.recipient]
      .some((value) => String(value || "").toLocaleLowerCase("fr").includes(query));
  });
  empty.hidden = filtered.length > 0;
  $("h3", empty).textContent = state.history.length ? "Aucun résultat correspondant" : "Aucun contrôle pour le moment";
  $("p", empty).textContent = state.history.length ? "Modifiez la recherche ou le filtre de résultat." : "Testez une facture pour voir son diagnostic apparaître ici.";
  list.innerHTML = filtered.map((item) => `<div class="history-row"><div><strong>${escapeHtml(item.invoice.invoiceNumber || "Sans numéro")}</strong><small>${escapeHtml(item.invoice.syntax || "XML")} · ${escapeHtml(item.recipient)}</small></div><div><strong>${escapeHtml(item.invoice.supplierName || "Inconnu")}</strong><small>${escapeHtml(item.invoice.supplierVat || "TVA non lue")}</small></div><span class="result-tag ${item.outcome}">${escapeHtml(resultSummary(item).label)}</span><div class="score-bar"><i style="--score:${item.score}%"></i><strong>${item.score}</strong></div><small>${formatDate(item.checkedAt)}</small></div>`).join("");
}

function renderBatchResults(entries) {
  currentBatch = entries;
  const panel = $("#batch-panel");
  panel.hidden = false;
  const completed = entries.filter((entry) => entry.result);
  const ready = completed.filter((entry) => entry.result.outcome === "ready").length;
  const review = completed.filter((entry) => entry.result.outcome === "review").length;
  const blocked = completed.filter((entry) => entry.result.outcome === "blocked").length;
  const failed = entries.length - completed.length;
  $("#batch-title").textContent = `${entries.length} facture${entries.length > 1 ? "s" : ""} traitée${entries.length > 1 ? "s" : ""}`;
  $("#batch-metrics").innerHTML = [
    ["Total", entries.length], ["Prêtes", ready], ["À vérifier", review], ["À corriger", blocked], ["Non lues", failed]
  ].map(([label, value]) => `<div class="batch-metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#batch-list").innerHTML = entries.map((entry) => {
    if (!entry.result) return `<div class="batch-row failed"><div><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.error)}</small></div><div></div><span class="result-tag blocked">Non analysée</span><span class="score">—</span></div>`;
    const result = entry.result;
    return `<button class="batch-row" type="button" data-batch-result="${escapeHtml(result.id)}"><div><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(result.invoice.invoiceNumber || "Sans numéro")}</small></div><div><strong>${escapeHtml(result.invoice.supplierName || "Fournisseur inconnu")}</strong><small>${escapeHtml(result.invoice.currency || "Devise inconnue")}</small></div><span class="result-tag ${result.outcome}">${escapeHtml(resultSummary(result).label)}</span><span class="score">${result.score}/100</span></button>`;
  }).join("");
}

function formatMoney(value, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function renderNetting() {
  const obligations = state.netting?.obligations || [];
  const results = $("#netting-results");
  if (!obligations.length) {
    currentNettingSimulation = null;
    results.hidden = true;
    $("#netting-source p").textContent = "Aucun registre chargé. La démonstration contient cinq factures éligibles et une facture en litige.";
    return;
  }

  const simulation = simulateNetting(obligations);
  currentNettingSimulation = simulation;
  results.hidden = false;
  const currencySummary = (field) => simulation.metricsByCurrency.map((item) => formatMoney(item[field], item.currency)).join(" + ") || "0 €";
  $("#netting-gross").textContent = currencySummary("grossVolume");
  $("#netting-offset").textContent = currencySummary("nettedVolume");
  $("#netting-residual").textContent = currencySummary("residualVolume");
  $("#netting-invoices").textContent = `${simulation.eligible.length} facture${simulation.eligible.length > 1 ? "s éligibles" : " éligible"}`;
  $("#netting-rate").textContent = simulation.metricsByCurrency.length === 1
    ? `${simulation.metricsByCurrency[0].nettingRate.toLocaleString("fr-FR")} % du volume`
    : simulation.metricsByCurrency.map((item) => `${item.currency} ${item.nettingRate.toLocaleString("fr-FR")} %`).join(" · ");
  $("#netting-transfers").textContent = simulation.metrics.transfersAvoided;
  $("#netting-transfer-detail").textContent = `${simulation.metrics.transfersBefore} avant · ${simulation.metrics.transfersAfter} après`;
  $("#netting-ignored").textContent = `${simulation.ignored.length} facture${simulation.ignored.length > 1 ? "s exclues" : " exclue"}`;
  $("#netting-source p").textContent = `${state.netting.source || "Registre local"} · ${obligations.length} ligne${obligations.length > 1 ? "s" : ""} · calcul effectué dans ce navigateur.`;

  $("#netting-proposals").innerHTML = simulation.proposals.length ? simulation.proposals.map((proposal) => {
    const label = proposal.type === "bilateral" ? "Bilatérale" : "Cycle à 3";
    const path = proposal.type === "bilateral" ? proposal.parties.join(" ↔ ") : `${proposal.parties.join(" → ")} → ${proposal.parties[0]}`;
    const legs = proposal.legs.map((item) => `<div class="proposal-leg"><span>${escapeHtml(item.from)}</span><span>→</span><span>${escapeHtml(item.to)}</span><strong>${escapeHtml(formatMoney(item.amount, proposal.currency))}</strong></div>`).join("");
    const invoices = [...new Set(proposal.legs.flatMap((item) => item.allocations.map((allocation) => allocation.invoiceNumber)))].join(", ");
    return `<article class="netting-proposal"><div class="proposal-top"><div><span class="proposal-type">${label}</span><h4>${escapeHtml(path)}</h4></div><div class="proposal-value"><strong>${escapeHtml(formatMoney(proposal.grossReduction, proposal.currency))}</strong><small>volume brut réduit</small></div></div><div class="proposal-legs">${legs}</div><p class="proposal-note">Factures mobilisées : ${escapeHtml(invoices)} · accord de toutes les parties requis.</p></article>`;
  }).join("") : `<div class="empty-inline">Aucune boucle compensable détectée dans ce registre.</div>`;

  $("#netting-positions").innerHTML = simulation.positions.map((position) => `<div class="netting-position"><div><strong>${escapeHtml(position.name)}</strong><small>${escapeHtml(position.currency)} · à recevoir ${escapeHtml(formatMoney(position.receivable, position.currency))} · à payer ${escapeHtml(formatMoney(position.payable, position.currency))}</small></div><span class="${position.netPosition >= 0 ? "positive" : "negative"}">${position.netPosition >= 0 ? "+" : "−"}${escapeHtml(formatMoney(Math.abs(position.netPosition), position.currency))}</span></div>`).join("");
  $("#netting-residuals").innerHTML = simulation.residuals.length ? simulation.residuals.map((item) => `<div class="residual-row"><strong>${escapeHtml(item.debtor)}</strong><span>→</span><strong>${escapeHtml(item.creditor)}</strong><strong>${escapeHtml(formatMoney(item.remainingAmount, item.currency))}</strong></div>`).join("") : `<div class="empty-inline">Aucun paiement résiduel dans la simulation.</div>`;
}

function applyNettingObligations(obligations, source) {
  state.netting = { obligations: obligations.slice(0, 500), source };
  persist();
  renderNetting();
  if (currentView === "netting") $("#netting-results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResult(result) {
  const summary = resultSummary(result);
  const area = $("#result-area");
  area.hidden = false;
  $("#result-summary").className = `result-summary ${result.outcome}`;
  $("#result-summary").innerHTML = `<div><span class="section-label">${escapeHtml(result.id)}</span><h3>${escapeHtml(summary.label)}</h3><p>${escapeHtml(summary.headline)}</p></div><div class="score-orb"><strong>${result.score}</strong><span>sur 100</span></div>`;
  $("#checks-list").innerHTML = result.checks.map((item) => `<article class="check-row ${item.status}"><span class="check-status">${item.status === "pass" ? "✓" : item.status === "error" ? "×" : item.status === "warning" ? "!" : "i"}</span><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.message)}</p>${item.fix ? `<div class="fix"><strong>Comment corriger :</strong> ${escapeHtml(item.fix)}</div>` : ""}</div><span class="field-code">${escapeHtml(item.field)}</span></article>`).join("");
  $("#result-side").innerHTML = `<span class="section-label">Document analysé</span><h3>${escapeHtml(result.invoice.invoiceNumber || "Sans numéro")}</h3><div class="result-fact"><span>Fournisseur</span><strong>${escapeHtml(result.invoice.supplierName || "Non lu")}</strong></div><div class="result-fact"><span>Destinataire</span><strong>${escapeHtml(result.invoice.buyerName || "Non lu")}</strong></div><div class="result-fact"><span>Format</span><strong>${escapeHtml(result.invoice.container === "FACTUR-X" ? "Factur-X · CII" : result.invoice.syntax)}</strong></div><div class="result-fact"><span>Norme</span><strong>EN 16931 ${escapeHtml(result.standards?.en16931 || "précontrôle")}</strong></div><div class="result-fact"><span>Montant</span><strong>${result.invoice.payableAmount != null ? `${result.invoice.payableAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${escapeHtml(result.invoice.currency)}` : "Non lu"}</strong></div><button class="button primary full" type="button" id="download-report">Rapport lisible</button><button class="button secondary full" type="button" id="download-json-report">Rapport JSON</button><button class="button ghost full" type="button" id="new-check">Contrôler une autre facture</button><p class="disclaimer">Validation automatisée des artefacts indiqués, complétée par les exigences du destinataire. Ne constitue pas un avis juridique.</p>`;
  $("#download-report").addEventListener("click", () => download(`eurule-${result.invoice.invoiceNumber || result.id}.txt`, exportResultText(result)));
  $("#download-json-report").addEventListener("click", () => download(`eurule-${result.invoice.invoiceNumber || result.id}.json`, exportResultJson(result), "application/json;charset=utf-8"));
  $("#new-check").addEventListener("click", () => { area.hidden = true; $("#upload-panel").scrollIntoView({ behavior: "smooth" }); });
  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function buildValidationResult(xmlText, source = {}, progressPrefix = "") {
  const invoice = { ...parseInvoiceXml(xmlText), ...source };
  let result = validateInvoice(invoice, activeProfile());
  setValidationProgress(true, `${progressPrefix}${invoice.syntax === "UBL" ? "Validation EN 16931 et Peppol…" : "Validation EN 16931…"}`);
  try {
    const official = await validateEuropeanStandard(xmlText, invoice);
    result = appendValidationChecks(result, official.checks, official.metadata);
  } catch (standardError) {
    result = appendValidationChecks(result, [{
      id: "official-validator-unavailable", status: "warning", title: "Validation officielle indisponible",
      message: standardError.message || "Le moteur officiel n’a pas répondu.",
      fix: "Relancez le contrôle avec une connexion stable.", field: "EN 16931"
    }], { en16931: null, peppol: null, officialFailures: null });
  }
  return result;
}

function saveResults(results) {
  if (!results.length) return;
  state.lastResult = results[0];
  state.history.unshift(...results);
  state.history = state.history.slice(0, 100);
  persist();
  renderDashboard();
  renderHistory();
}

async function analyze(xmlText, source = {}) {
  try {
    setValidationProgress(true, "Lecture de la facture…");
    const result = await buildValidationResult(xmlText, source);
    saveResults([result]);
    $("#batch-panel").hidden = true;
    renderResult(result);
    toast("Contrôle terminé", resultSummary(result).headline);
  } catch (error) {
    toast("Fichier non analysé", error.message || "Le document ne peut pas être lu.");
  } finally {
    setValidationProgress(false);
  }
}

async function readInvoiceFile(file) {
  if (!file) throw new Error("Aucun fichier sélectionné.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Le fichier dépasse la limite de 20 Mo.");
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  if (isPdf) {
    const extracted = await extractFacturXXml(file);
    return { xmlText: extracted.xmlText, source: { container: extracted.container, attachmentName: extracted.attachmentName, originalFileName: file.name } };
  }
  if (!/\.(xml|ubl|cii)$/i.test(file.name) && !/xml/i.test(file.type)) throw new Error("Format non pris en charge. Utilisez XML UBL/CII ou PDF Factur-X.");
  return { xmlText: await file.text(), source: { container: "XML", originalFileName: file.name } };
}

async function analyzeFiles(fileList) {
  const selected = [...(fileList || [])];
  if (!selected.length) return;
  const files = selected.slice(0, 20);
  if (selected.length > files.length) toast("Lot limité à 20 fichiers", `${selected.length - files.length} fichier(s) n’ont pas été traités.`);
  const entries = [];
  setValidationProgress(true, `Préparation de ${files.length} fichier${files.length > 1 ? "s" : ""}…`);
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const prefix = files.length > 1 ? `${index + 1}/${files.length} · ` : "";
      setValidationProgress(true, `${prefix}${/\.pdf$/i.test(file.name) ? "Extraction Factur-X…" : "Lecture du XML…"}`);
      try {
        const payload = await readInvoiceFile(file);
        const result = await buildValidationResult(payload.xmlText, payload.source, prefix);
        entries.push({ name: file.name, result });
      } catch (error) {
        entries.push({ name: file.name, error: error.message || "Document non analysable." });
      }
    }
    const results = entries.flatMap((entry) => entry.result ? [entry.result] : []);
    saveResults(results);
    if (files.length === 1) {
      if (results.length === 1) {
        $("#batch-panel").hidden = true;
        renderResult(results[0]);
        toast("Contrôle terminé", resultSummary(results[0]).headline);
      } else {
        $("#result-area").hidden = true;
        renderBatchResults(entries);
        toast("Fichier non analysé", entries[0].error);
      }
    } else {
      $("#result-area").hidden = true;
      renderBatchResults(entries);
      $("#batch-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Lot terminé", `${results.length}/${files.length} facture(s) analysée(s).`);
    }
  } finally {
    setValidationProgress(false);
  }
}

function renderAll() {
  renderProfileSurface(activeProfile());
  renderDashboard();
  renderHistory();
  renderNetting();
}

function setupEvents() {
  document.addEventListener("click", (event) => {
    const route = event.target.closest("[data-route]")?.dataset.route;
    if (route) { event.preventDefault(); setView(route); }
    if (event.target.closest("[data-copy-link]")) copyCheckLink();
    const resultId = event.target.closest("[data-batch-result]")?.dataset.batchResult;
    if (resultId) {
      const result = currentBatch.find((entry) => entry.result?.id === resultId)?.result;
      if (result) renderResult(result);
    }
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
  $("#export-profile").addEventListener("click", () => {
    const name = state.profile.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "entreprise";
    download(`eurule-profil-${name}.json`, JSON.stringify(createProfileBundle(state.profile), null, 2), "application/json;charset=utf-8");
    toast("Profil exporté", "Le fichier peut être sauvegardé ou transféré à un collègue.");
  });
  $("#import-profile").addEventListener("click", () => $("#profile-import-file").click());
  $("#profile-import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 100 * 1024) return toast("Profil non importé", "Le fichier dépasse la limite de 100 Ko.");
    try {
      state.profile = parseProfileBundle(await file.text());
      persist(); renderAll(); fillProfileForm();
      toast("Profil importé", `Le CheckLink de ${state.profile.companyName} est prêt.`);
    } catch (error) {
      toast("Profil non importé", error.message || "Le fichier n’est pas compatible.");
    }
  });

  const drop = $("#drop-area");
  drop.addEventListener("click", () => $("#invoice-file").click());
  drop.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") $("#invoice-file").click(); });
  ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("dragging"); }));
  drop.addEventListener("drop", (event) => analyzeFiles(event.dataTransfer.files));
  $("#invoice-file").addEventListener("change", (event) => { analyzeFiles(event.target.files); event.target.value = ""; });
  $("#demo-invalid").addEventListener("click", () => analyze(createDemoXml({ valid: false, profile: activeProfile() }), { container: "XML", originalFileName: "demo-erreurs.xml" }));
  $("#demo-valid").addEventListener("click", () => analyze(createDemoXml({ valid: true, profile: activeProfile() }), { container: "XML", originalFileName: "demo-conforme.xml" }));
  $("#paste-toggle").addEventListener("click", () => { $("#paste-box").hidden = !$("#paste-box").hidden; });
  $("#analyze-pasted").addEventListener("click", () => analyze($("#xml-input").value, { container: "XML", originalFileName: "xml-colle.xml" }));
  $("#batch-export").addEventListener("click", () => {
    const results = currentBatch.flatMap((entry) => entry.result ? [entry.result] : []);
    if (!results.length) return toast("Aucun résultat à exporter", "Le lot ne contient aucune facture analysée.");
    download(`eurule-lot-${new Date().toISOString().slice(0, 10)}.csv`, exportHistoryCsv(results), "text/csv;charset=utf-8");
  });
  $("#export-history").addEventListener("click", () => {
    if (!state.history.length) return toast("Historique vide", "Effectuez au moins un contrôle avant l’export.");
    download(`eurule-historique-${new Date().toISOString().slice(0, 10)}.csv`, exportHistoryCsv(state.history), "text/csv;charset=utf-8");
  });
  $("#history-search").addEventListener("input", (event) => { historyQuery = event.target.value; renderHistory(); });
  $("#history-outcome").addEventListener("change", (event) => { historyOutcome = event.target.value; renderHistory(); });
  $("#clear-history").addEventListener("click", () => {
    if (!state.history.length) return toast("Historique déjà vide");
    if (!window.confirm("Effacer définitivement l’historique enregistré dans ce navigateur ?")) return;
    state.history = []; state.lastResult = null; currentBatch = []; persist(); renderDashboard(); renderHistory();
    $("#batch-panel").hidden = true; $("#result-area").hidden = true;
    toast("Historique effacé", "Les contrôles locaux ont été supprimés.");
  });

  const nettingDrop = $("#netting-drop");
  const importNettingFile = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast("Registre non importé", "La limite du CSV est fixée à 2 Mo.");
    try {
      const parsed = parseNettingCsv(await file.text());
      const rejected = parsed.rejected.length ? ` · ${parsed.rejected.length} ligne(s) non lisible(s)` : "";
      applyNettingObligations(parsed.obligations, `${file.name}${rejected}`);
      toast("Registre analysé", `${parsed.obligations.length} obligation(s) exploitable(s).`);
    } catch (error) {
      toast("Registre non importé", error.message || "Le CSV n’est pas compatible.");
    }
  };
  nettingDrop.addEventListener("click", () => $("#netting-file").click());
  nettingDrop.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("#netting-file").click(); } });
  ["dragenter", "dragover"].forEach((name) => nettingDrop.addEventListener(name, (event) => { event.preventDefault(); nettingDrop.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => nettingDrop.addEventListener(name, (event) => { event.preventDefault(); nettingDrop.classList.remove("dragging"); }));
  nettingDrop.addEventListener("drop", (event) => importNettingFile(event.dataTransfer.files[0]));
  $("#netting-file").addEventListener("change", (event) => { importNettingFile(event.target.files[0]); event.target.value = ""; });
  $("#netting-demo").addEventListener("click", () => {
    applyNettingObligations(createNettingDemo(), "Réseau de démonstration");
    toast("Simulation prête", "Les compensations bilatérale et triangulaire ont été calculées.");
  });
  $("#netting-template").addEventListener("click", () => download("settlemesh-modele-compensation.csv", `\ufeff${nettingCsvTemplate()}`, "text/csv;charset=utf-8"));
  $("#netting-export").addEventListener("click", () => {
    if (!currentNettingSimulation?.proposals.length) return toast("Aucune proposition à exporter", "Chargez un registre contenant des dettes réciproques.");
    download(`settlemesh-propositions-${new Date().toISOString().slice(0, 10)}.csv`, exportNettingCsv(currentNettingSimulation), "text/csv;charset=utf-8");
  });
  window.addEventListener("hashchange", parseLocation);
}

setupEvents();
parseLocation();
renderAll();
fillProfileForm();
