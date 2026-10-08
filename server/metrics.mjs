// Logique de la mesure d'activation consentie — plateforme neutre, partagée
// avec le Worker publié (même pattern que identity.mjs) : le code utile vit
// dans worker/metrics.mjs (fetch natif, aucune dépendance Node), le serveur
// local et le Worker publié exécutent exactement la même liste blanche
// stricte { organizationId, action, day } et les mêmes validations.

export * from "../worker/metrics.mjs";
