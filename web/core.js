import { nationalChecks } from "./rules/index.mjs";

export const DEFAULT_PROFILE = Object.freeze({
  companyName: "Atelier Nova",
  legalName: "Atelier Nova SAS",
  country: "FR",
  vatId: "FR11123456782",
  peppolId: "0009:123456782",
  routingProvider: "Plateforme agréée de démonstration",
  acceptedFormats: ["UBL", "CII", "FACTUR-X"],
  acceptedCurrencies: ["EUR"],
  requirePurchaseOrder: true,
  requireBuyerReference: false,
  requireEndpoint: true,
  requireAttachment: false,
  submissionEmail: "factures@atelier-nova.example",
  instructions: "Ajoutez le numéro de commande communiqué par votre contact dans le champ BT-13."
});

const field = (scope, localName) => {
  if (!scope) return "";
  const nodes = scope.getElementsByTagNameNS?.("*", localName) || [];
  return nodes[0]?.textContent?.trim() || "";
};

const node = (scope, localName) => {
  if (!scope) return null;
  return (scope.getElementsByTagNameNS?.("*", localName) || [])[0] || null;
};

const directField = (scope, localName) => {
  if (!scope) return "";
  return [...(scope.childNodes || [])].find((child) => child.nodeType === 1 && child.localName === localName)?.textContent?.trim() || "";
};

const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const cleanId = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const textEncoder = new TextEncoder();
let resultSequence = 0;
const electronicAddress = (scope, localName) => {
  const element = node(scope, localName);
  const value = element?.textContent?.trim() || "";
  const scheme = element?.getAttribute?.("schemeID")?.trim() || "";
  return value && scheme && !value.startsWith(`${scheme}:`) ? `${scheme}:${value}` : value;
};

export function profileSlug(name) {
  return String(name || "entreprise")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "entreprise";
}

export function profileCompleteness(profile) {
  const required = [profile.companyName, profile.legalName, profile.country, profile.vatId,
    profile.acceptedFormats?.length, profile.acceptedCurrencies?.length, profile.instructions];
  return Math.round((required.filter(Boolean).length / required.length) * 100);
}

