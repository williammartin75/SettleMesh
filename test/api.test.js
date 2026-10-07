import test from "node:test";
import assert from "node:assert/strict";
import { createDemoXml, DEFAULT_PROFILE } from "../web/core.js";
import { hashApiKey } from "../server/auth.mjs";
import { createSettleMeshServer, listen, MAX_API_BODY_BYTES } from "../server/server.mjs";

const TEST_API_KEY = "sm_test_settlemesh_validation_key_123456789";
const TEST_ORGANIZATION = "test-organization";
const testCredential = (organizationId, apiKey, requestsPerMinute = 60, keyId = `${organizationId}-key`) => ({
  organizationId,
  keyId,
  keyHash: hashApiKey(apiKey),
  requestsPerMinute
});
const DEFAULT_API_KEYS = [testCredential(TEST_ORGANIZATION, TEST_API_KEY)];
const jsonHeaders = (apiKey = TEST_API_KEY) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`
});

async function withServer(run, options = {}) {
  const server = createSettleMeshServer({ logger: null, apiKeys: DEFAULT_API_KEYS, ...options });
  const address = await listen(server, { port: 0 });
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("expose la santé et les versions de l’API v1", () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/v1/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.apiVersion, "v1");
  assert.equal(body.validators.en16931, "1.3.16");
  assert.equal(body.authentication.validate, "bearer-api-key");
  assert.equal(body.authentication.configured, true);
  assert.equal(body.persistence, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
}));

test("valide un UBL conforme sans renvoyer ni stocker le XML", () => withServer(async (baseUrl) => {
  const xml = createDemoXml({ valid: true, profile: DEFAULT_PROFILE });
  const response = await fetch(`${baseUrl}/api/v1/validate`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ xml, profile: DEFAULT_PROFILE, source: { originalFileName: "invoice.xml" } })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.schema, "settlemesh-validation-response");
  assert.equal(body.organizationId, TEST_ORGANIZATION);
  assert.equal(body.stored, false);
  assert.equal(body.result.outcome, "ready");
  assert.equal(body.result.standards.complete, true);
  assert.equal(body.result.standards.en16931, "1.3.16");
  assert.equal(body.result.invoice.raw, undefined);
  assert.doesNotMatch(JSON.stringify(body), /Mission de conseil/);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(TEST_API_KEY));
}));

test("retourne une erreur structurée pour un XML invalide", () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/v1/validate`, {
    method: "POST", headers: jsonHeaders(), body: JSON.stringify({ xml: "<Invoice>" })
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.schema, "settlemesh-api-error");
  assert.equal(body.error.code, "INVALID_XML");
  assert.ok(body.requestId);
}));

test("refuse les déclarations DOCTYPE dans un XML non fiable", () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/v1/validate`, {
    method: "POST", headers: jsonHeaders(),
    body: JSON.stringify({ xml: '<!DOCTYPE Invoice [<!ENTITY secret SYSTEM "file:///etc/passwd">]><Invoice>&secret;</Invoice>' })
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "UNSAFE_XML");
  assert.doesNotMatch(JSON.stringify(body), /etc\/passwd/);
}));

test("refuse les médias et méthodes non prévus", () => withServer(async (baseUrl) => {
  const wrongType = await fetch(`${baseUrl}/api/v1/validate`, { method: "POST", body: "{}" });
  assert.equal(wrongType.status, 415);
  const wrongMethod = await fetch(`${baseUrl}/api/v1/validate`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
}));

test("applique une limite de débit explicite", () => withServer(async (baseUrl) => {
  assert.equal((await fetch(`${baseUrl}/api/v1/health`)).status, 200);
  const response = await fetch(`${baseUrl}/api/v1/health`);
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.error.code, "RATE_LIMITED");
}, { rateLimit: 1 }));

test("exige une clé API valide pour la validation", () => withServer(async (baseUrl) => {
  const missing = await fetch(`${baseUrl}/api/v1/validate`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xml: "<Invoice/>" })
  });
  const missingBody = await missing.json();
  assert.equal(missing.status, 401);
  assert.equal(missingBody.error.code, "AUTH_REQUIRED");
  assert.match(missing.headers.get("www-authenticate"), /^Bearer/);

  const invalid = await fetch(`${baseUrl}/api/v1/validate`, {
    method: "POST", headers: jsonHeaders("sm_test_invalid_key_123456789012345"), body: JSON.stringify({ xml: "<Invoice/>" })
  });
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).error.code, "INVALID_API_KEY");
}));

test("reste fermé si aucune clé API n’est configurée", () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/v1/validate`, {
    method: "POST", headers: jsonHeaders(), body: JSON.stringify({ xml: "<Invoice/>" })
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "AUTH_NOT_CONFIGURED");
}, { apiKeys: [] }));

