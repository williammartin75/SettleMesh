const bundles = new Map();
export function schemaBundle(invoice) {
  return invoice.syntax === "UBL"
    ? { name: "ubl-2.1", main: `maindoc/UBL-${invoice.documentType === "Avoir" ? "CreditNote" : "Invoice"}-2.1.xsd` }
    : { name: "cii-d16b", main: "CrossIndustryInvoice_100pD16B.xsd" };
}
export function schemaChecks(report, name) {
  if (report.valid) return [{ id: "xsd-valid", status: "pass", title: `Structure XSD ${name} validée`, message: "Éléments, ordre, cardinalités, attributs et types contrôlés par libxml2 en local.", fix: "", field: "XSD" }];
  const errors = report.errors.length ? report.errors : [{ message: "La structure ne respecte pas le schéma sélectionné." }];
  return errors.slice(0, 24).map((error, index) => ({ id: `xsd-${index}`, status: "error", title: `Structure XSD ${name} invalide`, message: String(error.message).slice(0, 1600), fix: "Corrigez la structure dans le logiciel émetteur. Un profil CII plus récent peut nécessiter un schéma non encore pris en charge.", field: error.loc?.lineNumber ? `XSD · ligne ${error.loc.lineNumber}` : "XSD" }));
}
export async function validateBrowserXsd(xml, invoice) {
  const { name, main } = schemaBundle(invoice);
  if (!bundles.has(name)) bundles.set(name, (async () => {
    const base = new URL(`./validation/xsd/${name}/`, import.meta.url);
    const response = await fetch(new URL("manifest.json", base));
    if (!response.ok) throw new Error("Schémas XSD indisponibles.");
    const manifest = await response.json();
    return Promise.all(manifest.files.map(async ({ path }) => {
      const response = await fetch(new URL(path, base));
      if (!response.ok) throw new Error("Dépendance XSD indisponible.");
      return { fileName: path, contents: await response.text() };
    }));
  })().catch((error) => { bundles.delete(name); throw error; }));
  const files = await bundles.get(name);
  const { validateXML } = await import("./vendor/xmllint/index-browser.mjs");
  const report = await validateXML({ xml: [{ fileName: "invoice.xml", contents: xml }], schema: [files.find((file) => file.fileName === main)], preload: files.filter((file) => file.fileName !== main), maxMemoryPages: 2048, modifyArguments: (args) => ["--nonet", ...args] });
  return { checks: schemaChecks(report, name), metadata: { xsd: name, xsdValid: report.valid } };
}
