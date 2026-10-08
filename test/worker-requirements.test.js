import test from "node:test";
import assert from "node:assert/strict";
import workerDefault, { requirementsSearchRoute, requirementsVerifyRoute, metricsEventRoute } from "../worker/index.js";
import { METRICS_SCHEMA } from "../worker/metrics.mjs";

// Routes publiques du Worker publié (0.23.0) : parité exacte avec le serveur
// Node — mêmes listes blanches, mêmes verdicts, mêmes formes de réponse. Le
// Worker reste sans stockage : Supabase en secrets d'environnement, aucune
// indisponibilité jamais maquillée en succès.

const ENV = {
  SETTLEMESH_SUPABASE_PROJECT_REF: "projetref000000000000",
  SETTLEMESH_SUPABASE_SERVICE_KEY: "cle-service-de-test"
};

const jsonResponse = (rows, status = 200) => ({ ok: status < 400, status, json: async () => rows, text: async () => "" });

const publishedRow = (overrides = {}) => ({
  id: 1,
  organization_id: "atelier-nova",
  company_name: "Atelier Nova",
  legal_name: "Atelier Nova SARL",
  country: "FR",
  vat_id: "FR32987654321",
  peppol_id: "",
  accepted_formats: ["UBL", "CII"],
  accepted_currencies: ["EUR"],
  requirements: {
    routingProvider: "PDP exemple",
    requirePurchaseOrder: true,
    requireBuyerReference: false,
    requireEndpoint: true,
    requireAttachment: false,
    submissionEmail: "factures@atelier-nova.example",
    instructions: "Bon de commande obligatoire sur toute facture."
  },
  version: 2,
  published: true,
  created_at: "2026-10-08T08:00:00.000Z",
  updated_at: "2026-10-08T08:00:00.000Z",
  ...overrides
});

// Profil complet (les 15 champs de la liste blanche) : verifyAgainstPublished
// compare le profil entier avec normalisation symétrique, omissions comprises.
const matchingProfile = {
  companyName: "Atelier Nova",
  legalName: "Atelier Nova SARL",
  country: "FR",
  vatId: "FR32987654321",
  peppolId: "",
  acceptedFormats: ["UBL", "CII"],
  acceptedCurrencies: ["EUR"],
  routingProvider: "PDP exemple",
  requirePurchaseOrder: true,
  requireBuyerReference: false,
  requireEndpoint: true,
  requireAttachment: false,
  submissionEmail: "factures@atelier-nova.example",
  instructions: "Bon de commande obligatoire sur toute facture."
};

const verifyPayload = { profile: matchingProfile };

test("recherche du Worker : uniquement les profils publiés, champs minimisés, forme identique au serveur", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse([publishedRow()]);
  };
  const response = await requirementsSearchRoute(new URL("https://settlemesh.example/api/v1/requirements?q=nova"), ENV, { fetchImpl });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schema, "settlemesh-requirements");
  assert.equal(body.apiVersion, "v1");
  assert.equal(body.count, 1);
  assert.equal(body.query, "nova");
  assert.equal(body.stored, false);
  assert.equal(body.results[0].profile.companyName, "Atelier Nova");
  // Invariant de l'épique : minimisation stricte des résultats de recherche.
  for (const forbidden of ["instructions", "submissionEmail", "routingProvider", "requirePurchaseOrder"]) {
    assert.ok(!(forbidden in body.results[0].profile), `le champ ${forbidden} ne doit pas apparaître en recherche`);
  }
  // Invariant central : rien n'est cherchable sans publication explicite.
  assert.ok(calls[0].includes("published=eq.true"));
  assert.ok(calls[0].includes("or=("));
});

test("recherche sans secrets du Worker : 503 explicite, jamais de succès maquillé", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse([]); };
  const response = await requirementsSearchRoute(new URL("https://settlemesh.example/api/v1/requirements?q=nova"), {}, { fetchImpl });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "REQUIREMENTS_UNAVAILABLE");
  assert.equal(called, false, "aucune requête ne doit partir sans secrets configurés");
});

test("recherche : stockage indisponible en amont → 503 explicite, sans succès par défaut", async () => {
  const fetchImpl = async () => jsonResponse({ message: "JWT invalide" }, 401);
  const response = await requirementsSearchRoute(new URL("https://settlemesh.example/api/v1/requirements?q=nova"), ENV, { fetchImpl });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "REQUIREMENTS_UNAVAILABLE");
});

test("vérification CheckLink : verified, not_published et unknown distingués", async () => {
  const fetchRows = (rows) => async () => jsonResponse(rows);
  const verified = await requirementsVerifyRoute(new Request("https://settlemesh.example/api/v1/requirements/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(verifyPayload)
  }), ENV, { fetchImpl: fetchRows([publishedRow()]) });
  assert.equal(verified.status, 200);
  const verifiedBody = await verified.json();
  assert.equal(verifiedBody.schema, "settlemesh-requirements-verify");
  assert.equal(verifiedBody.verdict, "verified");
  assert.equal(verifiedBody.stored, false);

  const notPublished = await requirementsVerifyRoute(new Request("https://settlemesh.example/api/v1/requirements/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(verifyPayload)
  }), ENV, { fetchImpl: fetchRows([publishedRow({ published: false })]) });
  assert.equal((await notPublished.json()).verdict, "not_published");

  const unknown = await requirementsVerifyRoute(new Request("https://settlemesh.example/api/v1/requirements/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(verifyPayload)
  }), ENV, { fetchImpl: fetchRows([]) });
  assert.equal((await unknown.json()).verdict, "unknown");
});

