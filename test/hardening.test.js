import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { captureAnalysisContext, analysisContextIsCurrent } from "../web/analysis-context.js";
import { DOMParser } from "@xmldom/xmldom";
import { DEFAULT_PROFILE, createDemoXml, parseInvoiceXml, createCheckLink } from "../web/core.js";
import { validateApiInvoice } from "../server/validation.mjs";
import { validateServerXsd } from "../server/xsd.mjs";
import { parseSvrl } from "../web/svrl.js";
import { createApiCredential, parseApiKeyConfiguration, authenticateApiKey } from "../server/auth.mjs";
import { createSettleMeshServer, listen } from "../server/server.mjs";
import { simulateNetting, parseNettingCsv } from "../web/netting.js";
import { reportEvent } from "../web/reporting.js";
import { createSupabaseMetrics, aggregateMetricRows, validateMetricEvent } from "../worker/metrics.mjs";
import { authorizeMetricEvent, issueMetricsToken } from "../worker/telemetry.mjs";
import { memberRoute, publicProfileRoute, requirementsSearchRoute, requirementsVerifyRoute, metricsEventRoute } from "../worker/index.js";
import { extractFacturXXml } from "../web/facturx.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const xml = () => createDemoXml({ valid: true, profile: DEFAULT_PROFILE });
test("résultat asynchrone : changement d'acheteur ou de lien invalide le contexte", () => {
  const profile = { ...DEFAULT_PROFILE, organizationId: "buyer-a" };
  const context = captureAnalysisContext(profile, 1);
  assert.equal(analysisContextIsCurrent(context, { ...profile }, 1), true);
  assert.equal(analysisContextIsCurrent(context, { ...profile, organizationId: "buyer-b" }, 1), false);
  assert.equal(analysisContextIsCurrent(context, profile, 2), false);
});
test("résultat asynchrone : modification d'une règle pendant le contrôle interdit l'attribution", () => {
  const profile = { ...DEFAULT_PROFILE };
  const context = captureAnalysisContext(profile, 1);
  profile.requirePurchaseOrder = !profile.requirePurchaseOrder;
  assert.equal(analysisContextIsCurrent(context, profile, 1), false);
});
test("namespaces falsifiés : la facture entière et les composants ne passent jamais", async () => {
  const wrongRoot = xml().replaceAll("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2", "urn:fake:invoice");
  assert.throws(() => parseInvoiceXml(wrongRoot, DOMParser), /noms/);
  await assert.rejects(validateApiInvoice({ xml: wrongRoot }), { code: "INVALID_XML" });
  const wrongComponents = xml().replaceAll("urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2", "urn:fake:cbc");
  const result = await validateApiInvoice({ xml: wrongComponents });
  assert.notEqual(result.outcome, "ready");
});
test("extension UBL : un faux acheteur imbriqué ne remplace pas l'acheteur réel", async () => {
  const extension = '<ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionContent><f:AccountingCustomerParty xmlns:f="urn:fake"><f:Party><f:PartyLegalEntity><f:RegistrationName>Atelier Nova SAS</f:RegistrationName></f:PartyLegalEntity><f:PartyTaxScheme><f:CompanyID>FR11123456782</f:CompanyID></f:PartyTaxScheme><f:EndpointID schemeID="0009">123456782</f:EndpointID></f:Party></f:AccountingCustomerParty></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>';
  const attacked = xml().replace('  <cbc:CustomizationID>', extension + '  <cbc:CustomizationID>').replace('Atelier Nova SAS</cbc:RegistrationName>', 'Autre Acheteur SAS</cbc:RegistrationName>').replace('urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0', 'urn:cen.eu:en16931:2017');
  assert.ok(attacked.includes(extension));
  assert.equal(parseInvoiceXml(attacked, DOMParser).buyerName, "Autre Acheteur SAS");
  const result = await validateApiInvoice({ xml: attacked });
  assert.equal(result.standards.xsdValid, true);
  assert.equal(result.outcome, "blocked");
});
test("XSD rejette un élément inconnu, un ordre faux et un attribut absent", async () => {
  for (const modified of [
    xml().replace("</Invoice>", "<cbc:NonExistentSchemaField>1</cbc:NonExistentSchemaField></Invoice>"),
    xml().replace("</Invoice>", "<cbc:IssueDate>2026-10-01</cbc:IssueDate></Invoice>"),
    xml().replaceAll(' currencyID="EUR"', "")
  ]) {
    const result = await validateApiInvoice({ xml: modified });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.standards.xsdValid, false);
  }
});
test("XSD valide le CII réel extrait du PDF de test", async () => {
  const bytes = await readFile(new URL("./fixtures/facturx-en16931.pdf", import.meta.url));
  const file = { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const { xmlText } = await extractFacturXXml(file, pdfjs);
  const report = await validateServerXsd(xmlText, parseInvoiceXml(xmlText, DOMParser));
  assert.equal(report.metadata.xsdValid, true);
});
test("SVRL vide ou étranger ne prouve aucune validation", () => {
  for (const input of ['<fake/>', '<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl"/>']) assert.throws(() => parseSvrl(input, "Test", "test", DOMParser));
  const valid = parseSvrl('<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl"><svrl:fired-rule context="Invoice"/></svrl:schematron-output>', "Test", "test", DOMParser);
  assert.equal(valid.firedRules, 1);
});
test("configuration environnement : viewer reste viewer, révocation reste appliquée", () => {
  const { credential, apiKey } = createApiCredential({ organizationId: "real_org", keyId: "viewer-key", role: "viewer" });
  const parsed = parseApiKeyConfiguration(JSON.stringify([credential]));
  assert.equal(authenticateApiKey(`Bearer ${apiKey}`, parsed).credential.role, "viewer");
  const revoked = parseApiKeyConfiguration(JSON.stringify([{ ...credential, revokedAt: new Date().toISOString() }]));
  assert.equal(authenticateApiKey(`Bearer ${apiKey}`, revoked).code, "API_KEY_REVOKED");
  assert.throws(() => parseApiKeyConfiguration(JSON.stringify([{ ...credential, role: "superadmin" }])));
});
test("panne logout : réponse 503 bornée et serveur toujours vivant", async () => {
  const server = createSettleMeshServer({ apiKeys: [], membersStoreOption: { deleteSession: async () => { throw new Error("secret upstream detail"); } }, logger: null });
  const { port } = await listen(server, { port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, { method: "POST", headers: { "X-SettleMesh-CSRF": "session", Cookie: "settlemesh_session=11111111-1111-1111-1111-111111111111" }, signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /secret upstream/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).status, 200);
  } finally { server.close(); }
});
const obligation = (changes = {}) => ({ invoiceNumber: "F-1", debtor: "A", creditor: "B", amount: 100, currency: "EUR", status: "accepted", disputed: false, assigned: false, ...changes });
test("Net : aucune acceptation, référence, devise ou déclaration implicite", () => {
  for (const changes of [{ status: "" }, { invoiceNumber: "" }, { disputed: undefined }, { assigned: "unknown" }, { currency: "" }, { amount: "1.234" }, { currency: "ZZZ" }]) {
    const result = simulateNetting([obligation(changes)]);
    assert.equal(result.eligible.length, 0);
    assert.equal(result.ignored.length, 1);
  }
  assert.throws(() => parseNettingCsv("invoice;debtor;creditor;amount;currency\nF-1;A;B;100;EUR"), /status/);
});
test("Net : toutes les occurrences d'une référence dupliquée sont exclues", () => {
  const result = simulateNetting([obligation(), obligation({ amount: 200 }), obligation({ invoiceNumber: "F-2", debtor: "B", creditor: "A" })]);
  assert.equal(result.ignored.length, 2);
  assert.equal(result.metrics.grossVolume, 100);
  assert.equal(result.proposals.length, 0);
});
test("Net : dépassement de capacité refusé sans calcul partiel", () => {
  const rows = Array.from({ length: 501 }, (_, index) => obligation({ invoiceNumber: `F-${index}` }));
  assert.throws(() => simulateNetting(rows), /500/);
  const csv = "invoice;debtor;creditor;amount;currency;status;disputed;assigned\n" + rows.map((row) => `${row.invoiceNumber};A;B;100;EUR;accepted;false;false`).join("\n");
  assert.throws(() => parseNettingCsv(csv), /500/);
});
test("Net : propriétés sur 30 graphes déterministes, positions résiduelles et allocations", () => {
  let seed = 7919;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let scenario = 0; scenario < 30; scenario++) {
    const rows = Array.from({ length: 60 }, (_, index) => {
      const a = Math.floor(random() * 6), b = (a + 1 + Math.floor(random() * 5)) % 6;
      return obligation({ invoiceNumber: `F-${index}`, debtor: `P${a}`, creditor: `P${b}`, amount: Math.floor(random() * 100_000 + 1) / 100, currency: index % 2 ? "EUR" : "USD" });
    });
    const result = simulateNetting(rows);
    for (const position of result.positions) assert.equal(position.netPosition, position.residualNetPosition);
    const consumed = new Map();
    for (const proposal of result.proposals) for (const leg of proposal.legs) {
      assert.ok(Math.abs(leg.allocations.reduce((sum, row) => sum + row.amount, 0) - leg.amount) < .005);
      for (const allocation of leg.allocations) consumed.set(allocation.id, (consumed.get(allocation.id) || 0) + allocation.amount);
    }
    for (const row of result.eligible) assert.ok(Math.abs((consumed.get(row.id) || 0) + row.remainingAmount - row.amount) < .005);
  }
});
test("télémétrie : acheteur seul ne peut consentir pour le fournisseur, ancien slug non deviné", async () => {
  const fetchImpl = () => { throw new Error("Unexpected transport"); };
  assert.equal((await reportEvent({ companyName: "A", usageMetricsConsent: true }, "invoice_checked", { fetchImpl })).reason, "no-consent");
  assert.equal((await reportEvent({ companyName: "A", usageMetricsConsent: true }, "invoice_checked", { fetchImpl, visitorConsent: true })).reason, "no-organization");
});
test("télémétrie : token absent, falsifié, expiré, autre organisation et consentement retiré refusés", async () => {
  const event = { organizationId: "real-org", action: "invoice_checked", day: "2026-10-08" };
  const store = { findByOrganization: async () => ({ published: true, profile: { usageMetricsConsent: true } }) };
  const token = await issueMetricsToken(event.organizationId, "test-only");
  await authorizeMetricEvent(event, token, "test-only", store);
  for (const bad of [null, token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"), await issueMetricsToken("another-org", "test-only"), await issueMetricsToken(event.organizationId, "test-only", Date.now() - 3600000)]) await assert.rejects(authorizeMetricEvent(event, bad, "test-only", store));
  await assert.rejects(authorizeMetricEvent(event, token, "test-only", { findByOrganization: async () => ({ published: false }) }));
  assert.throws(() => validateMetricEvent({ ...event, day: "2026-02-30" }));
});
test("métriques : pagination au-delà de 1000 événements et agrégation réelle", async () => {
  const row = { organization_id: "real-org", day: "2026-10-08", action: "invoice_checked", count: 1 };
  const calls = [];
  const store = createSupabaseMetrics({ projectRef: "test", serviceKey: "test-only", fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => url.includes("offset=0") ? Array(1000).fill(row) : [row] }; } });
  const rows = await store.range({ organizationId: "real-org", from: "2026-10-01", to: "2026-10-08" });
  assert.equal(rows.length, 1001);
  assert.equal(calls.length, 2);
  const aggregate = aggregateMetricRows(rows, { organizationId: "real-org", from: "2026-10-01", to: "2026-10-08" });
  assert.equal(aggregate.days.length, 1);
  assert.equal(aggregate.totals.invoice_checked, 1001);
});
const env = { SETTLEMESH_SUPABASE_PROJECT_REF: "test", SETTLEMESH_SUPABASE_SERVICE_KEY: "test-only" };
const headers = { "oai-authenticated-user-id": "site-user", "oai-authenticated-user-email": "invited@example.test", "X-SettleMesh-CSRF": "session", "Content-Type": "application/json" };
test("Worker : Sites connecté ne signifie pas membre ; viewer ne peut publier", async () => {
  const request = () => new Request("https://example.test/api/v1/requirements", { method: "POST", headers, body: JSON.stringify({ published: true, profile: DEFAULT_PROFILE, organizationId: "other-org" }) });
  const response = (rows) => ({ ok: true, json: async () => rows });
  const notMember = await memberRoute(request(), env, { fetchImpl: async () => response([]) });
  assert.equal(notMember.status, 403);
  const viewer = await memberRoute(request(), env, { fetchImpl: async () => response([{ organization_id: "real-org", role: "viewer" }]) });
  assert.equal(viewer.status, 403);
});
test("Worker : mutation dérive l'organisation du membre, jamais du corps", async () => {
  let posted;
  const response = (rows) => ({ ok: true, json: async () => rows });
  const fetchImpl = async (url, init) => {
    if (url.includes("settlemesh_members")) return response([{ organization_id: "real-org", role: "admin" }]);
    if (init.method === "POST") { posted = JSON.parse(init.body); return response([{ ...posted, version: 1 }]); }
    return response([]);
  };
  const result = await memberRoute(new Request("https://example.test/api/v1/requirements", { method: "POST", headers, body: JSON.stringify({ published: true, organizationId: "other-org", profile: DEFAULT_PROFILE }) }), env, { fetchImpl });
  assert.equal(result.status, 201);
  assert.equal(posted.organization_id, "real-org");
});
test("lien stable : version courante résolue, brouillon inaccessible publiquement", async () => {
  assert.equal(createCheckLink({ ...DEFAULT_PROFILE, organizationId: "real-org", published: true }, { origin: "https://example.test", pathname: "/" }), "https://example.test/#buyer/real-org");
  const url = new URL("https://example.test/api/v1/requirements/public/real-org");
  const fetchRows = (published, version) => async () => ({ ok: true, json: async () => [{ organization_id: "real-org", company_name: "A", version, published }] });
  assert.equal((await publicProfileRoute(url, env, { fetchImpl: fetchRows(false, 2) })).status, 404);
  const result = await publicProfileRoute(url, env, { fetchImpl: fetchRows(true, 3) });
  assert.equal((await result.json()).version, 3);
});

