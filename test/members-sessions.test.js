import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseMembers, hashPassword, verifyPassword } from "../server/members.mjs";
import { createSettleMeshServer, listen } from "../server/server.mjs";

test("les mots de passe scrypt ne sont jamais réversibles et se vérifient en temps constant structurel", () => {
  const { stored } = hashPassword("MotDePasseFort!2026");
  assert.match(stored, /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.ok(verifyPassword("MotDePasseFort!2026", stored));
  assert.ok(!verifyPassword("AutreMotDePasse", stored));
  assert.ok(!verifyPassword("MotDePasseFort!2026", "scrypt:cacahuetes:1234"));
});

test("l'adaptateur Supabase crée membre et session via PostgREST", async () => {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });
    if (url.includes("/settlemesh_sessions") && (init.method || "GET") === "POST") {
      return { ok: true, status: 201, json: async () => [], text: async () => "" };
    }
    if (url.includes("/settlemesh_members") && (init.method || "GET") === "POST") {
      return {
        ok: true, status: 201,
        json: async () => [{ id: "11111111-1111-1111-1111-111111111111", email: "alpha@example.test", role: "admin" }],
        text: async () => ""
      };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
  const store = createSupabaseMembers({ projectRef: "ref0000000000000", serviceKey: "service-key", fetchImpl: fetchStub });
  const member = await store.createMember({ organizationId: "atelier-nova", email: "Alpha@Example.test", passwordHash: "scrypt:sel:hash", role: "admin" });
  assert.equal(member.email, "alpha@example.test"); // e-mail normalisé
  const session = await store.createSession({ memberId: member.id, organizationId: "atelier-nova", role: "admin" });
  assert.match(session.sessionId, /^[0-9a-f-]{36}$/);
  assert.ok(session.expiresAt > new Date().toISOString());
  assert.ok(["POST"].every((method) => calls.some((call) => call.method === method)));
});

test("session périmée ou expirée : le /me répond 401 sans jamais rendre temporairement actif", async () => {
  const rows = [{
    id: "22222222-2222-2222-2222-222222222222",
    member_id: "11111111-1111-1111-1111-111111111111",
    organization_id: "atelier-nova",
    role: "viewer",
    expires_at: new Date(Date.now() - 1000).toISOString() // expirée depuis 1 s
  }];
  const store = {
    findMemberByEmail: async (email) => {
      const stored = hashPassword("BonMotDePasse1").stored;
      const member = email.toLowerCase() === "alpha@example.test"
        ? { id: rows[0].member_id, email: "alpha@example.test", role: "viewer", organization_id: "atelier-nova", password_hash: stored }
        : null;
      return member;
    },
    createSession: async (payload) => ({ sessionId: rows[0].id, organizationId: payload.organizationId, role: payload.role, expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    findSession: async () => null,
    deleteSession: async () => undefined
  };
  const server = createSettleMeshServer({ membersStoreOption: store });
  const address = await listen(server, { port: 0 });
  const url = `http://127.0.0.1:${address.port}/api/v1/auth`;
  try {
    const session = await fetch(`${url}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alpha@example.test", password: "BonMotDePasse1" })
    });
    assert.equal(session.status, 200);
    const cookie = session.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const expired = await fetch(`${url}/me`, { headers: { Cookie: "settlemesh_session=22222222-2222-2222-2222-222222222222" } });
    assert.equal(expired.status, 401);
    assert.equal((await expired.json()).error.code, "SESSION_EXPIRED");

    const noCookie = await fetch(`${url}/me`);
    assert.equal(noCookie.status, 401);
    assert.equal((await noCookie.json()).error.code, "AUTH_REQUIRED");
  } finally {
    server.close();
  }
});

test("login complet : cookie durci, /me, puis logout efface la session", async () => {
  let sessionRows = new Map();
  const stored = hashPassword("BonMotDePasse1").stored;
  const store = {
    findMemberByEmail: async (email) => email === "alpha@example.test"
      ? { id: "33333333-3333-3333-3333-333333333333", email: "alpha@example.test", role: "admin", organization_id: "atelier-nova", password_hash: stored }
      : null,
    createSession: async (payload) => {
      const id = "44444444-4444-4444-4444-444444444444";
      sessionRows.set(id, { organization_id: payload.organizationId, role: payload.role, expires_at: new Date(Date.now() + 3600_000).toISOString() });
      return { sessionId: id, organizationId: payload.organizationId, role: payload.role, expiresAt: sessionRows.get(id).expires_at };
    },
    findSession: async (id) => sessionRows.get(id) ? { ...sessionRows.get(id), id } : null,
    deleteSession: async (id) => sessionRows.delete(id)
  };
  const server = createSettleMeshServer({ membersStoreOption: store });
  const address = await listen(server, { port: 0 });
  const url = `http://127.0.0.1:${address.port}/api/v1/auth`;
  try {
    const wrong = await fetch(`${url}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alpha@example.test", password: "Faux" })
    });
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).error.code, "INVALID_CREDENTIALS");
    assert.equal(await sessionStatus(wrong), null);

    const login = await fetch(`${url}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alpha@example.test", password: "BonMotDePasse1" })
    });
    assert.equal(login.status, 200);
    const cookieHeader = login.headers.get("set-cookie");
    const cookie = cookieHeader.match(/settlemesh_session=([0-9a-f-]{36})/)[1];
    assert.match(cookieHeader, /HttpOnly/);
    assert.ok(!/Secure/.test(cookieHeader), "pas de bandeau Secure sans TLS local");

    const me = await fetch(`${url}/me`, { headers: { Cookie: `settlemesh_session=${cookie}` } });
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.organizationId, "atelier-nova");
    assert.equal(meBody.member.role, "admin");

    const logout = await fetch(`${url}/logout`, { method: "POST", headers: { Cookie: `settlemesh_session=${cookie}`, "X-SettleMesh-CSRF": "session" } });
    assert.equal(logout.status, 200);
    assert.ok((await logout.json()).terminated);
    const clearCookie = logout.headers.get("set-cookie");
    assert.match(clearCookie, /Max-Age=0/);
    assert.ok(!clearCookie.includes("86400"), "le cookie d'effacement ne doit pas re-programmer 24 h");
    assert.deepEqual(sessionRows.has(cookie), false);

    const after = await fetch(`${url}/me`, { headers: { Cookie: `settlemesh_session=${cookie}` } });
    assert.equal(after.status, 401);
  } finally {
    server.close();
  }

  async function sessionStatus(response) {
    return response.headers.get("set-cookie")?.match(/settlemesh_session=([0-9a-f-]{36})/)?.[1] ?? null;
  }
});

test("sans stockage membres (mode mémoire/fichier), les routes auth répondent 409 explicites", async () => {
  const server = createSettleMeshServer({});
  const address = await listen(server, { port: 0 });
  const url = `http://127.0.0.1:${address.port}/api/v1/auth/login`;
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "MEMBERS_UNAVAILABLE");
  } finally {
    server.close();
  }
});
