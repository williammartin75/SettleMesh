// Pack de règles nationales — Allemagne 1.0.0 (XRechnung / KoSIT)
export default Object.freeze({
  country: "DE",
  version: "1.0.0",
  effectiveFrom: "2020-11-27",
  effectiveUntil: null,
  source: {
    label: "XRechnung — KoSIT (formatspezification de la Leitweg-ID) et E-Rechnungsverordnung",
    href: "https://www.xoev.de/de/egov/xrechnung"
  },
  rules: Object.freeze([
    Object.freeze({
      id: "de-vat-format",
      kind: "id-format",
      severity: "error",
      field: "BT-31/BT-48",
      prefix: "DE",
      pattern: "^DE[0-9]{9}$",
      fields: ["supplierVat", "buyerVat"],
      title: "Format du numéro de TVA allemand",
      okMessage: "Numéro de TVA au format allemand (DE suivi de 9 chiffres).",
      koMessage: "Numéro de TVA non conforme au format allemand attendu (DE suivi de 9 chiffres).",
      fix: "Vérifiez le numéro de TVA intracommunautaire auprès de VIES et corrigez-le dans le champ concerné.",
      sourceLabel: "Umsatzsteuer-Identifikationsnummer — §27a UStG / liste de la Commission européenne"
    }),
    Object.freeze({
      id: "de-leitweg-id",
      kind: "leitweg-id",
      severity: "error",
      field: "BT-10",
      trigger: "xrechnung",
      fields: ["buyerReference"],
      title: "Leitweg-ID de la facturation allemande B2G",
      okMessage: "Käuferreferenz (BT-10) conforme au format Leitweg-ID : structure et clé de contrôle Mod 97-10 valides.",
      koMessage: "Käuferreferenz (BT-10) non conforme au format Leitweg-ID (grob-adressage 2 à 12 chiffres, fin-adressage facultatif, clé de 2 chiffres Mod 97-10, 5 à 46 caractères).",
      orphanMessage: "Käuferreferenz (BT-10) : la clé de contrôle Mod 97-10 de la Leitweg-ID est invalide.",
      koEmptyMessage: "XRechnung destinée à un acheteur public : la Käuferreferenz (BT-10) portant la Leitweg-ID est absente.",
      fix: "Reportez la Leitweg-ID communiquée par l'acheteur public dans le champ BT-10, sans la modifier.",
      sourceLabel: "KoSIT — Leitweg-ID : Grob-/Feinadressierung et Prüfziffer Mod 97-10 (ISO/IEC 7064)"
    })
  ])
});
