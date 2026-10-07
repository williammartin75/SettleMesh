# Artefacts de validation vendoriés

Le navigateur exécute ces artefacts localement ; aucune facture n’est envoyée à un service tiers.

- `en16931-1.3.16/ubl/EN16931-UBL-validation.xslt` et `cii/EN16931-CII-validation.xslt` : release 1.3.16 de [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931), sous EUPL 1.2 comme indiqué dans les en-têtes.
- `en16931-1.3.16/ubl/PEPPOL-EN16931-UBL-3.0.21.sch` : règles Peppol BIS Billing 3.0, release 3.0.21 (mai 2026), publiées par [OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/).
- `schxslt/` : compilateur Schematron [SchXslt](https://github.com/Arithmeticus/schxslt), licence MIT.
- `saxonjs-2.7/` : runtime SaxonJS 2.7 ; sa licence est conservée dans le même répertoire.
- `pdfjs-dist` (dépendance npm) : lecture locale des pièces jointes PDF Factur-X, sous licence Apache 2.0 ; la licence est copiée dans la distribution.

`npm run build:validator` compile les feuilles XSLT en SEF SaxonJS et copie dans `dist/vendor/` les runtimes navigateur de SaxonJS et PDF.js.
