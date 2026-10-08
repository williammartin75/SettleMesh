// Logique du registre d'exigences — plateforme neutre, partagée avec le
// Worker publié (même pattern que identity.mjs) : le code utile vit dans
// worker/requirements.mjs (fetch natif, aucune dépendance Node), le serveur
// local et le Worker publié exécutent exactement les mêmes listes blanches,
// les mêmes verdicts et les mêmes réponses minimisées.

export * from "../worker/requirements.mjs";
