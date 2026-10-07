import { createApiCredential } from "../server/auth.mjs";

const organizationId = process.argv[2];
const dateSuffix = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const keyId = process.argv[3] || `${String(organizationId || "organization").slice(0, 54)}-${dateSuffix}`;

try {
  const generated = createApiCredential({ organizationId, keyId });
  console.log("Clé API SettleMesh créée. Elle ne sera plus affichée :");
  console.log(generated.apiKey);
  console.log("\nAjoutez cet objet à SETTLEMESH_API_KEYS (seul le hash est configuré côté serveur) :");
  console.log(JSON.stringify(generated.credential));
} catch (error) {
  console.error(`Usage : npm run api:key -- <organization-id> [key-id]\n${error.message}`);
  process.exitCode = 1;
}
