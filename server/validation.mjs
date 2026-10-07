import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import SaxonJS from "saxon-js";
import {
  DEFAULT_PROFILE,
  appendValidationChecks,
  parseInvoiceXml,
  parseProfileBundle,
  validateInvoice
} from "../dist/core.js";
import { parseSvrl } from "../dist/svrl.js";

class StrictDomParser extends DOMParser {
  constructor() {
    super({
      onError(level, message) {
        if (level === "error" || level === "fatalError") throw new Error(message);
      }
    });
  }
}

const validationAsset = (name) => fileURLToPath(new URL(`../dist/validation/${name}`, import.meta.url));

const STYLESHEETS = Object.freeze({
  ubl: validationAsset("en16931-ubl-1.3.16.sef.json"),
  cii: validationAsset("en16931-cii-1.3.16.sef.json"),
  peppol: validationAsset("peppol-ubl-3.0.21.sef.json")
});

async function transform(xmlText, stylesheetFileName, label, prefix) {
  const output = await SaxonJS.transform({
    stylesheetFileName,
    sourceText: xmlText,
    sourceBaseURI: `urn:settlemesh:api:${prefix}`,
    destination: "serialized"
  }, "async");
  return parseSvrl(output.principalResult, label, prefix, StrictDomParser);
}

export async function validateApiInvoice(payload) {
  const xml = String(payload?.xml || "").trim();
  if (!xml) throw Object.assign(new Error("Le champ xml est obligatoire."), { statusCode: 422, code: "XML_REQUIRED" });
  if (Buffer.byteLength(xml, "utf8") > 1024 * 1024) {
    throw Object.assign(new Error("Le XML dépasse la limite de 1 Mo."), { statusCode: 413, code: "XML_TOO_LARGE" });
  }
  if (/<!DOCTYPE/i.test(xml)) {
    throw Object.assign(new Error("Les déclarations DOCTYPE ne sont pas acceptées."), { statusCode: 422, code: "UNSAFE_XML" });
  }

  let profile = DEFAULT_PROFILE;
  if (payload.profile != null) {
    try {
      profile = parseProfileBundle(payload.profile);
    } catch (error) {
      throw Object.assign(new Error(error.message), { statusCode: 422, code: "INVALID_PROFILE" });
    }
  }

  let invoice;
  try {
    invoice = parseInvoiceXml(xml, StrictDomParser);
  } catch (error) {
    throw Object.assign(new Error(error.message), { statusCode: 422, code: "INVALID_XML" });
  }

  const safeSourceName = String(payload?.source?.originalFileName || "api.xml").slice(0, 200);
  let result = validateInvoice({ ...invoice, container: "XML", originalFileName: safeSourceName }, profile);
  const reports = [];
  try {
    reports.push(await transform(xml, invoice.syntax === "UBL" ? STYLESHEETS.ubl : STYLESHEETS.cii, "EN 16931 v1.3.16", "en16931"));
    const isPeppol = invoice.syntax === "UBL" && /peppol\.eu|peppol:bis|poacc:billing/i.test(invoice.customizationId || "");
    if (isPeppol) reports.push(await transform(xml, STYLESHEETS.peppol, "Peppol BIS 3.0.21", "peppol"));
    result = appendValidationChecks(result, reports.flatMap((report) => report.checks), {
      en16931: "1.3.16",
      peppol: isPeppol ? "3.0.21" : null,
      officialFailures: reports.reduce((sum, report) => sum + report.failures, 0),
      complete: true
    });
  } catch {
    result = appendValidationChecks(result, [{
      id: "official-validator-unavailable", status: "warning", title: "Validation officielle indisponible",
      message: "Le moteur officiel n’a pas pu terminer le contrôle.",
      fix: "Relancez le contrôle ou utilisez le validateur navigateur.", field: "EN 16931"
    }], { en16931: null, peppol: null, officialFailures: null, complete: false });
  }

  return result;
}