test("vérification : un profil divergent liste seulement les champs en écart", async () => {
  const divergent = { ...verifyPayload, profile: { ...matchingProfile, acceptedCurrencies: ["EUR", "USD"] } };
  const response = await requirementsVerifyRoute(new Request("https://settlemesh.example/api/v1/requirements/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(divergent)
  }), ENV, { fetchImpl: async () => jsonResponse([publishedRow()]) });
  const body = await response.json();
  assert.equal(body.verdict, "mismatch");
  assert.deepEqual(body.mismatches, ["acceptedCurrencies"]);
});

test("événement de mesure : exactement { organizationId, action, day } inséré, aucune donnée de facture transportée", async () => {
  let captured = null;
  const fetchImpl = async (url, init = {}) => {
    if (String(init?.method || "GET").toUpperCase() === "POST") captured = { url: String(url), body: JSON.parse(init.body) };
    return jsonResponse([], 201);
  };
  const response = await metricsEventRoute(new Request("https://settlemesh.example/api/v1/metrics/events", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId: "atelier-nova", action: "invoice_checked", day: "2026-10-08",
      invoiceNumber: "FA-2026-001", amount: 5000, supplierVat: "DE123456789", xml: "<Invoice/>"
    })
  }), ENV, { fetchImpl });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.schema, METRICS_SCHEMA);
  assert.equal(body.accepted, true);
  assert.deepEqual(body.event, { organizationId: "atelier-nova", action: "invoice_checked", day: "2026-10-08" });
  assert.ok(captured.url.includes("/settlemesh_metrics"));
  // Invariant absolu : la ligne stockée ne porte que les trois champs anonymes.
  assert.deepEqual(captured.body, [{ organization_id: "atelier-nova", action: "invoice_checked", day: "2026-10-08", count: 1 }]);
});

test("événement de mesure : action inconnue ou jour futur → 400, sans écriture", async () => {
  let posted = false;
  const fetchImpl = async (url, init = {}) => {
    if (String(init?.method || "GET").toUpperCase() === "POST") posted = true;
    return jsonResponse([], 201);
  };
  const call = (payload) => metricsEventRoute(new Request("https://settlemesh.example/api/v1/metrics/events", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  }), ENV, { fetchImpl });
  const unknownAction = await call({ organizationId: "atelier-nova", action: "page_opened", day: "2026-10-08" });
  assert.equal(unknownAction.status, 400);
  assert.equal((await unknownAction.json()).error.code, "INVALID_METRICS_PAYLOAD");
  const futureDay = await call({ organizationId: "atelier-nova", action: "invoice_checked", day: "2099-01-01" });
  assert.equal(futureDay.status, 400);
  assert.equal(posted, false, "aucune écriture ne doit partir sur un événement invalide");
});

test("événement de mesure sans secrets du Worker : 503 explicite", async () => {
  const response = await metricsEventRoute(new Request("https://settlemesh.example/api/v1/metrics/events", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: "atelier-nova", action: "invoice_checked", day: "2026-10-08" })
  }), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "METRICS_UNAVAILABLE");
});

test("méthodes, médias et tailles refusés : 405, 415 et 413", async () => {
  const get = await requirementsVerifyRoute(new Request("https://settlemesh.example/api/v1/requirements/verify"), ENV, { fetchImpl: async () => jsonResponse([]) });
  assert.equal(get.status, 405);

  const wrongMedia = await metricsEventRoute(new Request("https://settlemesh.example/api/v1/metrics/events", {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "x"
  }), ENV, { fetchImpl: async () => jsonResponse([], 201) });
  assert.equal(wrongMedia.status, 415);

  const oversized = await requirementsVerifyRoute(new Request("https://settlemesh.example/api/v1/requirements/verify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: { companyName: "X", instructions: "a".repeat(40 * 1024) } })
  }), ENV, { fetchImpl: async () => jsonResponse([]) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "BODY_TOO_LARGE");
});

test("câblage du Worker : mutations authentifiées refusées avec la frontière explicite", async () => {
  const response = await workerDefault.fetch(new Request("https://settlemesh.example/api/v1/requirements", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), {});
  assert.equal(response.status, 405);
  const body = await response.json();
  assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
  assert.match(body.error.message, /serveur/);
});

test("limites de débit du Worker : recherches répétées depuis une adresse → 429", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse([]);
  try {
    let last;
    for (let i = 0; i < 31; i += 1) {
      last = await workerDefault.fetch(new Request("https://settlemesh.example/api/v1/requirements?q=nova", {
        headers: { "cf-connecting-ip": "203.0.113.77" }
      }), { ...ENV, ASSETS: { fetch: async () => new Response("ok") } });
    }
    assert.equal(last.status, 429);
    assert.equal((await last.json()).error.code, "RATE_LIMITED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
