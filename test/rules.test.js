import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { DEFAULT_PROFILE, createDemoXml, parseInvoiceXml, validateInvoice } from "../web/core.js";
import { activePacks, listPacks, nationalChecks, validatePack } from "../web/rules/index.mjs";

const frPack = listPacks().find((pack) => pack.country === "FR");
const demoProfile = (vatId = "FR44123456789", country = "FR") => ({ ...DEFAULT_PROFILE, vatId, country });

const parsedDemo = (profile) => parseInvoiceXml(createDemoXml({ valid: true, profile }), DOMParser);

test("le pack France applique le format TVA et la notice de réforme aux factures d'un profil français", () => {
  const invoice = parsedDemo(demoProfile());
  invoice.buyerVat = "FRA1234567"; // format français invalide
  const result = validateInvoice(invoice, demoProfile());
  const checks = result.checks.filter((item) => item.id === "fr-vat-format");
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "error");
  const notice = result.checks.find((item) => item.id === "fr-reception-obligation");
  assert.equal(notice.status, "info");
});

test("un numéro de TVA français bien formé passe la règle nationale sans bloquer", () => {
  const invoice = parsedDemo(demoProfile("FR96552100554"));
  const checks = nationalChecks(invoice, demoProfile("FR96552100554"));
  const frVat = checks.find((item) => item.id === "fr-vat-format");
  assert.equal(frVat.status, "pass");
});

test("aucune règle nationale française ne s'applique à un profil d'un autre pays", () => {
  const invoice = parsedDemo(demoProfile("FR44123456789", "DE"));
  const dePackOnly = nationalChecks(invoice, demoProfile("FR44123456789", "DE")).map((item) => item.id);
  assert.ok(dePackOnly.every((id) => id.startsWith("de-")), dePackOnly.join(", "));
  assert.equal(activePacks("FR", "2026-08-31").length, 0);
  assert.equal(activePacks("IT", "2026-10-08").length, 0);
});

test("les packs respectent la fenêtre de date d'effet", () => {
  const invoice = parsedDemo(demoProfile());
  assert.equal(nationalChecks(invoice, demoProfile(), { date: "2026-08-31" }).length, 0);
  const active = nationalChecks(invoice, demoProfile(), { date: "2026-09-01" });
  assert.ok(active.length >= 2);
  const packs = activePacks("FR", "2026-09-01");
  assert.equal(packs.length, 1);
  assert.equal(packs[0].version, "1.3.0");
  assert.deepEqual(activePacks("FR", "2026-08-31"), []);
});

test("le moteur ignore prudemment les types de règle inconnus", () => {
  const invoice = parsedDemo(demoProfile());
  const checks = nationalChecks(invoice, demoProfile());
  const ids = checks.map((item) => item.id);
  assert.ok(!ids.some((id) => !["fr-vat-format", "fr-siren-endpoint", "fr-facturx-profile", "fr-ctc-parcours", "fr-reception-obligation"].includes(id)));
});

test("les identifiants hors préfixe FR laissent la règle sans avis", () => {
  const invoice = parsedDemo(demoProfile("FR44123456789"));
  invoice.supplierVat = "DE123456789";
  invoice.buyerVat = "DE123456789";
  const frVat = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-vat-format");
  assert.equal(frVat, undefined);
});

test("un profil Factur-X MINIMUM est signalé comme inadapté à la réception", () => {
  const invoice = { supplierVat: "FR96552100554", containerPreflight: { conformanceLevel: "MINIMUM" } };
  const frProfile = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-facturx-profile");
  assert.equal(frProfile.status, "warning");
});

test("un profil Factur-X EN 16931 passe le contrôle de réception", () => {
  const invoice = { supplierVat: "FR96552100554", containerPreflight: { conformanceLevel: "EN 16931" } };
  const frProfile = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-facturx-profile");
  assert.equal(frProfile.status, "pass");
  assert.match(frProfile.message, /EN 16931/);
});

