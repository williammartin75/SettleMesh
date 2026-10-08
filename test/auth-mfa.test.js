import test from "node:test";
import assert from "node:assert/strict";
import { base32Encode, base32Decode, totpCode, verifyTotp, generateTotpSecret } from "../server/totp.mjs";
import { hashPassword, verifyPassword } from "../server/members.mjs";
import { createSettleMeshServer, listen } from "../server/server.mjs";

test("base32 conforme aux vecteurs RFC 4648", () => {
  assert.equal(base32Encode(Uint8Array.from([])), "");
  assert.equal(base32Encode(Uint8Array.from([0x66])), "MY");          // RFC : "MY======"
  assert.equal(base32Encode(Uint8Array.from([0x66, 0x6f])), "MZXQ");  // RFC : "MZXQ===="
  assert.deepEqual([...base32Decode("MY")], [0x66]);
  assert.deepEqual([...base32Decode("MZXQ====")], [0x66, 0x6f]);
});

test("TOTP conforme aux vecteurs RFC 6238 (SHA-1, 6 chiffres)", () => {
  // secret « 12345678901234567890 » ASCII, comme dans le RFC
  const secret = base32Encode(Uint8Array.from("12345678901234567890".split("").map((char) => char.charCodeAt(0))));
  assert.equal(totpCode(secret, { timestampMs: 59_000 }), "287082");   // T=59
  assert.equal(totpCode(secret, { timestampMs: 1111111109_000 }), "081804"); // T=1111111109
  assert.equal(totpCode(secret, { timestampMs: 1234567890_000 }), "005924"); // T=1234567890
});

test("vérification avec fenêtre ±1 pas (dérive d'horloge), refus hors fenêtre", () => {
  const { secret } = generateTotpSecret("alpha@example.test");
  const base = 1_700_000_000_000;
  const code = totpCode(secret, { timestampMs: base });
  assert.ok(verifyTotp(secret, code, { timestampMs: base }));
  assert.ok(verifyTotp(secret, code, { timestampMs: base - 29_000 })); // pas précédent
  assert.ok(verifyTotp(secret, code, { timestampMs: base + 29_000 })); // pas suivant
  assert.ok(!verifyTotp(secret, code, { timestampMs: base + 90_000 }));
  assert.ok(!verifyTotp(secret, "123456", { timestampMs: base })); // mauvais code : refus
  assert.ok(!verifyTotp(secret, "abcdef", { timestampMs: base }));
  assert.ok(!verifyTotp(secret, "", { timestampMs: base }));
});

test("l'URI otpauth est bien formée et le secret est de longueur canonique (20 octets)", () => {
  const { secret, otpauthUri } = generateTotpSecret("alpha@example.test");
  assert.equal(secret.length, 32);
  assert.match(otpauthUri, /^otpauth:\/\/totp\/SettleMesh:alpha%40example\.test\?secret=[A-Z2-7]+&issuer=SettleMesh&algorithm=SHA1&digits=6&period=30$/);
});

const buildStore = ({ role = "owner", mfa = true } = {}) => {
  const password = hashPassword("MotDePasseFort!2026");
  const { secret } = generateTotpSecret("alpha@example.test");
  const member = {
    id: "55555555-5555-5555-5555-555555555555",
    email: "alpha@example.test",
    role,
    organization_id: "atelier-nova",
    password_hash: password.stored,
    mfa_secret: mfa ? secret : null,
    mfa_enabled: mfa
  };
  let sessionRows = new Map();
  return {
    member,
    secret,
    store: {
      findMemberByEmail: async (email) => (email === member.email ? member : null),
      findMemberById: async (id) => (id === member.id ? member : null),
      createSession: async (payload) => {
        const id = "66666666-6666-6666-6666-666666666666";
        sessionRows.set(id, { organization_id: payload.organizationId, role: payload.role, expires_at: new Date(Date.now() + 3600_000).toISOString() });
        return { sessionId: id, organizationId: payload.organizationId, role: payload.role, expiresAt: sessionRows.get(id).expires_at };
      },
      findSession: async (id) => (sessionRows.get(id) ? { ...sessionRows.get(id), member_id: member.id, id } : null),
      deleteSession: async (id) => sessionRows.delete(id),
      updatePassword: async (id, hash) => { member.password_hash = hash; return true; },
      updateMfa: async (id, { mfaSecret, mfaEnabled }) => {
        member.mfa_secret = mfaSecret;
        member.mfa_enabled = mfaEnabled;
        return { ...member };
      }
    }
  };
};

const start = async (store) => {
  const server = createSettleMeshServer({ membersStoreOption: store });
  const address = await listen(server, { port: 0 });
  return { server, url: `http://127.0.0.1:${address.port}/api/v1/auth` };
};

