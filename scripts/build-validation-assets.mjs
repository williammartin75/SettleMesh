import { copyFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const xslt3 = resolve(root, "node_modules/xslt3/xslt3.js");
const validation = resolve(root, "web/validation");
const browserVendor = resolve(root, "web/vendor");

mkdirSync(validation, { recursive: true });
mkdirSync(browserVendor, { recursive: true });

const compile = (source, target) => {
  const result = spawnSync(process.execPath, [xslt3, `-xsl:${resolve(root, source)}`, `-export:${resolve(root, target)}`, "-nogo"], {
    cwd: root,
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status || 1);
};

compile("vendor/en16931-1.3.16/ubl/EN16931-UBL-validation.xslt", "web/validation/en16931-ubl-1.3.16.sef.json");
compile("vendor/en16931-1.3.16/cii/EN16931-CII-validation.xslt", "web/validation/en16931-cii-1.3.16.sef.json");
compile("vendor/en16931-1.3.16/ubl/PEPPOL-EN16931-UBL-3.0.21.xslt", "web/validation/peppol-ubl-3.0.21.sef.json");

copyFileSync(resolve(root, "vendor/saxonjs-2.7/SaxonJS2.rt.js"), resolve(browserVendor, "SaxonJS2.rt.js"));
copyFileSync(resolve(root, "vendor/saxonjs-2.7/LICENSE.txt"), resolve(browserVendor, "SAXONJS-LICENSE.txt"));
copyFileSync(resolve(root, "node_modules/pdfjs-dist/build/pdf.mjs"), resolve(browserVendor, "pdf.mjs"));
copyFileSync(resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.mjs"), resolve(browserVendor, "pdf.worker.mjs"));
copyFileSync(resolve(root, "node_modules/pdfjs-dist/LICENSE"), resolve(browserVendor, "PDFJS-LICENSE.txt"));

console.log("Artefacts EN 16931, Peppol et Factur-X prêts dans web/.");
const xmlVendor = resolve(browserVendor, "xmllint");
mkdirSync(xmlVendor, { recursive: true });
for (const name of ["index-browser.mjs", "xmllint-browser.mjs", "xmllint.wasm"]) copyFileSync(resolve(root, "node_modules/xmllint-wasm", name), resolve(xmlVendor, name));
copyFileSync(resolve(root, "vendor/xmllint-wasm/LICENSE.txt"), resolve(xmlVendor, "LICENSE.txt"));