export function encodeProfile(profile) {
  const compact = {
    n: profile.companyName, l: profile.legalName, c: profile.country, v: profile.vatId,
    p: profile.peppolId, r: profile.routingProvider, f: profile.acceptedFormats,
    u: profile.acceptedCurrencies, po: Boolean(profile.requirePurchaseOrder),
    br: Boolean(profile.requireBuyerReference), ep: Boolean(profile.requireEndpoint),
    at: Boolean(profile.requireAttachment), e: profile.submissionEmail, i: profile.instructions
  };
  const bytes = textEncoder.encode(JSON.stringify(compact));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeProfile(value) {
  try {
    const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return {
      companyName: data.n || "Entreprise", legalName: data.l || data.n || "Entreprise",
      country: data.c || "FR", vatId: data.v || "", peppolId: data.p || "",
      routingProvider: data.r || "", acceptedFormats: Array.isArray(data.f) ? data.f : ["UBL"],
      acceptedCurrencies: Array.isArray(data.u) ? data.u : ["EUR"],
      requirePurchaseOrder: Boolean(data.po), requireBuyerReference: Boolean(data.br),
      requireEndpoint: Boolean(data.ep), requireAttachment: Boolean(data.at),
      submissionEmail: data.e || "", instructions: data.i || ""
    };
  } catch {
    return null;
  }
}

const PROFILE_BUNDLE_SCHEMA = "settlemesh-checklink-profile";
const LEGACY_PROFILE_BUNDLE_SCHEMAS = new Set(["eurule-checklink-profile"]);
const SUPPORTED_FORMATS = ["UBL", "CII", "FACTUR-X"];

export function createProfileBundle(profile) {
  const normalized = decodeProfile(encodeProfile(profile));
  return {
    schema: PROFILE_BUNDLE_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: normalized
  };
}

export function parseProfileBundle(value) {
  let payload;
  try {
    payload = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("Le fichier de profil n’est pas un JSON valide.");
  }
  if (!payload || typeof payload !== "object") throw new Error("Le profil importé est vide.");
  if (payload.schema && payload.schema !== PROFILE_BUNDLE_SCHEMA && !LEGACY_PROFILE_BUNDLE_SCHEMAS.has(payload.schema)) throw new Error("Ce fichier n’est pas un profil SettleMesh compatible.");
  const source = payload.profile && typeof payload.profile === "object" ? payload.profile : payload;
  const companyName = String(source.companyName || "").trim();
  const legalName = String(source.legalName || "").trim();
  const vatId = String(source.vatId || "").trim().toUpperCase();
  const acceptedFormats = [...new Set((Array.isArray(source.acceptedFormats) ? source.acceptedFormats : [])
    .map((item) => String(item).trim().toUpperCase()).filter((item) => SUPPORTED_FORMATS.includes(item)))];
  const acceptedCurrencies = [...new Set((Array.isArray(source.acceptedCurrencies) ? source.acceptedCurrencies : [])
    .map((item) => String(item).trim().toUpperCase()).filter((item) => /^[A-Z]{3}$/.test(item)))];
  if (!companyName || !legalName || !vatId) throw new Error("Le nom, la raison sociale et le numéro de TVA sont obligatoires.");
  if (!acceptedFormats.length) throw new Error("Le profil doit accepter au moins un format pris en charge.");
  if (!acceptedCurrencies.length) throw new Error("Le profil doit contenir au moins une devise ISO à trois lettres.");
  return {
    companyName,
    legalName,
    country: String(source.country || "FR").trim().toUpperCase().slice(0, 2),
    vatId,
    peppolId: String(source.peppolId || "").trim(),
    routingProvider: String(source.routingProvider || "").trim(),
    acceptedFormats,
    acceptedCurrencies,
    requirePurchaseOrder: source.requirePurchaseOrder === true,
    requireBuyerReference: source.requireBuyerReference === true,
    requireEndpoint: source.requireEndpoint === true,
    requireAttachment: source.requireAttachment === true,
    submissionEmail: String(source.submissionEmail || "").trim(),
    instructions: String(source.instructions || "").trim()
  };
}

export function createCheckLink(profile, locationLike = globalThis.location) {
  const origin = locationLike?.origin || "https://settlemesh.example";
  const pathname = locationLike?.pathname || "/";
  return `${origin}${pathname}#check/${profileSlug(profile.companyName)}/${encodeProfile(profile)}`;
}

export function parseInvoiceXml(xmlText, Parser = globalThis.DOMParser) {
  const raw = String(xmlText || "").trim();
  if (!raw) throw new Error("Le fichier est vide.");
  if (/<!DOCTYPE/i.test(raw)) throw new Error("Les déclarations DOCTYPE ne sont pas acceptées.");
  if (typeof Parser !== "function") throw new Error("Le parseur XML est indisponible dans cet environnement.");
  const document = new Parser().parseFromString(raw, "application/xml");
  const parserErrors = document.getElementsByTagNameNS?.("*", "parsererror") || [];
  if (parserErrors.length) throw new Error("Le XML n’est pas lisible. Vérifiez que le fichier n’est pas tronqué.");
  const root = document.documentElement;
  const rootName = root.localName;
  const isUbl = rootName === "Invoice" || rootName === "CreditNote";
  const isCii = rootName === "CrossIndustryInvoice";
  if (!isUbl && !isCii) throw new Error(`Format XML non reconnu (${rootName || "racine inconnue"}).`);

  if (isUbl) {
    const supplier = node(root, "AccountingSupplierParty");
    const buyer = node(root, "AccountingCustomerParty");
    const order = node(root, "OrderReference");
    return {
      syntax: "UBL", documentType: rootName === "CreditNote" ? "Avoir" : "Facture",
      customizationId: directField(root, "CustomizationID"), profileId: directField(root, "ProfileID"),
      documentTypeCode: directField(root, rootName === "CreditNote" ? "CreditNoteTypeCode" : "InvoiceTypeCode"),
      invoiceNumber: directField(root, "ID"), issueDate: directField(root, "IssueDate"),
      currency: directField(root, "DocumentCurrencyCode"), buyerReference: directField(root, "BuyerReference"),
      purchaseOrder: directField(order, "ID"),
      supplierName: field(node(supplier, "PartyLegalEntity"), "RegistrationName") || field(node(supplier, "PartyName"), "Name"),
      supplierVat: field(node(supplier, "PartyTaxScheme"), "CompanyID"), supplierEndpoint: electronicAddress(supplier, "EndpointID"),
      buyerName: field(node(buyer, "PartyLegalEntity"), "RegistrationName") || field(node(buyer, "PartyName"), "Name"),
      buyerVat: field(node(buyer, "PartyTaxScheme"), "CompanyID"), buyerEndpoint: electronicAddress(buyer, "EndpointID"),
      lineTotal: number(directField(node(root, "LegalMonetaryTotal"), "LineExtensionAmount")),
      taxExclusive: number(directField(node(root, "LegalMonetaryTotal"), "TaxExclusiveAmount")),
      taxAmount: number(directField(node(root, "TaxTotal"), "TaxAmount")),
      taxInclusive: number(directField(node(root, "LegalMonetaryTotal"), "TaxInclusiveAmount")),
      payableAmount: number(directField(node(root, "LegalMonetaryTotal"), "PayableAmount")),
      lineCount: root.getElementsByTagNameNS("*", rootName === "CreditNote" ? "CreditNoteLine" : "InvoiceLine").length,
      sourceSize: textEncoder.encode(raw).length, raw
    };
  }

  const header = node(root, "ExchangedDocument");
  const context = node(root, "ExchangedDocumentContext");
  const transaction = node(root, "SupplyChainTradeTransaction");
  const agreement = node(transaction, "ApplicableHeaderTradeAgreement");
  const settlement = node(transaction, "ApplicableHeaderTradeSettlement");
  const supplier = node(agreement, "SellerTradeParty");
  const buyer = node(agreement, "BuyerTradeParty");
  const totals = node(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
  const taxRegistration = (party) => [...(party?.getElementsByTagNameNS("*", "SpecifiedTaxRegistration") || [])]
    .map((registration) => field(registration, "ID")).find(Boolean) || "";
  return {
    syntax: "CII", documentType: "Facture", invoiceNumber: directField(header, "ID"),
    customizationId: field(node(context, "GuidelineSpecifiedDocumentContextParameter"), "ID"),
    profileId: field(node(context, "BusinessProcessSpecifiedDocumentContextParameter"), "ID"),
    documentTypeCode: directField(header, "TypeCode"),
    issueDate: field(node(header, "IssueDateTime"), "DateTimeString"), currency: directField(settlement, "InvoiceCurrencyCode"),
    buyerReference: directField(agreement, "BuyerReference"),
    purchaseOrder: field(node(agreement, "BuyerOrderReferencedDocument"), "IssuerAssignedID"),
    supplierName: directField(supplier, "Name"), supplierVat: taxRegistration(supplier),
    supplierEndpoint: electronicAddress(node(supplier, "URIUniversalCommunication"), "URIID") || field(supplier, "URIUniversalCommunication"), buyerName: directField(buyer, "Name"),
    buyerVat: taxRegistration(buyer), buyerEndpoint: electronicAddress(node(buyer, "URIUniversalCommunication"), "URIID") || field(buyer, "URIUniversalCommunication"),
    lineTotal: number(directField(totals, "LineTotalAmount")), taxExclusive: number(directField(totals, "TaxBasisTotalAmount")),
    taxAmount: number(field(settlement, "TaxTotalAmount")), taxInclusive: number(directField(totals, "GrandTotalAmount")),
    payableAmount: number(directField(totals, "DuePayableAmount")),
    lineCount: root.getElementsByTagNameNS("*", "IncludedSupplyChainTradeLineItem").length,
    sourceSize: textEncoder.encode(raw).length, raw
  };
}

const check = (id, status, title, message, fix = "", fieldName = "") => ({ id, status, title, message, fix, field: fieldName });
const canonicalCompany = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\b(sas|sasu|sarl|sa|eurl|gmbh|ag|bv|nv|ltd|limited|spa|srl|oy|ab)\b/g, " ")
  .replace(/[^a-z0-9]/g, "");
const fuzzySame = (a, b) => {
  const left = canonicalCompany(a); const right = canonicalCompany(b);
  return Boolean(left && right && left === right);
};
const meaningfulReference = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(normalized && !["na", "none", "aucun", "sans", "notapplicable", "nonapplicable"].includes(normalized));
};

