import { existsSync } from "node:fs";
import { readRegistryFile } from "../server/registry.mjs";
import { createSupabaseRegistry } from "../server/registry-supabase.mjs";

// Migration / synchronisation : pousse un fichier de registre local vers
// Supabase (une ligne, upsert atomique). La clé service_role provient de
// l'environnement et n'est jamais écrite dans le dépôt :
//   npm run registry:push -- [chemin-registre-local]

const localPath = process.argv[2] || "settlemesh-registry.json";
const projectRef = process.env.SETTLEMESH_SUPABASE_PROJECT_REF;
const serviceKey = process.env.SETTLEMESH_SUPABASE_SERVICE_KEY;

if (!projectRef || !serviceKey) {
  console.error("SETTLEMESH_SUPABASE_PROJECT_REF et SETTLEMESH_SUPABASE_SERVICE_KEY sont requis (variables d'environnement utilisateur, jamais dans le dépôt).");
  process.exit(1);
}
if (!existsSync(localPath)) {
  console.error(`Fichier de registre introuvable : ${localPath}`);
  process.exit(1);
}

const document = readRegistryFile(localPath);
const registry = createSupabaseRegistry({ projectRef, serviceKey });
const written = await registry.write(document.entries);

const revokedCount = written.organizations
  .flatMap((organization) => organization.keys)
  .filter((key) => key.revokedAt).length;
const keyCount = written.organizations
  .flatMap((organization) => organization.keys).length;

console.log(`Registre poussé vers Supabase (${projectRef}) :`);
console.log(`  ${written.organizations.length} organisation(s), ${keyCount} clé(s), ${revokedCount} révoquée(s)`);
console.log("La clé service_role reste dans l'environnement ; aucun secret écrit dans le fichier poussé ou le dépôt.");
