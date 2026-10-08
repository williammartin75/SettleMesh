import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApiCredential } from "../server/auth.mjs";
import { parseRegistryDocument, writeRegistryFile } from "../server/registry.mjs";

// Ajoute une clé au fichier de registre (hash uniquement) :
//   npm run registry:key -- atelier-nova admin [chemin-registre]
// La clé brute est affichée une seule fois et n'est jamais écrite dans le fichier.

const [organizationId, role = "viewer", rawPath] = process.argv.slice(2);
const registryPath = resolve(rawPath || process.env.SETTLEMESH_REGISTRY_FILE || "settlemesh-registry.json");

if (!organizationId) {
  console.error("Usage : npm run registry:key -- <organizationId> [owner|admin|viewer] [chemin-registre]");
  process.exit(1);
}

if (!["owner", "admin", "viewer"].includes(role)) {
  console.error("Le rôle doit être owner, admin ou viewer.");
  process.exit(1);
}

const keyId = `key-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 6)}`;
const requestsPerMinute = Number(process.env.SETTLEMESH_KEY_QUOTA || 60);
const { apiKey, credential } = createApiCredential({ organizationId, keyId, role, requestsPerMinute });

let existingEntries = [];
if (existsSync(registryPath)) {
  const existing = parseRegistryDocument(JSON.parse(readFileSync(registryPath, "utf8")));
  existingEntries = existing.entries.map((entry) => ({ ...entry }));
  if (existingEntries.some((entry) => entry.organizationId === organizationId && entry.requestsPerMinute !== requestsPerMinute)) {
    console.error(`Quota demandé (${requestsPerMinute}) différent du quota existant de ${organizationId}. Supprimez SETTLEMESH_KEY_QUOTA ou ajustez le registre.`);
    process.exit(1);
  }
}

writeRegistryFile(registryPath, [...existingEntries, credential]);

console.log("Clé API (affichée une seule fois, ne pas stocker) :");
console.log(apiKey);
console.log(`Entrée ajoutée : ${organizationId} / ${keyId} / rôle ${role} / quota ${requestsPerMinute} rq/min`);
console.log(`Registre mis à jour : ${registryPath}`);
