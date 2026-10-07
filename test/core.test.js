import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import {
  DEFAULT_PROFILE,
  appendValidationChecks,
  createCheckLink,
  createDemoXml,
  createProfileBundle,
  decodeProfile,
  exportHistoryCsv,
  exportResultJson,
  encodeProfile,
  exportResultText,
  parseInvoiceXml,
  parseProfileBundle,
  profileCompleteness,
  profileSlug,
  resultSummary,
  validateInvoice
} from "../web/core.js";

test("refuse un DOCTYPE avant le parsing XML dans le navigateur", () => {
  const malicious = '<!DOCTYPE Invoice [<!ENTITY secret SYSTEM "file:///etc/passwd">]><Invoice>&secret;</Invoice>';
  assert.throws(() => parseInvoiceXml(malicious, DOMParser), /DOCTYPE/);
});

test("encode et décode un profil CheckLink", () => {
  const decoded = decodeProfile(encodeProfile(DEFAULT_PROFILE));
  assert.equal(decoded.companyName, DEFAULT_PROFILE.companyName);
  assert.equal(decoded.vatId, DEFAULT_PROFILE.vatId);
  assert.deepEqual(decoded.acceptedFormats, DEFAULT_PROFILE.acceptedFormats);
  assert.equal(decoded.requirePurchaseOrder, true);
});

test("exporte et réimporte un profil portable validé", () => {
  const bundle = createProfileBundle(DEFAULT_PROFILE);
  const imported = parseProfileBundle(JSON.stringify(bundle));
  assert.equal(bundle.schema, "settlemesh-checklink-profile");
  assert.equal(imported.companyName, DEFAULT_PROFILE.companyName);
  assert.deepEqual(imported.acceptedFormats, DEFAULT_PROFILE.acceptedFormats);
  assert.throws(() => parseProfileBundle('{"profile":{"companyName":"Incomplet"}}'), /obligatoires/);
});

test("importe encore les profils Eurule existants après le changement de marque", () => {
  const legacyBundle = { schema: "eurule-checklink-profile", version: 1, profile: DEFAULT_PROFILE };
  const imported = parseProfileBundle(legacyBundle);
  assert.equal(imported.companyName, DEFAULT_PROFILE.companyName);
  assert.equal(imported.vatId, DEFAULT_PROFILE.vatId);
});