export function validateInvoice(invoice, profile = DEFAULT_PROFILE) {
  const checks = [];
  checks.push(check("syntax", "pass", `Format ${invoice.syntax} reconnu`, `${invoice.documentType} structurée et lisible.`, "", "Document"));
  const receivedFormat = invoice.container === "FACTUR-X" ? "FACTUR-X" : invoice.syntax;
  const acceptedFormats = profile.acceptedFormats || [];
  checks.push(acceptedFormats.includes(receivedFormat)
    ? check("accepted-format", "pass", `${receivedFormat} accepté par le destinataire`, acceptedFormats.join(", "), "", "Format")
    : check("accepted-format", "error", `${receivedFormat} non accepté par le destinataire`, `Formats attendus : ${acceptedFormats.join(", ") || "aucun format configuré"}.`, "Exportez la facture dans l’un des formats annoncés par le destinataire.", "Format"));
  checks.push(invoice.invoiceNumber
    ? check("number", "pass", "Numéro de facture présent", invoice.invoiceNumber, "", "BT-1")
    : check("number", "error", "Numéro de facture manquant", "Chaque facture doit porter un identifiant unique.", "Ajoutez le numéro dans le champ BT-1.", "BT-1"));
  checks.push(invoice.issueDate
    ? check("date", "pass", "Date d’émission présente", invoice.issueDate, "", "BT-2")
    : check("date", "error", "Date d’émission manquante", "La date de création de la facture est obligatoire.", "Renseignez le champ BT-2 au format AAAA-MM-JJ.", "BT-2"));

  const allowedCurrencies = profile.acceptedCurrencies || ["EUR"];
  checks.push(!invoice.currency
    ? check("currency", "error", "Devise absente", "La devise n’a pas été trouvée.", "Ajoutez DocumentCurrencyCode (BT-5).", "BT-5")
    : allowedCurrencies.includes(invoice.currency.toUpperCase())
      ? check("currency", "pass", `Devise ${invoice.currency} acceptée`, allowedCurrencies.join(", "), "", "BT-5")
      : check("currency", "error", `Devise ${invoice.currency} non acceptée`, `Le destinataire accepte : ${allowedCurrencies.join(", ")}.`, `Émettez la facture dans l’une des devises acceptées ou contactez ${profile.companyName}.`, "BT-5"));

  checks.push(invoice.supplierName
    ? check("supplier", "pass", "Fournisseur identifié", invoice.supplierName, "", "BT-27")
    : check("supplier", "error", "Nom du fournisseur absent", "L’émetteur ne peut pas être identifié.", "Complétez le nom légal du vendeur (BT-27).", "BT-27"));
  checks.push(invoice.supplierVat
    ? check("supplier-vat", "pass", "Identifiant fiscal fournisseur présent", invoice.supplierVat, "", "BT-31")
    : check("supplier-vat", "error", "Identifiant fiscal fournisseur absent", "Aucun numéro de TVA ou identifiant fiscal n’a été trouvé.", "Complétez BT-31 ou l’identifiant fiscal applicable.", "BT-31"));

  const buyerNameMatches = fuzzySame(invoice.buyerName, profile.legalName) || fuzzySame(invoice.buyerName, profile.companyName);
  checks.push(!invoice.buyerName
    ? check("buyer", "error", "Destinataire absent", "Le nom de l’acheteur n’a pas été trouvé.", `Utilisez l’entité légale « ${profile.legalName} » dans BT-44.`, "BT-44")
    : buyerNameMatches
      ? check("buyer", "pass", "Bonne entité destinataire", invoice.buyerName, "", "BT-44")
      : check("buyer", "error", "Mauvaise entité destinataire", `La facture vise « ${invoice.buyerName} » au lieu de « ${profile.legalName} ».`, `Remplacez l’acheteur par « ${profile.legalName} » dans BT-44.`, "BT-44"));

  const buyerVatMatches = cleanId(invoice.buyerVat) === cleanId(profile.vatId);
  checks.push(!invoice.buyerVat
    ? check("buyer-vat", "error", "TVA du destinataire manquante", `Le profil attendu est ${profile.vatId}.`, `Ajoutez ${profile.vatId} dans BT-48.`, "BT-48")
    : buyerVatMatches
      ? check("buyer-vat", "pass", "TVA du destinataire concordante", invoice.buyerVat, "", "BT-48")
      : check("buyer-vat", "error", "TVA du destinataire différente", `Trouvé : ${invoice.buyerVat} · attendu : ${profile.vatId}.`, `Utilisez ${profile.vatId} dans BT-48.`, "BT-48"));

  if (profile.requirePurchaseOrder) {
    checks.push(meaningfulReference(invoice.purchaseOrder)
      ? check("po", "pass", "Numéro de commande présent", invoice.purchaseOrder, "", "BT-13")
      : check("po", "error", "Numéro de commande manquant ou inutilisable", `${profile.companyName} exige une vraie référence de commande${invoice.purchaseOrder ? ` ; « ${invoice.purchaseOrder} » est un placeholder.` : "."}`, "Ajoutez le numéro communiqué par votre contact dans BT-13.", "BT-13"));
  } else {
    checks.push(check("po", meaningfulReference(invoice.purchaseOrder) ? "pass" : "info", "Numéro de commande facultatif", meaningfulReference(invoice.purchaseOrder) ? invoice.purchaseOrder : "Aucune référence exploitable fournie.", "", "BT-13"));
  }

  if (profile.requireBuyerReference) {
    checks.push(meaningfulReference(invoice.buyerReference)
      ? check("buyer-reference", "pass", "Référence acheteur présente", invoice.buyerReference, "", "BT-10")
      : check("buyer-reference", "error", "Référence acheteur manquante ou inutilisable", "Le destinataire utilise cette référence pour router la facture.", "Ajoutez un vrai code service ou contact dans BT-10.", "BT-10"));
  }

  if (profile.requireEndpoint) {
    const endpointMatches = cleanId(invoice.buyerEndpoint) === cleanId(profile.peppolId);
    checks.push(!invoice.buyerEndpoint
      ? check("endpoint", "error", "Adresse électronique absente", `Adresse attendue : ${profile.peppolId}.`, `Ajoutez ${profile.peppolId} dans BT-49.`, "BT-49")
      : endpointMatches
        ? check("endpoint", "pass", "Adresse de réception concordante", invoice.buyerEndpoint, "", "BT-49")
        : check("endpoint", "error", "Adresse de réception différente", `Trouvé : ${invoice.buyerEndpoint} · attendu : ${profile.peppolId}.`, `Utilisez ${profile.peppolId} dans BT-49.`, "BT-49"));
  }

  const hasTotals = invoice.taxExclusive !== null && invoice.taxAmount !== null && invoice.taxInclusive !== null;
  if (hasTotals) {
    const delta = Math.abs((invoice.taxExclusive + invoice.taxAmount) - invoice.taxInclusive);
    checks.push(delta <= 0.02
      ? check("totals", "pass", "Totaux cohérents", `${invoice.taxExclusive.toFixed(2)} + ${invoice.taxAmount.toFixed(2)} = ${invoice.taxInclusive.toFixed(2)} ${invoice.currency}`, "", "BT-109/110/112")
      : check("totals", "error", "Totaux incohérents", `Écart détecté : ${delta.toFixed(2)} ${invoice.currency}.`, "Recalculez le total hors taxe, la TVA et le total TTC.", "BT-109/110/112"));
  } else {
    checks.push(check("totals", "warning", "Totaux partiellement lisibles", "Le contrôle arithmétique complet n’a pas pu être exécuté.", "Vérifiez BT-109, BT-110 et BT-112.", "BT-109/110/112"));
  }

  checks.push(invoice.lineCount
    ? check("lines", "pass", `${invoice.lineCount} ligne${invoice.lineCount > 1 ? "s" : ""} détectée${invoice.lineCount > 1 ? "s" : ""}`, "Structure de détail lisible.", "", "BG-25")
    : check("lines", "warning", "Aucune ligne détectée", "Le document ne contient pas de ligne de facturation reconnue.", "Ajoutez au moins une ligne de bien ou service.", "BG-25"));

  checks.push(...nationalChecks(invoice, profile));

  return recalculateResult({
    id: `CHK-${Date.now().toString(36).toUpperCase()}-${(++resultSequence).toString(36).toUpperCase()}`, checkedAt: new Date().toISOString(), checks,
    invoice: { ...invoice, raw: undefined }, recipient: profile.companyName
  });
}

