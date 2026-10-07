import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import SaxonJS from "saxon-js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createDemoXml, DEFAULT_PROFILE } from "../web/core.js";
import { extractFacturXXml } from "../web/facturx.js";

const FAILED_ASSERT = /<svrl:failed-assert\b/g;

async function transform(xml, stylesheet, name) {
  const result = await SaxonJS.transform({
    stylesheetFileName: new URL(stylesheet, import.meta.url).pathname.replace(/^\/(.:)/, "$1"),
    sourceText: xml,
    sourceBaseURI: `file:///${name}.xml`,
    destination: "serialized"
  }, "async");
  return result.principalResult;
}

test("l’exemple UBL passe les règles officielles EN 16931 et Peppol", async () => {
  const xml = createDemoXml({ valid: true, profile: DEFAULT_PROFILE });
  const en16931 = await transform(xml, "../web/validation/en16931-ubl-1.3.16.sef.json", "demo-ubl");
  const peppol = await transform(xml, "../web/validation/peppol-ubl-3.0.21.sef.json", "demo-peppol");
  assert.equal((en16931.match(FAILED_ASSERT) || []).length, 0);
  assert.equal((peppol.match(FAILED_ASSERT) || []).length, 0);
});

test("les règles officielles détectent un total TTC erroné", async () => {
  const xml = createDemoXml({ valid: true, profile: DEFAULT_PROFILE })
    .replace(">1440.00</cbc:TaxInclusiveAmount>", ">1540.00</cbc:TaxInclusiveAmount>");
  const svrl = await transform(xml, "../web/validation/en16931-ubl-1.3.16.sef.json", "invalid-total");
  assert.match(svrl, /BR-CO-15/);
});

test("extrait et valide le CII embarqué dans un vrai PDF Factur-X", async () => {
  const bytes = await readFile(new URL("./fixtures/facturx-en16931.pdf", import.meta.url));
  const file = { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const extracted = await extractFacturXXml(file, pdfjs);
  assert.equal(extracted.container, "FACTUR-X");
  assert.equal(extracted.attachmentName.toLowerCase(), "factur-x.xml");
  assert.match(extracted.xmlText, /CrossIndustryInvoice/);

  const svrl = await transform(extracted.xmlText, "../web/validation/en16931-cii-1.3.16.sef.json", "factur-x");
  assert.equal((svrl.match(FAILED_ASSERT) || []).length, 0);
});