test("génère un slug et un lien partageable", () => {
  assert.equal(profileSlug("École des Arts & Métiers"), "ecole-des-arts-metiers");
  const link = createCheckLink(DEFAULT_PROFILE, { origin: "https://settlemesh.test", pathname: "/app" });
  assert.match(link, /^https:\/\/settlemesh\.test\/app#check\/atelier-nova\//);
  assert.ok(decodeProfile(link.split("/").at(-1)));
});

test("calcule la complétude du profil", () => {
  assert.equal(profileCompleteness(DEFAULT_PROFILE), 100);
  assert.ok(profileCompleteness({ ...DEFAULT_PROFILE, vatId: "", instructions: "" }) < 100);
});

test("résume un résultat d’historique compact sans détail des contrôles", () => {
  const summary = resultSummary({ outcome: "blocked", counts: { error: 2 } });
  assert.equal(summary.label, "Correction requise");
  assert.match(summary.headline, /2 anomalies bloquantes/);
  assert.deepEqual(summary.blockers, []);
});

test("bloque une facture visant la mauvaise entité", () => {
  const result = validateInvoice({
    syntax: "UBL", documentType: "Facture", invoiceNumber: "INV-1", issueDate: "2026-10-07", currency: "EUR",
    supplierName: "Studio Horizon SAS", supplierVat: "FR123", buyerName: "Autre société", buyerVat: "FR999",
    buyerEndpoint: "0009:999", purchaseOrder: "", buyerReference: "", taxExclusive: 100,
    taxAmount: 20, taxInclusive: 120, payableAmount: 120, lineCount: 1
  }, DEFAULT_PROFILE);
  assert.equal(result.outcome, "blocked");
  assert.ok(result.counts.error >= 3);
  assert.ok(result.checks.some((item) => item.id === "buyer" && item.status === "error"));
});

test("accepte une facture correspondant au profil", () => {
  const result = validateInvoice({
    syntax: "UBL", documentType: "Facture", invoiceNumber: "INV-2", issueDate: "2026-10-07", currency: "EUR",
    supplierName: "Studio Horizon SAS", supplierVat: "FR123", buyerName: DEFAULT_PROFILE.legalName,
    buyerVat: DEFAULT_PROFILE.vatId, buyerEndpoint: DEFAULT_PROFILE.peppolId, purchaseOrder: "PO-42",
    buyerReference: "", taxExclusive: 100, taxAmount: 20, taxInclusive: 120, payableAmount: 120, lineCount: 1
  }, DEFAULT_PROFILE);
  assert.equal(result.outcome, "ready");
  assert.equal(result.counts.error, 0);
  assert.equal(resultSummary(result).label, "Prête à envoyer");
});

test("produit un rapport lisible", () => {
  const result = validateInvoice({
    syntax: "UBL", documentType: "Facture", invoiceNumber: "INV-3", issueDate: "2026-10-07", currency: "EUR",
    supplierName: "Studio", supplierVat: "FR123", buyerName: DEFAULT_PROFILE.legalName,
    buyerVat: DEFAULT_PROFILE.vatId, buyerEndpoint: DEFAULT_PROFILE.peppolId, purchaseOrder: "PO-1",
    taxExclusive: 10, taxAmount: 2, taxInclusive: 12, payableAmount: 12, lineCount: 1
  }, DEFAULT_PROFILE);
  const text = exportResultText(result);
  assert.match(text, /SETTLEMESH CHECKLINK/);
  assert.match(text, /INV-3/);
  assert.match(text, /Score/);
  const json = JSON.parse(exportResultJson(result));
  assert.equal(json.schema, "settlemesh-validation-report");
  assert.equal(json.result.invoice.invoiceNumber, "INV-3");

  const csv = exportHistoryCsv([result]);
  assert.match(csv, /invoice_number/);
  assert.match(csv, /INV-3/);
  assert.match(csv, /ready/);
  const protectedCsv = exportHistoryCsv([{ ...result, invoice: { ...result.invoice, supplierName: "=HYPERLINK(\"https://example.test\")" } }]);
  assert.match(protectedCsv, /'=HYPERLINK/);
});

test("les exemples UBL reflètent les exigences du profil", () => {
  const invalid = createDemoXml({ valid: false, profile: DEFAULT_PROFILE });
  const valid = createDemoXml({ valid: true, profile: DEFAULT_PROFILE });
  assert.doesNotMatch(invalid, /PO-2026-042/);
  assert.match(valid, /PO-2026-042/);
  assert.match(valid, new RegExp(DEFAULT_PROFILE.vatId));
  assert.match(valid, /CustomizationID/);
  assert.match(valid, /ClassifiedTaxCategory/);
});

test("rejette les placeholders comme numéro de commande", () => {
  const result = validateInvoice({
    syntax: "UBL", documentType: "Facture", invoiceNumber: "INV-4", issueDate: "2026-10-07", currency: "EUR",
    supplierName: "Studio", supplierVat: "FR123", buyerName: DEFAULT_PROFILE.legalName,
    buyerVat: DEFAULT_PROFILE.vatId, buyerEndpoint: DEFAULT_PROFILE.peppolId, purchaseOrder: "n/a",
    taxExclusive: 10, taxAmount: 2, taxInclusive: 12, payableAmount: 12, lineCount: 1
  }, DEFAULT_PROFILE);
  assert.equal(result.checks.find((item) => item.id === "po").status, "error");
});

test("intègre les résultats du validateur officiel dans le score", () => {
  const base = validateInvoice({
    syntax: "UBL", documentType: "Facture", invoiceNumber: "INV-5", issueDate: "2026-10-07", currency: "EUR",
    supplierName: "Studio", supplierVat: "FR123", buyerName: DEFAULT_PROFILE.legalName,
    buyerVat: DEFAULT_PROFILE.vatId, buyerEndpoint: DEFAULT_PROFILE.peppolId, purchaseOrder: "PO-5",
    taxExclusive: 10, taxAmount: 2, taxInclusive: 12, payableAmount: 12, lineCount: 1
  }, DEFAULT_PROFILE);
  const result = appendValidationChecks(base, [{ id: "BR-TEST", status: "error", title: "Erreur officielle", message: "Test", fix: "", field: "BR-TEST" }], { en16931: "1.3.16" });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.standards.en16931, "1.3.16");
});
