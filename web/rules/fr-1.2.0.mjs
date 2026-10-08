// Pack de règles nationales — France 1.2.0
export default Object.freeze({
  country: "FR",
  version: "1.2.0",
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
      id: "fr-siren-endpoint",
      kind: "numeric-id",
      severity: "error",
      field: "BT-34/BT-49",
      digits9Pattern: "^[0-9]{9}$",
      digits14Pattern: "^[0-9]{14}$",
      fields: ["supplierEndpoint", "buyerEndpoint"],
      title: "Identifiant SIREN/SIRET du routage électronique",
      okMessage: "Identifiant de routage au format SIREN/SIRET dont la clé de contrôle est valide.",
      koMessage: "Identifiant de routage ressemblant à un SIREN/SIRET mais dont la clé de contrôle est invalide.",
      fix: "Vérifiez le SIRET de l'entreprise auprès de l'INSEE et corrigez l'adresse électronique de routage (schéma 0009).",
      sourceLabel: "SIREN/SIRET INSEE — clé de contrôle Luhn · code ISO 6523 0009"
    }),
    Object.freeze({
      id: "fr-facturx-profile",
      kind: "facturx-profile",
      severity: "warning",
      field: "PDF/A-3",
      warnOn: ["MINIMUM"],
      fields: ["containerPreflight"],
      title: "Profil Factur-X adapté à la réception",
      okMessage: "Profil Factur-X « {level} » déclaré : lisible et exploitable pour un acheteur français.",
      koMessage: "Profil Factur-X MINIMUM : seules les données d'entête et de pied sont présentes. Ce profil est conçu pour le e-reporting et ne contient pas de ligne de facture.",
      fix: "Émettez la facture au minimum en profil Factur-X BASIC pour inclure les données de ligne, ou clarifiez le format attendu avec votre destinataire.",
      sourceLabel: "FNFE-MPE — profils Factur-X (MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED)"
    }),
    Object.freeze({
      id: "fr-ctc-parcours",
      kind: "facturx-profile",
      severity: "info",
      field: "PDF/A-3",
      noticeOn: ["EXTENDED-CTC"],
      fields: ["containerPreflight"],
      title: "Parcours France CTC déclaré",
      noticeMessage: "Le niveau de profil Factur-X déclaré correspond au parcours français CTC (EXTENDED-CTC-FR). Ce contrôle est informatif ; l'exhaustivité du profil reste du ressort des artefacts officiels.",
      fix: "",
      sourceLabel: "FNFE-MPE / FeRD — Factur-X 1.09, profil de référence EXTENDED-CTC-FR"
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
