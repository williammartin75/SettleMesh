import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCycleRecord,
  computePlan,
  createDemoInvoices,
  parseInvoiceCSV,
  settlementsToCSV,
  validatePortfolio
} from "../dist/core.js";

test("parse un CSV français séparé par des points-virgules", () => {
  const csv = "référence;fournisseur;client;montant;échéance;statut\nF-1;Alpha;Beta;12 500,50;31/10/2026;ouverte";
  const result = parseInvoiceCSV(csv);
  assert.equal(result.errors.length, 0);
  assert.equal(result.invoices.length, 1);
  assert.deepEqual(result.invoices[0], {
    id: "F-1",
    supplier: "Alpha",
    customer: "Beta",
    amount: 12500.5,
    dueDate: "2026-10-31",
    status: "open"
  });
});

test("signale les colonnes obligatoires manquantes", () => {
  const result = parseInvoiceCSV("id;montant\nF-1;100");
  assert.equal(result.invoices.length, 0);
  assert.match(result.errors[0], /supplier|fournisseur/i);
});

test("compense un cycle à trois entreprises", () => {
  const plan = computePlan([
    { id: "1", supplier: "B", customer: "A", amount: 100, status: "open" },
    { id: "2", supplier: "C", customer: "B", amount: 80, status: "open" },
    { id: "3", supplier: "A", customer: "C", amount: 70, status: "overdue" }
  ]);
  assert.equal(plan.gross, 250);
  assert.equal(plan.netCash, 30);
  assert.equal(plan.totalCleared, 220);
  assert.equal(plan.reductionRate, 0.88);
  assert.equal(plan.settlements.reduce((sum, item) => sum + item.amount, 0), 30);
});

test("effectue d’abord la compensation bilatérale", () => {
  const plan = computePlan([
    { id: "1", supplier: "B", customer: "A", amount: 100, status: "open" },
    { id: "2", supplier: "A", customer: "B", amount: 65, status: "open" }
  ]);
  assert.equal(plan.gross, 165);
  assert.equal(plan.bilateralCleared, 130);
  assert.equal(plan.bilateralRemaining, 35);
  assert.deepEqual(plan.settlements, [{ from: "A", to: "B", amount: 35 }]);
});

test("exclut les factures payées et litigieuses", () => {
  const plan = computePlan([
    { id: "1", supplier: "B", customer: "A", amount: 100, status: "paid" },
    { id: "2", supplier: "C", customer: "A", amount: 50, status: "disputed" },
    { id: "3", supplier: "D", customer: "A", amount: 25, status: "open" }
  ]);
  assert.equal(plan.gross, 25);
  assert.equal(plan.eligibleCount, 1);
  assert.equal(plan.excludedCount, 2);
});

test("conserve l’équilibre comptable du portefeuille de démonstration", () => {
  const plan = computePlan(createDemoInvoices());
  const netSum = plan.entities.reduce((sum, entity) => sum + entity.net, 0);
  const paid = plan.settlements.reduce((sum, item) => sum + item.amount, 0);
  assert.equal(netSum, 0);
  assert.equal(paid, plan.netCash);
  assert.ok(plan.reductionRate > 0.5);
});

test("exporte un plan compatible avec un tableur français", () => {
  const csv = settlementsToCSV([{ from: "A; France", to: "B", amount: 1234.5 }]);
  assert.match(csv, /"A; France";B;1234,50/);
  assert.ok(csv.startsWith("\uFEFF"));
});

test("produit une empreinte de cycle déterministe", () => {
  const invoices = createDemoInvoices();
  const approvals = Object.fromEntries(computePlan(invoices).entities.map((entity) => [entity.name, true]));
  const first = buildCycleRecord({ invoices, approvals, createdAt: "2026-10-07T12:00:00.000Z", status: "sealed" });
  const second = buildCycleRecord({ invoices, approvals, createdAt: "2026-10-07T12:00:00.000Z", status: "sealed" });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.id, second.id);
  assert.ok(first.participants.every((participant) => participant.approved));
});

test("détecte les références dupliquées avant scellement", () => {
  const invoices = createDemoInvoices();
  invoices.push({ ...invoices[0] });
  const validation = validatePortfolio(invoices);
  assert.equal(validation.ready, false);
  assert.equal(validation.stats.duplicateIds, 1);
  assert.match(validation.issues.join(" "), /doublon/i);
});