export function recalculateResult(result) {
  const counts = result.checks.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, { pass: 0, error: 0, warning: 0, info: 0 });
  const scoreable = result.checks.filter((item) => item.status !== "info").length || 1;
  const score = Math.round(((counts.pass + counts.warning * 0.45) / scoreable) * 100);
  const outcome = counts.error ? "blocked" : counts.warning ? "review" : "ready";
  return { ...result, counts, score, outcome };
}

export function appendValidationChecks(result, checks, metadata = {}) {
  return recalculateResult({ ...result, checks: [...result.checks, ...checks], standards: metadata });
}

export function resultSummary(result) {
  const label = result.outcome === "ready" ? "Prête à envoyer" : result.outcome === "review" ? "À vérifier" : "Correction requise";
  const blockers = Array.isArray(result.checks) ? result.checks.filter((item) => item.status === "error") : [];
  const blockerCount = Array.isArray(result.checks) ? blockers.length : Math.max(0, Number(result.counts?.error) || 0);
  return {
    label, blockers,
    headline: result.outcome === "ready" ? "La facture respecte les contrôles configurés."
      : result.outcome === "review" ? "La facture peut avancer après une vérification rapide."
        : `${blockerCount} anomalie${blockerCount > 1 ? "s bloquantes" : " bloquante"} à corriger avant l’envoi.`
  };
}

