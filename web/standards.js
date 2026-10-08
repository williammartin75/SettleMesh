import { parseSvrl } from "./svrl.js";
import { validateBrowserXsd } from "./xsd.js";

let saxonPromise;

function loadSaxon() {
  if (globalThis.SaxonJS) return Promise.resolve(globalThis.SaxonJS);
  if (saxonPromise) return saxonPromise;
  saxonPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("./vendor/SaxonJS2.rt.js", import.meta.url).href;
    script.async = true;
    script.addEventListener("load", () => globalThis.SaxonJS ? resolve(globalThis.SaxonJS) : reject(new Error("SaxonJS ne s’est pas initialisé.")));
    script.addEventListener("error", () => reject(new Error("Le moteur de validation n’a pas pu être chargé.")));
    document.head.append(script);
  });
  return saxonPromise;
}

async function transform(xmlText, stylesheet, label, prefix) {
  const SaxonJS = await loadSaxon();
  const sourceBaseURI = new URL(`./validation-input-${prefix}.xml`, import.meta.url).href;
  const output = await SaxonJS.transform({
    stylesheetLocation: new URL(stylesheet, import.meta.url).href,
    sourceText: xmlText,
    sourceBaseURI,
    destination: "serialized"
  }, "async");
  return parseSvrl(output.principalResult, label, prefix);
}

export async function validateEuropeanStandard(xmlText, invoice) {
  const structural = await validateBrowserXsd(xmlText, invoice);
  if (!structural.metadata.xsdValid) return { checks: structural.checks, metadata: { ...structural.metadata, en16931: null, peppol: null, officialFailures: null, complete: false } };
  const enStylesheet = invoice.syntax === "UBL"
    ? "./validation/en16931-ubl-1.3.16.sef.json"
    : "./validation/en16931-cii-1.3.16.sef.json";
  const reports = [];
  reports.push(await transform(xmlText, enStylesheet, "EN 16931 v1.3.16", "en16931"));

  const isPeppol = invoice.syntax === "UBL" && /peppol\.eu|peppol:bis|poacc:billing/i.test(invoice.customizationId || "");
  if (isPeppol) {
    reports.push(await transform(xmlText, "./validation/peppol-ubl-3.0.21.sef.json", "Peppol BIS 3.0.21", "peppol"));
  }

  return {
    checks: [...structural.checks, ...reports.flatMap((report) => report.checks)],
    metadata: {
      ...structural.metadata,
      complete: true,
      firedRules: reports.reduce((sum, report) => sum + report.firedRules, 0),
      en16931: "1.3.16",
      peppol: isPeppol ? "3.0.21" : null,
      officialFailures: reports.reduce((sum, report) => sum + report.failures, 0)
    }
  };
}
