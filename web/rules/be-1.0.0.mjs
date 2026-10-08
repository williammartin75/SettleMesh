// Pack de règles nationales — Belgique 1.0.0
export default Object.freeze({
  country: "BE",
  version: "1.0.0",
  effectiveFrom: "2026-01-01",
  effectiveUntil: null,
  source: {
    label: "Communication structurée (VCS) — SPF Finances · Mercurius / facturation électronique belge",
    href: "https://finances.belgium.be/fr/entreprises/tva/communication-structuree"
  },
  rules: Object.freeze([
    Object.freeze({
      id: "be-vat-format",
      kind: "id-format",
      severity: "error",
      field: "BT-31/BT-48",
      prefix: "BE",
      pattern: "^BE[0-9]{10}$",
      fields: ["supplierVat", "buyerVat"],
      title: "Format du numéro de TVA belge",
      okMessage: "Numéro de TVA au format belge (BE suivi de 10 chiffres, 0 initial possible).",
      koMessage: "Numéro de TVA non conforme au format belge attendu (BE suivi de 10 chiffres).",
      fix: "Vérifiez le numéro de TVA intracommunautaire auprès de VIES et corrigez-le dans le champ concerné.",
      sourceLabel: "Numéro de TVA belge — code TVA / liste de la Commission européenne"
    }),
    Object.freeze({
      id: "be-communication-structuree",
      kind: "structured-comms",
      severity: "warning",
      field: "BT-83",
      fields: ["paymentReference"],
      title: "Communication structurée belge (BT-83)",
      okMessage: "Communication structurée (VCS) à 12 chiffres dont la clé de contrôle Mod 97 est valide.",
      koMessage: "Communication structurée (VCS) à 12 chiffres dont la clé de contrôle Mod 97 est invalide.",
      fix: "Composez la communication structurée +++XXX/XXXX/XXXXX++ dont les deux derniers chiffres valent le reste Mod 97 des dix premiers (97 si reste nul).",
      sourceLabel: "SPF Finances — clé de contrôle de la communication structurée (Mod 97)"
    })
  ])
});
