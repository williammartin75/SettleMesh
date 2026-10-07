const SVRL_NS = "http://purl.oclc.org/dsdl/svrl";
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

const normalizeMessage = (value) => String(value || "").replace(/\s+/g, " ").trim();

function parseSvrl(serialized, label, prefix) {
  const report = new DOMParser().parseFromString(String(serialized || ""), "application/xml");
  if (report.querySelector("parsererror")) throw new Error(`Le rapport ${label} est illisible.`);
  const failures = [...report.getElementsByTagNameNS(SVRL_NS, "failed-assert")];
  const checks = failures.slice(0, 24).map((failure, index) => {
    const reference = failure.getAttribute("id") || `${prefix}-${index + 1}`;
    const flag = `${failure.getAttribute("flag") || ""} ${failure.getAttribute("role") || ""}`.toLowerCase();
    const warning = flag.includes("warning") || flag.includes("warn");
    const message = normalizeMessage(failure.getElementsByTagNameNS(SVRL_NS, "text")[0]?.textContent) || "Une règle officielle n’est pas respectée.";
    return {
      id: `${prefix}-${reference}-${index}`,
      status: warning ? "warning" : "error",
      title: `${label} · ${reference}`,
      message,
      fix: "Corrigez le champ concerné dans le logiciel émetteur, puis relancez le contrôle.",
      field: reference
    };
  });

  if (failures.length > checks.length) {
    checks.push({
      id: `${prefix}-more`, status: "error", title: `${failures.length - checks.length} autres règles non respectées`,
      message: "Le rapport est volontairement condensé pour rester lisible.",
      fix: "Téléchargez le rapport SettleMesh ou corrigez les premières anomalies avant de relancer le contrôle.", field: label
    });
  }

  if (!checks.length) {
    checks.push({
      id: `${prefix}-valid`, status: "pass", title: `${label} validé`,
      message: "Aucune assertion bloquante n’a été trouvée par l’artefact officiel.", fix: "", field: label
    });
  }
  return { failures: failures.length, checks };
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
    checks: reports.flatMap((report) => report.checks),
    metadata: {
      en16931: "1.3.16",
      peppol: isPeppol ? "3.0.21" : null,
      officialFailures: reports.reduce((sum, report) => sum + report.failures, 0)
    }
  };
}
