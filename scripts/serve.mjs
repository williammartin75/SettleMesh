import { createSettleMeshServer, listen } from "../server/server.mjs";
import { parseApiKeyConfiguration } from "../server/auth.mjs";

const apiKeys = parseApiKeyConfiguration();
const server = createSettleMeshServer({ apiKeys });
const address = await listen(server);
console.log(`SettleMesh et son API v1 sont disponibles sur http://${address.address}:${address.port}`);
console.log(apiKeys.length
  ? `Authentification API active (${new Set(apiKeys.map((entry) => entry.organizationId)).size} organisation(s) configurée(s)).`
  : "Validation API verrouillée : générez une clé avec npm run api:key puis configurez SETTLEMESH_API_KEYS.");
