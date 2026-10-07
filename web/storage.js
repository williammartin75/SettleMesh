export const STORAGE_KEY = "settlemesh-v1";
export const LEGACY_STORAGE_KEYS = Object.freeze(["eurule-checklink-v1"]);
export const HISTORY_RETENTION_DAYS = 30;
export const MAX_HISTORY_ENTRIES = 100;

const boundedCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(10_000, Math.floor(number)) : 0;
};

const nullableAmount = (value) => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

const compactHistoryEntry = (entry) => ({
  id: String(entry?.id || "").slice(0, 100),
  checkedAt: new Date(entry.checkedAt).toISOString(),
  recipient: String(entry?.recipient || "").slice(0, 200),
  outcome: ["ready", "review", "blocked"].includes(entry?.outcome) ? entry.outcome : "blocked",
  score: Math.max(0, Math.min(100, Math.round(Number(entry?.score) || 0))),
  counts: {
    pass: boundedCount(entry?.counts?.pass),
    error: boundedCount(entry?.counts?.error),
    warning: boundedCount(entry?.counts?.warning),
    info: boundedCount(entry?.counts?.info)
  },
  standards: {
    en16931: entry?.standards?.en16931 ? String(entry.standards.en16931).slice(0, 50) : null,
    peppol: entry?.standards?.peppol ? String(entry.standards.peppol).slice(0, 50) : null
  },
  invoice: {
    invoiceNumber: String(entry?.invoice?.invoiceNumber || "").slice(0, 200),
    documentType: String(entry?.invoice?.documentType || "").slice(0, 50),
    syntax: String(entry?.invoice?.syntax || "").slice(0, 30),
    container: String(entry?.invoice?.container || "").slice(0, 30),
    supplierName: String(entry?.invoice?.supplierName || "").slice(0, 200),
    supplierVat: String(entry?.invoice?.supplierVat || "").slice(0, 100),
    currency: String(entry?.invoice?.currency || "").slice(0, 3),
    payableAmount: nullableAmount(entry?.invoice?.payableAmount)
  }
});

export function compactHistory(history, {
  now = Date.now(),
  retentionDays = HISTORY_RETENTION_DAYS,
  maxEntries = MAX_HISTORY_ENTRIES
} = {}) {
  const timestamp = new Date(now).getTime();
  const cutoff = timestamp - Math.max(0, Number(retentionDays) || 0) * 24 * 60 * 60 * 1000;
  return (Array.isArray(history) ? history : [])
    .filter((entry) => {
      const checkedAt = new Date(entry?.checkedAt).getTime();
      return Number.isFinite(checkedAt) && checkedAt >= cutoff && checkedAt <= timestamp + 5 * 60 * 1000;
    })
    .slice(0, Math.max(0, Number(maxEntries) || 0))
    .map(compactHistoryEntry);
}

export function createPersistedState(state, options = {}) {
  return {
    profile: state?.profile || {},
    history: compactHistory(state?.history, options),
    metrics: state?.metrics || null,
    netting: state?.netting || { obligations: [], source: "" }
  };
}

export function readPersistedState(storage) {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    try {
      const raw = storage?.getItem?.(key);
      if (!raw) continue;
      return { value: JSON.parse(raw), sourceKey: key, migrated: key !== STORAGE_KEY };
    } catch {
      // Une entrée illisible ne doit pas masquer une ancienne sauvegarde valide.
    }
  }
  return { value: null, sourceKey: "", migrated: false };
}

export function writePersistedState(storage, value) {
  storage?.setItem?.(STORAGE_KEY, JSON.stringify(value));
}
