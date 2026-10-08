import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeRequirementProfile, verifyAgainstPublished, createSupabaseRequirements } from "../server/requirements.mjs";
import { createApiCredential } from "../server/auth.mjs";
import { writeRegistryFile } from "../server/registry.mjs";
import { createSettleMeshServer, listen } from "../server/server.mjs";

test("la liste blanche rejette le contenu de facture, d'obligation et tout champ inconnu", () => {
  const clean = sanitizeRequirementProfile({
    companyName: "Atelier Nova", legalName: "Atelier Nova SAS", country: "fr",
    vatId: " fr11123456782 ", peppolId: "0009:123456782", acceptedFormats: ["ubl", "CII"],
    acceptedCurrencies: ["eur"], requirePurchaseOrder: true, submissionEmail: "FACTURES@Example.test",
    // champs hôte interdits :
    xml: "<Invoice/>", invoiceNumber: "F-1", debtor: "A", creditor: "B", amount: 100, currency: "EUR",
    obligations: [{ invoice_number: "F-1" }], apiKey: "sm_live_x", iban: "FR76...", password: "x"
  });
  assert.equal(clean.country, "FR");
  assert.equal(clean.vatId, "FR11123456782");
  assert.deepEqual(clean.acceptedFormats, ["UBL", "CII"]);
  assert.equal(clean.submissionEmail, "factures@example.test");
  for (const forbidden of ["xml", "invoiceNumber", "debtor", "creditor", "amount", "currency", "obligations", "apiKey", "iban", "password"]) {
    assert.ok(!(forbidden in clean), `champ interdit conservé : ${forbidden}`);
  }
  assert.throws(() => sanitizeRequirementProfile({}), /nom d'entreprise/);
});

const adminKey = createApiCredential({ organizationId: "atelier-nova", keyId: "req-admin", role: "admin" });
const viewerKey = createApiCredential({ organizationId: "atelier-nova", keyId: "req-viewer", role: "viewer" });
const otherAdminKey = createApiCredential({ organizationId: "studio-horizon", keyId: "req-other", role: "owner" });

const publishedRow = {
  organization_id: "atelier-nova", company_name: "Atelier Nova", legal_name: "Atelier Nova SAS",
  country: "FR", vat_id: "FR11123456782", peppol_id: "0009:123456782",
  accepted_formats: ["UBL"], accepted_currencies: ["EUR"],
  requirements: { requirePurchaseOrder: true, requireEndpoint: true, submissionEmail: "factures@example.test", instructions: "Commande dans BT-13." },
  version: 3, published: true, updated_at: "2026-10-08T10:00:00.000Z"
};
const draftRow = { ...publishedRow, published: false };

test("l'adaptateur publie via upsert atomique et cherche uniquement ce qui est publié", async () => {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });
    if ((init.method || "GET") === "POST") return { ok: true, status: 201, json: async () => [publishedRow], text: async () => "" };
    if (url.includes("published=eq.true")) {
      return { ok: true, status: 200, json: async () => [publishedRow], text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
  const store = createSupabaseRequirements({ projectRef: "ref0000000000000", serviceKey: "sk", fetchImpl: fetchStub });
  const record = await store.upsert({ organizationId: "atelier-nova", profile: { companyName: "Atelier Nova", legalName: "Atelier Nova SAS", vatId: "FR11123456782", requirePurchaseOrder: true }, published: true });
  assert.equal(record.published, true);
  assert.ok(calls.some((call) => call.method === "POST" && call.url.includes("on_conflict=organization_id")));

  const results = await store.search("atelier");
  assert.equal(results.length, 1);
  assert.deepEqual(Object.keys(results[0].profile).sort(), ["acceptedCurrencies", "acceptedFormats", "companyName", "country", "legalName", "peppolId", "vatId"]);
  assert.ok(!JSON.stringify(results[0]).includes("submissionEmail"), "l'e-mail de soumission n'est pas exposé dans la recherche");
  assert.ok(!JSON.stringify(results[0]).includes("instructions"), "les instructions ne sont pas exposées dans la recherche");

  await assert.rejects(() => store.search(""), /mot-cl/);
});

test("HTTP : publication opt-in, viewer refusé, brouillon non cherchable (invariant central)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settlemesh-req-"));
  const registryPath = join(dir, "registry.json");
  writeRegistryFile(registryPath, [adminKey.credential, viewerKey.credential, otherAdminKey.credential]);
  const rows = new Map([["atelier-nova", { ...publishedRow, published: false }]]);
  const store = {
    upsert: async ({ organizationId, profile, published }) => {
      const record = { ...publishedRow, organization_id: organizationId, published, profile };
      rows.set(organizationId, record);
      return record;
    },
    findByOrganization: async (id) => rows.get(id) ?? null,
    findByIdentifier: async ({ vatId }) => {
      const row = vatId === "FR11123456782" ? rows.get("atelier-nova") : null;
      return row ? { profile: { companyName: row.company_name, legalName: row.legal_name, country: row.country, vatId: row.vat_id, peppolId: row.peppol_id, acceptedFormats: row.accepted_formats, acceptedCurrencies: row.accepted_currencies, ...row.requirements }, published: row.published } : null;
    },
    search: async (q) => ([...rows.values()].filter((row) => row.published && /atelier/i.test(row.company_name))
      .map((row) => ({ organizationId: row.organization_id, profile: { companyName: row.company_name, vatId: row.vat_id }, published: true }))),
    delete: async (id) => rows.delete(id)
  };
  const server = createSettleMeshServer({ registryFile: registryPath, requirementsStoreOption: store });
  const address = await listen(server, { port: 0 });
  const url = `http://127.0.0.1:${address.port}/api/v1/requirements`;

  try {
    // recherche publique SANS compte : brouillon invisible
    const search = await fetch(`${url}?q=atelier`);
    assert.equal(search.status, 200);
    assert.equal((await search.json()).results.length, 0, "INVARIANT : rien n'est cherchable sans publication explicite");

    // viewer refusé
    const viewerPost = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${viewerKey.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { companyName: "Atelier Nova" }, published: true })
    });
    assert.equal(viewerPost.status, 403);
    assert.equal((await viewerPost.json()).error.code, "FORBIDDEN_ROLE");

    // publication explicite
    const publish = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${adminKey.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { companyName: "Atelier Nova", legalName: "Atelier Nova SAS", vatId: "FR11123456782" }, published: true })
    });
    assert.equal(publish.status, 201);
    assert.equal((await publish.json()).published, true);

    // maintenant cherchable, toujours sans compte
    const search2 = await fetch(`${url}?q=atelier`);
    assert.equal((await search2.json()).results.length, 1);
  } finally {
    server.close();
  }
});

