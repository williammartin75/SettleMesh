import {
  buildCycleRecord,
  computePlan,
  createDemoInvoices,
  getPortfolioSignals,
  invoicesToCSV,
  isEligible,
  normalizeInvoice,
  parseInvoiceCSV,
  settlementsToCSV,
  validatePortfolio
} from "./core.js";

const STORAGE_KEY = "settlemesh-workspace-v2";
const LEGACY_STORAGE_KEY = "settlemesh-workspace-v1";
const TITLES = {
  overview: "Vue d’ensemble",
  invoices: "Factures",
  network: "Réseau",
  settlement: "Cycle de règlement",
  audit: "Journal d’audit",
  settings: "Paramètres"
};
const STATUS_LABELS = { open: "Ouverte", overdue: "En retard", paid: "Payée", disputed: "En litige" };
const palette = ["#16865d", "#d77d3c", "#4871b8", "#9672bd", "#2b8f93", "#c96078", "#758768", "#ad8846"];

function initialState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
    if (stored && Array.isArray(stored.invoices)) {
      return {
        invoices: stored.invoices,
        approvals: stored.approvals || {},
        cycleReady: Boolean(stored.cycleReady && stored.currentCycle),
        currentCycle: stored.currentCycle || null,
        cycleHistory: Array.isArray(stored.cycleHistory) ? stored.cycleHistory : [],
        auditLog: Array.isArray(stored.auditLog) ? stored.auditLog : [],
        lastMutationAt: stored.lastMutationAt || new Date().toISOString(),
        view: location.hash.slice(1) in TITLES ? location.hash.slice(1) : "overview",
        graphMode: "obligations",
        networkMode: "obligations",
        statusFilter: "all",
        search: ""
      };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return {
    invoices: createDemoInvoices(), approvals: {}, cycleReady: false, currentCycle: null,
    cycleHistory: [], auditLog: [], lastMutationAt: new Date().toISOString(),
    view: "overview", graphMode: "obligations", networkMode: "obligations",
    statusFilter: "all", search: ""
  };
}

