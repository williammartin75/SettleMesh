import test from "node:test";
import assert from "node:assert/strict";
import { searchRequirements, publishRequirements, unpublishRequirements, verifyRequirements } from "../web/requirements.js";

test("le client des exigences utilise uniquement les routes SettleMesh de même origine", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, headers: options.headers });
    return { ok: true, status: 200, json: async () => ({ schema: "settlemesh-requirements", results: [] }) };
  };
  await searchRequirements("Atelier Nova", { fetchImpl });
  await publishRequirements({ companyName: "Atelier Nova" }, { published: true, fetchImpl });
  await unpublishRequirements({ fetchImpl });
  await verifyRequirements({ companyName: "Atelier Nova" }, { fetchImpl });

  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    "GET /api/v1/requirements?q=Atelier%20Nova",
    "POST /api/v1/requirements",
    "DELETE /api/v1/requirements",
    "POST /api/v1/requirements/verify"
  ]);
  // l'en-tête CSRF personnalise toute mutation de session et ne peut pas être forgé entre sites
  assert.equal(calls[1].headers["X-SettleMesh-CSRF"], "session");
  assert.equal(calls[2].headers["X-SettleMesh-CSRF"], "session");
  assert.ok(!calls[0].headers["X-SettleMesh-CSRF"]);
  assert.ok(!calls[3].headers["X-SettleMesh-CSRF"]);
  assert.deepEqual(calls[1].body, { profile: { companyName: "Atelier Nova" }, published: true });
  assert.ok(calls.some((call) => call.url.startsWith("/api/v1/")) && calls.every((call) => !call.url.startsWith("http")));
});