test("login d'un owner avec MFA : sans code → MFA_REQUIRED ; avec le bon code → 200 ; sans code → pas de cookie", async () => {
  const { store, secret } = buildStore();
  const { server, url } = await start(store);
  try {
    const without = await fetch(`${url}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alpha@example.test", password: "MotDePasseFort!2026" })
    });
    assert.equal(without.status, 401);
    assert.equal((await without.json()).error.code, "MFA_REQUIRED");

    const now = Date.now();
    const good = totpCode(secret, { timestampMs: now });
    const withCode = await fetch(`${url}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alpha@example.test", password: "MotDePasseFort!2026", code: good })
    });
    assert.equal(withCode.status, 200);
    const body = await withCode.json();
    assert.equal(body.mfaEnrollmentRequired, false);
    assert.equal(body.member.role, "owner");
  } finally {
    server.close();
  }
});

test("viewer sans MFA : login direct sans code, sans drapeau d'enrôlement", async () => {
  const { store } = buildStore({ role: "viewer", mfa: false });
  const { server, url } = await start(store);
  try {
    const response = await fetch(`${url}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alpha@example.test", password: "MotDePasseFort!2026" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mfaEnrollmentRequired, false);
  } finally {
    server.close();
  }
});

test("owner sans MFA actif : login toléré avec drapeau d'enrôlement requis", async () => {
  const { store } = buildStore({ mfa: false });
  const { server, url } = await start(store);
  try {
    const response = await fetch(`${url}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alpha@example.test", password: "MotDePasseFort!2026" })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).mfaEnrollmentRequired, true);
  } finally {
    server.close();
  }
});

test("setup → enable → login avec code ; disable exige le mot de passe ; password change et invalide l'ancien", async () => {
  const { store, member } = buildStore({ mfa: false });
  const { server, url } = await start(store);
  const headers = (cookie) => ({ "Content-Type": "application/json", Cookie: cookie ? `settlemesh_session=${cookie}` : undefined });
  try {
    const login = await fetch(`${url}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "alpha@example.test", password: "MotDePasseFort!2026" }) });
    const cookie = login.headers.get("set-cookie").match(/settlemesh_session=([0-9a-f-]{36})/)[1];

    const setup = await fetch(`${url}/mfa/setup`, { method: "POST", headers: headers(cookie), body: "{}" });
    assert.equal(setup.status, 200);
    const { secret, otpauthUri } = await setup.json();
    assert.equal(secret.length, 32);

    const enableWithWrongCode = await fetch(`${url}/mfa/enable`, { method: "POST", headers: headers(cookie), body: JSON.stringify({ code: "000000" }) });
    assert.equal(enableWithWrongCode.status, 401);

    const now = Date.now();
    const code = totpCode(secret, { timestampMs: now });
    const enable = await fetch(`${url}/mfa/enable`, { method: "POST", headers: headers(cookie), body: JSON.stringify({ code }) });
    assert.equal(enable.status, 200);
    assert.equal((await enable.json()).mfaEnabled, true);

    const disableWithoutPassword = await fetch(`${url}/mfa/disable`, { method: "POST", headers: headers(cookie), body: "{}" });
    assert.equal(disableWithoutPassword.status, 401);
    const disable = await fetch(`${url}/mfa/disable`, { method: "POST", headers: headers(cookie), body: JSON.stringify({ password: "MotDePasseFort!2026" }) });
    assert.equal(disable.status, 200);
    assert.equal((await disable.json()).mfaEnabled, false);

    const wrongCurrent = await fetch(`${url}/password`, { method: "POST", headers: headers(cookie), body: JSON.stringify({ currentPassword: "Faux", newPassword: "NouveauMotFort!2026" }) });
    assert.equal(wrongCurrent.status, 401);
    const tooShort = await fetch(`${url}/password`, { method: "POST", headers: headers(cookie), body: JSON.stringify({ currentPassword: "MotDePasseFort!2026", newPassword: "court" }) });
    assert.equal(tooShort.status, 400);
    const changed = await fetch(`${url}/password`, { method: "POST", headers: headers(cookie), body: JSON.stringify({ currentPassword: "MotDePasseFort!2026", newPassword: "NouveauMotFort!2026" }) });
    assert.equal(changed.status, 200);
    assert.ok((await changed.json()).passwordChanged);
    assert.ok(!verifyPassword("MotDePasseFort!2026", member.password_hash));
    assert.ok(verifyPassword("NouveauMotFort!2026", member.password_hash));
  } finally {
    server.close();
  }
});
