import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateMetricEvent, validateMetricRange, aggregateMetricRows, metricsCsv } from "../server/metrics.mjs";
import { createApiCredential } from "../server/auth.mjs";
import { writeRegistryFile } from "../server/registry.mjs";
import { createSettleMeshServer, listen } from "../server/server.mjs";

const adminKey = createApiCredential({ organizationId: "atelier-nova", keyId: "met-admin", role: "admin" });
const viewerKey = createApiCredential({ organizationId: "atelier-nova", keyId: "met-viewer", role: "viewer" });
const otherOwnerKey = createApiCredential({ organizationId: "studio-horizon", keyId: "met-other", role: "owner" });

test("la liste blanche de l'événement ne transporte aucune donnée de facture", () => {
  const event = validateMetricEvent({
    organizationId: "atelier-nova", action: "invoice_checked", day: "2026-10-08",
    // données hôte ignorées, jamais transportées :
    invoiceNumber: "F-2026-001", supplierName: "Atelier Nova", amount: 1200, currency: "EUR",
    vatId: "FR11123456782", xml: "<Invoice/>", ip: "1.2.3.4", sessionId: "abc"
  });
  assert.deepEqual(event, { organizationId: "atelier-nova", action: "invoice_checked", day: "2026-10-08" });
  assert.throws(() => validateMetricEvent({ organizationId: "Atelier Nova!", action: "invoice_checked", day: "2026-10-08" }), /slug/);
  assert.throws(() => validateMetricEvent({ organizationId: "atelier-nova", action: "page_opened", day: "2026-10-08" }), /action/);
  assert.throws(() => validateMetricEvent({ organizationId: "atelier-nova", action: "invoice_checked", day: "08/10/2026" }), /AAAA-MM-JJ/);
  assert.throws(() => validateMetricEvent({ organizationId: "atelier-nova", action: "invoice_checked", day: "2099-01-01" }), /futur/);
});

test("la période de lecture est bornée et cohérente", () => {
  assert.deepEqual(validateMetricRange("2026-10-01", "2026-10-08"), { from: "2026-10-01", to: "2026-10-08" });
  assert.throws(() => validateMetricRange("2026-10-08", "2026-10-01"), /précéder/);
  assert.throws(() => validateMetricRange("2026-01-01", "2026-12-31"), /limitée/);
  assert.throws(() => validateMetricRange("01-10-2026", "2026-10-08"), /AAAA-MM-JJ/);
});

test("l'agrégation regroupe par jour et action, hors périmètre d'autres organisations", () => {
  const rows = [
    { organization_id: "atelier-nova", day: "2026-10-07", action: "checklink_copied", count: 1 },
    { organization_id: "atelier-nova", day: "2026-10-08", action: "invoice_checked", count: 3 },
    { organization_id: "atelier-nova", day: "2026-10-08", action: "invoice_ready", count: 2 },
    { organization_id: "studio-horizon", day: "2026-10-08", action: "invoice_checked", count: 9 },
    { organization_id: "atelier-nova", day: "2026-09-01", action: "invoice_checked", count: 7 }
  ];
  const aggregated = aggregateMetricRows(rows, { organizationId: "atelier-nova", from: "2026-10-01", to: "2026-10-08" });
  assert.deepEqual(aggregated.totals, { checklink_copied: 1, invoice_checked: 3, invoice_ready: 2 });
  assert.deepEqual(aggregated.days, [
    { day: "2026-10-07", action: "checklink_copied", count: 1 },
    { day: "2026-10-08", action: "invoice_checked", count: 3 },
    { day: "2026-10-08", action: "invoice_ready", count: 2 }
  ]);
});

test("l'export CSV est neutralisé : aucune formule exécutable dans un tableur", () => {
  const csv = metricsCsv({
    organizationId: "atelier-nova", from: "2026-10-01", to: "2026-10-08",
    totals: { checklink_copied: 1, invoice_checked: 3, invoice_ready: 2 },
    days: [
      { day: "=HYPERLINK(http://evil)", action: "+cmd", count: "@risky" },
      { day: "-2+3", action: "invoice_ready", count: 2 }
    ]
  });
  assert.ok(csv.startsWith("day,action,count"), "l'en-tête reste lisible");
  assert.ok(csv.includes(`'=HYPERLINK`), "cellule = neutralisée");
  assert.ok(csv.includes("'+cmd"));
  assert.ok(csv.includes("'@risky"));
  assert.ok(csv.includes("'-2+3"));
  for (const dangerous of ["=HYPERLINK", "+cmd", "@risky", "-2+3"]) {
    assert.ok(!csv.includes(`,${dangerous}`), `préfixe dangereux non neutralisé : ${dangerous}`);
  }
});

