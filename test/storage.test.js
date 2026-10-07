import test from "node:test";
import assert from "node:assert/strict";
import { readPersistedState, STORAGE_KEY, writePersistedState } from "../dist/storage.js";

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
