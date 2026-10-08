import { readFile } from "node:fs/promises";
import { validateXML } from "xmllint-wasm";
import { schemaBundle, schemaChecks } from "../web/xsd.js";
const bundles = new Map();
export async function validateServerXsd(xml, invoice) {
  const { name, main } = schemaBundle(invoice);
  if (!bundles.has(name)) bundles.set(name, (async () => {
    const base = new URL(`../web/validation/xsd/${name}/`, import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
    return Promise.all(manifest.files.map(async ({ path }) => ({ fileName: path, contents: await readFile(new URL(path, base), "utf8") })));
  })());
  const files = await bundles.get(name);
  const report = await validateXML({ xml: [{ fileName: "invoice.xml", contents: xml }], schema: [files.find((file) => file.fileName === main)], preload: files.filter((file) => file.fileName !== main), maxMemoryPages: 2048, modifyArguments: (args) => ["--nonet", ...args] });
  return { checks: schemaChecks(report, name), metadata: { xsd: name, xsdValid: report.valid } };
}
