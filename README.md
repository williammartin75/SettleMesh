# SettleMesh

MVP fonctionnel de préparation de cycles de compensation de factures B2B. L’application importe des factures, contrôle leur qualité, calcule les positions nettes d’un réseau d’entreprises et produit un dossier auditable à transmettre à des partenaires agréés.

## Fonctionnalités

- import CSV avec séparateur virgule ou point-virgule ;
- compensation bilatérale puis multilatérale en centimes ;
- visualisation du réseau avant et après compensation ;
- portefeuille filtrable et ajout manuel de factures ;
- approbation simulée des participants ;
- scellement et archivage local des cycles avec empreinte déterministe ;
- journal d’audit horodaté ;
- export CSV des factures et instructions résiduelles ;
- export JSON d’un dossier complet de cycle ;
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

Ce MVP produit un dossier de préparation : il ne réalise ni novation, ni cession de créance, ni initiation ou mouvement de fonds. Les validations sont simulées et n’ont pas valeur de signature électronique. Un pilote réel nécessitera des accords contractuels, une analyse réglementaire, une authentification des entreprises et des intégrations avec une plateforme de facturation agréée et un prestataire de paiement agréé.
