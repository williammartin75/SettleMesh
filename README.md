# Eurule CheckLink

MVP de prévalidation des factures électroniques européennes. Une entreprise configure son profil de réception et partage un CheckLink avec ses fournisseurs. Ceux-ci contrôlent leur facture UBL ou CII avant transmission et reçoivent des corrections formulées en langage simple.

## Fonctionnalités

- configuration de l’entité destinataire, de son numéro de TVA et de son identifiant Peppol ;
- sélection des formats, devises et références obligatoires ;
- génération d’un CheckLink autonome et partageable ;
- lecture locale des factures XML UBL et CII ;
- contrôles du destinataire, de la TVA, de l’adresse électronique, du numéro de commande et des totaux ;
- diagnostic détaillé avec références EN 16931 `BT-*` ;
- rapport téléchargeable et historique local ;
- interface fournisseur utilisable sans compte ;
- aucune transmission ou conservation serveur des factures dans ce MVP.

## Utilisation locale

```powershell
npm test
npm run check
npm run serve
```

Puis ouvrir `http://127.0.0.1:4173`.

## Démonstration

Dans **Tester une facture**, utiliser :

- **Exemple avec erreurs** pour observer la mauvaise entité, la TVA incorrecte, l’adresse de réception différente et l’absence de commande ;
- **Exemple conforme** pour obtenir un résultat prêt à envoyer.

## Périmètre

Les contrôles sont une aide à la préparation et ne constituent ni une certification juridique ni une garantie d’acceptation. La validation complète contre les artefacts officiels EN 16931, VIES, OpenPeppol et les annuaires nationaux devra être activée par des connecteurs serveur lors d’un pilote réel.
