import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiCredential, authenticateApiKey, hashApiKey, parseApiKeyConfiguration } from "../server/auth.mjs";
import { buildRegistryDocument, createFileRegistry, parseRegistryDocument, readRegistryFile, writeRegistryFile } from "../server/registry.mjs";
import { createSettleMeshServer, listen } from "../server/server.mjs";

const hash = (key) => hashApiKey(key);
const workdir = mkdtempSync(join(tmpdir(), "settlemesh-registry-"));
const registryPath = join(workdir, "registry.json");

const baseEntries = [
  { organizationId: "atelier-nova", keyId: "key-2026-a", keyHash: hash("sm_live_atelier-nova-key-a-1234"), role: "owner" },
  { organizationId: "atelier-nova", keyId: "key-2026-b", keyHash: hash("sm_live_atelier-nova-key-b-1234"), role: "viewer" },
  { organizationId: "studio-horizon", keyId: "key-2026-c", keyHash: hash("sm_live_studio-horizon-key-c"), role: "admin", requestsPerMinute: 120 }
];

test("le document de registre valide produit des entrées figées avec rôle et révocation", () => {
  const document = buildRegistryDocument(baseEntries);
  const parsed = parseRegistryDocument(document);
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[0].role, "owner");
  assert.equal(parsed.entries[1].role, "viewer");
  assert.equal(parsed.entries[2].requestsPerMinute, 120);
  assert.equal(parsed.entries[0].revokedAt, null);
});

test("le registre refuse un hash en clair, un rôle inconnu, une clé dupliquée et un doublon de hash", () => {
  const document = buildRegistryDocument(baseEntries);
  assert.throws(() => parseRegistryDocument({ ...document, schema: "autre" }), /sch.ma/);
  assert.throws(() => parseRegistryDocument({
    schema: "settlemesh-registry-1",
    organizations: [{ organizationId: "org", keys: [{ keyId: "k1", keyHash: "sm_live_cle_en_clair", role: "owner" }] }]
  }), /hash SHA-256/);
  assert.throws(() => parseRegistryDocument({
    schema: "settlemesh-registry-1",
    organizations: [{ organizationId: "org", keys: [{ keyId: "k1", keyHash: hash("x-1-234567890"), role: "superadmin" }] }]
  }), /r.le/);
  assert.throws(() => parseRegistryDocument({
    schema: "settlemesh-registry-1",
    organizations: [{ organizationId: "org", keys: [{ keyId: "k1", keyHash: hash("x-1-234567890"), role: "owner" }, { keyId: "k1", keyHash: hash("x-2-234567890"), role: "owner" }] }]
  }), /dupliqu/);
});

test("une clé révoquée produit une erreur API_KEY_REVOKED et non un refus générique", () => {
  const document = buildRegistryDocument([{ ...baseEntries[0], revokedAt: "2026-10-08T10:00:00Z" }, baseEntries[1]]);
  const entries = parseRegistryDocument(document).entries;
  const refused = authenticateApiKey("Bearer sm_live_atelier-nova-key-a-1234", entries);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "API_KEY_REVOKED");
  assert.equal(refused.statusCode, 401);
  const valid = authenticateApiKey("Bearer sm_live_atelier-nova-key-b-1234", entries.filter((entry) => !entry.revokedAt));
  assert.equal(valid.ok, true);
  assert.equal(valid.credential.role, "viewer");
});

test("la configuration d'environnement historique reste acceptée et obtient le rôle owner", () => {
  const credential = createApiCredential({ organizationId: "atelier-nova", keyId: "legacy-key" });
  const entries = parseApiKeyConfiguration(JSON.stringify([{ organizationId: "atelier-nova", keyId: "legacy-key", keyHash: credential.credential.keyHash }]));
  const authenticated = authenticateApiKey(`Bearer ${credential.apiKey}`, entries);
  assert.equal(authenticated.ok, true);
  assert.equal(authenticated.credential.role, "owner");
});

test("le fichier de registre est relu après modification, sans redémarrage", () => {
  writeRegistryFile(registryPath, baseEntries);
  const registry = createFileRegistry(registryPath);
  assert.equal(registry.credentials().length, 3);
  writeRegistryFile(registryPath, baseEntries.slice(0, 1));
  assert.equal(registry.credentials().length, 1);
});

test("une revocation écrite dans le fichier est appliquée par le serveur sans redémarrage", async () => {
  writeRegistryFile(registryPath, baseEntries);
  const server = createSettleMeshServer({ registryFile: registryPath });
  const listening = await listen(server);
  const post = async (apiKey) => {
    const response = await fetch(`http://127.0.0.1:${listening.port}/api/v1/validate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ xml: "<Invoice/>", sourceName: "test" })
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const before = await post("sm_live_studio-horizon-key-c");
    assert.equal(before.status, 200);
    assert.equal(before.body.organizationRole, "admin");

    writeRegistryFile(registryPath, baseEntries.map((entry) => (entry.keyId === "key-2026-c" ? { ...entry, revokedAt: "2026-10-08T11:00:00Z" } : entry)));
    const after = await post("sm_live_studio-horizon-key-c");
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, "API_KEY_REVOKED");

    const other = await post("sm_live_atelier-nova-key-b-1234");
    assert.equal(other.status, 200);
    assert.equal(other.body.organizationRole, "viewer");
  } finally {
    server.close();
  }
});

test("readRegistryFile rejette un fichier illisible ou de schéma faux", () => {
  const brokenPath = join(workdir, "broken.json");
  writeFileSync(brokenPath, "{pas du json", "utf8");
  assert.throws(() => readRegistryFile(brokenPath));
  writeFileSync(brokenPath, JSON.stringify({ schema: "faux", organizations: [] }), "utf8");
  assert.throws(() => readRegistryFile(brokenPath), /sch.ma/);
});

test("l'écriture atomique ne laisse pas de fichier temporaire derrière elle", () => {
  writeRegistryFile(registryPath, baseEntries);
  const document = readRegistryFile(registryPath);
  assert.equal(document.schema, "settlemesh-registry-1");
  const leftovers = readdirSync(workdir).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("une organisation sans clé est refusée", () => {
  assert.throws(() => parseRegistryDocument({
    schema: "settlemesh-registry-1",
    organizations: [{ organizationId: "org-vide", keys: [] }]
  }), /au moins une cl/);
});
