# API SettleMesh Validation v1

L'API v1 permet à un ERP, un logiciel de facturation ou une Plateforme Agréée d'envoyer une facture XML UBL/CII et de recevoir le même diagnostic structuré que SettleMesh CheckLink.

## Statut

Cette API est un endpoint pilote exécutable localement. Elle est versionnée et testée, mais elle n'est pas encore déployée par l'hébergement statique du projet et ne possède pas encore d'authentification par organisation. Elle ne doit pas être exposée telle quelle sur Internet.

## Démarrage

```powershell
npm install
npm run serve
```

Le même serveur fournit ensuite :

- l'application sur `http://127.0.0.1:4173/` ;
- la santé de l'API sur `GET http://127.0.0.1:4173/api/v1/health` ;
- la validation sur `POST http://127.0.0.1:4173/api/v1/validate`.

Le port peut être changé avec la variable d'environnement `PORT`.

## Requête de validation

En-tête obligatoire :

```text
Content-Type: application/json
```

Corps :

```json
{
  "xml": "<?xml version=\"1.0\"?><Invoice>...</Invoice>",
  "profile": {
    "companyName": "Atelier Nova",
    "legalName": "Atelier Nova SAS",
    "country": "FR",
    "vatId": "FR11123456782",
    "peppolId": "0009:123456782",
    "routingProvider": "Plateforme partenaire",
    "acceptedFormats": ["UBL", "CII", "FACTUR-X"],
    "acceptedCurrencies": ["EUR"],
    "requirePurchaseOrder": true,
    "requireBuyerReference": false,
    "requireEndpoint": true,
    "requireAttachment": false,
    "submissionEmail": "factures@example.test",
    "instructions": "Ajoutez le numéro de commande dans BT-13."
  },
  "source": {
    "originalFileName": "INV-2026-1042.xml"
  }
}
```

`profile` et `source` sont facultatifs. Sans profil, le profil de démonstration est utilisé ; une intégration réelle doit toujours envoyer explicitement le profil du destinataire.

Exemple PowerShell :

```powershell
$body = @{
  xml = Get-Content -Raw -LiteralPath '.\facture.xml'
  profile = @{
    companyName = 'Atelier Nova'
    legalName = 'Atelier Nova SAS'
    country = 'FR'
    vatId = 'FR11123456782'
    acceptedFormats = @('UBL', 'CII')
    acceptedCurrencies = @('EUR')
    requirePurchaseOrder = $true
    requireBuyerReference = $false
    requireEndpoint = $false
    requireAttachment = $false
    instructions = 'Ajoutez la commande dans BT-13.'
  }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:4173/api/v1/validate' `
  -ContentType 'application/json' `
  -Body $body
```

## Réponse réussie

```json
{
  "schema": "settlemesh-validation-response",
  "apiVersion": "v1",
  "requestId": "2c51c119-26cf-4eec-a763-827703766faa",
  "processedAt": "2026-10-07T12:00:00.000Z",
  "stored": false,
  "result": {
    "id": "CHK-...",
    "checkedAt": "2026-10-07T12:00:00.000Z",
    "recipient": "Atelier Nova",
    "score": 100,
    "outcome": "ready",
    "counts": { "pass": 13, "error": 0, "warning": 0, "info": 0 },
    "standards": {
      "en16931": "1.3.16",
      "peppol": "3.0.21",
      "officialFailures": 0,
      "complete": true
    },
    "invoice": {},
    "checks": []
  }
}
```

Le champ `result.invoice` contient uniquement les données structurées extraites. Le XML brut est retiré avant la réponse. `stored: false` indique que le serveur pilote ne conserve pas la requête ni son résultat.

## Résultats métier

- `ready` : aucune erreur ni aucun avertissement ;
- `review` : aucun blocage, mais au moins un avertissement ;
- `blocked` : au moins une erreur.

`standards.complete` vaut `false` si le moteur officiel est indisponible. Dans ce cas, un avertissement est ajouté et le résultat ne peut pas devenir silencieusement « prêt ».

## Erreurs

Toutes les erreurs suivent ce format :

```json
{
  "schema": "settlemesh-api-error",
  "apiVersion": "v1",
  "requestId": "...",
  "error": {
    "code": "INVALID_XML",
    "message": "Le XML n’est pas lisible."
  }
}
```

| HTTP | Code principal | Signification |
|---:|---|---|
| 400 | `INVALID_JSON` | Corps JSON non lisible |
| 404 | `NOT_FOUND` | Route API inconnue |
| 405 | `METHOD_NOT_ALLOWED` | Méthode HTTP non prise en charge |
| 413 | `BODY_TOO_LARGE`, `XML_TOO_LARGE` | Limite de taille dépassée |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` différent de JSON |
| 422 | `XML_REQUIRED`, `INVALID_XML`, `UNSAFE_XML`, `INVALID_PROFILE` | Données métier invalides ou DOCTYPE refusé |
| 429 | `RATE_LIMITED` | Limite de débit atteinte |
| 500 | `VALIDATION_FAILED` | Erreur interne non prévue |

## Limites et sécurité du pilote

- corps HTTP : 2 Mo maximum ;
- XML : 1 Mo maximum ;
- 60 appels par minute et par adresse IP en mémoire ;
- XML UBL/CII uniquement ; le PDF Factur-X reste traité dans le navigateur ;
- déclarations `DOCTYPE` refusées pour éviter toute résolution d'entité non fiable ;
- aucune persistance ;
- aucun contenu de facture dans les logs applicatifs ;
- pas de CORS ouvert par défaut ;
- en-têtes `nosniff`, `no-referrer` et permissions sensibles désactivées ;
- aucune authentification, aucun quota par organisation et aucun SLA dans cette version locale.

Avant tout déploiement Internet, il faut au minimum ajouter authentification forte, clés tournantes ou OAuth client credentials, isolation par organisation, quotas persistants, journal d'audit sans contenu sensible, TLS géré, observabilité, politique de rétention et revue de sécurité.

## Versionnement

La version majeure est portée dans l'URL (`/api/v1`) et dans `apiVersion`. Une modification incompatible doit créer `/api/v2`. Les ajouts compatibles peuvent enrichir une réponse v1 sans supprimer ni changer le sens des champs existants.

Le contrat machine complet est disponible dans [`openapi.yaml`](./openapi.yaml).
