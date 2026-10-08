import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_REQUESTS_PER_MINUTE = 60;

const configurationError = (message) => Object.assign(new Error(message), { code: "INVALID_API_KEY_CONFIGURATION" });

const assertIdentifier = (value, label) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw configurationError(`${label} doit contenir 2 à 64 caractères minuscules, chiffres, tirets ou underscores.`);
  }
  return normalized;
};

export function hashApiKey(apiKey) {
  return createHash("sha256").update(String(apiKey || ""), "utf8").digest("hex");
}

export function createApiCredential({ organizationId, keyId, role = "owner", requestsPerMinute = DEFAULT_REQUESTS_PER_MINUTE } = {}) {
  const ROLES = new Set(["owner", "admin", "viewer"]);
  if (!ROLES.has(role)) throw configurationError("Le rôle doit être owner, admin ou viewer.");
  const normalizedOrganizationId = assertIdentifier(organizationId, "organizationId");
  const normalizedKeyId = assertIdentifier(keyId, "keyId");
  const limit = Number(requestsPerMinute);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw configurationError("requestsPerMinute doit être un entier entre 1 et 10000.");
  }
  const apiKey = `sm_live_${randomBytes(32).toString("base64url")}`;
  return {
    apiKey,
    credential: {
      organizationId: normalizedOrganizationId,
      keyId: normalizedKeyId,
      keyHash: hashApiKey(apiKey),
      role,
      requestsPerMinute: limit
    }
  };
}

export function parseApiKeyConfiguration(raw = process.env.SETTLEMESH_API_KEYS || "") {
  const serialized = String(raw || "").trim();
  if (!serialized) return Object.freeze([]);

  let entries;
  try {
    entries = JSON.parse(serialized);
  } catch {
    throw configurationError("SETTLEMESH_API_KEYS doit contenir un tableau JSON valide.");
  }
  if (!Array.isArray(entries)) throw configurationError("SETTLEMESH_API_KEYS doit être un tableau JSON.");

  const seenKeyIds = new Set();
  const seenHashes = new Set();
  const organizationLimits = new Map();
  const credentials = entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw configurationError(`La clé API à l’index ${index} doit être un objet.`);
    }
    const organizationId = assertIdentifier(entry.organizationId, `organizationId à l’index ${index}`);
    const keyId = assertIdentifier(entry.keyId, `keyId à l’index ${index}`);
    const keyHash = String(entry.keyHash || "").trim().toLowerCase();
    if (!SHA256_PATTERN.test(keyHash)) {
      throw configurationError(`keyHash à l’index ${index} doit être un hash SHA-256 hexadécimal.`);
    }
    const requestsPerMinute = Number(entry.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE);
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 10_000) {
      throw configurationError(`requestsPerMinute à l’index ${index} doit être un entier entre 1 et 10000.`);
    }
    if (seenKeyIds.has(keyId)) throw configurationError(`Le keyId ${keyId} est dupliqué.`);
    if (seenHashes.has(keyHash)) throw configurationError(`Le keyHash de ${keyId} est dupliqué.`);
    if (organizationLimits.has(organizationId) && organizationLimits.get(organizationId) !== requestsPerMinute) {
      throw configurationError(`Toutes les clés de ${organizationId} doivent partager le même quota.`);
    }
    seenKeyIds.add(keyId);
    seenHashes.add(keyHash);
    organizationLimits.set(organizationId, requestsPerMinute);
    return Object.freeze({ organizationId, keyId, keyHash, role: "owner", requestsPerMinute, revokedAt: null });
  });
  return Object.freeze(credentials);
}

export function authenticateApiKey(authorizationHeader, credentials) {
  if (!credentials.length) {
    return {
      ok: false,
      statusCode: 503,
      code: "AUTH_NOT_CONFIGURED",
      message: "L’authentification de l’API n’est pas configurée."
    };
  }

  const match = /^Bearer\s+([^\s]+)$/i.exec(String(authorizationHeader || "").trim());
  if (!match) {
    return {
      ok: false,
      statusCode: 401,
      code: "AUTH_REQUIRED",
      message: "Ajoutez une clé API dans l’en-tête Authorization: Bearer."
    };
  }
  const apiKey = match[1];
  if (apiKey.length < 20 || apiKey.length > 256) {
    return { ok: false, statusCode: 401, code: "INVALID_API_KEY", message: "La clé API est invalide." };
  }

  const candidate = Buffer.from(hashApiKey(apiKey), "hex");
  let authenticated = null;
  for (const credential of credentials) {
    const expected = Buffer.from(credential.keyHash, "hex");
    if (timingSafeEqual(candidate, expected)) authenticated = credential;
  }
  if (!authenticated) {
    return { ok: false, statusCode: 401, code: "INVALID_API_KEY", message: "La clé API est invalide." };
  }
  if (authenticated.revokedAt) {
    return { ok: false, statusCode: 401, code: "API_KEY_REVOKED", message: "La clé API a été révoquée." };
  }
  return {
    ok: true,
    credential: {
      organizationId: authenticated.organizationId,
      keyId: authenticated.keyId,
      role: authenticated.role || "owner",
      requestsPerMinute: authenticated.requestsPerMinute
    }
  };
}