test("HTTP : l'événement accepté est anonyme, et le stockage indisponible reste 503", async () => {
  const inserted = [];
  const store = {
    insert: async (event) => { inserted.push(event); return true; },
    range: async () => []
  };
  const server = createSettleMeshServer({ metricsStoreOption: store });
  const address = await listen(server, { port: 0 });
  const url = `http://127.0.0.1:${address.port}/api/v1/metrics`;
  try {
    const response = await fetch(`${url}/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: "atelier-nova", action: "checklink_copied", day: "2026-10-08", invoiceNumber: "F-1", amount: 500 })
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).accepted, true);
    assert.deepEqual(inserted, [{ organizationId: "atelier-nova", action: "checklink_copied", day: "2026-10-08" }]);

    // sans stockage configuré : indisponibilité explicite, jamais un succès
    const closed = createSettleMeshServer({});
    const closedAddress = await listen(closed, { port: 0 });
    try {
      const unavailable = await fetch(`http://127.0.0.1:${closedAddress.port}/api/v1/metrics/events`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: "atelier-nova", action: "checklink_copied", day: "2026-10-08" })
      });
      assert.equal(unavailable.status, 503);
      assert.equal((await unavailable.json()).error.code, "METRICS_UNAVAILABLE");
    } finally {
      closed.close();
    }
  } finally {
    server.close();
  }
});

test("HTTP : lecture refusée à un viewer et isolée par organisation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settlemesh-met-"));
  const registryPath = join(dir, "registry.json");
  writeRegistryFile(registryPath, [adminKey.credential, viewerKey.credential, otherOwnerKey.credential]);
  const rows = [
    { organization_id: "atelier-nova", day: "2026-10-08", action: "checklink_copied", count: 2 },
    { organization_id: "studio-horizon", day: "2026-10-08", action: "checklink_copied", count: 5 }
  ];
  const store = { insert: async () => true, range: async () => rows };
  const server = createSettleMeshServer({ registryFile: registryPath, metricsStoreOption: store });
  const address = await listen(server, { port: 0 });
  const url = `http://127.0.0.1:${address.port}/api/v1/metrics?from=2026-10-01&to=2026-10-08`;
  try {
    const viewer = await fetch(url, { headers: { Authorization: `Bearer ${viewerKey.apiKey}` } });
    assert.equal(viewer.status, 403);
    assert.equal((await viewer.json()).error.code, "FORBIDDEN_ROLE");

    const owner = await fetch(url, { headers: { Authorization: `Bearer ${adminKey.apiKey}` } });
    assert.equal(owner.status, 200);
    const body = await owner.json();
    assert.equal(body.organizationId, "atelier-nova");
    assert.deepEqual(body.totals, { checklink_copied: 2, invoice_checked: 0, invoice_ready: 0 });

    const other = await fetch(url, { headers: { Authorization: `Bearer ${otherOwnerKey.apiKey}` } });
    assert.equal(other.status, 200);
    const otherBody = await other.json();
    assert.equal(otherBody.organizationId, "studio-horizon");
    assert.deepEqual(otherBody.totals, { checklink_copied: 5, invoice_checked: 0, invoice_ready: 0 });

    // l'agrégation ignore les lignes hors périmètre de la période demandée
    const narrow = await fetch(`http://127.0.0.1:${address.port}/api/v1/metrics?from=2026-10-09&to=2026-10-10`, { headers: { Authorization: `Bearer ${adminKey.apiKey}` } });
    assert.deepEqual((await narrow.json()).totals, { checklink_copied: 0, invoice_checked: 0, invoice_ready: 0 });
  } finally {
    server.close();
  }
});

test("HTTP : l'export CSV exige le même rôle et respecte la période", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settlemesh-met-"));
  const registryPath = join(dir, "registry.json");
  writeRegistryFile(registryPath, [adminKey.credential, viewerKey.credential]);
  const store = {
    insert: async () => true,
    range: async () => [{ organization_id: "atelier-nova", day: "2026-10-08", action: "invoice_ready", count: 4 }]
  };
  const server = createSettleMeshServer({ registryFile: registryPath, metricsStoreOption: store });
  const address = await listen(server, { port: 0 });
  try {
    const denied = await fetch(`http://127.0.0.1:${address.port}/api/v1/metrics/export?from=2026-10-01&to=2026-10-08`);
    assert.equal(denied.status, 401);
    const viewer = await fetch(`http://127.0.0.1:${address.port}/api/v1/metrics/export?from=2026-10-01&to=2026-10-08`, { headers: { Authorization: `Bearer ${viewerKey.apiKey}` } });
    assert.equal(viewer.status, 403);
    const exported = await fetch(`http://127.0.0.1:${address.port}/api/v1/metrics/export?from=2026-10-01&to=2026-10-08`, { headers: { Authorization: `Bearer ${adminKey.apiKey}` } });
    assert.equal(exported.status, 200);
    assert.ok(String(exported.headers.get("content-type")).includes("text/csv"));
    const text = await exported.text();
    assert.ok(text.includes("2026-10-08,invoice_ready,4"));
    const badRange = await fetch(`http://127.0.0.1:${address.port}/api/v1/metrics?from=x&to=y`, { headers: { Authorization: `Bearer ${adminKey.apiKey}` } });
    assert.equal(badRange.status, 400);
    assert.equal((await badRange.json()).error.code, "INVALID_METRICS_RANGE");
  } finally {
    server.close();
  }
});