test("le parcours EXTENDED-CTC-FR produit une notice informative", () => {
  const invoice = { supplierVat: "FR96552100554", containerPreflight: { conformanceLevel: "EXTENDED-CTC-FR" } };
  const checks = nationalChecks(invoice, demoProfile(), { country: "FR" });
  assert.equal(checks.find((item) => item.id === "fr-ctc-parcours")?.status, "info");
  assert.equal(checks.find((item) => item.id === "fr-facturx-profile")?.status, "pass");
});

test("sans conteneur Factur-X lu, les règles de profil restent silencieuses", () => {
  const invoice = parsedDemo(demoProfile());
  const ids = nationalChecks(invoice, demoProfile()).map((item) => item.id);
  assert.ok(!ids.includes("fr-facturx-profile"));
  assert.ok(!ids.includes("fr-ctc-parcours"));
});

test("validatePack exige warnOn ou noticeOn pour une règle de profil Factur-X", () => {
  const stripped = (rule) => listPacks().find((pack) => pack.country === "FR").rules.map((item) => (item.id === rule ? { ...item, warnOn: undefined, noticeOn: undefined } : item));
  const packWithout = { ...frPack, rules: stripped("fr-facturx-profile") };
  assert.throws(() => validatePack(packWithout), /warnOn ni noticeOn/);
  assert.doesNotThrow(() => validatePack(frPack));
});

