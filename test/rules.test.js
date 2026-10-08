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
  assert.equal(nationalChecks(invoice, demoProfile("FR44123456789", "DE")).length, 0);
  assert.deepEqual(activePacks("DE"), []);
});

test("les packs respectent la fenêtre de date d'effet", () => {
  const invoice = parsedDemo(demoProfile());
  assert.equal(nationalChecks(invoice, demoProfile(), { date: "2026-08-31" }).length, 0);
  const active = nationalChecks(invoice, demoProfile(), { date: "2026-09-01" });
  assert.ok(active.length >= 2);
  const packs = activePacks("FR", "2026-09-01");
  assert.equal(packs.length, 1);
  assert.equal(packs[0].version, "1.0.0");
  assert.deepEqual(activePacks("FR", "2026-08-31"), []);
});

test("le moteur ignore prudemment les types de règle inconnus", () => {
  const invoice = parsedDemo(demoProfile());
  const checks = nationalChecks(invoice, demoProfile());
  const ids = checks.map((item) => item.id);
  assert.ok(!ids.some((id) => !["fr-vat-format", "fr-reception-obligation"].includes(id)));
});

test("les identifiants hors préfixe FR laissent la règle sans avis", () => {
  const invoice = parsedDemo(demoProfile("FR44123456789"));
  invoice.supplierVat = "DE123456789";
  invoice.buyerVat = "DE123456789";
  const frVat = nationalChecks(invoice, demoProfile(), { country: "FR" }).find((item) => item.id === "fr-vat-format");
  assert.equal(frVat, undefined);
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
