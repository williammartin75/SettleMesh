import { createApiCredential } from "./auth.mjs";

// Administration des clés, pure logique HTTP-indépendante pour rester
// testable : le serveur fournit l'authentification, les entrées du
// registre et la fonction d'écriture (fichier ou Supabase). Toute
// mutation réécrit le document complet, lequel est revalidé par les
// règles du registre (hashes et keyId uniques, rôle coûteux).

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const ROLES = new Set(["owner", "admin", "viewer"]);
const ADMIN_ROLES = new Set(["owner", "admin"]);

const failure = (code, message, status) => ({ failure: { code, message, status } });

const requireRole = (credential, allowedRoles) => {
  if (!allowedRoles.has(credential.role)) {
    return failure("FORBIDDEN_ROLE", `Cette opération exige le rôle ${[...allowedRoles].join(" ou ")}.`, 403);
  }
  return null;
};

const publicKeys = (entries) => entries.map((entry) => ({
  keyId: entry.keyId,
  role: entry.role,
  requestsPerMinute: entry.requestsPerMinute,
  revokedAt: entry.revokedAt
}));

const respondKeys = (organizationId, requestId, entries) => ({
  status: 200,
  body: {
    schema: "settlemesh-admin-keys",
    apiVersion: "v1",
    requestId,
    organizationId,
    keys: publicKeys(entries)
  }
});

export async function handleAdminRequest({ method, segments, body, credential, loadEntries, writeEntries, requestId, now = () => new Date().toISOString() }) {
  const roleError = requireRole(credential, ADMIN_ROLES);
  if (roleError) return roleError;

  const [resource, keyId] = segments || [];
  const allEntries = await loadEntries();
  const own = allEntries.filter((entry) => entry.organizationId === credential.organizationId);
  const others = allEntries.filter((entry) => entry.organizationId !== credential.organizationId);
  const applyMutation = async (updatedOwn) => {
    await writeEntries([...others, ...updatedOwn]);
    return updatedOwn;
  };

  if (resource === "keys") {
    if (method === "GET") {
      return respondKeys(credential.organizationId, requestId, own);
    }

    if (method === "POST") {
      const requestedRole = body?.role || "viewer";
      if (!ROLES.has(requestedRole)) {
        return failure("INVALID_ADMIN_PAYLOAD", "Le rôle demandé doit être owner, admin ou viewer.", 400);
      }
      if (requestedRole === "owner" && credential.role !== "owner") {
        return failure("FORBIDDEN_ROLE", "Seul un owner peut créer une clé owner.", 403);
      }
      const keyId = body?.keyId
        ? String(body.keyId).trim().toLowerCase()
        : `${requestedRole}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      if (!KEY_ID_PATTERN.test(keyId)) {
        return failure("INVALID_ADMIN_PAYLOAD", "keyId doit contenir 2 à 64 caractères minuscules, chiffres, tirets ou underscores.", 400);
      }
      if (allEntries.some((entry) => entry.keyId === keyId)) {
        return failure("KEY_ID_UNAVAILABLE", `Le keyId ${keyId} est déjà pris dans le registre.`, 409);
      }
      const created = createApiCredential({
        organizationId: credential.organizationId,
        keyId,
        role: requestedRole,
        requestsPerMinute: own[0]?.requestsPerMinute ?? 60
      });
      const updatedOwn = await applyMutation([...own, { ...created.credential, revokedAt: null }]);
      return {
        status: 201,
        body: {
          schema: "settlemesh-admin-keys", apiVersion: "v1", requestId,
          organizationId: credential.organizationId,
          apiKey: created.apiKey,
          notice: "Clé brute affichée une seule fois. Ne jamais la stocker : seul son hash est conservé dans le registre.",
          keys: publicKeys(updatedOwn)
        }
      };
    }

    if (method === "PATCH" && keyId) {
      const target = own.find((entry) => entry.keyId === keyId);
      if (!target) return failure("KEY_NOT_FOUND", `Clé ${keyId} inconnue dans cette organisation.`, 404);
      const updatedOwnPartial = { ...target };
      if (body?.role !== undefined) {
        if (credential.role !== "owner") return failure("FORBIDDEN_ROLE", "Seul un owner peut changer le rôle d'une clé.", 403);
        if (!ROLES.has(body.role)) return failure("INVALID_ADMIN_PAYLOAD", "Le rôle doit être owner, admin ou viewer.", 400);
        updatedOwnPartial.role = body.role;
      }
      if (body?.revokedAt !== undefined) {
        if (body.revokedAt === null) {
          updatedOwnPartial.revokedAt = null;
        } else if (ISO_DATE_PATTERN.test(String(body.revokedAt))) {
          updatedOwnPartial.revokedAt = String(body.revokedAt);
        } else {
          return failure("INVALID_ADMIN_PAYLOAD", "revokedAt doit être null ou un horodatage ISO.", 400);
        }
      }
      if (updatedOwnPartial.role === target.role && updatedOwnPartial.revokedAt === target.revokedAt) {
        return failure("INVALID_ADMIN_PAYLOAD", "Le corps PATCH doit contenir `role` ou `revokedAt` avec une valeur différente.", 400);
      }
      const updatedOwn = await applyMutation(own.map((entry) => (entry.keyId === keyId ? updatedOwnPartial : entry)));
      return respondKeys(credential.organizationId, requestId, updatedOwn);
    }

    if (method === "DELETE" && keyId) {
      const target = own.find((entry) => entry.keyId === keyId);
      if (!target) return failure("KEY_NOT_FOUND", `Clé ${keyId} inconnue dans cette organisation.`, 404);
      if (target.revokedAt) {
        return failure("INVALID_ADMIN_PAYLOAD", "Cette clé est déjà révoquée.", 400);
      }
      const updatedOwn = await applyMutation(own.map((entry) => (entry.keyId === keyId ? { ...entry, revokedAt: new Date(now()).toISOString() } : entry)));
      return respondKeys(credential.organizationId, requestId, updatedOwn);
    }

    return failure("UNKNOWN_ADMIN_ROUTE", "Route d'administration inconnue.", 404);
  }

  if (resource === "organization") {
    if (method !== "PATCH") return failure("UNKNOWN_ADMIN_ROUTE", "Utilisez PATCH /api/v1/admin/organization.", 404);
    if (credential.role !== "owner") return failure("FORBIDDEN_ROLE", "Seul un owner peut modifier le quota de l'organisation.", 403);
    const requestsPerMinute = Number(body?.requestsPerMinute);
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 10_000) {
      return failure("INVALID_ADMIN_PAYLOAD", "requestsPerMinute doit être un entier entre 1 et 10000.", 400);
    }
    const updatedOwn = await applyMutation(own.map((entry) => ({ ...entry, requestsPerMinute })));
    return respondKeys(credential.organizationId, requestId, updatedOwn);
  }

  return failure("UNKNOWN_ADMIN_ROUTE", "Route d'administration inconnue.", 404);
}
