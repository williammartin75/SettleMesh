const XML_CANDIDATES = ["factur-x.xml", "zugferd-invoice.xml", "xrechnung.xml"];
const PDFA_CONFORMANCE_LEVELS = new Set(["A", "B", "U"]);
const FACTURX_AF_RELATIONSHIPS = new Set(["Alternative", "Data", "Source", "Supplement"]);

const containerCheck = (id, status, title, message, fix = "") => ({
  id, status, title, message, fix, field: "PDF/A-3"
});

const metadataValue = (metadata, key) => {
  const value = metadata?.get?.(key);
  return value == null ? "" : String(value).trim();
};

const normalizedFileName = (value) => String(value || "").split(/[\\/]/).at(-1).trim().toLowerCase();

const decodeXml = (bytes) => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) {
    const swapped = new Uint8Array(data.length - 2);
    for (let index = 2; index + 1 < data.length; index += 2) {
      swapped[index - 2] = data[index + 1];
      swapped[index - 1] = data[index];
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder("utf-8").decode(data);
};

const looksLikeInvoiceXml = (text) => /<(?:\w+:)?CrossIndustryInvoice\b|<(?:\w+:)?Invoice\b|<(?:\w+:)?CreditNote\b/i.test(text);

export function inspectFacturXContainer(pdfBytes, metadata, attachmentName) {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const rawPdf = new TextDecoder("latin1").decode(bytes);
  const declaredPart = metadataValue(metadata, "pdfaid:part");
  const declaredConformance = metadataValue(metadata, "pdfaid:conformance").toUpperCase();
  const documentFileName = metadataValue(metadata, "fx:documentfilename");
  const documentType = metadataValue(metadata, "fx:documenttype").toUpperCase();
  const version = metadataValue(metadata, "fx:version");
  const conformanceLevel = metadataValue(metadata, "fx:conformancelevel");
  const pdfVersion = rawPdf.match(/%PDF-(\d\.\d)/)?.[1] || "";
  const relationships = [...rawPdf.matchAll(/\/AFRelationship\s*\/([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]);
  const supportedRelationship = relationships.find((value) => FACTURX_AF_RELATIONSHIPS.has(value)) || "";
  const hasCatalogAssociation = /\/AF\s*(?:\[|\d+\s+\d+\s+R)/.test(rawPdf);
  const checks = [];

  checks.push(declaredPart === "3" && PDFA_CONFORMANCE_LEVELS.has(declaredConformance)
    ? containerCheck("facturx-pdfa-declaration", "pass", `Conteneur déclaré PDF/A-3${declaredConformance}`, `Métadonnées XMP pdfaid:part=3 · PDF ${pdfVersion || "version non lue"}.`)
    : containerCheck(
      "facturx-pdfa-declaration",
      "error",
      "Déclaration PDF/A-3 absente ou incohérente",
      declaredPart ? `Le document déclare PDF/A-${declaredPart}${declaredConformance || ""}, pas un niveau PDF/A-3 reconnu.` : "Les métadonnées XMP ne déclarent pas pdfaid:part=3 avec un niveau A, B ou U.",
      "Réexportez la facture en PDF/A-3 depuis un générateur Factur-X compatible."
    ));

  const attachmentMatchesMetadata = normalizedFileName(documentFileName) === normalizedFileName(attachmentName);
  checks.push(documentFileName && attachmentMatchesMetadata
    ? containerCheck("facturx-xmp-filename", "pass", "Nom du XML cohérent avec les métadonnées", `${documentFileName} est déclaré dans XMP et présent dans le conteneur.`)
    : containerCheck(
      "facturx-xmp-filename",
      "error",
      "Nom du XML incohérent dans les métadonnées",
      documentFileName ? `XMP annonce « ${documentFileName} » mais la pièce extraite est « ${attachmentName} ».` : "La propriété XMP fx:DocumentFileName est absente.",
      "Alignez fx:DocumentFileName sur le nom exact du XML embarqué."
    ));

  checks.push(documentType === "INVOICE" && version && conformanceLevel
    ? containerCheck("facturx-xmp-profile", "pass", `Profil Factur-X déclaré : ${conformanceLevel}`, `Type ${documentType} · version ${version}.`)
    : containerCheck(
      "facturx-xmp-profile",
      "error",
      "Métadonnées Factur-X incomplètes",
      "Le type INVOICE, la version ou le niveau de conformité Factur-X manque dans XMP.",
      "Ajoutez les propriétés fx:DocumentType, fx:Version et fx:ConformanceLevel attendues."
    ));

  checks.push(hasCatalogAssociation && supportedRelationship
    ? containerCheck("facturx-associated-file", "pass", "XML associé au document PDF", `Association catalogue /AF et relation /${supportedRelationship} détectées.`)
    : relationships.length && !supportedRelationship
      ? containerCheck("facturx-associated-file", "error", "Relation de pièce jointe Factur-X invalide", `Relation trouvée : /${relationships.join(", /")}.`, "Déclarez le XML comme fichier associé au catalogue avec une relation Factur-X compatible.")
      : containerCheck("facturx-associated-file", "warning", "Association PDF du XML non confirmée", "Le navigateur a extrait le XML, mais n’a pas pu confirmer les marqueurs /AF et /AFRelationship dans les objets PDF lisibles.", "Contrôlez le fichier avec veraPDF avant son archivage ou son envoi."));

  checks.push(containerCheck(
    "facturx-pdfa-scope",
    "info",
    "Précontrôle PDF/A-3 local, pas certification ISO",
    "SettleMesh vérifie la déclaration XMP et la structure hybride visible. Les polices, couleurs, profils ICC, actions et règles ISO 19005-3 complètes ne sont pas évalués ; pour une preuve exhaustive, utilisez veraPDF avec le profil 3 correspondant."
  ));

  return {
    schema: "settlemesh-facturx-preflight",
    version: 1,
    pdfVersion,
    declaredPart: declaredPart || null,
    declaredConformance: declaredConformance || null,
    documentFileName: documentFileName || null,
    documentType: documentType || null,
    facturXVersion: version || null,
    conformanceLevel: conformanceLevel || null,
    associatedFileRelationship: supportedRelationship || relationships[0] || null,
    scope: "structural-preflight",
    checks
  };
}

export async function extractFacturXXml(file, pdfjsModule = null) {
  const pdfjs = pdfjsModule || await import("./vendor/pdf.mjs");
  if (!pdfjsModule) pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).href;

  const pdfBytes = new Uint8Array(await file.arrayBuffer());

  const loadingTask = pdfjs.getDocument({
    data: pdfBytes.slice(),
    isEvalSupported: false,
    useWorkerFetch: false
  });

  let document;
  try {
    document = await loadingTask.promise;
    const attachments = await document.getAttachments();
    const entries = attachments instanceof Map
      ? [...attachments.entries()]
      : Object.entries(attachments || {});
    if (!entries.length) throw new Error("Ce PDF ne contient aucun XML embarqué. Il ne semble pas être une facture Factur-X.");

    const ranked = entries.sort(([leftName], [rightName]) => {
      const rank = (name) => {
        const normalized = name.toLowerCase();
        const index = XML_CANDIDATES.indexOf(normalized);
        return index === -1 ? 99 : index;
      };
      return rank(leftName) - rank(rightName);
    });

    for (const [name, attachment] of ranked) {
      if (!/\.xml$/i.test(name) && !/xml/i.test(attachment?.filename || "")) continue;
      const content = attachment?.content || await document.getAttachmentContent(name);
      if (!content) continue;
      const xmlText = decodeXml(content).replace(/^\uFEFF/, "").trim();
      if (looksLikeInvoiceXml(xmlText)) {
        const attachmentName = attachment.filename || name;
        const metadata = await document.getMetadata().catch(() => null);
        const containerPreflight = inspectFacturXContainer(pdfBytes, metadata?.metadata, attachmentName);
        return {
          xmlText,
          attachmentName,
          container: "FACTUR-X",
          containerPreflight,
          containerChecks: containerPreflight.checks
        };
      }
    }

    throw new Error("Le PDF contient des pièces jointes, mais aucun XML de facture UBL/CII exploitable.");
  } catch (error) {
    if (error?.message?.includes("PDF")) throw error;
    throw new Error(`Factur-X non lisible : ${error?.message || "extraction impossible"}.`);
  } finally {
    await loadingTask.destroy();
  }
}
