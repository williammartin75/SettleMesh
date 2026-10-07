import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticateApiKey,
  createApiCredential,
  hashApiKey,
  parseApiKeyConfiguration
} from "../server/auth.mjs";

test("génère une clé forte et ne conserve que son hash dans la configuration", () => {
  const generated = createApiCredential({ organizationId: "atelier-nova", keyId: "atelier-nova-primary" });
  assert.match(generated.apiKey, /^sm_live_[A-Za-z0-9_-]{43}$/);
  assert.equal(generated.credential.keyHash, hashApiKey(generated.apiKey));
  assert.equal("apiKey" in generated.credential, false);

  const authentication = authenticateApiKey(`Bearer ${generated.apiKey}`, [generated.credential]);
  assert.equal(authentication.ok, true);
  assert.equal(authentication.credential.organizationId, "atelier-nova");
  assert.equal(authentication.credential.keyId, "atelier-nova-primary");
  assert.equal("keyHash" in authentication.credential, false);
});

test("charge plusieurs clés de rotation pour une même organisation", () => {
  const entries = [
    { organizationId: "atelier-nova", keyId: "primary", keyHash: hashApiKey("first-secret-api-key-123456789"), requestsPerMinute: 20 },
    { organizationId: "atelier-nova", keyId: "rotation", keyHash: hashApiKey("second-secret-api-key-12345678"), requestsPerMinute: 20 }
  ];
  const parsed = parseApiKeyConfiguration(JSON.stringify(entries));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].organizationId, parsed[1].organizationId);
  assert.equal(Object.isFrozen(parsed), true);
});

test("refuse une configuration en clair, faible ou dupliquée", () => {
  assert.throws(() => parseApiKeyConfiguration('[{"organizationId":"atelier-nova","keyId":"primary","key":"secret"}]'), /keyHash/);
  assert.throws(() => parseApiKeyConfiguration('[{"organizationId":"A","keyId":"primary","keyHash":"abc"}]'), /organizationId/);
  const keyHash = hashApiKey("a-long-test-key-that-is-not-a-secret");
  assert.throws(() => parseApiKeyConfiguration(JSON.stringify([
    { organizationId: "atelier-nova", keyId: "primary", keyHash },
    { organizationId: "other-company", keyId: "primary", keyHash: hashApiKey("another-long-test-key") }
  ])), /keyId primary est dupliqué/);
  assert.throws(() => parseApiKeyConfiguration(JSON.stringify([
    { organizationId: "atelier-nova", keyId: "primary", keyHash, requestsPerMinute: 10 },
    { organizationId: "atelier-nova", keyId: "rotation", keyHash: hashApiKey("another-long-test-key"), requestsPerMinute: 20 }
  ])), /même quota/);
});
