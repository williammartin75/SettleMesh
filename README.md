# SettleMesh

SettleMesh transforme des factures conformes en flux de paiement plus simples. Le module **SettleMesh CheckLink** permet à une entreprise de configurer son profil de réception et de le partager avec ses fournisseurs. Ceux-ci contrôlent leur facture UBL, CII ou Factur-X avant transmission et reçoivent des corrections formulées en langage simple. **SettleMesh Net** détecte ensuite les obligations réciproques pouvant faire l'objet d'une compensation après accord des parties.

Le périmètre produit, l'état de chaque module, les invariants, les risques et la feuille de route sont centralisés dans [`PROJECT_DASHBOARD.md`](./PROJECT_DASHBOARD.md). Toute modification du dépôt est soumise à la règle de contrôle définie dans [`AGENTS.md`](./AGENTS.md).

## Fonctionnalités

- configuration de l’entité destinataire, de son numéro de TVA et de son identifiant Peppol ;
- sélection des formats, devises et références obligatoires ;
- génération d’un CheckLink autonome et partageable ;
- lecture locale des factures XML UBL/CII et extraction du XML embarqué dans les PDF Factur-X ;
- exécution locale des règles officielles EN 16931 v1.3.16 pour UBL et CII ;
- exécution locale des règles Peppol BIS Billing 3.0.21 pour les documents UBL Peppol ;
- contrôles du destinataire, de la TVA, de l’adresse électronique, du numéro de commande et des totaux ;
- diagnostic détaillé avec références EN 16931 `BT-*` ;
- rapport téléchargeable et historique local ;
- contrôle en lot de 20 factures avec synthèse consolidée ;
- exports de rapports lisibles, JSON et CSV pour intégration dans un workflow ;
- recherche et filtrage de l’historique local ;
- export et import sécurisé du profil de réception ;
- simulation de compensation bilatérale et triangulaire entre entreprises avec SettleMesh Net ;
- import d’un registre de factures en CSV, exclusion des créances litigieuses ou cédées et séparation stricte par devise ;
- calcul du volume compensable, des positions nettes et des paiements résiduels ;
- export CSV des propositions de compensation et des factures mobilisées ;
- interface fournisseur utilisable sans compte ;
- aucune transmission ou conservation serveur des factures dans ce MVP.

## Utilisation locale

```powershell
npm test
npm run check
npm run build:validator
npm run serve
```

Puis ouvrir `http://127.0.0.1:4173`.

## Démonstration

Dans **Tester une facture**, utiliser :

- **Exemple avec erreurs** pour observer la mauvaise entité, la TVA incorrecte, l’adresse de réception différente et l’absence de commande ;
- **Exemple conforme** pour obtenir un résultat prêt à envoyer.

Il est aussi possible de déposer jusqu’à 20 fichiers en une fois. Le tableau de synthèse ouvre ensuite le diagnostic détaillé de chaque facture et s’exporte en CSV.

Dans **Mon CheckLink**, le profil peut être exporté en JSON puis réimporté dans un autre navigateur. Dans **Contrôles**, l’historique peut être recherché, filtré et exporté en CSV.

## SettleMesh Net

La page **SettleMesh Net** contient un réseau de démonstration et accepte un registre CSV utilisant les colonnes suivantes :

```text
invoice_number;debtor;creditor;amount;currency;due_date;status;disputed;assigned
```

Le moteur regroupe les obligations par devise, compense d’abord les dettes bilatérales, puis détecte les cycles triangulaires. Il conserve la position nette de chaque participant et exporte les propositions avec l’allocation aux factures d’origine.

Cette fonctionnalité est une simulation d’aide à la décision. Elle ne déplace aucun fonds, n’initie aucun paiement et ne constate pas juridiquement l’extinction des créances. Toute mise en production nécessite notamment un accord entre les parties et une validation juridique, comptable et fiscale.

## Périmètre

Les contrôles sont une aide à la préparation et ne constituent ni une certification juridique ni une garantie d’acceptation. Les artefacts EN 16931 et Peppol sont exécutés dans le navigateur, sans envoi de la facture à un serveur. Le MVP ne vérifie pas encore la conformité PDF/A-3 du conteneur Factur-X, le statut TVA VIES, l’existence d’un participant dans le Peppol Directory ou les règles nationales supplémentaires ; ces contrôles devront être ajoutés par des connecteurs et artefacts versionnés lors d’un pilote réel.