export function createDemoXml({ valid = false, profile = DEFAULT_PROFILE } = {}) {
  const po = valid ? "<cac:OrderReference><cbc:ID>PO-2026-042</cbc:ID></cac:OrderReference>" : "";
  const buyer = valid ? profile.legalName : "Atelier Nova Holding";
  const buyerVat = valid ? profile.vatId : "FR99999999999";
  const [configuredScheme = "0009", configuredEndpoint = "123456782"] = String(profile.peppolId || "0009:123456782").split(":");
  const endpointScheme = valid ? configuredScheme : "0009";
  const endpoint = valid ? configuredEndpoint : "999999999";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>INV-2026-1042</cbc:ID><cbc:IssueDate>2026-10-07</cbc:IssueDate><cbc:DueDate>2026-11-06</cbc:DueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>${po}
  <cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="0009">552100554</cbc:EndpointID><cac:PartyIdentification><cbc:ID schemeID="0009">552100554</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>Studio Horizon SAS</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>12 rue des Ateliers</cbc:StreetName><cbc:CityName>Paris</cbc:CityName><cbc:PostalZone>75011</cbc:PostalZone><cac:Country><cbc:IdentificationCode>FR</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>FR96552100554</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Studio Horizon SAS</cbc:RegistrationName><cbc:CompanyID schemeID="0009">552100554</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cbc:EndpointID schemeID="${endpointScheme}">${endpoint}</cbc:EndpointID><cac:PartyIdentification><cbc:ID schemeID="${endpointScheme}">${endpoint}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${buyer}</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>8 avenue de l’Europe</cbc:StreetName><cbc:CityName>Lyon</cbc:CityName><cbc:PostalZone>69002</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${profile.country || "FR"}</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>${buyerVat}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${buyer}</cbc:RegistrationName><cbc:CompanyID schemeID="${endpointScheme}">${endpoint}</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cbc:PaymentID>INV-2026-1042</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>FR7630006000011234567890189</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>Paiement à 30 jours</cbc:Note></cac:PaymentTerms>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">240.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">1200.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">240.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">1200.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">1200.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">1440.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">1440.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="H87">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">1200.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Mission de conseil</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">1200.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>`;
}

