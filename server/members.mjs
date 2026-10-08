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

  return {
    async findMemberByEmail(email) {
      const response = await request(`/settlemesh_members?email=eq.${encodeURIComponent(String(email).toLowerCase())}&select=id,organization_id,email,password_hash,role`);
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
