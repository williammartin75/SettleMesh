import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseRegistry } from "../server/registry-supabase.mjs";
import { createApiCredential, authenticateApiKey, hashApiKey } from "../server/auth.mjs";

const SERVICE_KEY = "service-role-key-de-test";
const REF = "projetref000000000000";

const credential = createApiCredential({ organizationId: "atelier-nova", keyId: "supa-key-1", role: "admin", requestsPerMinute: 90 });

const documentStub = {
  schema: "settlemesh-registry-1",
  organizations: [{
    organizationId: "atelier-nova",
    requestsPerMinute: 90,
    keys: [
      { keyId: "supa-key-1", keyHash: credential.credential.keyHash, role: "admin", revokedAt: null },
      { keyId: "supa-key-2", keyHash: hashApiKey("sm_live_revolue-56789012"), role: "viewer", revokedAt: "2026-10-08T09:00:00.000Z" }
    ]
  }]
};

let calls = [];
const fetchStub = async (url, init = {}) => {
  calls.push({ url, method: init.method || "GET" });
  if ((init.method || "GET") === "GET") {
    return {
      ok: true, status: 200,
      json: async () => [{ id: 1, schema_name: "settlemesh-registry-1", document: documentStub, updated_at: "2026-10-08T09:30:00.000Z" }],
      text: async () => ""
    };
  }
  return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
};

test("l'adaptateur chargé sur une ligne existante expose les clés, rôles et révocations", async () => {
  const registry = createSupabaseRegistry({ projectRef: REF, serviceKey: SERVICE_KEY, fetchImpl: fetchStub });
  const entries = await registry.credentials();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].role, "admin");
  assert.equal(entries[1].revokedAt, "2026-10-08T09:00:00.000Z");
  const refused = authenticateApiKey(`Bearer ${credential.apiKey}`, entries);
  assert.equal(refused.credential.role, "admin");
  const revoked = authenticateApiKey("Bearer sm_live_revolue-56789012", entries);
  assert.equal(revoked.code, "API_KEY_REVOKED");
});

test("la lecture est mise en cache selon la fenêtre de sondage, sauf force", async () => {
  calls = [];
  const registry = createSupabaseRegistry({ projectRef: REF, serviceKey: SERVICE_KEY, fetchImpl: fetchStub, pollMs: 60_000 });
  await registry.credentials();
  await registry.credentials();
  assert.equal(calls.filter((call) => call.method === "GET").length, 1);
  await registry.credentials(true);
  assert.equal(calls.filter((call) => call.method === "GET").length, 2);
});

test("l'écriture est un upsert atomique et revalide le document", async () => {
  let captured = null;
  const fetchPush = async (url, init = {}) => {
    if ((init.method || "GET") === "POST") {
      captured = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
    }
    return fetchStub(url, init);
  };
  const registry = createSupabaseRegistry({ projectRef: REF, serviceKey: SERVICE_KEY, fetchImpl: fetchPush, pollMs: 0 });
  const written = await registry.write([{ organizationId: "nouvelle-org", keyId: "k-1", keyHash: credential.credential.keyHash, role: "viewer" }]);
  assert.equal(written.organizations[0].requestsPerMinute, 60);
  assert.equal(captured.body.id, 1);
  assert.equal(captured.body.schema_name, "settlemesh-registry-1");
  assert.ok(captured.url.includes("on_conflict=id"));
  assert.equal(captured.body.document.organizations[0].keys[0].role, "viewer");
});

test("une écriture de document invalide est refusée avant toute requête", async () => {
  let posted = false;
  const fetchRefuse = async (url, init = {}) => {
    if ((init.method || "GET") === "POST") { posted = true; return { ok: true, status: 201, json: async () => ({}), text: async () => "" }; }
    return fetchStub(url, init);
  };
  const registry = createSupabaseRegistry({ projectRef: REF, serviceKey: SERVICE_KEY, fetchImpl: fetchRefuse });
  await assert.rejects(() => registry.write([{ organizationId: "org", keyId: "bad", keyHash: "sm_live_en_clair", role: "owner" }]), /hash SHA-256/);
  assert.equal(posted, false);
});

test("une clé service_role invalide produit une indisponibilité explicite", async () => {
  const fetch401 = async () => ({ ok: false, status: 401, json: async () => ({ message: "JWT invalide" }), text: async () => "" });
  const registry = createSupabaseRegistry({ projectRef: REF, serviceKey: SERVICE_KEY, fetchImpl: fetch401 });
  await assert.rejects(() => registry.credentials(), (error) => error.code === "SUPABASE_REGISTRY_UNAVAILABLE" && error.statusCode === 503);
});

test("sans ligne, le registre expose exactement aucune clé (validation fermée)", async () => {
  const fetchEmpty = async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" });
  const registry = createSupabaseRegistry({ projectRef: REF, serviceKey: SERVICE_KEY, fetchImpl: fetchEmpty });
  assert.deepEqual(await registry.credentials(), []);
});
