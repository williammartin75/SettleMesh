import test from "node:test";
import assert from "node:assert/strict";
import { createNettingDemo, exportNettingCsv, parseNettingCsv, simulateNetting } from "../web/netting.js";

test("détecte une compensation bilatérale et un cycle triangulaire", () => {
  const result = simulateNetting(createNettingDemo());
  assert.equal(result.eligible.length, 5);
  assert.equal(result.ignored.length, 1);
  assert.equal(result.proposals.length, 2);
  assert.deepEqual(result.proposals.map((item) => item.type).sort(), ["bilateral", "triangular"]);
  assert.equal(result.metrics.grossVolume, 315000);
  assert.equal(result.metrics.nettedVolume, 260000);
  assert.equal(result.metrics.residualVolume, 55000);
  assert.equal(result.metrics.nettingRate, 82.5);
  assert.equal(result.residuals.length, 3);
});

test("préserve la position nette de chaque participant", () => {
  const result = simulateNetting(createNettingDemo());
  const position = Object.fromEntries(result.positions.map((item) => [item.name, item.netPosition]));
  assert.equal(position["Atelier Nova"], -45000);
  assert.equal(position["Studio Horizon"], 20000);
  assert.equal(position.LogiCore, 10000);
  assert.equal(position.TechFlow, 15000);
  assert.equal(Object.values(position).reduce((sum, value) => sum + value, 0), 0);
});

test("importe un CSV français et exclut les factures en litige", () => {
  const csv = [
    "numero_facture;debiteur;crediteur;montant;devise;date_echeance;statut;litige;cedee",
    'F-1;Entreprise A;Entreprise B;"1 200,50";EUR;2026-12-01;acceptee;non;non',
    "F-2;Entreprise B;Entreprise A;700,25;EUR;2026-12-01;acceptee;oui;non"
  ].join("\n");
  const parsed = parseNettingCsv(csv);
  assert.equal(parsed.obligations.length, 2);
  assert.equal(parsed.obligations[0].amount, 1200.5);
  const result = simulateNetting(parsed.obligations);
  assert.equal(result.eligible.length, 1);
  assert.equal(result.ignored[0].reason, "Facture en litige");
});

test("ne compense jamais deux devises différentes", () => {
  const result = simulateNetting([
    { invoiceNumber: "EUR-1", debtor: "A", creditor: "B", amount: 100, currency: "EUR", status: "accepted" },
    { invoiceNumber: "USD-1", debtor: "B", creditor: "A", amount: 100, currency: "USD", status: "accepted" }
  ]);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.metricsByCurrency.length, 2);
  assert.equal(result.metrics.nettedVolume, 0);
});

test("applique un cut-off sans modifier les positions nettes du périmètre", () => {
  const result = simulateNetting(createNettingDemo(), { cutoffDate: "2026-11-15" });
  assert.equal(result.scenario.cutoffDate, "2026-11-15");
  assert.equal(result.eligible.length, 3);
  assert.equal(result.deferred.length, 2);
  assert.equal(result.ignored.length, 1);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].type, "triangular");
  assert.equal(result.metrics.grossVolume, 250000);
  assert.equal(result.metrics.nettedVolume, 210000);
  assert.equal(result.metrics.residualVolume, 40000);
  assert.equal(result.metrics.nettingRate, 84);
  assert.equal(result.positions.reduce((sum, item) => sum + item.netPosition, 0), 0);
});

test("écarte prudemment les échéances absentes ou invalides d'un scénario daté", () => {
  const obligations = [
    { invoiceNumber: "F-1", debtor: "A", creditor: "B", amount: 100, currency: "EUR", dueDate: "", status: "accepted" },
    { invoiceNumber: "F-2", debtor: "B", creditor: "A", amount: 80, currency: "EUR", dueDate: "2026-02-30", status: "accepted" }
  ];
  const allDates = simulateNetting(obligations);
  const cutoff = simulateNetting(obligations, { cutoffDate: "2026-12-31" });
  assert.equal(allDates.eligible.length, 2);
  assert.equal(allDates.metrics.nettedVolume, 160);
  assert.equal(cutoff.eligible.length, 0);
  assert.equal(cutoff.deferred.length, 2);
  assert.match(cutoff.deferred[0].reason, /Échéance/);
  assert.throws(() => simulateNetting(obligations, { cutoffDate: "31/12/2026" }), /Date de cut-off invalide/);
});

test("exporte les propositions en CSV sans formule exécutable", () => {
  const result = simulateNetting([
    { invoiceNumber: "=DANGER", debtor: "A", creditor: "B", amount: 100, currency: "EUR", status: "accepted" },
    { invoiceNumber: "F-2", debtor: "B", creditor: "A", amount: 80, currency: "EUR", status: "accepted" }
  ]);
  result.scenario.cutoffDate = "2026-12-31";
  const csv = exportNettingCsv(result);
  assert.match(csv, /bilateral/);
  assert.match(csv, /'=DANGER/);
  assert.match(csv, /scenario_cutoff/);
  assert.match(csv, /2026-12-31/);
});
