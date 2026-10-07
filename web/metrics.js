export const METRICS_SCHEMA = "settlemesh-local-metrics";
export const METRICS_VERSION = 1;

const COUNTER_KEYS = Object.freeze([
  "profileUpdates",
  "checkLinkCopies",
  "validationAttempts",
  "validationCompleted",
  "validationUnreadable",
  "batchRuns"
]);
const OUTCOME_KEYS = Object.freeze(["ready", "review", "blocked"]);
const FORMAT_KEYS = Object.freeze(["UBL", "CII", "FACTUR_X", "OTHER"]);
const ACTION_COUNTERS = Object.freeze({
  "profile-update": "profileUpdates",
  "checklink-copy": "checkLinkCopies"
});
const MAX_COUNTER = 1_000_000_000;
const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

function boundedInteger(value, maximum = MAX_COUNTER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(maximum, Math.floor(number));
}

function isoDate(value, fallback) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function emptyMetrics(now = new Date().toISOString()) {
  const timestamp = isoDate(now, new Date().toISOString());
  return {
    schema: METRICS_SCHEMA,
    version: METRICS_VERSION,
    periodStartedAt: timestamp,
    updatedAt: timestamp,
    counters: Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0])),
    outcomes: Object.fromEntries(OUTCOME_KEYS.map((key) => [key, 0])),
    formats: Object.fromEntries(FORMAT_KEYS.map((key) => [key, 0])),
    duration: { runs: 0, totalMs: 0, maxMs: 0 }
  };
}

function resultFormat(result) {
  if (result?.invoice?.container === "FACTUR-X") return "FACTUR_X";
  if (result?.invoice?.syntax === "UBL") return "UBL";
  if (result?.invoice?.syntax === "CII") return "CII";
  return "OTHER";
}

export function normalizeLocalMetrics(value, { history = [], now = new Date().toISOString() } = {}) {
  const fallback = isoDate(now, new Date().toISOString());
  if (value?.schema !== METRICS_SCHEMA || value?.version !== METRICS_VERSION) {
    const metrics = emptyMetrics(fallback);
    const usableHistory = Array.isArray(history) ? history : [];
    if (!usableHistory.length) return metrics;

    metrics.counters.validationAttempts = usableHistory.length;
    metrics.counters.validationCompleted = usableHistory.length;
    usableHistory.forEach((result) => {
      if (OUTCOME_KEYS.includes(result?.outcome)) metrics.outcomes[result.outcome] += 1;
      metrics.formats[resultFormat(result)] += 1;
    });
    const oldest = usableHistory
      .map((result) => new Date(result?.checkedAt).getTime())
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    if (oldest) metrics.periodStartedAt = new Date(oldest).toISOString();
    return metrics;
  }

  const metrics = emptyMetrics(fallback);
  metrics.periodStartedAt = isoDate(value.periodStartedAt, fallback);
  metrics.updatedAt = isoDate(value.updatedAt, fallback);
  COUNTER_KEYS.forEach((key) => { metrics.counters[key] = boundedInteger(value.counters?.[key]); });
  OUTCOME_KEYS.forEach((key) => { metrics.outcomes[key] = boundedInteger(value.outcomes?.[key]); });
  FORMAT_KEYS.forEach((key) => { metrics.formats[key] = boundedInteger(value.formats?.[key]); });
  metrics.duration.runs = boundedInteger(value.duration?.runs);
  metrics.duration.totalMs = boundedInteger(value.duration?.totalMs, MAX_DURATION_MS);
  metrics.duration.maxMs = boundedInteger(value.duration?.maxMs, MAX_DURATION_MS);
  return metrics;
}

export function recordMetricAction(current, action, { at = new Date().toISOString() } = {}) {
  const counter = ACTION_COUNTERS[action];
  if (!counter) return normalizeLocalMetrics(current, { now: at });
  const metrics = normalizeLocalMetrics(current, { now: at });
  metrics.counters[counter] = Math.min(MAX_COUNTER, metrics.counters[counter] + 1);
  metrics.updatedAt = isoDate(at, metrics.updatedAt);
  return metrics;
}

export function recordValidationRun(current, {
  submitted = 0,
  results = [],
  durationMs = 0,
  batch = false,
  at = new Date().toISOString()
} = {}) {
  const metrics = normalizeLocalMetrics(current, { now: at });
  const submittedCount = boundedInteger(submitted);
  const safeResults = Array.isArray(results) ? results.slice(0, submittedCount) : [];
  const completedCount = safeResults.length;

  metrics.counters.validationAttempts = Math.min(MAX_COUNTER, metrics.counters.validationAttempts + submittedCount);
  metrics.counters.validationCompleted = Math.min(MAX_COUNTER, metrics.counters.validationCompleted + completedCount);
  metrics.counters.validationUnreadable = Math.min(MAX_COUNTER, metrics.counters.validationUnreadable + Math.max(0, submittedCount - completedCount));
  if (batch && submittedCount > 1) metrics.counters.batchRuns = Math.min(MAX_COUNTER, metrics.counters.batchRuns + 1);

  safeResults.forEach((result) => {
    if (OUTCOME_KEYS.includes(result?.outcome)) metrics.outcomes[result.outcome] = Math.min(MAX_COUNTER, metrics.outcomes[result.outcome] + 1);
    const format = resultFormat(result);
    metrics.formats[format] = Math.min(MAX_COUNTER, metrics.formats[format] + 1);
  });

  if (submittedCount > 0) {
    const elapsed = boundedInteger(Math.round(durationMs), MAX_DURATION_MS);
    metrics.duration.runs = Math.min(MAX_COUNTER, metrics.duration.runs + 1);
    metrics.duration.totalMs = Math.min(MAX_DURATION_MS, metrics.duration.totalMs + elapsed);
    metrics.duration.maxMs = Math.max(metrics.duration.maxMs, elapsed);
  }
  metrics.updatedAt = isoDate(at, metrics.updatedAt);
  return metrics;
}

export function summarizeLocalMetrics(current) {
  const metrics = normalizeLocalMetrics(current);
  const attempts = metrics.counters.validationAttempts;
  const completed = metrics.counters.validationCompleted;
  return {
    checkLinkCopies: metrics.counters.checkLinkCopies,
    profileUpdates: metrics.counters.profileUpdates,
    validationAttempts: attempts,
    readableRate: attempts ? Math.min(100, Math.round((completed / attempts) * 100)) : null,
    readyRate: completed ? Math.min(100, Math.round((metrics.outcomes.ready / completed) * 100)) : null,
    averageDurationMs: metrics.duration.runs ? Math.round(metrics.duration.totalMs / metrics.duration.runs) : null,
    periodStartedAt: metrics.periodStartedAt
  };
}

export function resetLocalMetrics(now = new Date().toISOString()) {
  return emptyMetrics(now);
}

export function exportLocalMetrics(current, { generatedAt = new Date().toISOString() } = {}) {
  const metrics = normalizeLocalMetrics(current, { now: generatedAt });
  return JSON.stringify({
    schema: "settlemesh-local-metrics-export",
    version: 1,
    generatedAt: isoDate(generatedAt, metrics.updatedAt),
    privacy: {
      scope: "aggregated-browser-local",
      containsInvoiceContent: false,
      containsInvoiceIdentifiers: false,
      transmittedAutomatically: false
    },
    metrics
  }, null, 2);
}
