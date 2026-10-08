import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "web");
const worker = resolve(root, "worker");
const output = resolve(root, "dist");

if (basename(output) !== "dist" || !output.startsWith(`${root}\\`) && !output.startsWith(`${root}/`)) {
  throw new Error(`Refus de nettoyer un répertoire de sortie inattendu : ${output}`);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, "client"), { recursive: true });
mkdirSync(resolve(output, "server"), { recursive: true });
mkdirSync(resolve(output, ".openai"), { recursive: true });
cpSync(source, resolve(output, "client"), { recursive: true });
cpSync(worker, resolve(output, "server"), { recursive: true });
cpSync(resolve(root, ".openai/hosting.json"), resolve(output, ".openai/hosting.json"));

writeFileSync(resolve(output, "server/wrangler.json"), `${JSON.stringify({
  main: "index.js",
  compatibility_date: "2026-10-01",
  assets: { directory: "../client", binding: "ASSETS", not_found_handling: "single-page-application" }
}, null, 2)}\n`);

JSON.parse(readFileSync(resolve(output, ".openai/hosting.json"), "utf8"));
console.log("Artefact Worker prêt dans dist/ (identité, registre d'exigences, mesure consentie + assets web). ");