const ciiWithSubLines = ({ headerTotal = "1400.00", subParents = ["L1"], topTotal = null, orphan = false } = {}) => {
  const parentRefs = subParents.map((id) => `<ram:ParentLineID>${id}</ram:ParentLineID>`).join("");
  const lines = [
    `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>L1</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:Name>Kit composite</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeSettlement><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${topTotal ?? "1400.00"}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`,
    `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>S1</ram:LineID>${parentRefs}</ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:Name>Sous-ligne kit</ram:Name></ram:SpecifiedTradeProduct></ram:IncludedSupplyChainTradeLineItem>`
  ];
  const orphanParent = orphan ? `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>S2</ram:LineID><ram:ParentLineID>L404</ram:ParentLineID></ram:AssociatedDocumentLineDocument></ram:IncludedSupplyChainTradeLineItem>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument><ram:ID>CII-2026-1</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20261008</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${lines.join("")}${orphanParent}
    <ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>Studio Horizon SAS</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR96552100554</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty><ram:BuyerTradeParty><ram:Name>Atelier Nova SAS</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">FR11123456782</ram:ID></ram:SpecifiedTaxRegistration></ram:BuyerTradeParty></ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery></ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode><ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${headerTotal}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${headerTotal}</ram:TaxBasisTotalAmount><ram:GrandTotalAmount>${headerTotal}</ram:GrandTotalAmount><ram:DuePayableAmount>${headerTotal}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation></ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
};

test("un chemin de fer cohérent passe la règle nationale", () => {
  const invoice = parseInvoiceXml(ciiWithSubLines(), DOMParser);
  const chemin = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-chemin-de-fer");
  assert.equal(chemin.status, "pass");
});

test("un écart entre lignes de premier niveau et BT-106 est signalé", () => {
  const invoice = parseInvoiceXml(ciiWithSubLines({ topTotal: "1200.00" }), DOMParser);
  const chemin = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-chemin-de-fer");
  assert.equal(chemin.status, "error");
  assert.match(chemin.message, /200\.00/);
});

test("une sous-ligne orpheline (ParentLineID inexistant) est bloquée", () => {
  const invoice = parseInvoiceXml(ciiWithSubLines({ orphan: true }), DOMParser);
  const chemin = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-chemin-de-fer");
  assert.equal(chemin.status, "error");
  assert.match(chemin.message, /inexistante/);
});

test("sans sous-lignes, la règle chemin de fer reste silencieuse", () => {
  const plainUbl = parsedDemo(demoProfile());
  assert.equal(nationalChecks(plainUbl, demoProfile()).some((item) => item.id === "fr-chemin-de-fer"), false);
  const plainCii = parseInvoiceXml(ciiWithSubLines({ subParents: [] }), DOMParser);
  assert.equal(nationalChecks(plainCii, demoProfile()).some((item) => item.id === "fr-chemin-de-fer"), false);
});

test("la règle chemin de fer exige une tolérance numérique", () => {
  const broken = { ...frPack, rules: frPack.rules.map((item) => (item.id === "fr-chemin-de-fer" ? { ...item, tolerance: "large" } : item)) };
  assert.throws(() => validatePack(broken), /tol[ée]rance/);
});

test("validatePack rejette les packs incomplets, dans une langue déterministe", () => {
  assert.throws(() => validatePack(null), /invalide/);
  assert.throws(() => validatePack({ ...frPack, version: "1" }), /version/);
  assert.throws(() => validatePack({ ...frPack, country: "fra" }), /pays/);
  assert.throws(() => validatePack({ ...frPack, effectiveFrom: "31/12/2026" }), /AAAA-MM-JJ/);
  assert.throws(() => validatePack({ ...frPack, effectiveUntil: "2025-01-01" }), /ant[ée]rior/);
  assert.throws(() => validatePack({ ...frPack, rules: [] }), /aucune r[èe]gle/);
  assert.throws(() => validatePack({ ...frPack, source: { label: " " } }), /identifiable/);
  assert.doesNotThrow(() => validatePack(frPack));
});

test("les contrôles nationaux sont déterministes", () => {
  const invoice = parsedDemo(demoProfile());
  const first = JSON.stringify(nationalChecks(invoice, demoProfile(), { date: "2026-10-08" }));
  const second = JSON.stringify(nationalChecks(invoice, demoProfile(), { date: "2026-10-08" }));
  assert.equal(first, second);
});

test("la clé SIREN valide passe la règle de routage", () => {
  const invoice = parsedDemo(demoProfile());
  invoice.supplierEndpoint = "552100554"; // SIREN de démonstration INSEE, Luhn valide
  invoice.buyerEndpoint = "123456782";
  const frSiren = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-siren-endpoint");
  assert.equal(frSiren.status, "pass");
});

test("le préfixe de schéma EAS est retiré avant le contrôle SIREN", () => {
  const invoice = parsedDemo(demoProfile());
  invoice.supplierEndpoint = "0009:552100554";
  invoice.buyerEndpoint = "0009:123456782";
  invoice.buyerVat = "FR44123456789";
  const frSiren = nationalChecks(invoice, demoProfile("FR44123456789"), { country: "FR" }).find((item) => item.id === "fr-siren-endpoint");
  assert.equal(frSiren.status, "pass");
});

test("une pseudo-SIREN dont la clé Luhn échoue est signalée", () => {
  const invoice = parsedDemo(demoProfile("FR44123456789"));
  invoice.supplierEndpoint = "123456781"; // 9 chiffres, clé invalide
  invoice.buyerEndpoint = "999999999"; // 9 chiffres, clé invalide
  const frSiren = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-siren-endpoint");
  assert.equal(frSiren.status, "error");
});

test("un SIRET à 14 chiffres est contrôlé via sa partie SIREN", () => {
  const invoice = parsedDemo(demoProfile());
  invoice.supplierEndpoint = "55210055400010"; // 14 chiffres, SIREN valide
  invoice.buyerEndpoint = "12345678200012";
  const frSiren = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-siren-endpoint");
  assert.equal(frSiren.status, "pass");
});

test("une adresse électronique de routage n'est pas prise pour un SIRET", () => {
  const invoice = parsedDemo(demoProfile());
  invoice.supplierEndpoint = "contact@studio-horizon.fr";
  invoice.buyerEndpoint = "123456782"; // seul cet identifiant est évalué
  const frSiren = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-siren-endpoint");
  assert.equal(frSiren.status, "pass");
});
