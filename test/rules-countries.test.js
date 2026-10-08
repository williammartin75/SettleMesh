import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { DEFAULT_PROFILE, parseInvoiceXml, validateInvoice } from "../web/core.js";
import { activePacks, nationalChecks, validatePack } from "../web/rules/index.mjs";

const profileFor = (country) => ({ ...DEFAULT_PROFILE, country });

const leitwegInvoice = (buyerReference, customization = "urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0") => ({
  syntax: "UBL", customizationId: customization, buyerReference, supplierVat: "DE123456789", buyerVat: "DE123456789"
});

test("le pack Allemagne valide une Leitweg-ID réelle sur une XRechnung", () => {
  const invoice = leitwegInvoice("04011000-1234512345-06");
  const leitweg = nationalChecks(invoice, profileFor("DE"), { country: "DE" }).find((item) => item.id === "de-leitweg-id");
  assert.equal(leitweg.status, "pass");
  const vat = nationalChecks(invoice, profileFor("DE"), { country: "DE" }).find((item) => item.id === "de-vat-format");
  assert.equal(vat.status, "pass");
});

test("une Leitweg-ID avec clé invalide est signalée, avec la structure préservée", () => {
  const invoice = leitwegInvoice("04011000-1234512345-07");
  const leitweg = nationalChecks(invoice, profileFor("DE"), { country: "DE" }).find((item) => item.id === "de-leitweg-id");
  assert.equal(leitweg.status, "error");
  assert.match(leitweg.message, /Mod 97-10 de la Leitweg-ID est invalide/);
});

test("une structure non-Leitweg est signalée sur une XRechnung", () => {
  const invoice = leitwegInvoice("PO-BERLIN-42");
  const leitweg = nationalChecks(invoice, profileFor("DE"), { country: "DE" }).find((item) => item.id === "de-leitweg-id");
  assert.equal(leitweg.status, "error");
  assert.match(leitweg.message, /non conforme/);
});

test("une XRechnue sans Käuferreferenz est bloquée par la règle allemande", () => {
  const invoice = leitwegInvoice("");
  const leitweg = nationalChecks(invoice, profileFor("DE"), { country: "DE" }).find((item) => item.id === "de-leitweg-id");
  assert.equal(leitweg.status, "error");
  assert.match(leitweg.message, /absente/);
});

test("hors XRechnung, la règle Leitweg-ID reste silencieuse", () => {
  const invoice = leitwegInvoice("Référence interne client", "urn:cen.eu:en16931:2017");
  assert.equal(nationalChecks(invoice, profileFor("DE"), { country: "DE" }).some((item) => item.id === "de-leitweg-id"), false);
});

test("un TVA allemand malformé est signalé", () => {
  const invoice = leitwegInvoice("991-01000-61", "urn:cen.eu:en16931:2017");
  invoice.supplierVat = "DE123";
  const vat = nationalChecks(invoice, profileFor("DE"), { country: "DE" }).find((item) => item.id === "de-vat-format");
  assert.equal(vat.status, "error");
});

test("le pack Belgique valide la communication structurée canonique et un TVA BE", () => {
  const invoice = {
    syntax: "UBL", customizationId: "urn:cen.eu:en16931:2017",
    supplierVat: "BE0123456789", buyerVat: "BE0123456789", paymentReference: "+++000/0000/00097+++"
  };
  const checks = nationalChecks(invoice, profileFor("BE"), { country: "BE" });
  const comms = checks.find((item) => item.id === "be-communication-structuree");
  const vat = checks.find((item) => item.id === "be-vat-format");
  assert.equal(comms.status, "pass");
  assert.equal(vat.status, "pass");
});

test("une communication structurée belge avec clé invalide génère un avertissement avec la clé attendue", () => {
  const invoice = { syntax: "UBL", paymentReference: "+++020/7251/30526+++" };
  const comms = nationalChecks(invoice, profileFor("BE"), { country: "BE" }).find((item) => item.id === "be-communication-structuree");
  assert.equal(comms.status, "warning");
  assert.match(comms.message, /attendue : 38/);
});

test("une référence de paiement hors VCS laisse la règle belge silencieuse", () => {
  const invoice = { syntax: "UBL", paymentReference: "Réf 2026-42" };
  assert.equal(nationalChecks(invoice, profileFor("BE"), { country: "BE" }).some((item) => item.id === "be-communication-structuree"), false);
});

test("les packs DE et BE sont déclarés actifs avec leur version", () => {
  const active = activePacks("DE", "2026-10-08").map((pack) => `${pack.country}-${pack.version}`);
  assert.deepEqual(active, ["DE-1.0.0"]);
  const be = activePacks("BE", "2026-10-08").map((pack) => `${pack.country}-${pack.version}`);
  assert.deepEqual(be, ["BE-1.0.0"]);
  assert.equal(activePacks("FR", "2026-10-08").length, 1);
});

test("le pack belge applique ses règles via validateInvoice sur un UBL complet", () => {
  const invoice = parseInvoiceXml(
    `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>BE-2026-1</cbc:ID><cbc:IssueDate>2026-10-08</cbc:IssueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>BRUXELLES-1</cbc:BuyerReference>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>BE0123456789</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Fournisseur BE</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyName><cbc:Name>Atelier Nova</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentID>+++000/0000/00097+++</cbc:PaymentID></cac:PaymentMeans>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">100</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">100</cbc:TaxExclusiveAmount><cbc:TaxAmount currencyID="EUR">0</cbc:TaxAmount><cbc:TaxInclusiveAmount currencyID="EUR">100</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">100</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="H87">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">100</cbc:LineExtensionAmount><cac:Item><cbc:Name>Prestation</cbc:Name></cac:Item></cac:InvoiceLine>
</Invoice>`,
    DOMParser
  );
  const result = validateInvoice(invoice, profileFor("BE"));
  const comms = result.checks.find((item) => item.id === "be-communication-structuree");
  assert.equal(comms.status, "pass");
});

test("validatePack exige un déclencheur pour la règle Leitweg-ID", () => {
  const fr = activePacks("FR", "2026-10-08");
  const dePackData = { country: "DE", version: "1.0.0", effectiveFrom: "2026-01-01", effectiveUntil: null, source: { label: "test" }, rules: [{ id: "de-leitweg-id", kind: "leitweg-id", severity: "error", field: "BT-10", fields: ["buyerReference"], title: "t", okMessage: "o", koMessage: "k", orphanMessage: "o2", koEmptyMessage: "k2", fix: "f", sourceLabel: "s" }] };
  assert.throws(() => validatePack(dePackData), /d[ée]clencheur/);
  assert.ok(fr.length);
});