test("vérification officielle : verified, mismatch, not_published et unknown distingués", async () => {
  const mappedPublished = { profile: { companyName: publishedRow.company_name, legalName: publishedRow.legal_name, country: publishedRow.country, vatId: publishedRow.vat_id, peppolId: publishedRow.peppol_id, acceptedFormats: publishedRow.accepted_formats, acceptedCurrencies: publishedRow.accepted_currencies, ...publishedRow.requirements }, published: publishedRow.published };
  const store = {
    findByIdentifier: async ({ vatId }) => vatId === "FR11123456782" ? mappedPublished : null
  };
  const server = createSettleMeshServer({ requirementsStoreOption: store });
  const address = await listen(server, { port: 0 });
  const url = `http://127.0.0.1:${address.port}/api/v1/requirements/verify`;
  try {
    const verified = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { companyName: "Atelier Nova", legalName: "Atelier Nova SAS", vatId: "FR11123456782", peppolId: "0009:123456782", country: "FR", acceptedFormats: ["UBL"], acceptedCurrencies: ["EUR"], requirePurchaseOrder: true, requireEndpoint: true, submissionEmail: "factures@example.test", instructions: "Commande dans BT-13." } })
    });
    const verifiedBody = await verified.json();
    assert.equal(verified.status, 200);
    assert.equal(verifiedBody.verdict, "verified");
    assert.equal(verifiedBody.stored, false);

    const mismatch = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { companyName: "Atelier Nova", vatId: "FR11123456782", acceptedFormats: ["CII"] } })
    });
    const mismatchBody = await mismatch.json();
    assert.equal(mismatchBody.verdict, "mismatch");
    assert.ok(mismatchBody.mismatches.includes("acceptedFormats"));

    const draftStore = { findByIdentifier: async () => ({ ...mappedPublished, published: false }) };
    const server2 = createSettleMeshServer({ requirementsStoreOption: draftStore });
    const address2 = await listen(server2, { port: 0 });
    try {
      const unpublished = await fetch(`http://127.0.0.1:${address2.port}/api/v1/requirements/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: { companyName: "Atelier Nova", vatId: "FR11123456782" } })
      });
      assert.equal((await unpublished.json()).verdict, "not_published");
    } finally { server2.close(); }

    const unknown = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { companyName: "Inconnue SARL", vatId: "FR99999999999" } })
    });
    assert.equal((await unknown.json()).verdict, "unknown");
  } finally {
    server.close();
  }
});

test("l'organisation B ne peut pas écrire dans les exigences de l'organisation A", async () => {
  const dir = mkdtempSync(join(tmpdir(), "settlemesh-req-"));
  const registryPath = join(dir, "registry.json");
  writeRegistryFile(registryPath, [otherAdminKey.credential]);
  const rows = new Map([["atelier-nova", { ...publishedRow }]]);
  let writtenFor = [];
  const store = {
    upsert: async ({ organizationId }) => { writtenFor.push(organizationId); return { ...publishedRow, organization_id: organizationId }; },
    search: async () => [],
    findByIdentifier: async () => null
  };
  const server = createSettleMeshServer({ registryFile: registryPath, requirementsStoreOption: store });
  const address = await listen(server, { port: 0 });
  const url = `http://127.0.0.1:${address.port}/api/v1/requirements`;
  try {
    const response = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${otherAdminKey.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { companyName: "Atelier Nova (copie frauduleuse)" }, published: true })
    });
    assert.equal(response.status, 201);
    // l'écriture est passée, mais pour l'organisation de la CLÉ (studio-horizon), jamais pour atelier-nova :
    assert.deepEqual(writtenFor, ["studio-horizon"]);
  } finally {
    server.close();
  }
});

test("sans stockage d'exigences, les réponses restent explicites (503) côté public comme authentifié", async () => {
  const server = createSettleMeshServer({});
  const address = await listen(server, { port: 0 });
  try {
    const search = await fetch(`http://127.0.0.1:${address.port}/api/v1/requirements?q=x`);
    assert.equal(search.status, 503);
    assert.equal((await search.json()).error.code, "REQUIREMENTS_UNAVAILABLE");
    const publish = await fetch(`http://127.0.0.1:${address.port}/api/v1/requirements`, {
      method: "POST", headers: { Authorization: `Bearer ${adminKey.apiKey}`, "Content-Type": "application/json" }, body: "{}"
    });
    assert.equal(publish.status, 503);
  } finally {
    server.close();
  }
});
