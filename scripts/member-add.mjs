import { createSupabaseMembers, hashPassword } from "../server/members.mjs";
import { randomBytes } from "node:crypto";

// Ajoute un membre humain au stockage managé ; imprime une fois un mot de
// passe fort généré. Aucun secret n'est écrit dans le dépôt :
//   npm run member:add -- <organizationId> <email> [owner|admin|viewer]

const [organizationId, email, role = "viewer"] = process.argv.slice(2);
if (!organizationId || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage : npm run member:add -- <organizationId> <email> [owner|admin|viewer]");
  process.exit(1);
}
if (!["owner", "admin", "viewer"].includes(role)) {
  console.error("Le rôle doit être owner, admin ou viewer.");
  process.exit(1);
}
const projectRef = process.env.SETTLEMESH_SUPABASE_PROJECT_REF;
const serviceKey = process.env.SETTLEMESH_SUPABASE_SERVICE_KEY;
if (!projectRef || !serviceKey) {
  console.error("SETTLEMESH_SUPABASE_PROJECT_REF et SETTLEMESH_SUPABASE_SERVICE_KEY sont requis (variables d'environnement, jamais dans le dépôt).");
  process.exit(1);
}

const store = createSupabaseMembers({ projectRef, serviceKey });
const password = randomBytes(24).toString("base64url");
const { stored } = hashPassword(password);
const member = await store.createMember({ organizationId, email, passwordHash: stored, role });

console.log(`Membre créé : ${member?.email ?? email} (${role} de ${organizationId}).`);
console.log("Mot de passe (affiché une seule fois, à remettre au membre via un canal privé) :");
console.log(password);
console.log("Stocké : scrypt avec sel aléatoire. Jamais de mot de passe en clair dans le dépôt.");
