const EPSILON = 0.005;
const ELIGIBLE_STATUSES = new Set(["accepted", "approved", "validated", "due", "acceptee", "accepte", "approuvee", "approuve", "validee", "valide"]);

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const cleanText = (value) => String(value ?? "").trim();
const partyKey = (value) => cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").replace(/\s+/g, " ");
const normalizedHeader = (value) => partyKey(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const isTrue = (value) => ["1", "true", "yes", "oui", "o", "x"].includes(partyKey(value));

function normalizeIsoDate(value) {
  const raw = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? raw : "";
}

function parseAmount(value) {
  const raw = cleanText(value).replace(/\s/g, "");
  if (!raw) return NaN;
  const normalized = raw.includes(",") && !raw.includes(".") ? raw.replace(",", ".") : raw.replace(/,/g, "");
  return Number(normalized);
}

function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\ufeff/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  invoiceNumber: ["invoice_number", "invoice", "facture", "numero_facture", "reference"],
  debtor: ["debtor", "debiteur", "acheteur", "buyer", "client"],
  creditor: ["creditor", "crediteur", "fournisseur", "supplier", "vendor"],
  amount: ["amount", "montant", "total", "payable_amount"],
  currency: ["currency", "devise"],
  dueDate: ["due_date", "echeance", "date_echeance"],
  status: ["status", "statut"],
  disputed: ["disputed", "litige", "en_litige"],
  assigned: ["assigned", "cedee", "cede", "affacturee", "factored"]
};

export function parseNettingCsv(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = parseRows(text, delimiter);
  if (rows.length < 2) throw new Error("Le fichier CSV doit contenir un en-tête et au moins une facture.");
  const headers = rows[0].map(normalizedHeader);
  const indexes = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, headers.findIndex((header) => aliases.includes(header))]));
  for (const field of ["invoiceNumber", "debtor", "creditor", "amount", "currency"]) {
    if (indexes[field] < 0) throw new Error(`Colonne obligatoire absente : ${HEADER_ALIASES[field][0]}.`);
  }
  const obligations = [];
  const rejected = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const read = (field) => indexes[field] >= 0 ? row[indexes[field]] : "";
    const obligation = normalizeObligation({
      invoiceNumber: read("invoiceNumber"), debtor: read("debtor"), creditor: read("creditor"),
      amount: read("amount"), currency: read("currency"), dueDate: read("dueDate"), status: read("status") || "accepted",
      disputed: isTrue(read("disputed")), assigned: isTrue(read("assigned"))
    }, rowIndex);
    if (obligation.invoiceNumber && obligation.debtor && obligation.creditor && Number.isFinite(obligation.amount)) obligations.push(obligation);
    else rejected.push({ row: rowIndex + 2, reason: "Référence, débiteur, créancier ou montant invalide." });
  });
  if (!obligations.length) throw new Error("Aucune obligation exploitable n’a été trouvée dans le CSV.");
  return { obligations, rejected, delimiter };
}

export function normalizeObligation(value, index = 0) {
  const invoiceNumber = cleanText(value.invoiceNumber || value.invoice || `FACTURE-${index + 1}`);
  const debtor = cleanText(value.debtor);
  const creditor = cleanText(value.creditor);
  const currency = cleanText(value.currency || "EUR").toUpperCase();
  return {
    id: cleanText(value.id) || `OBL-${index + 1}-${invoiceNumber}`,
    invoiceNumber,
    debtor,
    creditor,
    debtorKey: partyKey(debtor),
    creditorKey: partyKey(creditor),
    amount: roundMoney(parseAmount(value.amount)),
    currency,
    dueDate: cleanText(value.dueDate),
    status: partyKey(value.status || "accepted"),
    disputed: value.disputed === true || isTrue(value.disputed),
    assigned: value.assigned === true || isTrue(value.assigned)
  };
}

function eligibilityReason(item) {
  if (!item.debtorKey || !item.creditorKey || item.debtorKey === item.creditorKey) return "Parties invalides ou identiques";
  if (!Number.isFinite(item.amount) || item.amount <= 0) return "Montant invalide";
  if (!/^[A-Z]{3}$/.test(item.currency)) return "Devise ISO invalide";
  if (!ELIGIBLE_STATUSES.has(item.status)) return "Facture non acceptée";
  if (item.disputed) return "Facture en litige";
  if (item.assigned) return "Créance déclarée cédée ou affacturée";
  return "";
}

const edgeKey = (from, to) => `${from}\u0000${to}`;
const edgeTotal = (edge) => roundMoney((edge || []).reduce((sum, item) => sum + item.remainingAmount, 0));

