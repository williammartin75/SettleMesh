const OPEN_STATUSES = new Set(["open", "overdue"]);

const HEADER_ALIASES = {
  id: ["id", "invoice_id", "invoice", "numero", "numéro", "reference", "référence", "ref"],
  supplier: ["supplier", "fournisseur", "vendor", "creditor", "créancier", "creancier"],
  customer: ["customer", "client", "buyer", "debtor", "débiteur", "debiteur"],
  amount: ["amount", "montant", "total", "amount_eur", "montant_eur"],
  dueDate: ["due_date", "due date", "echeance", "échéance", "date_echeance", "date échéance"],
  status: ["status", "statut", "etat", "état"]
};

const STATUS_ALIASES = new Map([
  ["open", "open"], ["ouverte", "open"], ["ouvert", "open"], ["a payer", "open"],
  ["overdue", "overdue"], ["late", "overdue"], ["en retard", "overdue"], ["retard", "overdue"],
  ["paid", "paid"], ["payee", "paid"], ["paye", "paid"], ["reglee", "paid"], ["réglée", "paid"],
  ["disputed", "disputed"], ["litige", "disputed"], ["contestee", "disputed"], ["contestée", "disputed"]
]);

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function parseAmount(value) {
  if (typeof value === "number") return value;
  let source = String(value ?? "").trim().replace(/[€$£\s\u00a0]/g, "");
  if (!source) return Number.NaN;

  const comma = source.lastIndexOf(",");
  const dot = source.lastIndexOf(".");
  if (comma > dot) {
    source = source.replace(/\./g, "").replace(",", ".");
  } else if (dot > comma && comma !== -1) {
    source = source.replace(/,/g, "");
  } else if (comma !== -1) {
    source = source.replace(",", ".");
  }
  return Number(source);
}

function canonicalStatus(value) {
  const key = normalizeKey(value || "open");
  return STATUS_ALIASES.get(key) || "open";
}

function toIsoDate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const french = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (french) {
    const [, day, month, year] = french;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function countDelimiter(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === delimiter && !quoted) count += 1;
  }
  return count;
}

function resolveHeaders(headers) {
  const normalized = headers.map(normalizeKey);
  return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([field, aliases]) => {
    const candidates = aliases.map(normalizeKey);
    return [field, normalized.findIndex((header) => candidates.includes(header))];
  }));
}

export function normalizeInvoice(raw, index = 0) {
  const supplier = cleanName(raw.supplier);
  const customer = cleanName(raw.customer);
  const amount = parseAmount(raw.amount);
  const dueDate = toIsoDate(raw.dueDate);

  if (!supplier) throw new Error("fournisseur manquant");
  if (!customer) throw new Error("client manquant");
  if (normalizeKey(supplier) === normalizeKey(customer)) throw new Error("client et fournisseur identiques");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("montant invalide");
  if (raw.dueDate && !dueDate) throw new Error("date d’échéance invalide");

  return {
    id: cleanName(raw.id) || `INV-${String(index + 1).padStart(4, "0")}`,
    supplier,
    customer,
    amount: Math.round(amount * 100) / 100,
    dueDate,
    status: canonicalStatus(raw.status)
  };
}

