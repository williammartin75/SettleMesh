# SettleMesh

Prototype fonctionnel de clearing de factures B2B. L’application importe des factures, calcule les positions nettes d’un réseau d’entreprises et génère un plan de virements résiduels.

## Fonctionnalités

- import CSV avec séparateur virgule ou point-virgule ;
- compensation bilatérale puis multilatérale en centimes ;
- visualisation du réseau avant et après compensation ;
- portefeuille filtrable et ajout manuel de factures ;
- approbation simulée des participants ;
- export CSV des instructions de règlement ;
- stockage exclusivement local dans le navigateur.

## Utilisation locale

```powershell
npm test
npm run check
npm run serve
```

Puis ouvrir `http://127.0.0.1:4173`.

## Format CSV

Les colonnes obligatoires sont `fournisseur`, `client` et `montant`. Les colonnes `référence`, `échéance` et `statut` sont facultatives. Les statuts reconnus sont `ouverte`, `en retard`, `payée` et `litige`, ainsi que leurs équivalents anglais.

## Limites

Ce prototype produit une simulation : il ne réalise ni novation, ni cession de créance, ni mouvement de fonds. Un déploiement réel nécessitera des accords contractuels, une analyse réglementaire et l’intégration d’un prestataire de paiement agréé.