function consumeEdge(edge, requested) {
  let amount = roundMoney(requested);
  const allocations = [];
  for (const item of edge || []) {
    if (amount <= EPSILON) break;
    const used = roundMoney(Math.min(item.remainingAmount, amount));
    if (used <= EPSILON) continue;
    item.remainingAmount = roundMoney(item.remainingAmount - used);
    amount = roundMoney(amount - used);
    allocations.push({ id: item.id, invoiceNumber: item.invoiceNumber, amount: used });
  }
  return allocations;
}

function leg(edge, from, to, amount, names) {
  return { from: names.get(from) || from, to: names.get(to) || to, amount, allocations: consumeEdge(edge, amount) };
}

export function simulateNetting(input, options = {}) {
  const requestedCutoff = cleanText(options.cutoffDate);
  const cutoffDate = normalizeIsoDate(requestedCutoff);
  if (requestedCutoff && !cutoffDate) throw new Error("Date de cut-off invalide. Utilisez le format AAAA-MM-JJ.");
  const normalized = (Array.isArray(input) ? input : []).map((item, index) => normalizeObligation(item, index));
  const ignored = [];
  const deferred = [];
  const eligible = [];
  normalized.forEach((item) => {
    const reason = eligibilityReason(item);
    if (reason) ignored.push({ ...item, reason });
    else if (cutoffDate && !normalizeIsoDate(item.dueDate)) deferred.push({ ...item, reason: "Échéance absente ou invalide pour ce cut-off" });
    else if (cutoffDate && item.dueDate > cutoffDate) deferred.push({ ...item, reason: "Échéance après le cut-off" });
    else eligible.push({ ...item, remainingAmount: item.amount });
  });

  const proposals = [];
  const names = new Map();
  eligible.forEach((item) => { names.set(item.debtorKey, item.debtor); names.set(item.creditorKey, item.creditor); });
  const currencies = [...new Set(eligible.map((item) => item.currency))].sort();
  let proposalIndex = 0;

  for (const currency of currencies) {
    const currencyItems = eligible.filter((item) => item.currency === currency)
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.invoiceNumber.localeCompare(b.invoiceNumber));
    const edges = new Map();
    currencyItems.forEach((item) => {
      const key = edgeKey(item.debtorKey, item.creditorKey);
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(item);
    });
    const parties = [...new Set(currencyItems.flatMap((item) => [item.debtorKey, item.creditorKey]))].sort();

    for (let leftIndex = 0; leftIndex < parties.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < parties.length; rightIndex += 1) {
        const left = parties[leftIndex]; const right = parties[rightIndex];
        const leftToRight = edges.get(edgeKey(left, right)); const rightToLeft = edges.get(edgeKey(right, left));
        const amount = roundMoney(Math.min(edgeTotal(leftToRight), edgeTotal(rightToLeft)));
        if (amount <= EPSILON) continue;
        proposals.push({
          id: `NET-${++proposalIndex}`, type: "bilateral", currency, settlementAmount: amount,
          grossReduction: roundMoney(amount * 2), parties: [names.get(left), names.get(right)],
          legs: [leg(leftToRight, left, right, amount, names), leg(rightToLeft, right, left, amount, names)],
          requiresAgreement: true
        });
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let aIndex = 0; aIndex < parties.length; aIndex += 1) {
        for (let bIndex = aIndex + 1; bIndex < parties.length; bIndex += 1) {
          for (let cIndex = bIndex + 1; cIndex < parties.length; cIndex += 1) {
            const [a, b, c] = [parties[aIndex], parties[bIndex], parties[cIndex]];
            for (const cycle of [[a, b, c], [a, c, b]]) {
              const cycleEdges = cycle.map((from, index) => edges.get(edgeKey(from, cycle[(index + 1) % cycle.length])));
              const amount = roundMoney(Math.min(...cycleEdges.map(edgeTotal)));
              if (amount <= EPSILON) continue;
              proposals.push({
                id: `NET-${++proposalIndex}`, type: "triangular", currency, settlementAmount: amount,
                grossReduction: roundMoney(amount * 3), parties: cycle.map((party) => names.get(party)),
                legs: cycle.map((from, index) => leg(cycleEdges[index], from, cycle[(index + 1) % cycle.length], amount, names)),
                requiresAgreement: true
              });
              changed = true;
              break outer;
            }
          }
        }
      }
    }
  }

  const residuals = eligible.filter((item) => item.remainingAmount > EPSILON).map((item) => ({
    id: item.id, invoiceNumber: item.invoiceNumber, debtor: item.debtor, creditor: item.creditor,
    currency: item.currency, dueDate: item.dueDate, originalAmount: item.amount, remainingAmount: item.remainingAmount
  }));
  const grossVolume = roundMoney(eligible.reduce((sum, item) => sum + item.amount, 0));
  const residualVolume = roundMoney(residuals.reduce((sum, item) => sum + item.remainingAmount, 0));
  const nettedVolume = roundMoney(grossVolume - residualVolume);
  const metricsByCurrency = currencies.map((currency) => {
    const gross = roundMoney(eligible.filter((item) => item.currency === currency).reduce((sum, item) => sum + item.amount, 0));
    const residual = roundMoney(residuals.filter((item) => item.currency === currency).reduce((sum, item) => sum + item.remainingAmount, 0));
    const netted = roundMoney(gross - residual);
    return { currency, grossVolume: gross, nettedVolume: netted, residualVolume: residual, nettingRate: gross ? Math.round((netted / gross) * 1000) / 10 : 0 };
  });
  const positions = currencies.flatMap((currency) => [...names.entries()].flatMap(([key, name]) => {
    const partyItems = eligible.filter((item) => item.currency === currency && (item.debtorKey === key || item.creditorKey === key));
    if (!partyItems.length) return [];
    const receivable = roundMoney(partyItems.filter((item) => item.creditorKey === key).reduce((sum, item) => sum + item.amount, 0));
    const payable = roundMoney(partyItems.filter((item) => item.debtorKey === key).reduce((sum, item) => sum + item.amount, 0));
    return [{ name, currency, receivable, payable, netPosition: roundMoney(receivable - payable) }];
  })).sort((a, b) => Math.abs(b.netPosition) - Math.abs(a.netPosition));

  return {
    generatedAt: new Date().toISOString(),
    scenario: { cutoffDate: cutoffDate || null },
    eligible, ignored, deferred, proposals, residuals, positions, metricsByCurrency,
    metrics: {
      grossVolume, nettedVolume, residualVolume,
      nettingRate: grossVolume ? Math.round((nettedVolume / grossVolume) * 1000) / 10 : 0,
      transfersBefore: eligible.length, transfersAfter: residuals.length,
      transfersAvoided: Math.max(0, eligible.length - residuals.length)
    }
  };
}

