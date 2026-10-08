# Artefacts de validation vendoriés

Le navigateur exécute ces artefacts localement ; aucune facture n’est envoyée à un service tiers.

- `en16931-1.3.16/ubl/EN16931-UBL-validation.xslt` et `cii/EN16931-CII-validation.xslt` : release 1.3.16 de [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931), sous EUPL 1.2 comme indiqué dans les en-têtes.
- `en16931-1.3.16/ubl/PEPPOL-EN16931-UBL-3.0.21.sch` : règles Peppol BIS Billing 3.0, release 3.0.21 (mai 2026), publiées par [OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/).
- `schxslt/` : compilateur Schematron [SchXslt](https://github.com/Arithmeticus/schxslt), licence MIT.
- `saxonjs-2.7/` : runtime SaxonJS 2.7 ; sa licence est conservée dans le même répertoire.
- `pdfjs-dist` (dépendance npm) : lecture locale des pièces jointes PDF Factur-X, sous licence Apache 2.0 ; la licence est copiée dans la distribution.

`npm run build:validator` compile les feuilles XSLT en SEF SaxonJS et copie dans `dist/vendor/` les runtimes navigateur de SaxonJS et PDF.js.
# XSD / libxml2 ajoutés en 0.24.0

XSD UBL 2.1 : [édition OASIS officielle](https://docs.oasis-open.org/ubl/os-UBL-2.1/xsd/). XSD CII D16B : [dépôt OpenPeppol](https://github.com/OpenPEPPOL/tc434-validation/tree/master/cii/validator/uncefact/data/standard), révision enregistrée dans le manifeste. Mentions de droits d'origine conservées ; URL et SHA-256 de chaque fichier dans `web/validation/xsd/*/manifest.json`.

Runtime [xmllint-wasm 5.3.0](https://github.com/noppa/xmllint-wasm/tree/v5.3.0), libxml2 2.13.8, licence MIT dans `vendor/xmllint-wasm/LICENSE.txt` et `web/vendor/xmllint/LICENSE.txt`. Fichiers navigateur copiés depuis la dépendance verrouillée par `scripts/build-validation-assets.mjs`. Aucun schéma distant résolu à partir d'une facture : actifs locaux seulement, `--nonet`, DOCTYPE refusé.
