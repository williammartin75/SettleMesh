// Acquisition explicite des schémas publics ; jamais appelée pendant un contrôle de facture.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, "../web/validation/xsd");
const license = await fetch("https://raw.githubusercontent.com/noppa/xmllint-wasm/v5.3.0/COPYING");
if (!license.ok) throw new Error("Validator license unavailable");
await mkdir(resolve(root, "../../../vendor/xmllint-wasm"), { recursive: true });
await writeFile(resolve(root, "../../../vendor/xmllint-wasm/LICENSE.txt"), await license.text());
const bundles = [
  { name: "ubl-2.1", base: "https://docs.oasis-open.org/ubl/os-UBL-2.1/xsd/", roots: ["maindoc/UBL-Invoice-2.1.xsd", "maindoc/UBL-CreditNote-2.1.xsd"] },
  { name: "cii-d16b", base: "https://raw.githubusercontent.com/OpenPEPPOL/tc434-validation/master/cii/validator/uncefact/data/standard/", roots: ["CrossIndustryInvoice_100pD16B.xsd"] }
];
for (const bundle of bundles) {
  // Pin the upstream CII revision in the manifest so acquisition is auditable.
  if (bundle.name === "cii-d16b") {
    const response = await fetch("https://api.github.com/repos/OpenPEPPOL/tc434-validation/commits/master");
    if (!response.ok) throw new Error("Cannot pin CII source");
    const { sha } = await response.json();
    bundle.base = bundle.base.replace("/master/", `/${sha}/`);
  }
  const visited = new Map();
  async function acquire(path) {
    if (visited.has(path)) return;
    const url = new URL(path, bundle.base);
    if (!url.href.startsWith(bundle.base) || !path.endsWith(".xsd")) throw new Error("Schema dependency outside approved source");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Schema unavailable: ${path} (${response.status})`);
    const contents = await response.text();
    if (!contents.includes("<") || !contents.includes("schema")) throw new Error("Invalid schema response");
    visited.set(path, { path, source: url.href, sha256: createHash("sha256").update(contents).digest("hex") });
    const destination = resolve(root, bundle.name, path);
    const relativePath = relative(resolve(root, bundle.name), destination);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("Unsafe destination");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
    for (const match of contents.matchAll(/schemaLocation\s*=\s*["']([^"']+)["']/g)) {
      const child = new URL(match[1], url);
      if (!child.href.startsWith(bundle.base)) throw new Error(`External schema dependency: ${child.href}`);
      await acquire(child.href.slice(bundle.base.length));
    }
  }
  for (const path of bundle.roots) await acquire(path);
  await writeFile(resolve(root, bundle.name, "manifest.json"), JSON.stringify({ name: bundle.name, roots: bundle.roots, files: [...visited.values()] }, null, 2) + "\n");
  console.log(`${bundle.name}: ${visited.size} schemas acquired`);
}