export function createNettingDemo() {
  return [
    { invoiceNumber: "INV-AN-1042", debtor: "Atelier Nova", creditor: "Studio Horizon", amount: 100000, currency: "EUR", dueDate: "2026-11-15", status: "accepted" },
    { invoiceNumber: "INV-SH-2088", debtor: "Studio Horizon", creditor: "LogiCore", amount: 80000, currency: "EUR", dueDate: "2026-11-15", status: "accepted" },
    { invoiceNumber: "INV-LC-3321", debtor: "LogiCore", creditor: "Atelier Nova", amount: 70000, currency: "EUR", dueDate: "2026-11-15", status: "accepted" },
    { invoiceNumber: "INV-AN-1054", debtor: "Atelier Nova", creditor: "TechFlow", amount: 40000, currency: "EUR", dueDate: "2026-11-30", status: "approved" },
    { invoiceNumber: "INV-TF-7780", debtor: "TechFlow", creditor: "Atelier Nova", amount: 25000, currency: "EUR", dueDate: "2026-11-30", status: "approved" },
    { invoiceNumber: "INV-LC-3399", debtor: "LogiCore", creditor: "TechFlow", amount: 18000, currency: "EUR", dueDate: "2026-12-05", status: "disputed", disputed: true }
  ];
}

const csvCell = (value) => {
  const raw = String(value ?? "");
  const safe = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function exportNettingCsv(simulation) {
  const header = ["scenario_cutoff", "proposal_id", "type", "currency", "gross_reduction", "from", "to", "amount", "invoices"];
  const rows = [header.map(csvCell).join(";")];
  for (const proposal of simulation?.proposals || []) {
    for (const item of proposal.legs) {
      rows.push([
        simulation?.scenario?.cutoffDate || "all", proposal.id, proposal.type, proposal.currency, proposal.grossReduction,
        item.from, item.to, item.amount, item.allocations.map((allocation) => `${allocation.invoiceNumber}:${allocation.amount}`).join(" | ")
      ].map(csvCell).join(";"));
    }
  }
  return `\ufeff${rows.join("\r\n")}`;
}

export function nettingCsvTemplate() {
  return [
    "invoice_number;debtor;creditor;amount;currency;due_date;status;disputed;assigned",
    "INV-001;Entreprise A;Entreprise B;10000;EUR;2026-12-15;accepted;false;false",
    "INV-002;Entreprise B;Entreprise A;6500;EUR;2026-12-15;accepted;false;false"
  ].join("\r\n");
}