test("parcours Worker complet : publier, chercher, résoudre, comparer, mesurer, modifier, dépublier", async () => {
  let row = null;
  const metrics = [];
  const response = (rows) => ({ ok: true, json: async () => rows });
  const fetchImpl = async (url, init = {}) => {
    if (url.includes("settlemesh_members")) return response([{ organization_id: "real-org", role: "owner" }]);
    if (url.includes("settlemesh_metrics")) { metrics.push(...JSON.parse(init.body)); return response([]); }
    if (init.method === "POST") { row = { ...JSON.parse(init.body), version: (row?.version || 0) + 1 }; return response([row]); }
    if (init.method === "DELETE") { row = null; return response([]); }
    return response(row && (!url.includes("published=eq.true") || row.published) ? [row] : []);
  };
  const mutate = (method, profile) => memberRoute(new Request("https://example.test/api/v1/requirements", { method, headers, ...(profile ? { body: JSON.stringify({ published: true, profile }) } : {}) }), env, { fetchImpl });
  const profile = { ...DEFAULT_PROFILE, usageMetricsConsent: true };
  assert.equal((await mutate("POST", profile)).status, 201);
  const search = await requirementsSearchRoute(new URL("https://example.test/api/v1/requirements?q=Atelier"), env, { fetchImpl });
  assert.equal((await search.json()).results[0].checkLink, "#buyer/real-org");
  const publicUrl = new URL("https://example.test/api/v1/requirements/public/real-org");
  const resolved = await (await publicProfileRoute(publicUrl, env, { fetchImpl })).json();
  assert.equal(resolved.version, 1);
  assert.equal(resolved.organizationId, "real-org");
  const compare = () => requirementsVerifyRoute(new Request("https://example.test/api/v1/requirements/verify", { method: "POST", headers, body: JSON.stringify({ profile: { ...resolved.profile, organizationId: resolved.organizationId } }) }), env, { fetchImpl });
  assert.equal((await (await compare()).json()).verdict, "verified");
  const report = () => metricsEventRoute(new Request("https://example.test/api/v1/metrics/events", { method: "POST", headers: { ...headers, "X-SettleMesh-Metrics-Token": resolved.metricsToken }, body: JSON.stringify({ organizationId: "real-org", action: "invoice_checked", day: new Date().toISOString().slice(0, 10) }) }), env, { fetchImpl });
  assert.equal((await report()).status, 202);
  assert.deepEqual(Object.keys(metrics[0]).sort(), ["action", "count", "day", "organization_id"]);
  assert.equal((await mutate("PATCH", { ...profile, requirePurchaseOrder: !profile.requirePurchaseOrder })).status, 200);
  assert.equal((await (await publicProfileRoute(publicUrl, env, { fetchImpl })).json()).version, 2);
  assert.equal((await (await compare()).json()).verdict, "mismatch");
  assert.equal((await mutate("DELETE")).status, 200);
  assert.equal((await publicProfileRoute(publicUrl, env, { fetchImpl })).status, 404);
  assert.equal((await report()).status, 403);
  assert.equal(metrics.length, 1);
});