test("vérifie VIES et Peppol sans clé API et sans persistance", () => withServer(async (baseUrl) => {
  const vies = await fetch(`${baseUrl}/api/v1/identity/vies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countryCode: "FR", vatNumber: "40303265045" })
  });
  const viesBody = await vies.json();
  assert.equal(vies.status, 200);
  assert.equal(viesBody.status, "verified");
  assert.equal(viesBody.stored, false);
  assert.equal(vies.headers.get("cache-control"), "no-store");

  const peppol = await fetch(`${baseUrl}/api/v1/identity/peppol`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId: "9930:de299939922" })
  });
  const peppolBody = await peppol.json();
  assert.equal(peppol.status, 200);
  assert.equal(peppolBody.status, "verified");
  assert.equal(peppolBody.legalName, "ACME GmbH");
}, {
  identityFetch: async (url) => String(url).includes("vies")
    ? new Response(JSON.stringify({ valid: true, name: "ACME SA" }), { status: 200, headers: { "Content-Type": "application/json" } })
    : new Response(JSON.stringify({ "total-result-count": 1, matches: [{ entities: [{ name: [{ name: "ACME GmbH" }], countryCode: "DE" }], docTypes: [] }] }), { status: 200, headers: { "Content-Type": "application/json" } })
}));

test("refuse les entrées et méthodes invalides sur les vérifications d’identité", () => withServer(async (baseUrl) => {
  const invalid = await fetch(`${baseUrl}/api/v1/identity/peppol`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ participantId: "incorrect" })
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "INVALID_PEPPOL_ID");
  const wrongMethod = await fetch(`${baseUrl}/api/v1/identity/vies`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
}));

test("isole le quota par organisation", () => {
  const keyA = "sm_test_organization_a_123456789012345";
  const keyB = "sm_test_organization_b_123456789012345";
  const apiKeys = [
    testCredential("organization-a", keyA, 1),
    testCredential("organization-b", keyB, 1)
  ];
  return withServer(async (baseUrl) => {
    const validate = (apiKey) => fetch(`${baseUrl}/api/v1/validate`, {
      method: "POST", headers: jsonHeaders(apiKey), body: JSON.stringify({ xml: "<Invoice>" })
    });
    assert.equal((await validate(keyA)).status, 422);
    const limited = await validate(keyA);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("x-ratelimit-scope"), "organization");
    assert.equal((await limited.json()).error.code, "RATE_LIMITED");
    assert.equal((await validate(keyB)).status, 422);
  }, { apiKeys });
});

test("refuse une requête dépassant la limite documentée", () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/v1/validate`, {
    method: "POST", headers: jsonHeaders(),
    body: JSON.stringify({ xml: " ".repeat(MAX_API_BODY_BYTES) })
  });
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.equal(body.error.code, "BODY_TOO_LARGE");
}));

test("refuse les méthodes statiques et les traversées de répertoire", () => withServer(async (baseUrl) => {
  const method = await fetch(`${baseUrl}/`, { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD");

  const traversal = await fetch(`${baseUrl}/..%2fpackage.json`);
  assert.equal(traversal.status, 404);
  assert.equal(await traversal.text(), "Not found");
  assert.equal(traversal.headers.get("x-frame-options"), "DENY");
}));
