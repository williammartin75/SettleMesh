import { captureAnalysisContext, analysisContextIsCurrent } from "./analysis-context.js";
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
import { checkPeppolIdentity, checkViesIdentity } from "./identity.js";
import {
  exportLocalMetrics,
  normalizeLocalMetrics,
  recordMetricAction,
  recordValidationRun,
  resetLocalMetrics,
  summarizeLocalMetrics
} from "./metrics.js";
import { createNettingDemo, exportNettingCsv, nettingCsvTemplate, parseNettingCsv, simulateNetting } from "./netting.js";
import { publishRequirements, searchRequirements, unpublishRequirements, verifyRequirements, resolveRequirements } from "./requirements.js";
import { reportEvent } from "./reporting.js";
import { activePacks } from "./rules/index.mjs";
import { validateEuropeanStandard } from "./standards.js";
import { compactHistory, createPersistedState, readPersistedState, writePersistedState } from "./storage.js";

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
const NETTING_SCENARIO_MODES = new Set(["all", "today", "custom"]);

function normalizeNettingScenario(value) {
  const mode = NETTING_SCENARIO_MODES.has(value?.mode) ? value.mode : "all";
  const cutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value?.cutoffDate || "")) ? String(value.cutoffDate) : "";
  return mode === "custom" && !cutoffDate ? { mode: "all", cutoffDate: "" } : { mode, cutoffDate };
}

