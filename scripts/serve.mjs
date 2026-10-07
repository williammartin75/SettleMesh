import { createSettleMeshServer, listen } from "../server/server.mjs";

const server = createSettleMeshServer();
const address = await listen(server);
console.log(`SettleMesh et son API v1 sont disponibles sur http://${address.address}:${address.port}`);
