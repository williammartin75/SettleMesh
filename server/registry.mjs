import { readFileSync, statSync, writeFileSync, renameSync } from "node:fs";

// Registre d'organisations persistant (étape 1 du P0 multi-utilisateurs).
// Le fichier ne contient jamais de clé brute : uniquement des hashes SHA-256,
// des rôles, des quotas et des horodatages de révocation. Il sert de source
// unique de vérité locale et prépare l'adaptateur plateforme managée
// (Supabase) : même document, même validation, autre stockage.

const REGISTRY_SCHEMA = "settlemesh-registry-1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ROLES = new Set(["owner", "admin", "viewer"]);
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const DEFAULT_REQUESTS_PER_MINUTE = 60;

const registryError = (message) => Object.assign(new Error(message), { code: "INVALID_REGISTRY" });

const assertIdentifier = (value, label) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw registryError(`${label} doit contenir 2 à 64 caractères minuscules, chiffres, tirets ou underscores.`);
  }
  return normalized;
};

export function parseRegistryDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw registryError("Le registre doit être un objet.");
  }
  if (document.schema !== REGISTRY_SCHEMA) {
    throw registryError(`Le registre doit déclarer le schéma ${REGISTRY_SCHEMA}.`);
  }
  if (!Array.isArray(document.organizations) || !document.organizations.length) {
    throw registryError("Le registre doit contenir au moins une organisation.");
  }
  const seenKeyIds = new Set();
  const seenHashes = new Set();
  const entries = [];
  for (const [index, organization] of document.organizations.entries()) {
    if (!organization || typeof organization !== "object" || Array.isArray(organization)) {
      throw registryError(`L'organisation à l'index ${index} doit être un objet.`);
    }
    const organizationId = assertIdentifier(organization.organizationId, `organizationId à l'index ${index}`);
    const requestsPerMinute = Number(organization.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE);
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 10_000) {
      throw registryError(`requestsPerMinute de ${organizationId} doit être un entier entre 1 et 10000.`);
    }
    if (!Array.isArray(organization.keys) || !organization.keys.length) {
      throw registryError(`L'organisation ${organizationId} doit déclarer au moins une clé (hash uniquement).`);
    }
    for (const [keyIndex, key] of organization.keys.entries()) {
      if (!key || typeof key !== "object" || Array.isArray(key)) {
        throw registryError(`La clé ${keyIndex} de ${organizationId} doit être un objet.`);
      }
      const keyId = assertIdentifier(key.keyId, `keyId de ${organizationId}`);
      const keyHash = String(key.keyHash || "").trim().toLowerCase();
      if (!SHA256_PATTERN.test(keyHash)) {
        throw registryError(`keyHash de ${keyId} doit être un hash SHA-256 hexadécimal (jamais une clé brute).`);
      }
      if (!ROLES.has(key.role)) {
        throw registryError(`Le rôle de ${keyId} doit être owner, admin ou viewer.`);
      }
      if (key.revokedAt !== undefined && key.revokedAt !== null && !ISO_DATE_PATTERN.test(String(key.revokedAt))) {
        throw registryError(`revokedAt de ${keyId} doit être null ou un horodatage ISO.`);
      }
      if (seenKeyIds.has(keyId)) throw registryError(`Le keyId ${keyId} est dupliqué.`);
      if (seenHashes.has(keyHash)) throw registryError(`Le keyHash de ${keyId} est dupliqué.`);
      seenKeyIds.add(keyId);
      seenHashes.add(keyHash);
      entries.push(Object.freeze({
        organizationId,
        keyId,
        keyHash,
        role: key.role,
        requestsPerMinute,
        revokedAt: key.revokedAt ?? null
      }));
    }
  }
  return Object.freeze({ schema: REGISTRY_SCHEMA, entries, document });
}

export function readRegistryFile(path) {
  return parseRegistryDocument(JSON.parse(readFileSync(path, "utf8")));
}

// Relecture paresseuse : le fichier est relu uniquement quand son horodatage
// change, afin qu'une révocation prenne effet sans redémarrage du processus.
export function createFileRegistry(path) {
  let cache = null;
  let cachedMtimeMs = -1;
  const load = () => {
    const mtimeMs = statSync(path).mtimeMs;
    if (!cache || mtimeMs !== cachedMtimeMs) {
      cache = readRegistryFile(path);
      cachedMtimeMs = mtimeMs;
    }
    return cache;
  };
  return {
    credentials: () => load().entries,
    schema: () => load().schema
  };
}

export function buildRegistryDocument(entries) {
  const organizations = new Map();
  for (const entry of entries || []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw registryError("Chaque entrée du registre doit être un objet.");
    }
    const organizationId = assertIdentifier(entry.organizationId, "organizationId");
    if (!organizations.has(organizationId)) {
      organizations.set(organizationId, {
        organizationId,
        requestsPerMinute: Number(entry.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE),
        keys: []
      });
    }
    organizations.get(organizationId).keys.push({
      keyId: assertIdentifier(entry.keyId, `keyId de ${organizationId}`),
      keyHash: String(entry.keyHash || "").trim().toLowerCase(),
      role: ROLES.has(entry.role) ? entry.role : "owner",
      revokedAt: entry.revokedAt ?? null
    });
  }
  return { schema: REGISTRY_SCHEMA, organizations: [...organizations.values()] };
}

// Écriture atomique : fichier temporaire puis renommage, pour éviter un
// registre tronqué en cas d'interruption.
export function writeRegistryFile(path, entries) {
  const document = buildRegistryDocument(entries);
  parseRegistryDocument(document);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
  return document;
}
