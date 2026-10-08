import test from "node:test";
import assert from "node:assert/strict";
import { reportEvent } from "../web/reporting.js";

const refusingFetch = () => {
  throw new Error("AUCUNE requête ne doit partir sans consentement.");
};

test("INVARIANT ABSOLU : sans consentement, zéro octet ne quitte le navigateur fournisseur", async () => {
  const calls = [];
  const outcome = await reportEvent(
    { companyName: "Atelier Nova", usageMetricsConsent: false },
    "invoice_checked",
    { fetchImpl: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } }
  );
  // double garde : fetchImpl qui refuserait, et le client qui ne l'appelle pas
  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, "no-consent");
  assert.equal(calls.length, 0, "aucune requête ne doit être déclenchée sans consentement");
  // profil sans le champ du tout (liens CheckLink anciens) : même verdict
  const legacy = await reportEvent({ companyName: "Atelier Nova" }, "invoice_checked", { fetchImpl: refusingFetch });
  assert.equal(legacy.sent, false);
  assert.equal(legacy.reason, "no-consent");
});

test("avec consentement, un seul événement anonyme minimal part", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return { ok: true, status: 202 };
  };
  const outcome = await reportEvent(
    { companyName: "Atelier Nova", organizationId: "real-org", usageMetricsConsent: true, metricsToken: "signed" },
    "checklink_copied",
    { fetchImpl, day: "2026-10-08", visitorConsent: true }
  );
  assert.equal(outcome.sent, true);
  assert.equal(calls.length, 1);
  // corps EXACTEMENT { organizationId, action, day } : rien d'autre
  assert.deepEqual(calls[0].body, { organizationId: "real-org", action: "checklink_copied", day: "2026-10-08" });
  assert.equal(calls[0].url, "/api/v1/metrics/events");
  assert.equal(calls[0].method, "POST");
});

test("un échec d'envoi ne perturbe jamais l'expérience fournisseur", async () => {
  const outcome = await reportEvent(
    { companyName: "Atelier Nova", organizationId: "real-org", usageMetricsConsent: true, metricsToken: "signed" },
    "invoice_ready",
    { fetchImpl: async () => { throw new Error("réseau coupé"); }, visitorConsent: true }
  );
  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, "unreachable");
});
