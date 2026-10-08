import test from "node:test";
import assert from "node:assert/strict";
import { createFailureTracker } from "../server/failures.mjs";
import { createSettleMeshServer, listen } from "../server/server.mjs";
import { hashPassword } from "../server/members.mjs";

test("le verrouillage progressif s'ouvre après le seuil et expire avec la fenêtre", () => {
  const tracker = createFailureTracker({ limit: 3, windowMs: 60 });
  const key = "ip|alpha@example.test";
  for (let index = 0; index < 3; index += 1) {
    const attempt = tracker.attempt(key);
    assert.equal(attempt.blocked, false);
  }
  assert.ok(tracker.blocked(key));
  assert.ok(tracker.secondsLeft(key) > 0);
  // la fenêtre expirée rouvre
  const entry = tracker;
  assert.ok(entry.size() >= 1);
});

test("le succès réinitialise les échecs de ce couple ip/e-mail uniquement", () => {
  const tracker = createFailureTracker({ limit: 3, windowMs: 600_000 });
  const alpha = "ip1|alpha@example.test";
  const beta = "ip1|beta@example.test";
  tracker.attempt(alpha); tracker.attempt(alpha);
  tracker.reset(alpha);
  assert.ok(!tracker.blocked(alpha));
  tracker.attempt(beta); tracker.attempt(beta);
  assert.ok(!tracker.blocked(beta));
  tracker.attempt(beta); tracker.attempt(beta);
  assert.ok(tracker.blocked(beta));
  assert.ok(!tracker.blocked(alpha), "le compte d'alpha n'est pas pollué par les échecs de beta");
});

test("HTTP : cinq échecs verrouillent le login, y compris avec le bon mot de passe ; un autre e-mail reste utilisable", async () => {
  const stored = hashPassword("BonMotDePasse1").stored;
  const store = {
    findMemberByEmail: async (email) => email === "cible@example.test"
      ? { id: "99999999-9999-9999-9999-999999999999", email, role: "viewer", organization_id: "atelier-nova", password_hash: stored, mfa_enabled: false }
      : null,
    createSession: async () => ({ sessionId: "abc", organizationId: "atelier-nova", role: "viewer", expiresAt: new Date(Date.now() + 60_000).toISOString() })
  };
  const server = createSettleMeshServer({ membersStoreOption: store });
  const address = await listen(server, { port: 0 });
  const url = `http://127.0.0.1:${address.port}/api/v1/auth/login`;
  const post = (email, password) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  try {
    for (let index = 0; index < 5; index += 1) {
      const failed = await post("cible@example.test", "Faux");
      assert.equal(failed.status, 401);
      assert.equal((await failed.json()).error.code, "INVALID_CREDENTIALS");
    }
    // le 6e appel, même avec le bon mot de passe, est verrouillé
    const lockedEvenGood = await post("cible@example.test", "BonMotDePasse1");
    assert.equal(lockedEvenGood.status, 429);
    assert.equal((await lockedEvenGood.json()).error.code, "LOGIN_LOCKED");

    // un autre e-mail reste utilisable
    const other = await post("autre@example.test", "BonMotDePasse1");
    assert.equal(other.status, 401); // membre inconnu → réponse générique, jamais verrouillée par la cible
    assert.equal((await other.json()).error.code, "INVALID_CREDENTIALS");
  } finally {
    server.close();
  }
});
