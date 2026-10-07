# API SettleMesh Validation v1

L'API v1 permet à un ERP, un logiciel de facturation ou une Plateforme Agréée d'envoyer une facture XML UBL/CII et de recevoir le même diagnostic structuré que SettleMesh CheckLink.

## Statut

Cette API est un endpoint pilote exécutable localement. Elle est versionnée, testée et protégée par des clés Bearer rattachées à une organisation. Elle n'est pas déployée par l'hébergement statique du projet. Les clés et quotas étant encore configurés en mémoire, elle ne doit pas être exposée telle quelle sur Internet.

## Démarrage

```powershell
npm install
npm run api:key -- atelier-nova
```

La commande affiche deux valeurs :

1. la clé secrète `sm_live_…`, affichée une seule fois et à conserver côté client ;
2. un objet JSON contenant `organizationId`, `keyId`, le hash SHA-256 et le quota de l'organisation.

Configurer ensuite le serveur avec uniquement l'objet hashé :

```powershell
$env:SETTLEMESH_API_KEYS = '[{"organizationId":"atelier-nova","keyId":"atelier-nova-20261007","keyHash":"<sha256-hexadecimal>","requestsPerMinute":60}]'
npm run serve
```

Plusieurs objets portant le même `organizationId` permettent une rotation progressive des clés. Les `keyId` et les hashes doivent rester uniques. Si la variable est absente ou vide, l'endpoint de validation reste fermé avec `503 AUTH_NOT_CONFIGURED`.

Le même serveur fournit ensuite :

- l'application sur `http://127.0.0.1:4173/` ;
- la santé de l'API sur `GET http://127.0.0.1:4173/api/v1/health` ;
- la validation sur `POST http://127.0.0.1:4173/api/v1/validate`.

Le port peut être changé avec la variable d'environnement `PORT`.

## Requête de validation

En-têtes obligatoires :

```text
Content-Type: application/json
Authorization: Bearer sm_live_…
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

$apiKey = 'sm_live_…'
Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:4173/api/v1/validate' `
  -Headers @{ Authorization = "Bearer $apiKey" } `
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
  "organizationId": "atelier-nova",
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

`organizationId` provient exclusivement de la clé authentifiée, jamais du corps envoyé par le client. Le champ `result.invoice` contient uniquement les données structurées extraites. Le XML brut est retiré avant la réponse. `stored: false` indique que le serveur pilote ne conserve pas la requête ni son résultat.

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
| 401 | `AUTH_REQUIRED`, `INVALID_API_KEY` | Clé absente ou invalide |
| 404 | `NOT_FOUND` | Route API inconnue |
| 405 | `METHOD_NOT_ALLOWED` | Méthode HTTP non prise en charge |
| 413 | `BODY_TOO_LARGE`, `XML_TOO_LARGE` | Limite de taille dépassée |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` différent de JSON |
| 422 | `XML_REQUIRED`, `INVALID_XML`, `UNSAFE_XML`, `INVALID_PROFILE` | Données métier invalides ou DOCTYPE refusé |
| 429 | `RATE_LIMITED` | Limite de débit atteinte |
| 500 | `VALIDATION_FAILED` | Erreur interne non prévue |
| 503 | `AUTH_NOT_CONFIGURED` | Aucune clé n'est configurée côté serveur |

## Limites et sécurité du pilote

- corps HTTP : 2 Mo maximum ;
- XML : 1 Mo maximum ;
- 120 appels par minute et par adresse IP en mémoire, comme protection générale ;
- quota par organisation, 60 appels par minute par défaut et configurable entre 1 et 10 000 ;
- toutes les clés d'une même organisation partagent son quota ;
- XML UBL/CII uniquement ; le PDF Factur-X reste traité dans le navigateur ;
- déclarations `DOCTYPE` refusées pour éviter toute résolution d'entité non fiable ;
- aucune persistance ;
- aucun contenu de facture dans les logs applicatifs ;
- clé secrète jamais stockée dans la configuration : seul son hash SHA-256 est chargé ;
- comparaison des hashes en temps constant et réponse générique en cas de clé invalide ;
- organisation dérivée de la clé côté serveur, sans faire confiance au corps de requête ;
- fermeture par défaut de la validation si aucune clé n'est configurée ;
- pas de CORS ouvert par défaut ;
- en-têtes `nosniff`, `no-referrer` et permissions sensibles désactivées ;
- aucun compte utilisateur, rôle, session, journal d'audit persistant ni SLA dans cette version locale.

Avant tout déploiement Internet, il faut au minimum placer les clés dans un gestionnaire de secrets, ajouter révocation et quotas persistants ou OAuth client credentials, TLS géré, journal d'audit sans contenu sensible, observabilité, politique de rétention et revue de sécurité.

## Versionnement

La version majeure est portée dans l'URL (`/api/v1`) et dans `apiVersion`. Une modification incompatible doit créer `/api/v2`. Les ajouts compatibles peuvent enrichir une réponse v1 sans supprimer ni changer le sens des champs existants.

Le contrat machine complet est disponible dans [`openapi.yaml`](./openapi.yaml).