const state = initialState();
let pendingDeleteId = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    invoices: state.invoices,
    approvals: state.approvals,
    cycleReady: state.cycleReady,
    currentCycle: state.currentCycle,
    cycleHistory: state.cycleHistory,
    auditLog: state.auditLog,
    lastMutationAt: state.lastMutationAt
  }));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatEuro(value, compact = false) {
  const amount = Number(value) || 0;
  if (compact && Math.abs(amount) >= 1_000_000) {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(amount / 1_000_000)} M€`;
  }
  if (compact && Math.abs(amount) >= 100_000) {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount / 1_000)} k€`;
  }
  return new Intl.NumberFormat("fr-FR", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0
  }).format(amount);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function addAudit(type, title, detail, metadata = {}) {
  state.auditLog.unshift({
    id: `EVT-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    at: new Date().toISOString(), type, title, detail, metadata
  });
  state.auditLog = state.auditLog.slice(0, 200);
}

function invalidateCycle(title, detail) {
  state.approvals = {};
  state.cycleReady = false;
  state.currentCycle = null;
  state.lastMutationAt = new Date().toISOString();
  addAudit("data", title, detail);
}

function buildCurrentCycle(status = state.cycleReady ? "sealed" : "draft") {
  return buildCycleRecord({
    invoices: state.invoices,
    approvals: state.approvals,
    createdAt: state.cycleReady && state.currentCycle?.createdAt ? state.currentCycle.createdAt : state.lastMutationAt,
    status
  });
}

function buildAuditPackage() {
  const cycle = state.currentCycle || buildCurrentCycle("draft");
  return {
    schema: "settlemesh.audit-package.v1",
    generatedAt: new Date().toISOString(),
    notice: "Dossier de préparation. SettleMesh ne détient pas de fonds et n’initie aucun paiement.",
    cycle,
    controls: validatePortfolio(state.invoices),
    auditTrail: state.auditLog
  };
}

function initials(name) {
  return String(name).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function hashColor(name) {
  let hash = 0;
  for (const char of String(name)) hash = ((hash << 5) - hash) + char.charCodeAt(0);
  return palette[Math.abs(hash) % palette.length];
}

function toast(title, message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `<span class="toast-icon">${type === "error" ? "!" : "✓"}</span><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div><button type="button" aria-label="Fermer">×</button>`;
  $("button", node).addEventListener("click", () => node.remove());
  $("#toast-region").append(node);
  window.setTimeout(() => node.remove(), 5200);
}

function download(name, content, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function aggregateGrossEdges(invoices) {
  const edgeMap = new Map();
  invoices.filter(isEligible).forEach((invoice) => {
    const key = `${invoice.customer}\u0000${invoice.supplier}`;
    if (!edgeMap.has(key)) edgeMap.set(key, { from: invoice.customer, to: invoice.supplier, amount: 0, invoiceCount: 0 });
    const edge = edgeMap.get(key);
    edge.amount += Number(invoice.amount) || 0;
    edge.invoiceCount += 1;
  });
  return [...edgeMap.values()].sort((a, b) => b.amount - a.amount);
}

function renderNavigation() {
  $$("[data-nav]").forEach((button) => button.classList.toggle("active", button.dataset.nav === state.view));
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === state.view));
  $("#page-title").textContent = TITLES[state.view];
  if (location.hash !== `#${state.view}`) history.replaceState(null, "", `#${state.view}`);
  document.body.classList.remove("menu-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setView(view) {
  if (!(view in TITLES)) return;
  state.view = view;
  renderNavigation();
  if (view === "network") requestAnimationFrame(() => renderGraph("detail"));
}

function renderKpis(plan) {
  $("#kpi-gross").textContent = formatEuro(plan.gross, true);
  $("#kpi-invoices").textContent = `${plan.eligibleCount} facture${plan.eligibleCount > 1 ? "s" : ""} éligible${plan.eligibleCount > 1 ? "s" : ""}`;
  $("#kpi-cleared").textContent = formatEuro(plan.totalCleared, true);
  $("#kpi-rate").textContent = `${Math.round(plan.reductionRate * 100)} %`;
  $("#kpi-net").textContent = formatEuro(plan.netCash, true);
  $("#kpi-transfers").textContent = plan.settlements.length;
  $("#kpi-entities").textContent = plan.entities.length;
  $("#radial-rate").textContent = `${Math.round(plan.reductionRate * 100)}%`;
  $("#reduction-radial").style.setProperty("--rate", Math.round(plan.reductionRate * 100));
  $("#bilateral-cleared").textContent = formatEuro(plan.bilateralCleared);
  $("#multilateral-cleared").textContent = formatEuro(plan.multilateralCleared);
  $("#impact-total").textContent = formatEuro(plan.totalCleared);
  $("#invoice-nav-count").textContent = state.invoices.length;
  $("#audit-nav-count").textContent = state.auditLog.length;
  $("#eligible-count").textContent = plan.eligibleCount;
}

function renderSignals() {
  const signals = getPortfolioSignals(state.invoices);
  const rows = [
    { icon: "!", color: "red", title: `${signals.overdueCount} facture${signals.overdueCount > 1 ? "s" : ""} échue${signals.overdueCount > 1 ? "s" : ""}`, detail: "Priorité de trésorerie", amount: signals.overdueAmount },
    { icon: "↗", color: "orange", title: "Échéances sous 7 jours", detail: "À intégrer au prochain cycle", amount: signals.dueSoonAmount },
    { icon: "≈", color: "blue", title: "Montants en litige", detail: "Exclus du calcul", amount: signals.disputedAmount }
  ];
  $("#signal-list").innerHTML = rows.map((row) => `
    <div class="signal-row">
      <span class="signal-icon ${row.color}">${row.icon}</span>
      <div><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.detail)}</span></div>
      <b>${formatEuro(row.amount, true)}</b>
    </div>`).join("");
}

function renderMiniSettlements(plan) {
  const container = $("#mini-settlements");
  if (!plan.settlements.length) {
    container.innerHTML = `<div class="empty-state"><h3>Aucun virement requis</h3><p>Le portefeuille ne contient pas de position nette.</p></div>`;
    return;
  }
  container.innerHTML = plan.settlements.slice(0, 4).map((item) => `
    <div class="mini-transfer">
      <span title="${escapeHtml(item.from)}">${escapeHtml(item.from)}</span><i>→</i>
      <span title="${escapeHtml(item.to)}">${escapeHtml(item.to)}</span><strong>${formatEuro(item.amount, true)}</strong>
    </div>`).join("");
}

function filteredInvoices() {
  const query = state.search.trim().toLowerCase();
  return state.invoices.filter((invoice) => {
    const matchesQuery = !query || [invoice.id, invoice.supplier, invoice.customer].some((field) => String(field).toLowerCase().includes(query));
    let matchesStatus = true;
    if (state.statusFilter === "open") matchesStatus = invoice.status === "open";
    if (state.statusFilter === "overdue") matchesStatus = invoice.status === "overdue";
    if (state.statusFilter === "excluded") matchesStatus = !isEligible(invoice);
    return matchesQuery && matchesStatus;
  });
}

function renderInvoices() {
  const invoices = filteredInvoices();
  const body = $("#invoice-table-body");
  body.innerHTML = invoices.map((invoice) => `
    <tr>
      <td>${escapeHtml(invoice.id)}</td>
      <td><div class="entity-cell"><span class="avatar" style="color:${hashColor(invoice.supplier)};background:${hashColor(invoice.supplier)}18">${initials(invoice.supplier)}</span>${escapeHtml(invoice.supplier)}</div></td>
      <td><div class="entity-cell"><span class="avatar" style="color:${hashColor(invoice.customer)};background:${hashColor(invoice.customer)}18">${initials(invoice.customer)}</span>${escapeHtml(invoice.customer)}</div></td>
      <td>${formatDate(invoice.dueDate)}</td>
      <td><span class="status-badge ${escapeHtml(invoice.status)}">${STATUS_LABELS[invoice.status] || "Ouverte"}</span></td>
      <td class="align-right"><strong>${formatEuro(invoice.amount)}</strong></td>
      <td><button class="row-action" type="button" data-delete-id="${escapeHtml(invoice.id)}" aria-label="Supprimer ${escapeHtml(invoice.id)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14"/></svg></button></td>
    </tr>`).join("");
  $("#invoice-empty").hidden = invoices.length !== 0;
  $("#table-result-count").textContent = `${invoices.length} résultat${invoices.length > 1 ? "s" : ""}`;
  body.closest(".table-scroll").hidden = invoices.length === 0;
}

function renderEntities(plan) {
  $("#entity-list").innerHTML = plan.entities.map((entity) => `
    <div class="entity-row" data-entity="${escapeHtml(entity.name)}">
      <span class="avatar" style="color:${hashColor(entity.name)};background:${hashColor(entity.name)}18">${initials(entity.name)}</span>
      <div><strong>${escapeHtml(entity.name)}</strong><span>${entity.invoiceCount} mouvement${entity.invoiceCount > 1 ? "s" : ""}</span></div>
      <b class="${entity.net >= 0 ? "positive" : "negative"}">${entity.net >= 0 ? "+" : ""}${formatEuro(entity.net, true)}</b>
    </div>`).join("");
}

function renderSettlement(plan) {
  $("#settlement-gross").textContent = formatEuro(plan.gross);
  $("#settlement-cleared").textContent = formatEuro(plan.totalCleared);
  $("#settlement-net").textContent = formatEuro(plan.netCash);
  $("#settlement-count").textContent = `${plan.settlements.length} virement${plan.settlements.length > 1 ? "s" : ""}`;
  const list = $("#settlement-list");
  list.innerHTML = plan.settlements.length ? plan.settlements.map((item, index) => `
    <div class="settlement-item">
      <span class="settlement-number">${String(index + 1).padStart(2, "0")}</span>
      <div class="settlement-party"><span>Débiteur</span><strong>${escapeHtml(item.from)}</strong></div>
      <span class="transfer-arrow"></span>
      <div class="settlement-party"><span>Créditeur</span><strong>${escapeHtml(item.to)}</strong></div>
      <strong class="settlement-amount">${formatEuro(item.amount)}</strong>
    </div>`).join("") : `<div class="empty-state"><div class="empty-icon">✓</div><h3>Réseau équilibré</h3><p>Aucun virement résiduel n’est nécessaire.</p></div>`;

  const activeEntities = new Set(plan.entities.map((entity) => entity.name));
  const participants = [...activeEntities].sort((a, b) => a.localeCompare(b, "fr"));
  Object.keys(state.approvals).forEach((name) => {
    if (!activeEntities.has(name)) delete state.approvals[name];
  });
  $("#approval-list").innerHTML = participants.map((name) => `
    <div class="approval-row">
      <span class="avatar" style="color:${hashColor(name)};background:${hashColor(name)}18">${initials(name)}</span>
      <span>${escapeHtml(name)}</span>
      <button class="approval-toggle ${state.approvals[name] ? "on" : ""}" type="button" data-approval="${escapeHtml(name)}" role="switch" aria-checked="${Boolean(state.approvals[name])}" aria-label="Valider ${escapeHtml(name)}" ${state.cycleReady ? "disabled" : ""}></button>
    </div>`).join("");
  const approved = participants.filter((name) => state.approvals[name]).length;
  const rate = participants.length ? Math.round(approved / participants.length * 100) : 100;
  const validation = validatePortfolio(state.invoices);
  const cycle = state.currentCycle || buildCurrentCycle("draft");
  $("#approval-text").textContent = `${approved} sur ${participants.length} validée${approved > 1 ? "s" : ""}`;
  $("#approval-rate").textContent = `${rate}%`;
  $("#approval-bar").style.width = `${rate}%`;
  $("#approve-all").textContent = approved === participants.length && participants.length ? "Retirer les validations" : "Valider toutes les parties";
  $("#approve-all").disabled = state.cycleReady;
  $("#mark-ready").disabled = !state.cycleReady && (!validation.ready || participants.length === 0 || approved !== participants.length);
  $("#mark-ready").textContent = state.cycleReady ? "Rouvrir le cycle" : "Sceller le cycle";
  $("#cycle-status-copy").textContent = state.cycleReady ? "Dossier scellé et prêt à être transmis à un partenaire — aucun paiement initié." : "Validation de démonstration uniquement — aucun paiement ne sera initié.";

  $("#cycle-reference").textContent = state.cycleReady ? cycle.id : "BROUILLON";
  $("#cycle-fingerprint").textContent = cycle.fingerprint;
  $("#cycle-updated").textContent = formatDateTime(state.lastMutationAt);
  $("#cycle-state").textContent = state.cycleReady ? "Scellé" : "Préparation";
  $("#cycle-state").classList.toggle("sealed", state.cycleReady);
  $("#quality-readiness").classList.toggle("complete", validation.ready);
  $("#quality-readiness").classList.toggle("attention", !validation.ready);
  $("#quality-readiness-copy").textContent = validation.ready
    ? `${validation.stats.eligible} factures éligibles · ${validation.warnings.length} alerte${validation.warnings.length > 1 ? "s" : ""}`
    : validation.issues[0];
  $("#approval-readiness").classList.toggle("complete", approved === participants.length && participants.length > 0);
  $("#approval-readiness-copy").textContent = participants.length ? `${approved}/${participants.length} participants validés` : "Aucun participant";

  $("#entity-options").innerHTML = plan.entities.map((entity) => `<option value="${escapeHtml(entity.name)}"></option>`).join("");
}

function renderAudit() {
  $("#audit-count").textContent = `${state.auditLog.length} événement${state.auditLog.length > 1 ? "s" : ""}`;
  $("#audit-nav-count").textContent = state.auditLog.length;
  $("#audit-timeline").innerHTML = state.auditLog.length ? state.auditLog.map((event) => `
    <div class="audit-event">
      <span class="audit-mark ${escapeHtml(event.type)}"></span>
      <div><div class="audit-event-head"><strong>${escapeHtml(event.title)}</strong><time>${formatDateTime(event.at)}</time></div><p>${escapeHtml(event.detail)}</p></div>
    </div>`).join("") : `<div class="empty-state"><div class="empty-icon">✓</div><h3>Journal initialisé</h3><p>Les prochaines actions apparaîtront ici.</p></div>`;

  $("#cycle-archive").innerHTML = state.cycleHistory.length ? state.cycleHistory.map((cycle) => `
    <button class="archive-cycle" type="button" data-download-cycle="${escapeHtml(cycle.id)}">
      <span><strong>${escapeHtml(cycle.id)}</strong><small>${formatDateTime(cycle.createdAt)} · ${cycle.metrics.eligibleInvoices} factures</small></span>
      <b>${Math.round(cycle.metrics.reductionRate * 100)}%</b>
    </button>`).join("") : `<div class="empty-state compact-empty"><div class="empty-icon">◇</div><h3>Aucun cycle scellé</h3><p>Un cycle archivé sera créé après validation de toutes les parties.</p></div>`;
}

function edgePath(from, to, nodeRadius, curve = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const start = { x: from.x + ux * nodeRadius, y: from.y + uy * nodeRadius };
  const end = { x: to.x - ux * (nodeRadius + 5), y: to.y - uy * (nodeRadius + 5) };
  const middle = { x: (start.x + end.x) / 2 - uy * curve, y: (start.y + end.y) / 2 + ux * curve };
  return { d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${middle.x.toFixed(1)} ${middle.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`, middle };
}

function renderGraph(kind) {
  const plan = computePlan(state.invoices);
  const mode = kind === "detail" ? state.networkMode : state.graphMode;
  const container = kind === "detail" ? $("#detail-graph") : $("#overview-graph");
  if (!container) return;
  const width = kind === "detail" ? 900 : 760;
  const height = kind === "detail" ? 590 : 325;
  const radiusX = kind === "detail" ? 320 : 267;
  const radiusY = kind === "detail" ? 218 : 113;
  const nodeRadius = kind === "detail" ? 25 : 19;
  const entities = plan.entities;
  const edges = mode === "settlements" ? plan.settlements : aggregateGrossEdges(state.invoices);
  const points = new Map();
  entities.forEach((entity, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index / Math.max(entities.length, 1));
    const modulation = index % 2 ? .94 : 1;
    points.set(entity.name, {
      x: width / 2 + Math.cos(angle) * radiusX * modulation,
      y: height / 2 + Math.sin(angle) * radiusY,
      entity
    });
  });

  const hasOpposite = (edge) => edges.some((candidate) => candidate.from === edge.to && candidate.to === edge.from);
  const maxAmount = Math.max(1, ...edges.map((edge) => edge.amount));
  const markerId = `arrow-${kind}-${mode}`;
  const edgeMarkup = edges.map((edge, index) => {
    const from = points.get(edge.from);
    const to = points.get(edge.to);
    if (!from || !to) return "";
    const curve = hasOpposite(edge) ? (edge.from.localeCompare(edge.to) > 0 ? 20 : -20) : 0;
    const path = edgePath(from, to, nodeRadius, curve);
    const stroke = mode === "settlements" ? "#16865d" : "#82958c";
    const strokeWidth = 1.1 + Math.sqrt(edge.amount / maxAmount) * (kind === "detail" ? 3 : 2.2);
    return `<g class="edge-group" data-from="${escapeHtml(edge.from)}" data-to="${escapeHtml(edge.to)}">
      <path class="edge" d="${path.d}" stroke="${stroke}" stroke-width="${strokeWidth.toFixed(1)}" marker-end="url(#${markerId})"><title>${escapeHtml(edge.from)} → ${escapeHtml(edge.to)} : ${formatEuro(edge.amount)}</title></path>
      ${kind === "detail" || edges.length <= 9 ? `<text class="edge-label" x="${path.middle.x.toFixed(1)}" y="${(path.middle.y - 5).toFixed(1)}" text-anchor="middle">${formatEuro(edge.amount, true)}</text>` : ""}
    </g>`;
  }).join("");
  const nodeMarkup = entities.map((entity) => {
    const point = points.get(entity.name);
    const fill = entity.role === "creditor" ? "#16865d" : entity.role === "debtor" ? "#d77d3c" : "#74827d";
    const displayName = entity.name.length > 18 ? `${entity.name.slice(0, 16)}…` : entity.name;
    return `<g class="node-group" data-node="${escapeHtml(entity.name)}" transform="translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})">
      <circle class="node-circle" r="${nodeRadius}" fill="${fill}"><title>${escapeHtml(entity.name)} · position ${formatEuro(entity.net)}</title></circle>
      <text x="0" y="4" text-anchor="middle" fill="#fff" font-size="${kind === "detail" ? 8 : 7}" font-weight="750">${initials(entity.name)}</text>
      <text class="node-label" x="0" y="${nodeRadius + 15}">${escapeHtml(displayName)}</text>
      ${kind === "detail" ? `<text class="node-value" x="0" y="${nodeRadius + 28}">${entity.net >= 0 ? "+" : ""}${formatEuro(entity.net, true)}</text>` : ""}
    </g>`;
  }).join("");

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${mode === "settlements" ? "Plan net de règlement" : "Réseau brut d’obligations"}">
    <defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${mode === "settlements" ? "#16865d" : "#82958c"}"></path></marker></defs>
    ${edgeMarkup}${nodeMarkup}
  </svg>`;
  if (kind === "detail") {
    $("#graph-edge-count").textContent = `${edges.length} ${mode === "settlements" ? "virement" : "obligation"}${edges.length > 1 ? "s" : ""}`;
  }

  $$(".node-group", container).forEach((node) => {
    node.addEventListener("mouseenter", () => {
      const name = node.dataset.node;
      $$(".node-group", container).forEach((item) => { if (item.dataset.node !== name) item.style.opacity = ".28"; });
      $$(".edge-group", container).forEach((item) => {
        item.style.opacity = item.dataset.from === name || item.dataset.to === name ? "1" : ".1";
      });
    });
    node.addEventListener("mouseleave", () => {
      $$(".node-group, .edge-group", container).forEach((item) => { item.style.opacity = ""; });
    });
  });
}

function render() {
  const plan = computePlan(state.invoices);
  renderKpis(plan);
  renderSignals();
  renderMiniSettlements(plan);
  renderInvoices();
  renderEntities(plan);
  renderSettlement(plan);
  renderAudit();
  renderGraph("overview");
  if (state.view === "network") renderGraph("detail");
  persist();
}

async function importFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".csv")) {
    toast("Format non pris en charge", "Utilisez un fichier CSV.", "error");
    return;
  }
  const result = parseInvoiceCSV(await file.text());
  if (!result.invoices.length) {
    toast("Import impossible", result.errors[0] || "Aucune ligne valide.", "error");
    return;
  }
  const existingIds = new Set(state.invoices.map((invoice) => invoice.id));
  let added = 0;
  result.invoices.forEach((invoice) => {
    let nextId = invoice.id;
    let suffix = 2;
    while (existingIds.has(nextId)) nextId = `${invoice.id}-${suffix++}`;
    existingIds.add(nextId);
    state.invoices.push({ ...invoice, id: nextId });
    added += 1;
  });
  invalidateCycle("Import CSV", `${added} facture(s) ajoutée(s)${result.errors.length ? ` · ${result.errors.length} ligne(s) ignorée(s)` : ""}.`);
  render();
  setView("invoices");
  toast("Import terminé", `${added} facture${added > 1 ? "s ajoutées" : " ajoutée"}${result.errors.length ? `, ${result.errors.length} ligne(s) ignorée(s)` : ""}.`);
}

function openModal() {
  const modal = $("#invoice-modal");
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => $("input[name='id']", modal).focus(), 20);
}

function closeModal() {
  $("#invoice-modal").hidden = true;
  document.body.style.overflow = "";
  $("#invoice-form").reset();
}

function showDeleteConfirm(button, id) {
  pendingDeleteId = id;
  const popover = $("#delete-confirm");
  const rect = button.getBoundingClientRect();
  const left = Math.min(window.innerWidth - 245, Math.max(10, rect.right - 230));
  const top = Math.min(window.innerHeight - 120, rect.bottom + 6);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.hidden = false;
}

function setupEvents() {
  $$('[data-nav]').forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    setView(button.dataset.nav);
  }));
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
  $("#mobile-menu").addEventListener("click", () => document.body.classList.toggle("menu-open"));

  $("#import-button").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", (event) => importFile(event.target.files[0]));
  $("#add-button").addEventListener("click", openModal);
  $("#close-modal").addEventListener("click", closeModal);
  $("#cancel-modal").addEventListener("click", closeModal);
  $("#invoice-modal").addEventListener("click", (event) => { if (event.target.id === "invoice-modal") closeModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

  $("#invoice-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const invoice = normalizeInvoice(Object.fromEntries(form.entries()), state.invoices.length);
      if (state.invoices.some((item) => item.id === invoice.id)) invoice.id = `${invoice.id}-${Date.now().toString().slice(-4)}`;
      state.invoices.unshift(invoice);
      invalidateCycle("Facture ajoutée", `${invoice.id} · ${invoice.customer} doit ${formatEuro(invoice.amount)} à ${invoice.supplier}.`);
      render();
      closeModal();
      toast("Facture ajoutée", `${invoice.id} est intégrée au portefeuille.`);
    } catch (error) {
      toast("Facture invalide", error.message, "error");
    }
  });

  $("#invoice-search").addEventListener("input", (event) => { state.search = event.target.value; renderInvoices(); });
  $("#status-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-status]");
    if (!button) return;
    state.statusFilter = button.dataset.status;
    $$('[data-status]', event.currentTarget).forEach((item) => item.classList.toggle("active", item === button));
    renderInvoices();
  });
  $("#invoice-table-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (button) showDeleteConfirm(button, button.dataset.deleteId);
  });
  $("#delete-confirm").addEventListener("click", (event) => {
    const action = event.target.dataset.confirm;
    if (!action) return;
    if (action === "delete" && pendingDeleteId) {
      state.invoices = state.invoices.filter((invoice) => invoice.id !== pendingDeleteId);
      invalidateCycle("Facture retirée", `${pendingDeleteId} a été exclue du portefeuille.`);
      render();
      toast("Facture supprimée", `${pendingDeleteId} a été retirée du cycle.`);
    }
    pendingDeleteId = null;
    $("#delete-confirm").hidden = true;
  });

  const dropZone = $("#drop-zone");
  dropZone.addEventListener("click", () => $("#file-input").click());
  dropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") $("#file-input").click(); });
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
  dropZone.addEventListener("drop", (event) => importFile(event.dataTransfer.files[0]));

  $("#download-template").addEventListener("click", (event) => {
    event.stopPropagation();
    download("modele-factures-settlemesh.csv", "\uFEFFreference;fournisseur;client;montant;date_echeance;statut\r\nINV-001;Fournisseur SAS;Client SARL;25000,00;2026-11-15;ouverte");
  });
  $("#export-invoices").addEventListener("click", () => {
    download(`settlemesh-factures-${new Date().toISOString().slice(0, 10)}.csv`, invoicesToCSV(state.invoices));
    addAudit("export", "Portefeuille exporté", `${state.invoices.length} facture(s) exportée(s) en CSV.`);
    renderAudit();
    persist();
    toast("Portefeuille exporté", "Les factures ont été enregistrées au format CSV.");
  });
  $("#export-settlements").addEventListener("click", () => {
    const plan = computePlan(state.invoices);
    if (!plan.settlements.length) return toast("Aucun mouvement", "Le plan ne contient aucun virement à exporter.", "error");
    download(`settlemesh-plan-${new Date().toISOString().slice(0, 10)}.csv`, settlementsToCSV(plan.settlements));
    addAudit("export", "Plan CSV exporté", `${plan.settlements.length} instruction(s) de règlement résiduel.`);
    renderAudit();
    persist();
    toast("Plan exporté", `${plan.settlements.length} instruction(s) enregistrée(s) au format CSV.`);
  });
  $("#export-cycle").addEventListener("click", () => {
    const dossier = buildAuditPackage();
    download(`${dossier.cycle.id}-dossier.json`, JSON.stringify(dossier, null, 2), "application/json;charset=utf-8");
    addAudit("export", "Dossier d’audit exporté", `${dossier.cycle.id} · empreinte ${dossier.cycle.fingerprint}.`);
    renderAudit();
    persist();
    toast("Dossier généré", "Le cycle, les contrôles et le journal ont été exportés en JSON.");
  });
  $("#export-audit").addEventListener("click", () => {
    const dossier = buildAuditPackage();
    download(`settlemesh-audit-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(dossier, null, 2), "application/json;charset=utf-8");
    addAudit("export", "Journal exporté", `${state.auditLog.length} événement(s) inclus dans le dossier.`);
    renderAudit();
    persist();
  });

  $$('[data-graph-mode]').forEach((button) => button.addEventListener("click", () => {
    state.graphMode = button.dataset.graphMode;
    $$('[data-graph-mode]').forEach((item) => item.classList.toggle("active", item === button));
    renderGraph("overview");
  }));
  $$('[data-network-mode]').forEach((button) => button.addEventListener("click", () => {
    state.networkMode = button.dataset.networkMode;
    $$('[data-network-mode]').forEach((item) => item.classList.toggle("active", item === button));
    renderGraph("detail");
  }));
  $("#refresh-plan").addEventListener("click", () => { render(); toast("Plan recalculé", "Toutes les positions ont été mises à jour."); });

  $("#approval-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-approval]");
    if (!button || state.cycleReady) return;
    state.approvals[button.dataset.approval] = !state.approvals[button.dataset.approval];
    state.lastMutationAt = new Date().toISOString();
    addAudit("approval", state.approvals[button.dataset.approval] ? "Consentement enregistré" : "Consentement retiré", button.dataset.approval);
    renderSettlement(computePlan(state.invoices));
    renderAudit();
    persist();
  });
  $("#approve-all").addEventListener("click", () => {
    if (state.cycleReady) return;
    const plan = computePlan(state.invoices);
    const participants = plan.entities.map((entity) => entity.name);
    const allApproved = participants.length && participants.every((name) => state.approvals[name]);
    participants.forEach((name) => { state.approvals[name] = !allApproved; });
    state.lastMutationAt = new Date().toISOString();
    addAudit("approval", allApproved ? "Consentements retirés" : "Consentements enregistrés", `${participants.length} participant(s) mis à jour dans la démonstration.`);
    renderSettlement(plan);
    renderAudit();
    persist();
  });
  $("#mark-ready").addEventListener("click", () => {
    if (state.cycleReady) {
      const previousId = state.currentCycle?.id || "cycle";
      state.cycleReady = false;
      state.currentCycle = null;
      state.lastMutationAt = new Date().toISOString();
      addAudit("cycle", "Cycle rouvert", `${previousId} reste dans les archives locales.`);
    } else {
      const validation = validatePortfolio(state.invoices);
      const plan = computePlan(state.invoices);
      const participants = plan.entities.map((entity) => entity.name);
      if (!validation.ready || !participants.length || !participants.every((name) => state.approvals[name])) {
        toast("Cycle incomplet", validation.issues[0] || "Tous les participants doivent être validés.", "error");
        return;
      }
      state.lastMutationAt = new Date().toISOString();
      state.currentCycle = buildCycleRecord({ invoices: state.invoices, approvals: state.approvals, createdAt: state.lastMutationAt, status: "sealed" });
      state.cycleReady = true;
      if (!state.cycleHistory.some((cycle) => cycle.id === state.currentCycle.id)) state.cycleHistory.unshift(state.currentCycle);
      addAudit("cycle", "Cycle scellé", `${state.currentCycle.id} · empreinte ${state.currentCycle.fingerprint}.`);
    }
    renderSettlement(computePlan(state.invoices));
    renderAudit();
    persist();
    toast(state.cycleReady ? "Cycle scellé" : "Cycle rouvert", state.cycleReady ? "Le dossier est prêt pour transmission à un partenaire, sans initiation de paiement." : "Le cycle peut de nouveau être modifié.");
  });

  $("#cycle-archive").addEventListener("click", (event) => {
    const button = event.target.closest("[data-download-cycle]");
    if (!button) return;
    const cycle = state.cycleHistory.find((item) => item.id === button.dataset.downloadCycle);
    if (!cycle) return;
    download(`${cycle.id}.json`, JSON.stringify(cycle, null, 2), "application/json;charset=utf-8");
    addAudit("export", "Cycle archivé exporté", cycle.id);
    renderAudit();
    persist();
  });

  $("#reset-data").addEventListener("click", () => {
    state.invoices = createDemoInvoices();
    state.approvals = {};
    state.cycleReady = false;
    state.currentCycle = null;
    state.cycleHistory = [];
    state.auditLog = [];
    state.lastMutationAt = new Date().toISOString();
    state.search = "";
    state.statusFilter = "all";
    $("#invoice-search").value = "";
    $$('[data-status]').forEach((item) => item.classList.toggle("active", item.dataset.status === "all"));
    addAudit("system", "Espace réinitialisé", "Le portefeuille de démonstration a été restauré.");
    render();
    toast("Espace réinitialisé", "Le portefeuille de démonstration a été restauré.");
  });

  window.addEventListener("hashchange", () => {
    const target = location.hash.slice(1);
    if (target in TITLES) setView(target);
  });
}

if (!state.auditLog.length) {
  addAudit("system", "Espace de travail initialisé", "Le pilote local SettleMesh est prêt. Aucun fonds ne transite par l’application.");
}

setupEvents();
renderNavigation();
render();
