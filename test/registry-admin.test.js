import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiCredential } from "../server/auth.mjs";
import { writeRegistryFile } from "../server/registry.mjs";
import { createSettleMeshServer, listen } from "../server/server.mjs";

const credentials = [
  createApiCredential({ organizationId: "atelier-nova", keyId: "owner-key", role: "owner" }),
  createApiCredential({ organizationId: "atelier-nova", keyId: "admin-key", role: "admin" }),
  createApiCredential({ organizationId: "atelier-nova", keyId: "viewer-key", role: "viewer" }),
  createApiCredential({ organizationId: "studio-horizon", keyId: "other-admin", role: "admin" })
];

const start = async () => {
  const dir = mkdtempSync(join(tmpdir(), "settlemesh-admin-"));
  const registryPath = join(dir, "registry.json");
  writeRegistryFile(registryPath, credentials.map((entry) => entry.credential));
  const server = createSettleMeshServer({ registryFile: registryPath });
  const address = await listen(server, { port: 0 }); // port éphémère : aucun conflit inter-fichiers de tests
  return { server, port: address.port };
};

const call = async (port, path, apiKey, { method = "GET", body } = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() };
};

test("la matrice de rôles s'applique aux routes d'administration", async () => {
  const { server, port } = await start();
  try {
    const viewer = await call(port, "keys", credentials[2].apiKey);
    assert.equal(viewer.status, 403);
    assert.equal(viewer.body.error.code, "FORBIDDEN_ROLE");

    const ownerList = await call(port, "keys", credentials[0].apiKey);
    assert.equal(ownerList.status, 200);
    assert.equal(ownerList.body.schema, "settlemesh-admin-keys");
    assert.deepEqual(ownerList.body.keys.map((key) => key.keyId).sort(), ["admin-key", "owner-key", "viewer-key"]);
    assert.ok(!JSON.stringify(ownerList.body).includes("other-admin"), "isolation : aucune clé de l'autre organisation");

    const adminList = await call(port, "keys", credentials[1].apiKey);
    assert.equal(adminList.status, 200);
  } finally {
    server.close();
  }
});

test("création, rotation de rôle, révocation et quota passent par le HTTP", async () => {
  const { server, port } = await start();
  const adminKey = credentials[1].apiKey;
  try {
    const created = await call(port, "keys", adminKey, { method: "POST", body: { keyId: "integrateur-1", role: "viewer" } });
    assert.equal(created.status, 201);
    assert.match(created.body.apiKey, /^sm_live_/);
    assert.equal(created.body.keys.at(-1).role, "viewer");

    const validated = await fetch(`http://127.0.0.1:${port}/api/v1/validate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${created.body.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ xml: "<Invoice/>", sourceName: "test" })
    });
    assert.equal(validated.status, 200);
    assert.equal((await validated.json()).organizationRole, "viewer");

    const forbiddenPromotion = await call(port, "keys", adminKey, { method: "POST", body: { keyId: "owner-essay", role: "owner" } });
    assert.equal(forbiddenPromotion.status, 403);
    assert.equal(forbiddenPromotion.body.error.code, "FORBIDDEN_ROLE");

    const promoted = await call(port, "keys/integrateur-1", credentials[0].apiKey, { method: "PATCH", body: { role: "admin" } });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.keys.find((key) => key.keyId === "integrateur-1").role, "admin");

    const unknown = await call(port, "keys/inconnue-404", credentials[0].apiKey, { method: "PATCH", body: { role: "viewer" } });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, "KEY_NOT_FOUND");

    const revoked = await call(port, "keys/integrateur-1", adminKey, { method: "DELETE" });
    assert.equal(revoked.status, 200);
    assert.ok(revoked.body.keys.find((key) => key.keyId === "integrateur-1").revokedAt);

    const rejected = await fetch(`http://127.0.0.1:${port}/api/v1/validate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${created.body.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ xml: "<Invoice/>", sourceName: "test" })
    });
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json()).error.code, "API_KEY_REVOKED");

    const quotaChanged = await call(port, "organization", credentials[0].apiKey, { method: "PATCH", body: { requestsPerMinute: 250 } });
    assert.equal(quotaChanged.status, 200);
    assert.ok(quotaChanged.body.keys.every((key) => key.requestsPerMinute === 250));

    const quotaDenied = await call(port, "organization", adminKey, { method: "PATCH", body: { requestsPerMinute: 300 } });
    assert.equal(quotaDenied.status, 403);
    assert.equal(quotaDenied.body.error.code, "FORBIDDEN_ROLE");
  } finally {
    server.close();
  }
});

test("l'administration exige un registre persistant et impose l'isolation des organisations", async () => {
  const fallback = createSettleMeshServer({});
  const fallbackAddress = await listen(fallback, { port: 0 });
  try {
    const response = await call(fallbackAddress.port, "keys", "sm_live_sans-registre-901234");
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "ADMIN_REQUIRES_REGISTRY");
  } finally {
    fallback.close();
  }

  const { server, port } = await start();
  try {
    const crossIso = await call(port, "keys/integrateur-1", credentials[3].apiKey, { method: "DELETE" });
    assert.equal(crossIso.status, 404);
    assert.equal(crossIso.body.error.code, "KEY_NOT_FOUND");
  } finally {
    server.close();
  }
});