export function exportResultText(result) {
  const summary = resultSummary(result);
  return [
    `SETTLEMESH CHECKLINK — ${summary.label}`, `Contrôle : ${result.id}`, `Destinataire : ${result.recipient}`,
    `Facture : ${result.invoice.invoiceNumber || "sans numéro"}`, `Score : ${result.score}/100`, "",
    ...result.checks.map((item) => `${item.status === "pass" ? "✓" : item.status === "error" ? "✕" : "!"} ${item.title}${item.fix ? ` — ${item.fix}` : ""}`),
    "", "Rapport d’aide à la préparation — ne constitue pas une certification juridique."
  ].join("\n");
}

export function exportResultJson(result) {
  return JSON.stringify({
    schema: "settlemesh-validation-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    result
  }, null, 2);
}

const csvCell = (value) => {
  const raw = String(value ?? "");
  const safe = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function exportHistoryCsv(history) {
  const columns = [
    ["checked_at", (item) => item.checkedAt],
    ["check_id", (item) => item.id],
    ["invoice_number", (item) => item.invoice?.invoiceNumber],
    ["document_type", (item) => item.invoice?.documentType],
    ["format", (item) => item.invoice?.container === "FACTUR-X" ? "FACTUR-X" : item.invoice?.syntax],
    ["supplier", (item) => item.invoice?.supplierName],
    ["supplier_vat", (item) => item.invoice?.supplierVat],
    ["recipient", (item) => item.recipient],
    ["currency", (item) => item.invoice?.currency],
    ["payable_amount", (item) => item.invoice?.payableAmount],
    ["outcome", (item) => item.outcome],
    ["score", (item) => item.score],
    ["errors", (item) => item.counts?.error || 0],
    ["warnings", (item) => item.counts?.warning || 0],
    ["en16931", (item) => item.standards?.en16931],
    ["peppol", (item) => item.standards?.peppol]
  ];
  const rows = [columns.map(([name]) => csvCell(name)).join(";")];
  for (const item of Array.isArray(history) ? history : []) {
    rows.push(columns.map(([, read]) => csvCell(read(item))).join(";"));
  }
  return `\ufeff${rows.join("\r\n")}`;
}