export function parseInvoiceCSV(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = countDelimiter(firstLine, ";") > countDelimiter(firstLine, ",") ? ";" : ",";
  const rows = parseRows(source, delimiter);
  if (rows.length < 2) return { invoices: [], errors: ["Le fichier ne contient aucune donnée."], delimiter };

  const headerMap = resolveHeaders(rows[0]);
  const required = ["supplier", "customer", "amount"];
  const missing = required.filter((field) => headerMap[field] < 0);
  if (missing.length) {
    return {
      invoices: [],
      errors: [`Colonnes obligatoires introuvables : ${missing.join(", ")}.`],
      delimiter
    };
  }

  const invoices = [];
  const errors = [];
  rows.slice(1).forEach((row, index) => {
    const pick = (field) => headerMap[field] >= 0 ? row[headerMap[field]] : "";
    try {
      invoices.push(normalizeInvoice({
        id: pick("id"),
        supplier: pick("supplier"),
        customer: pick("customer"),
        amount: pick("amount"),
        dueDate: pick("dueDate"),
        status: pick("status")
      }, index));
    } catch (error) {
      errors.push(`Ligne ${index + 2} : ${error.message}.`);
    }
  });

  return { invoices, errors, delimiter };
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

function euros(value) {
  return Math.round(value) / 100;
}

export function isEligible(invoice) {
  return OPEN_STATUSES.has(canonicalStatus(invoice.status));
}

export function computePlan(invoices) {
  const eligibleInvoices = invoices.filter(isEligible);
  const positions = new Map();
  const stats = new Map();
  const pairMap = new Map();
  let grossCents = 0;

  const ensureEntity = (name) => {
    if (!positions.has(name)) positions.set(name, 0);
    if (!stats.has(name)) stats.set(name, { name, receivablesCents: 0, payablesCents: 0, invoiceCount: 0 });
  };

  eligibleInvoices.forEach((invoice) => {
    const amount = cents(invoice.amount);
    if (amount <= 0) return;
    const supplier = cleanName(invoice.supplier);
    const customer = cleanName(invoice.customer);
    ensureEntity(supplier);
    ensureEntity(customer);

    grossCents += amount;
    positions.set(supplier, positions.get(supplier) + amount);
    positions.set(customer, positions.get(customer) - amount);
    stats.get(supplier).receivablesCents += amount;
    stats.get(supplier).invoiceCount += 1;
    stats.get(customer).payablesCents += amount;
    stats.get(customer).invoiceCount += 1;

    const [a, b] = [customer, supplier].sort((left, right) => left.localeCompare(right, "fr"));
    const key = `${a}\u0000${b}`;
    if (!pairMap.has(key)) pairMap.set(key, { a, b, aToB: 0, bToA: 0, invoiceCount: 0 });
    const pair = pairMap.get(key);
    if (customer === a) pair.aToB += amount;
    else pair.bToA += amount;
    pair.invoiceCount += 1;
  });

  const bilateralEdges = [];
  let bilateralRemainingCents = 0;
  pairMap.forEach((pair) => {
    const difference = pair.aToB - pair.bToA;
    if (difference > 0) {
      bilateralEdges.push({ from: pair.a, to: pair.b, amount: euros(difference), invoiceCount: pair.invoiceCount });
      bilateralRemainingCents += difference;
    } else if (difference < 0) {
      bilateralEdges.push({ from: pair.b, to: pair.a, amount: euros(-difference), invoiceCount: pair.invoiceCount });
      bilateralRemainingCents += -difference;
    }
  });

  const creditors = [];
  const debtors = [];
  positions.forEach((position, name) => {
    if (position > 0) creditors.push({ name, amount: position });
    if (position < 0) debtors.push({ name, amount: -position });
  });
  creditors.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "fr"));
  debtors.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "fr"));

  const settlements = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.amount, debtor.amount);
    if (amount > 0) settlements.push({ from: debtor.name, to: creditor.name, amount: euros(amount) });
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditorIndex += 1;
    if (debtor.amount === 0) debtorIndex += 1;
  }

  const netCashCents = settlements.reduce((sum, item) => sum + cents(item.amount), 0);
  const entityStats = [...stats.values()].map((entity) => {
    const netCents = positions.get(entity.name) || 0;
    return {
      name: entity.name,
      receivables: euros(entity.receivablesCents),
      payables: euros(entity.payablesCents),
      net: euros(netCents),
      invoiceCount: entity.invoiceCount,
      role: netCents > 0 ? "creditor" : netCents < 0 ? "debtor" : "balanced"
    };
  }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  const gross = euros(grossCents);
  const bilateralRemaining = euros(bilateralRemainingCents);
  const netCash = euros(netCashCents);
  const bilateralCleared = euros(grossCents - bilateralRemainingCents);
  const multilateralCleared = euros(Math.max(0, bilateralRemainingCents - netCashCents));
  const totalCleared = euros(Math.max(0, grossCents - netCashCents));

  return {
    gross,
    bilateralRemaining,
    bilateralCleared,
    multilateralCleared,
    totalCleared,
    netCash,
    reductionRate: grossCents ? (grossCents - netCashCents) / grossCents : 0,
    eligibleCount: eligibleInvoices.length,
    excludedCount: invoices.length - eligibleInvoices.length,
    bilateralEdges,
    settlements,
    entities: entityStats
  };
}

