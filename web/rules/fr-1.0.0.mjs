// Pack de règles nationales — France 1.0.0
export default Object.freeze({
  country: "FR",
  version: "1.0.0",
  effectiveFrom: "2026-09-01",
  effectiveUntil: null,
  source: {
    label: "Réforme française de la facture électronique — FNFE-MPE / DGFiP",
    href: "https://fnfe-mpe.org/"
  },
  rules: Object.freeze([
    Object.freeze({
      id: "fr-vat-format",
      kind: "id-format",
      severity: "error",
      field: "BT-31/BT-48",
      prefix: "FR",
      pattern: "^FR[0-9A-Z]{2}[0-9A-Z]{9}$",
      fields: ["supplierVat", "buyerVat"],
      title: "Format du numéro de TVA français",
      okMessage: "Numéro de TVA au format français (FR + 2 caractères + 9 caractères).",
      koMessage: "Numéro de TVA non conforme au format français attendu (FR suivi de 11 caractères).",
      fix: "Vérifiez le numéro de TVA intracommunautaire auprès de VIES et corrigez-le dans le champ concerné.",
      sourceLabel: "Numéro de TVA intracommunautaire — article 286 CGI / liste de la Commission européenne"
    }),
    Object.freeze({
      id: "fr-reception-obligation",
      kind: "notice",
      severity: "info",
      field: "Document",
      title: "Réforme française : réception obligatoire depuis le 1er septembre 2026",
      message: "Depuis le 1er septembre 2026, chaque entreprise française doit être en mesure de recevoir des factures électroniques ; l'obligation d'émission progresse par vagues jusqu'au 1er septembre 2027.",
      fix: "",
      sourceLabel: "FNFE-MPE — calendrier de la réforme"
    })
  ])
});
