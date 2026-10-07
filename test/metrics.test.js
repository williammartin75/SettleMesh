import test from "node:test";
import assert from "node:assert/strict";
import {
  exportLocalMetrics,
  normalizeLocalMetrics,
  recordMetricAction,
  recordValidationRun,
  resetLocalMetrics,
  summarizeLocalMetrics
} from "../dist/metrics.js";

const NOW = "2026-10-07T10:00:00.000Z";

test("initialise les métriques depuis l'historique existant sans reprendre ses identifiants", () => {
  const history = [
    { outcome: "ready", checkedAt: "2026-10-06T08:00:00.000Z", invoice: { syntax: "UBL", invoiceNumber: "SECRET-001" } },
    { outcome: "blocked", checkedAt: "2026-10-07T08:00:00.000Z", invoice: { syntax: "CII", supplierName: "Fournisseur secret" } }
  ];
  const metrics = normalizeLocalMetrics(null, { history, now: NOW });

  assert.equal(metrics.counters.validationAttempts, 2);
  assert.equal(metrics.counters.validationCompleted, 2);
  assert.equal(metrics.outcomes.ready, 1);
  assert.equal(metrics.outcomes.blocked, 1);
  assert.equal(metrics.formats.UBL, 1);
  assert.equal(metrics.formats.CII, 1);
  assert.equal(metrics.periodStartedAt, "2026-10-06T08:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(metrics), /SECRET-001|Fournisseur secret/);
});

test("agrège les actions et un lot sans conserver le contenu des résultats", () => {
  let metrics = resetLocalMetrics(NOW);
  metrics = recordMetricAction(metrics, "checklink-copy", { at: NOW });
  metrics = recordMetricAction(metrics, "profile-update", { at: NOW });
  metrics = recordValidationRun(metrics, {
    submitted: 3,
    batch: true,
    durationMs: 1450,
    at: NOW,
    results: [
      { outcome: "ready", invoice: { syntax: "UBL", invoiceNumber: "INV-PRIVATE" } },
      { outcome: "review", invoice: { syntax: "CII", supplierVat: "FR-PRIVATE" } }
    ]
  });
  const summary = summarizeLocalMetrics(metrics);

  assert.equal(summary.checkLinkCopies, 1);
  assert.equal(summary.profileUpdates, 1);
  assert.equal(summary.validationAttempts, 3);
  assert.equal(summary.readableRate, 67);
  assert.equal(summary.readyRate, 50);
  assert.equal(summary.averageDurationMs, 1450);
  assert.equal(metrics.counters.validationUnreadable, 1);
  assert.equal(metrics.counters.batchRuns, 1);
  assert.doesNotMatch(JSON.stringify(metrics), /INV-PRIVATE|FR-PRIVATE/);
});

test("exporte uniquement le schéma agrégé et documente ses garanties de confidentialité", () => {
  const metrics = recordValidationRun(resetLocalMetrics(NOW), {
    submitted: 1,
    durationMs: 500,
    at: NOW,
    results: [{ outcome: "blocked", invoice: { container: "FACTUR-X", invoiceNumber: "DO-NOT-EXPORT" } }]
  });
  const exported = exportLocalMetrics(metrics, { generatedAt: NOW });
  const payload = JSON.parse(exported);

  assert.equal(payload.schema, "settlemesh-local-metrics-export");
  assert.equal(payload.privacy.containsInvoiceContent, false);
  assert.equal(payload.privacy.containsInvoiceIdentifiers, false);
  assert.equal(payload.privacy.transmittedAutomatically, false);
  assert.equal(payload.metrics.formats.FACTUR_X, 1);
  assert.doesNotMatch(exported, /DO-NOT-EXPORT/);
});

test("normalise une sauvegarde altérée avec des compteurs bornés", () => {
  const metrics = normalizeLocalMetrics({
    schema: "settlemesh-local-metrics",
    version: 1,
    periodStartedAt: "date-invalide",
    updatedAt: NOW,
    counters: { validationAttempts: -9, checkLinkCopies: "4.9" },
    outcomes: { ready: Number.POSITIVE_INFINITY },
    formats: { UBL: 3 },
    duration: { runs: 2, totalMs: 800, maxMs: 500 }
  }, { now: NOW });

  assert.equal(metrics.counters.validationAttempts, 0);
  assert.equal(metrics.counters.checkLinkCopies, 4);
  assert.equal(metrics.outcomes.ready, 0);
  assert.equal(metrics.formats.UBL, 3);
  assert.equal(metrics.periodStartedAt, NOW);
});