export function getPortfolioSignals(invoices, today = new Date()) {
  const date = new Date(today);
  date.setHours(0, 0, 0, 0);
  const nextWeek = new Date(date);
  nextWeek.setDate(nextWeek.getDate() + 7);

  let overdueAmount = 0;
  let dueSoonAmount = 0;
  let disputedAmount = 0;
  let overdueCount = 0;
  invoices.forEach((invoice) => {
    if (canonicalStatus(invoice.status) === "disputed") disputedAmount += Number(invoice.amount) || 0;
    if (!isEligible(invoice) || !invoice.dueDate) return;
    const due = new Date(`${invoice.dueDate}T00:00:00`);
    if (due < date) {
      overdueAmount += Number(invoice.amount) || 0;
      overdueCount += 1;
    } else if (due <= nextWeek) {
      dueSoonAmount += Number(invoice.amount) || 0;
    }
  });
  return { overdueAmount, dueSoonAmount, disputedAmount, overdueCount };
}

function relativeDate(days) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

export function createDemoInvoices() {
  const data = [
    ["FM-2401", "Novera Matériaux", "Astre BTP", 128000, -12, "overdue"],
    ["FM-2402", "FluxGrid Logistique", "Novera Matériaux", 95000, 3, "open"],
    ["FM-2403", "Astre BTP", "FluxGrid Logistique", 82000, -4, "overdue"],
    ["FM-2404", "Koru Énergie", "Astre BTP", 34000, 8, "open"],
    ["FM-2405", "Novera Matériaux", "Koru Énergie", 28000, 14, "open"],
    ["FM-2406", "Atlas Services", "Novera Matériaux", 22000, -2, "overdue"],
    ["FM-2407", "Koru Énergie", "Atlas Services", 18000, 6, "open"],
    ["FM-2408", "Koru Énergie", "FluxGrid Logistique", 15000, 20, "open"],
    ["FM-2409", "FluxGrid Logistique", "Koru Énergie", 12000, 10, "open"],
    ["FM-2410", "Astre BTP", "Cime Retail", 41000, 4, "open"],
    ["FM-2411", "Cime Retail", "Novera Matériaux", 26000, 16, "open"],
    ["FM-2412", "Atlas Services", "Cime Retail", 9000, -7, "overdue"],
    ["FM-2413", "Cime Retail", "Solstice Conseil", 17000, 24, "open"],
    ["FM-2414", "Solstice Conseil", "Atlas Services", 8000, 12, "open"],
    ["FM-2397", "Novera Matériaux", "Atlas Services", 7500, -22, "disputed"],
    ["FM-2388", "FluxGrid Logistique", "Cime Retail", 13000, -31, "paid"]
  ];
  return data.map(([id, supplier, customer, amount, days, status]) => ({
    id, supplier, customer, amount, dueDate: relativeDate(days), status
  }));
}

export function escapeCsv(value) {
  const source = String(value ?? "");
  return /[;"\r\n]/.test(source) ? `"${source.replace(/"/g, '""')}"` : source;
}

export function settlementsToCSV(settlements) {
  const lines = ["debiteur;crediteur;montant_eur"];
  settlements.forEach((item) => lines.push([
    escapeCsv(item.from),
    escapeCsv(item.to),
    Number(item.amount).toFixed(2).replace(".", ",")
  ].join(";")));
  return `\uFEFF${lines.join("\r\n")}`;
}