function todayIsoDate() {
  const date = new Date();
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

function scenarioCutoffDate(scenario) {
  if (scenario.mode === "today") return todayIsoDate();
  if (scenario.mode === "custom") return scenario.cutoffDate;
  return "";
}

function formatIsoDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function loadState() {
  const persisted = readPersistedState(localStorage);
  const saved = persisted.value;
  try {
    const profile = { ...clone(DEFAULT_PROFILE), ...(saved?.profile || {}) };
    if (profile.peppolId === "0009:123456789") profile.peppolId = DEFAULT_PROFILE.peppolId;
    if (profile.vatId === "FR40123456789") profile.vatId = DEFAULT_PROFILE.vatId;
    const history = compactHistory(saved?.history);
    const loaded = {
      profile,
      history,
      lastResult: saved?.lastResult || null,
      metrics: normalizeLocalMetrics(saved?.metrics, { history }),
      netting: {
        obligations: Array.isArray(saved?.netting?.obligations) && saved.netting.obligations.length <= 500 ? saved.netting.obligations : [],
        source: saved?.netting?.source || "",
        scenario: normalizeNettingScenario(saved?.netting?.scenario)
      }
    };
    writePersistedState(localStorage, createPersistedState(loaded));
    return loaded;
  } catch {
    return { profile: clone(DEFAULT_PROFILE), history: [], lastResult: null, metrics: normalizeLocalMetrics(null), netting: { obligations: [], source: "", scenario: normalizeNettingScenario(null) } };
  }
}

const state = loadState();
let publicProfile = null;
let currentSurfaceProfile = null;
let currentView = "overview";
let currentBatch = [];
let historyQuery = "";
let historyOutcome = "all";
let currentNettingSimulation = null;
let linkLoadBlocked = false;
let locationRevision = 0;

function activeProfile() { return publicProfile || state.profile; }
function initials(name) { return String(name || "EU").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatDate(value) { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

function persist() {
  writePersistedState(localStorage, createPersistedState(state));
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
  state.metrics = recordMetricAction(state.metrics, "checklink-copy");
  persist();
  renderDashboard();
  // Signalement consenti : ne part que si le profil porte usageMetricsConsent.
  reportEvent(state.profile, "checklink_copied").catch(() => {});
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
  if (view === "sources") prefillIdentityForms();
}

async function parseLocation() {
  const revision = ++locationRevision;
  linkLoadBlocked = false;
  $("#visitor-metrics-consent").checked = false;
  $("#result-area").hidden = true;
  $("#batch-panel").hidden = true;
  $("#checklink-verify-result").hidden = true;
  const hash = location.hash || "#overview";
  if (hash.startsWith("#buyer/")) {
    linkLoadBlocked = true;
    publicProfile = { companyName: "Chargement du profil publié…", legalName: "", acceptedFormats: [], acceptedCurrencies: [] };
    document.body.classList.add("public-mode");
    setView("checker", { updateHash: false });
    $("#link-status").textContent = "Chargement des exigences courantes. Ne déposez pas encore de facture.";
    renderProfileSurface(publicProfile);
    try {
      const record = await resolveRequirements(hash.slice(7));
      if (revision !== locationRevision) return;
      publicProfile = { ...record.profile, organizationId: record.organizationId, published: true, version: record.version, metricsToken: record.metricsToken };
      linkLoadBlocked = false;
      renderProfileSurface(publicProfile);
      $("#link-status").textContent = `Exigences publiées · version ${record.version} · chargées à l'ouverture. Déclarations de l'acheteur, pas certification d'identité ou de conformité juridique.`;
    } catch (error) {
      if (revision !== locationRevision) return;
      publicProfile.companyName = "Lien indisponible";
      renderProfileSurface(publicProfile);
      $("#link-status").textContent = `${error.message} Aucun profil de remplacement utilisé ; le contrôle est bloqué.`;
    }
    return;
  }
  if (hash.startsWith("#check/")) {
    const parts = hash.split("/");
    const decoded = decodeProfile(parts.at(-1));
    if (decoded) {
      publicProfile = decoded;
      document.body.classList.add("public-mode");
      currentView = "checker";
      $$(".view").forEach((item) => item.classList.toggle("active", item.dataset.view === "checker"));
      renderProfileSurface(decoded);
      $("#link-status").textContent = "Lien instantané non authentifié : les exigences sont intégrées au lien et ne se mettent pas à jour. Comparez-les au registre avant utilisation.";
      return;
    }
  }
  publicProfile = null;
  renderProfileSurface(state.profile);
  $("#link-status").textContent = "Profil local de démonstration, non certifié. Publiez vos exigences pour obtenir un lien stable.";
  document.body.classList.remove("public-mode");
  const route = hash.slice(1);
  setView(TITLES[route] ? route : "overview", { updateHash: false });
}

function renderProfileSurface(profile) {
  currentSurfaceProfile = profile;
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
  renderNationalPacks(profile);
}

function prefillIdentityForms() {
  const profile = state.profile;
  const country = String(profile.country || "FR").toUpperCase();
  const vat = String(profile.vatId || "").replace(/[\s.\-]/g, "").toUpperCase();
  if ([...$("#vies-country").options].some((option) => option.value === country)) $("#vies-country").value = country;
  $("#vies-number").value = vat.startsWith(country) ? vat.slice(country.length) : vat;
  $("#peppol-number").value = profile.peppolId || "";
}

function renderIdentityResult(target, result) {
  const status = result?.status || "unavailable";
  const labels = {
    loading: ["…", "Vérification en cours"],
    verified: ["✓", "Vérifié"],
    not_verified: ["!", "Non vérifié"],
    unavailable: ["×", "Indisponible"]
  };
  const [icon, label] = labels[status] || labels.unavailable;
  target.className = `identity-result ${status.replace("_", "-")}`;
  target.querySelector(":scope > span").textContent = icon;
  target.querySelector("strong").textContent = label;
  const details = [result?.message];
  if (result?.legalName) details.push(result.legalName);
  if (result?.address) details.push(result.address);
  if (result?.countryCode) details.push(`Pays : ${result.countryCode}`);
  if (Number.isFinite(result?.acceptedDocumentTypes) && status === "verified") details.push(`${result.acceptedDocumentTypes} type(s) de document déclaré(s)`);
  if (result?.checkedAt && status !== "loading") details.push(`Consulté le ${formatDate(result.checkedAt)}`);
  target.querySelector("small").textContent = details.filter(Boolean).join("\n");
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

  const pilot = summarizeLocalMetrics(state.metrics);
  $("#pilot-link-copies").textContent = pilot.checkLinkCopies;
  $("#pilot-files").textContent = pilot.validationAttempts;
  $("#pilot-readable-rate").textContent = pilot.readableRate == null ? "—" : `${pilot.readableRate}%`;
  $("#pilot-ready-rate").textContent = pilot.readyRate == null ? "—" : `${pilot.readyRate}%`;
  $("#pilot-average-time").textContent = pilot.averageDurationMs == null ? "—" : pilot.averageDurationMs < 1000 ? `${pilot.averageDurationMs} ms` : `${(pilot.averageDurationMs / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
  $("#pilot-period").textContent = `Depuis le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(pilot.periodStartedAt))} · ${pilot.profileUpdates} mise${pilot.profileUpdates > 1 ? "s" : ""} à jour du profil`;

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

function renderNationalPacks(profile) {
  const packs = activePacks(profile?.country);
  $("#national-packs").innerHTML = packs.map((pack) => `<article class="source-card active-source"><div class="source-icon national">${escapeHtml(pack.country)}</div><span class="source-state">Pack v${escapeHtml(pack.version)} actif depuis le ${escapeHtml(formatDate(pack.effectiveFrom))}</span><h3>Règles nationales — ${escapeHtml(pack.country)}</h3><p>${escapeHtml(pack.ruleTitles.join(" · "))}.</p><a href="${escapeHtml(pack.sourceHref)}" target="_blank" rel="noreferrer">${escapeHtml(pack.sourceLabel)} ↗</a></article>`).join("");
}
function fillProfileForm() {
  const form = $("#profile-form");
  if (!form) return;
  const profile = state.profile;
  ["companyName", "legalName", "country", "vatId", "peppolId", "routingProvider", "submissionEmail", "instructions"].forEach((name) => { form.elements[name].value = profile[name] || ""; });
  form.elements.acceptedCurrencies.value = (profile.acceptedCurrencies || []).join(", ");
  $$('input[name="formats"]', form).forEach((input) => { input.checked = profile.acceptedFormats?.includes(input.value); });
  ["requirePurchaseOrder", "requireBuyerReference", "requireEndpoint", "requireAttachment"].forEach((name) => { form.elements[name].checked = Boolean(profile[name]); });
  form.elements.usageMetricsConsent.checked = profile.usageMetricsConsent === true;
}

function profileFromForm(form) {
  const data = new FormData(form);
  return {
    ...(state.profile.organizationId ? { organizationId: state.profile.organizationId } : {}),
    published: false,
    companyName: String(data.get("companyName") || "").trim(), legalName: String(data.get("legalName") || "").trim(),
    country: String(data.get("country") || "FR"), vatId: String(data.get("vatId") || "").trim().toUpperCase(),
    peppolId: String(data.get("peppolId") || "").trim(), routingProvider: String(data.get("routingProvider") || "").trim(),
    acceptedFormats: data.getAll("formats"),
    acceptedCurrencies: String(data.get("acceptedCurrencies") || "EUR").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean),
    requirePurchaseOrder: data.has("requirePurchaseOrder"), requireBuyerReference: data.has("requireBuyerReference"),
    requireEndpoint: data.has("requireEndpoint"), requireAttachment: data.has("requireAttachment"),
    usageMetricsConsent: data.has("usageMetricsConsent"),
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

  const scenario = normalizeNettingScenario(state.netting.scenario);
  state.netting.scenario = scenario;
  const cutoffDate = scenarioCutoffDate(scenario);
  const simulation = simulateNetting(obligations, { cutoffDate });
  currentNettingSimulation = simulation;
  results.hidden = false;
  $$('[data-netting-scenario]').forEach((button) => {
    const active = button.dataset.nettingScenario === scenario.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#netting-cutoff").value = scenario.mode === "custom" ? scenario.cutoffDate : "";
  const scenarioLabel = cutoffDate ? `Cut-off au ${formatIsoDate(cutoffDate)}` : "Toutes les échéances";
  $("#netting-scenario-name").textContent = scenarioLabel;
  $("#netting-scenario-summary").textContent = cutoffDate
    ? `${simulation.eligible.length} incluse(s) · ${simulation.deferred.length} hors période ou sans échéance · ${simulation.ignored.length} non éligible(s).`
    : `${simulation.eligible.length} incluse(s) · ${simulation.ignored.length} non éligible(s). Activez un cut-off pour isoler une période.`;
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
  const excludedCount = simulation.ignored.length;
  const deferredCount = simulation.deferred.length;
  $("#netting-ignored").textContent = `${excludedCount} exclue${excludedCount > 1 ? "s" : ""}${cutoffDate ? ` · ${deferredCount} hors période` : ""}`;
  $("#netting-source p").textContent = `${state.netting.source || "Registre local"} · ${obligations.length} ligne${obligations.length > 1 ? "s" : ""} · ${scenarioLabel.toLocaleLowerCase("fr-FR")} · calcul local.`;

  $("#netting-proposals").innerHTML = simulation.proposals.length ? simulation.proposals.map((proposal) => {
    const label = proposal.type === "bilateral" ? "Bilatérale" : "Cycle à 3";
    const path = proposal.type === "bilateral" ? proposal.parties.join(" ↔ ") : `${proposal.parties.join(" → ")} → ${proposal.parties[0]}`;
    const legs = proposal.legs.map((item) => `<div class="proposal-leg"><span>${escapeHtml(item.from)}</span><span>→</span><span>${escapeHtml(item.to)}</span><strong>${escapeHtml(formatMoney(item.amount, proposal.currency))}</strong></div>`).join("");
    const invoices = [...new Set(proposal.legs.flatMap((item) => item.allocations.map((allocation) => allocation.invoiceNumber)))].join(", ");
    return `<article class="netting-proposal"><div class="proposal-top"><div><span class="proposal-type">${label}</span><h4>${escapeHtml(path)}</h4></div><div class="proposal-value"><strong>${escapeHtml(formatMoney(proposal.grossReduction, proposal.currency))}</strong><small>volume brut réduit</small></div></div><div class="proposal-legs">${legs}</div><p class="proposal-note">Factures mobilisées : ${escapeHtml(invoices)} · accord de toutes les parties requis.</p></article>`;
  }).join("") : `<div class="empty-inline">${simulation.eligible.length ? "Aucune boucle compensable détectée dans ce scénario." : "Aucune obligation éligible à cette date de cut-off."}</div>`;

  $("#netting-positions").innerHTML = simulation.positions.length ? simulation.positions.map((position) => `<div class="netting-position"><div><strong>${escapeHtml(position.name)}</strong><small>${escapeHtml(position.currency)} · à recevoir ${escapeHtml(formatMoney(position.receivable, position.currency))} · à payer ${escapeHtml(formatMoney(position.payable, position.currency))}</small></div><span class="${position.netPosition >= 0 ? "positive" : "negative"}">${position.netPosition >= 0 ? "+" : "−"}${escapeHtml(formatMoney(Math.abs(position.netPosition), position.currency))}</span></div>`).join("") : `<div class="empty-inline">Aucune position dans le périmètre sélectionné.</div>`;
  $("#netting-residuals").innerHTML = simulation.residuals.length ? simulation.residuals.map((item) => `<div class="residual-row"><strong>${escapeHtml(item.debtor)}</strong><span>→</span><strong>${escapeHtml(item.creditor)}</strong><strong>${escapeHtml(formatMoney(item.remainingAmount, item.currency))}</strong></div>`).join("") : `<div class="empty-inline">Aucun paiement résiduel dans la simulation.</div>`;
  $("#netting-exclusions").innerHTML = `<h3>Factures exclues du calcul</h3>${[...simulation.ignored, ...simulation.deferred].map((item) => `<p>${escapeHtml(item.invoiceNumber || "Sans référence")} · ${escapeHtml(item.reason)}</p>`).join("") || "<p>Aucune exclusion.</p>"}`;
}

function applyNettingObligations(obligations, source) {
  simulateNetting(obligations); // Validate capacity and invariants before replacing local state.
  state.netting = { obligations, source, scenario: { mode: "all", cutoffDate: "" } };
  persist();
  renderNetting();
  if (currentView === "netting") $("#netting-results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResult(result) {
  const summary = resultSummary(result);
  const pdfa = result.invoice.containerPreflight;
  const containerLabel = pdfa?.declaredPart === "3"
    ? `PDF/A-3${pdfa.declaredConformance || ""} déclaré · précontrôle local`
    : "Déclaration PDF/A-3 non confirmée";
  const area = $("#result-area");
  area.hidden = false;
  $("#result-summary").className = `result-summary ${result.outcome}`;
  $("#result-summary").innerHTML = `<div><span class="section-label">${escapeHtml(result.id)}</span><h3>${escapeHtml(summary.label)}</h3><p>${escapeHtml(summary.headline)}</p></div><div class="score-orb"><strong>${result.score}</strong><span>sur 100</span></div>`;
  $("#checks-list").innerHTML = result.checks.map((item) => `<article class="check-row ${item.status}"><span class="check-status">${item.status === "pass" ? "✓" : item.status === "error" ? "×" : item.status === "warning" ? "!" : "i"}</span><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.message)}</p>${item.fix ? `<div class="fix"><strong>Comment corriger :</strong> ${escapeHtml(item.fix)}</div>` : ""}</div><span class="field-code">${escapeHtml(item.field)}</span></article>`).join("");
  $("#result-side").innerHTML = `<span class="section-label">Document analysé</span><h3>${escapeHtml(result.invoice.invoiceNumber || "Sans numéro")}</h3><div class="result-fact"><span>Fournisseur</span><strong>${escapeHtml(result.invoice.supplierName || "Non lu")}</strong></div><div class="result-fact"><span>Destinataire</span><strong>${escapeHtml(result.invoice.buyerName || "Non lu")}</strong></div><div class="result-fact"><span>Format</span><strong>${escapeHtml(result.invoice.container === "FACTUR-X" ? "Factur-X · CII" : result.invoice.syntax)}</strong></div>${result.invoice.container === "FACTUR-X" ? `<div class="result-fact"><span>Conteneur</span><strong>${escapeHtml(containerLabel)}</strong></div>` : ""}<div class="result-fact"><span>Norme</span><strong>EN 16931 ${escapeHtml(result.standards?.en16931 || "précontrôle")}</strong></div><div class="result-fact"><span>Montant</span><strong>${result.invoice.payableAmount != null ? `${result.invoice.payableAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${escapeHtml(result.invoice.currency)}` : "Non lu"}</strong></div><button class="button primary full" type="button" id="download-report">Rapport lisible</button><button class="button secondary full" type="button" id="download-json-report">Rapport JSON</button><button class="button ghost full" type="button" id="new-check">Contrôler une autre facture</button><p class="disclaimer">Validation automatisée des artefacts indiqués, complétée par les exigences du destinataire. Le précontrôle PDF/A-3 ne remplace pas une validation ISO exhaustive. Ne constitue pas un avis juridique.</p>`;
  $("#download-report").addEventListener("click", () => download(`settlemesh-${result.invoice.invoiceNumber || result.id}.txt`, exportResultText(result)));
  $("#download-json-report").addEventListener("click", () => download(`settlemesh-${result.invoice.invoiceNumber || result.id}.json`, exportResultJson(result), "application/json;charset=utf-8"));
  $("#new-check").addEventListener("click", () => { area.hidden = true; $("#upload-panel").scrollIntoView({ behavior: "smooth" }); });
  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function buildValidationResult(xmlText, source = {}, progressPrefix = "") {
  if (linkLoadBlocked) throw new Error("Le profil publié est indisponible ou en cours de chargement. Aucun contrôle possible.");
  const { containerChecks = [], ...invoiceSource } = source;
  const invoice = { ...parseInvoiceXml(xmlText), ...invoiceSource };
  let result = validateInvoice(invoice, activeProfile());
  if (containerChecks.length) result = appendValidationChecks(result, containerChecks, result.standards);
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
  // Signalement consenti, un événement par facture contrôlée : le profil
  // effectif est celui du lien CheckLink (fournisseur) ou le profil local.
  const profile = publicProfile || state.profile;
  for (const result of results) {
    const visitorConsent = $("#visitor-metrics-consent").checked;
    reportEvent(profile, "invoice_checked", { visitorConsent }).catch(() => {});
    if (result.outcome === "ready") reportEvent(profile, "invoice_ready", { visitorConsent }).catch(() => {});
  }
}

async function analyze(xmlText, source = {}) {
  const startedAt = performance.now();
  const context = captureAnalysisContext(activeProfile(), locationRevision);
  try {
    setValidationProgress(true, "Lecture de la facture…");
    const result = await buildValidationResult(xmlText, source);
    if (!analysisContextIsCurrent(context, activeProfile(), locationRevision)) return;
    state.metrics = recordValidationRun(state.metrics, { submitted: 1, results: [result], durationMs: performance.now() - startedAt });
    saveResults([result]);
    $("#batch-panel").hidden = true;
    renderResult(result);
    toast("Contrôle terminé", resultSummary(result).headline);
  } catch (error) {
    if (!analysisContextIsCurrent(context, activeProfile(), locationRevision)) return;
    state.metrics = recordValidationRun(state.metrics, { submitted: 1, results: [], durationMs: performance.now() - startedAt });
    persist();
    renderDashboard();
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
    const { checks: _containerChecks, ...containerPreflight } = extracted.containerPreflight;
    return {
      xmlText: extracted.xmlText,
      source: {
        container: extracted.container,
        attachmentName: extracted.attachmentName,
        originalFileName: file.name,
        containerPreflight,
        containerChecks: extracted.containerChecks
      }
    };
  }
  if (!/\.(xml|ubl|cii)$/i.test(file.name) && !/xml/i.test(file.type)) throw new Error("Format non pris en charge. Utilisez XML UBL/CII ou PDF Factur-X.");
  return { xmlText: await file.text(), source: { container: "XML", originalFileName: file.name } };
}

async function analyzeFiles(fileList) {
  const selected = [...(fileList || [])];
  if (!selected.length) return;
  const files = selected.slice(0, 20);
  const startedAt = performance.now();
  const context = captureAnalysisContext(activeProfile(), locationRevision);
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
        if (!analysisContextIsCurrent(context, activeProfile(), locationRevision)) return;
        const result = await buildValidationResult(payload.xmlText, payload.source, prefix);
        if (!analysisContextIsCurrent(context, activeProfile(), locationRevision)) return;
        entries.push({ name: file.name, result });
      } catch (error) {
        entries.push({ name: file.name, error: error.message || "Document non analysable." });
      }
    }
    const results = entries.flatMap((entry) => entry.result ? [entry.result] : []);
    if (!analysisContextIsCurrent(context, activeProfile(), locationRevision)) return;
    state.metrics = recordValidationRun(state.metrics, { submitted: files.length, results, durationMs: performance.now() - startedAt, batch: files.length > 1 });
    persist();
    renderDashboard();
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

  $("#vies-check-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    form.setAttribute("aria-busy", "true");
    renderIdentityResult($("#vies-result"), { status: "loading", message: "Interrogation de la Commission européenne…" });
    try {
      const result = await checkViesIdentity($("#vies-country").value, $("#vies-number").value);
      renderIdentityResult($("#vies-result"), result);
    } catch (error) {
      renderIdentityResult($("#vies-result"), { status: error.status === 400 ? "not_verified" : "unavailable", message: error.message });
    } finally {
      button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });

  $("#peppol-check-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    form.setAttribute("aria-busy", "true");
    renderIdentityResult($("#peppol-result"), { status: "loading", message: "Recherche exacte dans l’annuaire OpenPeppol…" });
    try {
      const result = await checkPeppolIdentity($("#peppol-number").value);
      renderIdentityResult($("#peppol-result"), result);
    } catch (error) {
      renderIdentityResult($("#peppol-result"), { status: error.status === 400 ? "not_verified" : "unavailable", message: error.message });
    } finally {
      button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });

  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = profileFromForm(event.currentTarget);
    if (!profile.acceptedFormats.length) return toast("Choisissez un format", "Sélectionnez au moins UBL, CII ou Factur-X.");
    state.metrics = recordMetricAction(state.metrics, "profile-update");
    state.profile = profile; persist(); renderAll(); fillProfileForm();
    $("#save-status").textContent = `Enregistré à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
    toast("CheckLink actualisé", "Les nouvelles exigences sont intégrées au lien.");
  });
  $("#export-profile").addEventListener("click", () => {
    const name = state.profile.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "entreprise";
    download(`settlemesh-profil-${name}.json`, JSON.stringify(createProfileBundle(state.profile), null, 2), "application/json;charset=utf-8");
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
      state.metrics = recordMetricAction(state.metrics, "profile-update");
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
    download(`settlemesh-lot-${new Date().toISOString().slice(0, 10)}.csv`, exportHistoryCsv(results), "text/csv;charset=utf-8");
  });
  $("#export-history").addEventListener("click", () => {
    if (!state.history.length) return toast("Historique vide", "Effectuez au moins un contrôle avant l’export.");
    download(`settlemesh-historique-${new Date().toISOString().slice(0, 10)}.csv`, exportHistoryCsv(state.history), "text/csv;charset=utf-8");
  });
  $("#export-pilot-metrics").addEventListener("click", () => {
    download(`settlemesh-metriques-${new Date().toISOString().slice(0, 10)}.json`, exportLocalMetrics(state.metrics), "application/json;charset=utf-8");
    toast("Métriques exportées", "Le fichier contient uniquement des agrégats locaux, sans contenu de facture.");
  });
  $("#reset-pilot-metrics").addEventListener("click", () => {
    if (!window.confirm("Remettre à zéro les métriques agrégées de ce navigateur ? L’historique des contrôles sera conservé.")) return;
    state.metrics = resetLocalMetrics();
    persist(); renderDashboard();
    toast("Métriques remises à zéro", "L’historique local des contrôles n’a pas été modifié.");
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
  $$('[data-netting-scenario]').forEach((button) => button.addEventListener("click", () => {
    state.netting.scenario = { mode: button.dataset.nettingScenario, cutoffDate: "" };
    persist();
    renderNetting();
  }));
  $("#netting-cutoff").addEventListener("change", (event) => {
    const cutoffDate = event.target.value;
    state.netting.scenario = cutoffDate ? { mode: "custom", cutoffDate } : { mode: "all", cutoffDate: "" };
    persist();
    renderNetting();
  });
  $("#netting-template").addEventListener("click", () => download("settlemesh-modele-compensation.csv", `\ufeff${nettingCsvTemplate()}`, "text/csv;charset=utf-8"));
  $("#netting-export").addEventListener("click", () => {
    if (!currentNettingSimulation?.proposals.length) return toast("Aucune proposition à exporter", "Chargez un registre contenant des dettes réciproques.");
    const suffix = currentNettingSimulation.scenario.cutoffDate || "toutes-echeances";
    download(`settlemesh-propositions-${suffix}.csv`, exportNettingCsv(currentNettingSimulation), "text/csv;charset=utf-8");
  });

  // — Registre public d'exigences —
  $("#requirements-search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const area = $("#requirements-results");
    const query = $("#requirements-query").value.trim();
    area.hidden = false;
    area.innerHTML = `<div class="empty-inline">Recherche des exigences publiées…</div>`;
    try {
      const body = await searchRequirements(query);
      if (!body.results.length) {
        area.innerHTML = `<div class="empty-inline">Aucune exigence publiée ne correspond à « ${escapeHtml(query)} ». Seules les entreprises qui publient explicitement apparaissent.</div>`;
        return;
      }
      area.innerHTML = body.results.map((result) => `<article class="requirement-result"><div><strong>${escapeHtml(result.profile.companyName || result.profile.legalName)}</strong><small>${escapeHtml(result.profile.country || "—")} · TVA ${escapeHtml(result.profile.vatId || "non publiée")} · ${escapeHtml((result.profile.acceptedFormats || []).join(", ") || "formats non publiés")}</small></div><a class="button secondary" href="#buyer/${encodeURIComponent(result.organizationId)}">Ouvrir le CheckLink</a></article>`).join("");
    } catch (error) {
      area.innerHTML = `<div class="empty-inline">${escapeHtml(error.message || "Recherche indisponible.")}</div>`;
    }
  });

  $("#checklink-verify-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const area = $("#checklink-verify-result");
    const profile = currentSurfaceProfile || state.profile;
    if (!profile) return;
    area.hidden = false;
    area.className = "identity-result idle";
    area.querySelector("strong").textContent = "Vérification en cours…";
    try {
      const body = await verifyRequirements(profile);
      const labels = {
        verified: ["Pass", "Le lien correspond aux exigences publiées par l'entreprise. Même verdict à l'instant de la requête."],
        mismatch: ["Review", "Le profil du lien diverge des exigences publiées : prudence, demandez confirmation à l'acheteur."],
        not_published: ["Review", "L'entreprise a enregistré des exigences mais ne les a pas publiées."],
        unknown: ["Non trouvé", "Aucune exigence publiée correspondante. Ce contrôle du registre n'est pas une vérification officielle de l'entreprise."]
      };
      const [status, message] = labels[body.verdict] || ["Idle", body.reason];
      area.className = `identity-result ${body.verdict === "verified" ? "verified" : body.verdict === "mismatch" ? "error" : "idle"}`;
      area.querySelector("span").textContent = body.verdict === "verified" ? "✓" : body.verdict === "mismatch" ? "×" : "—";
      area.querySelector("strong").textContent = status;
      area.querySelector("small").textContent = message;
    } catch (error) {
      area.querySelector("strong").textContent = "Indisponible";
      area.querySelector("small").textContent = error.message || "Le registre d'exigences n'est pas joignable.";
    }
  });

  const memberLoginForm = $("#member-login-form");
  $("#member-login-submit").addEventListener("click", () => memberLoginForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  memberLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("#publish-status");
    const show = (state, label, detail) => {
      status.hidden = false;
      status.className = `identity-result ${state}`;
      status.querySelector("span").textContent = state === "verified" ? "✓" : state === "error" ? "×" : "—";
      status.querySelector("strong").textContent = label;
      status.querySelector("small").textContent = detail;
    };
    try {
      const payload = { email: $("#member-email").value.trim(), password: $("#member-password").value };
      const code = $("#member-code").value.trim();
      if (code) payload.code = code;
      const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        show("verified", "Connecté", `Rôle ${body?.member?.role} · publication disponible.`);
        $("#member-mfa-row").hidden = true;
        return;
      }
      if (body?.error?.code === "MFA_REQUIRED") {
        $("#member-mfa-row").hidden = false;
        show("idle", "MFA requis", "Saisissez le code de votre application d'authentification, puis reconnectez-vous.");
        return;
      }
      show("error", "Connexion refusée", body?.error?.message || "Identifiants refusés.");
    } catch (error) {
      show("error", "Connexion indisponible", error.message || "Le serveur n'est pas joignable.");
    }
  });

  $("#publish-requirements").addEventListener("click", async () => {
    try {
      const body = await publishRequirements(state.profile, { published: true });
      state.profile = { ...state.profile, organizationId: body.organizationId, published: body.published === true, version: body.version };
      persist(); renderAll();
      toast("Exigences publiées", body.notice || "Cherchables publiquement, sans compte.");
    } catch (error) {
      toast("Publication impossible", error.message || "Connectez-vous d'abord (rôle admin ou owner).");
    }
  });
  $("#unpublish-requirements").addEventListener("click", async () => {
    try {
      await unpublishRequirements();
      state.profile.published = false;
      persist(); renderAll();
      toast("Exigences dépubliées", "Plus cherchable dans le registre public.");
    } catch (error) {
      toast("Dépublication impossible", error.message || "Connectez-vous d'abord.");
    }
  });

  window.addEventListener("hashchange", parseLocation);
}

setupEvents();
parseLocation();
renderAll();
fillProfileForm();
async function refreshMemberAccess() {
  const status = $("#member-session-status");
  try {
    const health = await fetch("/api/v1/health").then((response) => response.json());
    const hosted = health.authentication?.mode === "sites";
    $("#site-signin").hidden = !hosted;
    $("#member-login-form").hidden = hosted;
    const response = await fetch("/api/v1/auth/me");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Connexion et invitation acheteur requises.");
    status.textContent = `Espace ${body.organizationId} · rôle ${body.member.role}. La connexion ne certifie pas l'identité juridique de l'entreprise.`;
    $("#publish-requirements").disabled = !["owner", "admin"].includes(body.member.role);
    $("#unpublish-requirements").disabled = !["owner", "admin"].includes(body.member.role);
  } catch (error) {
    status.textContent = error.message;
  }
}
refreshMemberAccess();
