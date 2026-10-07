import test from "node:test";
import assert from "node:assert/strict";
import {
  IdentityInputError,
  normalizePeppolInput,
  normalizeVatInput,
  verifyPeppol,
  verifyVies
} from "../worker/identity.mjs";
import { checkPeppolIdentity, checkViesIdentity } from "../web/identity.js";

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" }
});

test("normalise un numéro VIES avec son préfixe pays", () => {
  assert.deepEqual(normalizeVatInput({ countryCode: "fr", vatNumber: "FR 40 303 265 045" }), {
    countryCode: "FR",
    vatNumber: "40303265045"
  });
});

test("refuse un pays ou un numéro TVA hors contrat", () => {
  assert.throws(() => normalizeVatInput({ countryCode: "US", vatNumber: "123" }), IdentityInputError);
  assert.throws(() => normalizeVatInput({ countryCode: "FR", vatNumber: "?" }), /numéro de TVA/i);
});

test("accepte les deux formes d’identifiant Peppol", () => {
  assert.equal(normalizePeppolInput("9930:de299939922"), "9930:de299939922");
  assert.equal(normalizePeppolInput("iso6523-actorid-upis::9930:de299939922"), "9930:de299939922");
  assert.throws(() => normalizePeppolInput("de299939922"), IdentityInputError);
});

test("normalise un résultat VIES valide sans conserver la réponse brute", async () => {
  const result = await verifyVies({ countryCode: "FR", vatNumber: "40303265045" }, {
    fetchImpl: async () => jsonResponse({ valid: true, requestDate: "2026-10-07T12:00:00Z", name: "ACME SA", address: "Paris", secret: "ignored" })
  });
  assert.equal(result.status, "verified");
  assert.equal(result.identifier, "FR40303265045");
  assert.equal(result.legalName, "ACME SA");
  assert.equal(result.secret, undefined);
  assert.equal(result.stored, false);
});

test("distingue un numéro VIES non confirmé d’un service indisponible", async () => {
  const notVerified = await verifyVies({ countryCode: "FR", vatNumber: "00112233445" }, {
    fetchImpl: async () => jsonResponse({ valid: false, requestDate: "2026-10-07T12:00:00Z" })
  });
  const unavailable = await verifyVies({ countryCode: "FR", vatNumber: "00112233445" }, {
    fetchImpl: async () => jsonResponse({}, 503)
  });
  assert.equal(notVerified.status, "not_verified");
  assert.equal(unavailable.status, "unavailable");
});

test("extrait une présence Peppol sans exposer contacts ni document types", async () => {
  const result = await verifyPeppol("9930:de299939922", {
    fetchImpl: async () => jsonResponse({
      "total-result-count": 1,
      "creation-dt": "2026-10-07T12:00:00Z",
      matches: [{
        docTypes: [{ value: "invoice" }, { value: "credit-note" }],
        entities: [{ name: [{ name: "ACME GmbH" }], countryCode: "DE", regDate: "2026-01-10", contact: "ignored@example.com" }]
      }]
    })
  });
  assert.equal(result.status, "verified");
  assert.equal(result.legalName, "ACME GmbH");
  assert.equal(result.acceptedDocumentTypes, 2);
  assert.doesNotMatch(JSON.stringify(result), /ignored@example/);
  assert.doesNotMatch(JSON.stringify(result), /invoice/);
});

test("retourne non vérifié quand Peppol Directory ne trouve aucun participant", async () => {
  const result = await verifyPeppol("0088:1234567890123", {
    fetchImpl: async () => jsonResponse({ "total-result-count": 0, matches: [] })
  });
  assert.equal(result.status, "not_verified");
  assert.equal(result.acceptedDocumentTypes, 0);
});

test("le client navigateur utilise uniquement les routes SettleMesh de même origine", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ status: "verified" });
  };
  await checkViesIdentity("FR", "40303265045", { fetchImpl });
  await checkPeppolIdentity("9930:de299939922", { fetchImpl });
  assert.deepEqual(calls.map((call) => call.url), ["/api/v1/identity/vies", "/api/v1/identity/peppol"]);
  assert.deepEqual(JSON.parse(calls[0].options.body), { countryCode: "FR", vatNumber: "40303265045" });
  assert.deepEqual(JSON.parse(calls[1].options.body), { participantId: "9930:de299939922" });
});
