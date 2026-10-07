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
  assert.equal(extracted.containerPreflight.declaredPart, "3");
  assert.equal(extracted.containerPreflight.declaredConformance, "B");
  assert.equal(extracted.containerPreflight.scope, "structural-preflight");
  assert.equal(extracted.containerChecks.filter((item) => item.status === "error").length, 0);
  assert.ok(extracted.containerChecks.some((item) => item.id === "facturx-associated-file" && item.status === "pass"));
  assert.ok(extracted.containerChecks.some((item) => item.id === "facturx-pdfa-scope" && item.status === "info"));
  assert.match(extracted.xmlText, /CrossIndustryInvoice/);

  const svrl = await transform(extracted.xmlText, "../web/validation/en16931-cii-1.3.16.sef.json", "factur-x");
  assert.equal((svrl.match(FAILED_ASSERT) || []).length, 0);
});

const replaceAscii = (bytes, search, replacement) => {
  assert.equal(search.length, replacement.length);
  const source = Buffer.from(bytes);
  const offset = source.indexOf(Buffer.from(search, "ascii"));
  assert.notEqual(offset, -1, `Marqueur PDF absent : ${search}`);
  Buffer.from(replacement, "ascii").copy(source, offset);
  return source;
};

const asPdfFile = (bytes) => ({
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
});

test("bloque un Factur-X qui ne déclare pas PDF/A-3", async () => {
  const original = await readFile(new URL("./fixtures/facturx-en16931.pdf", import.meta.url));
  const altered = replaceAscii(original, "<pdfaid:part>3", "<pdfaid:part>2");
  const extracted = await extractFacturXXml(asPdfFile(altered), pdfjs);
  const declaration = extracted.containerChecks.find((item) => item.id === "facturx-pdfa-declaration");
  assert.equal(declaration.status, "error");
  assert.match(declaration.title, /PDF\/A-3/);
});

test("bloque une relation de fichier associé Factur-X invalide", async () => {
  const original = await readFile(new URL("./fixtures/facturx-en16931.pdf", import.meta.url));
  const altered = replaceAscii(original, "/AFRelationship /Data", "/AFRelationship /None");
  const extracted = await extractFacturXXml(asPdfFile(altered), pdfjs);
  const association = extracted.containerChecks.find((item) => item.id === "facturx-associated-file");
  assert.equal(association.status, "error");
  assert.match(association.message, /None/);
});

test("bloque un nom de XML différent de celui déclaré dans XMP", async () => {
  const original = await readFile(new URL("./fixtures/facturx-en16931.pdf", import.meta.url));
  const altered = replaceAscii(original, "<fx:DocumentFileName>factur-x.xml", "<fx:DocumentFileName>factur-y.xml");
  const extracted = await extractFacturXXml(asPdfFile(altered), pdfjs);
  const filename = extracted.containerChecks.find((item) => item.id === "facturx-xmp-filename");
  assert.equal(filename.status, "error");
  assert.match(filename.message, /factur-y\.xml/);
});
