import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// Membres et sessions (étape 2b-1). Les mots de passe ne sont jamais
// stockés en clair : scrypt + sel aléatoire, comparaison en temps
// constant. Les sessions sont côté serveur (table managée), identifiées
// par un UUID aléatoire porté par un cookie HttpOnly. Aucune dépendance
// nouvelle : fetch natif vers PostgREST.

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash: derived, stored: `scrypt:${salt}:${derived}` };
}

export function verifyPassword(password, stored) {
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(String(stored || ""));
  if (!match) return false;
  const candidate = scryptSync(String(password), match[1], 64);
  const expected = Buffer.from(match[2], "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const memberUnavailable = (detail) => Object.assign(
  new Error(`Stocker des membres est momentanément indisponible : ${detail}`),
  { statusCode: 503, code: "MEMBERS_UNAVAILABLE" }
);

export function createSupabaseMembers({ projectRef, serviceKey, fetchImpl = globalThis.fetch } = {}) {
  if (!projectRef || !serviceKey) {
    throw memberUnavailable("SETTLEMESH_SUPABASE_PROJECT_REF et SETTLEMESH_SUPABASE_SERVICE_KEY sont requis.");
  }
  const base = `https://${projectRef}.supabase.co/rest/v1`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json" };
  let mfaColumnsSupported = true; // détecté à la première lecture ; ALTER SQL absent → MFA indisponible explicitement
  let probed = false;
  const request = async (url, init = {}) => {
    let response;
    try {
      response = await fetchImpl(`${base}${url}`, { ...init, headers: { ...headers, ...init.headers } });
    } catch (error) {
      throw memberUnavailable(error?.message || "requête impossible");
    }
    if (!response.ok) {
      // 200 avec [] = aucune ligne ; tout 404/5xx = stockage indisponible ou mal configuré,
      // jamais interprété comme « membre inconnu ».
      throw memberUnavailable(`réponse ${response.status}`);
    }
    return response;
  };
  const memberSelect = () => (mfaColumnsSupported
    ? "id,organization_id,email,password_hash,role,mfa_secret,mfa_enabled"
    : "id,organization_id,email,password_hash,role");

  // Détection de capacité à la première requête : colonnes MFA absentes
  // (ALTER SQL non exécuté) → le store continue de servir le login mais le
  // MFA reste explicitement indisponible ; jamais maquillé en succès.
  const probeMfaColumns = async () => {
    probed = true;
    const probeUrl = `${base}/settlemesh_members?select=${encodeURIComponent("id,organization_id,email,password_hash,role,mfa_secret,mfa_enabled")}&limit=1`;
    let response;
    try {
      response = await fetchImpl(probeUrl, { headers });
    } catch (error) {
      throw memberUnavailable(error?.message || "requête impossible");
    }
    if (response.ok) {
      mfaColumnsSupported = true;
      return;
    }
    if (response.status === 404) throw memberUnavailable("table settlemesh_members introuvable");
    mfaColumnsSupported = false; // colonnes MFA absentes : exécuter l'ALTER SQL documenté
  };

  return {
    async mfaCapability() {
      if (!probed) await probeMfaColumns();
      return mfaColumnsSupported;
    },
    async findMemberByEmail(email) {
      if (!probed) await probeMfaColumns();
      const response = await request(`/settlemesh_members?email=eq.${encodeURIComponent(String(email).toLowerCase())}&select=${memberSelect()}`);
      const rows = await response.json();
      if (!rows.length) return null;
      return rows[0];
    },
    async findMemberById(memberId) {
      if (!/^[0-9a-f-]{36}$/i.test(String(memberId || ""))) return null;
      if (!probed) await probeMfaColumns();
      const response = await request(`/settlemesh_members?id=eq.${memberId}&select=${memberSelect()}`);
      const rows = await response.json();
      return rows.length ? rows[0] : null;
    },
    async createMember({ organizationId, email, passwordHash, role }) {
      const response = await request("/settlemesh_members", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ organization_id: organizationId, email: String(email).toLowerCase(), password_hash: passwordHash, role })
      });
      const rows = await response.json();
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async updatePassword(memberId, passwordHash) {
      const response = await request(`/settlemesh_members?id=eq.${memberId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ password_hash: passwordHash })
      });
      if (!response.ok) throw memberUnavailable(`réponse ${response.status} lors du changement de mot de passe`);
      return true;
    },
    async updateMfa(memberId, { mfaSecret, mfaEnabled }) {
      const response = await request(`/settlemesh_members?id=eq.${memberId}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ mfa_secret: mfaSecret, mfa_enabled: mfaEnabled })
      });
      const rows = await response.json();
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    async createSession({ memberId, organizationId, role }) {
      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const response = await request("/settlemesh_sessions", {
        method: "POST",
        body: JSON.stringify({ id: sessionId, member_id: memberId, organization_id: organizationId, role, expires_at: expiresAt })
      });
      if (!response.ok && response.status !== 201) throw memberUnavailable("session non créée");
      return { sessionId, organizationId, role, expiresAt };
    },
    async findSession(sessionId) {
      if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ""))) return null;
      const response = await request(`/settlemesh_sessions?id=eq.${sessionId}&select=*`);
      const rows = await response.json();
      if (!rows.length) return null;
      const row = rows[0];
      if (new Date(row.expires_at).getTime() <= Date.now()) return null; // périmée
      return row;
    },
    async deleteSession(sessionId) {
      await request(`/settlemesh_sessions?id=eq.${sessionId}`, { method: "DELETE" });
    }
  };
}
