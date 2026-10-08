import test from "node:test";
import assert from "node:assert/strict";
import {
  compactHistory,
  createPersistedState,
  HISTORY_RETENTION_DAYS,
  readPersistedState,
  STORAGE_KEY,
  writePersistedState
} from "../web/storage.js";

const createStorage = (entries = {}) => {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key)
  };
};

test("retrouve une sauvegarde Eurule et la réécrit sous la clé SettleMesh", () => {
  const legacy = { profile: { companyName: "Atelier Nova" }, history: [{ id: "CHK-1" }] };
  const storage = createStorage({ "eurule-checklink-v1": JSON.stringify(legacy) });
  const persisted = readPersistedState(storage);
  assert.equal(persisted.migrated, true);
  assert.equal(persisted.sourceKey, "eurule-checklink-v1");
  assert.deepEqual(persisted.value, legacy);

  writePersistedState(storage, persisted.value);
  assert.deepEqual(JSON.parse(storage.value(STORAGE_KEY)), legacy);
});

test("préfère la sauvegarde SettleMesh et ignore une entrée courante illisible", () => {
  const current = createStorage({
    [STORAGE_KEY]: JSON.stringify({ profile: { companyName: "Courante" } }),
    "eurule-checklink-v1": JSON.stringify({ profile: { companyName: "Ancienne" } })
  });
  assert.equal(readPersistedState(current).value.profile.companyName, "Courante");

  const fallback = createStorage({
    [STORAGE_KEY]: "{json-invalide",
    "eurule-checklink-v1": JSON.stringify({ profile: { companyName: "Ancienne" } })
  });
  assert.equal(readPersistedState(fallback).value.profile.companyName, "Ancienne");
});

test("minimise l’historique persistant et exclut les résultats expirés", () => {
  const now = Date.UTC(2026, 9, 7, 12);
  const recent = {
    id: "CHK-RECENT", checkedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(), recipient: "Atelier Nova",
    outcome: "ready", score: 100, counts: { pass: 12 }, standards: { en16931: "1.3.16", internal: "secret" },
    invoice: {
      invoiceNumber: "INV-42", documentType: "Facture", syntax: "UBL", supplierName: "Studio Horizon",
      supplierVat: "FR96552100554", buyerName: "Atelier Nova SAS", buyerEndpoint: "0009:secret", currency: "EUR",
      payableAmount: 120, raw: "<Invoice>secret</Invoice>"
    },
    checks: [{ message: "détail confidentiel" }]
  };
  const expired = { ...recent, id: "CHK-OLD", checkedAt: new Date(now - (HISTORY_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString() };
  const history = compactHistory([recent, expired], { now });
  assert.equal(history.length, 1);
  assert.equal(history[0].id, "CHK-RECENT");
  assert.equal(history[0].invoice.payableAmount, 120);
  assert.equal(history[0].invoice.buyerName, undefined);
  assert.equal(history[0].checks, undefined);
  assert.doesNotMatch(JSON.stringify(history), /secret|<Invoice>/);
  assert.equal(compactHistory([{ ...recent, invoice: { ...recent.invoice, payableAmount: null } }], { now })[0].invoice.payableAmount, null);
});

test("ne persiste jamais le dernier diagnostic détaillé", () => {
  const now = Date.UTC(2026, 9, 7, 12);
  const state = createPersistedState({
    profile: { companyName: "Atelier Nova" },
    history: [{ id: "CHK-1", checkedAt: new Date(now).toISOString(), invoice: {} }],
    lastResult: { checks: [{ message: "détail" }], invoice: { raw: "<Invoice/>" } },
    metrics: { schema: "settlemesh-local-metrics" },
    netting: { obligations: [], source: "" }
  }, { now });
  assert.equal(state.lastResult, undefined);
  assert.doesNotMatch(JSON.stringify(state), /<Invoice\/>|détail/);
});
