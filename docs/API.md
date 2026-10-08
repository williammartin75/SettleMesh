# API SettleMesh v1 — validation et identité européenne

L'API v1 permet à un ERP, un logiciel de facturation ou une Plateforme Agréée d'envoyer une facture XML UBL/CII et de recevoir le même diagnostic structuré que SettleMesh CheckLink. Elle expose aussi deux vérifications minimales utilisées par l’interface : VIES et Peppol Directory.

## Statut

La validation de factures est un endpoint pilote exécutable localement. Elle est versionnée, testée et protégée par des clés Bearer rattachées à une organisation. Elle n'est pas déployée avec le Site. Les clés peuvent être configurées de deux façons équivalentes — en mémoire via `SETTLEMESH_API_KEYS`, ou de façon persistante dans un fichier de registre `SETTLEMESH_REGISTRY_FILE` (hashes SHA-256, rôles, révocation à chaud, quotas) — ; elle ne doit pas être exposée sur Internet tant qu'un gestionnaire de secrets, TLS et une revue de sécurité externe ne sont pas en place.

Les routes d’identité ne reçoivent jamais de facture et ne nécessitent pas de clé dans le parcours navigateur same-origin. Le Site les exécute dans un Worker sans base de données : l’identifiant est transmis à la source officielle, la réponse normalisée est renvoyée puis oubliée. L’accès au Site reste contrôlé par sa politique d’audience.

## Démarrage

```powershell
npm install
npm run api:key -- atelier-nova
```

La commande affiche deux valeurs :

1. la clé secrète `sm_live_…`, affichée une seule fois et à conserver côté client ;
2. un objet JSON contenant `organizationId`, `keyId`, le hash SHA-256, le `role` et le quota de l'organisation.

Configurer ensuite le serveur avec uniquement l'objet hashé :

```powershell
$env:SETTLEMESH_API_KEYS = '[{"organizationId":"atelier-nova","keyId":"atelier-nova-20261007","keyHash":"<sha256-hexadecimal>","role":"owner","requestsPerMinute":60}]'
npm run serve
```

Multi-clé : plusieurs objets portant le même `organizationId` permettent une rotation progressive des clés. Les `keyId` et les hashes doivent rester uniques. Depuis 0.14.0, l'objet de configuration porte aussi un `role` (`owner`, `admin` ou `viewer`). Si la variable est absente ou vide, l'endpoint de validation reste fermé avec `503 AUTH_NOT_CONFIGURED`.

### Alternative persistante : le fichier de registre

Au lieu de la variable d'environnement, la configuration peut vivre dans un fichier de registre versionné `settlemesh-registry-1` :

```powershell
npm run registry:key -- atelier-nova admin
# puis, avant de lancer le serveur :
$env:SETTLEMESH_REGISTRY_FILE = '.\settlemesh-registry.json'
npm run serve
```

`registry:key` génère une clé brute affichée une seule fois et l'ajoute au fichier (hash SHA-256 uniquement) avec son rôle. Organisation par organisation, le fichier contient `organizationId`, `requestsPerMinute` (1 à 10 000) et la liste des clés : `keyId`, `keyHash`, `role`, `revokedAt` (`null` ou horodatage ISO). Le serveur relit ce fichier à chaud (horodatage de modification) : une clé ajoutée, tournée ou révoquée prend effet sans redémarrage. Une clé rétroactivement marquée `revokedAt` reçoit `401 API_KEY_REVOKED`. Le rôle résolu côté serveur est renvoyé dans chaque réponse de validation sous `organizationRole`. Le fichier ne doit jamais contenir de clé brute ni vivre dans le dépôt.

Le même serveur fournit ensuite :

- l'application sur `http://127.0.0.1:4173/` ;
- la santé de l'API sur `GET http://127.0.0.1:4173/api/v1/health` ;
- la validation sur `POST http://127.0.0.1:4173/api/v1/validate`.
- VIES sur `POST http://127.0.0.1:4173/api/v1/identity/vies` ;
- Peppol Directory sur `POST http://127.0.0.1:4173/api/v1/identity/peppol`.

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
  "organizationRole": "owner",
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

`organizationId` provient exclusivement de la clé authentifiée, jamais du corps envoyé par le client. `organizationRole` est le rôle résolu par le serveur pour cette clé : `owner`, `admin` ou `viewer` (depuis la configuration d'environnement, le rôle par défaut est `owner`). Le champ `result.invoice` contient uniquement les données structurées extraites. Le XML brut est retiré avant la réponse. `stored: false` indique que le serveur pilote ne conserve pas la requête ni son résultat.

## Résultats métier

- `ready` : aucune erreur ni aucun avertissement ;
- `review` : aucun blocage, mais au moins un avertissement ;
- `blocked` : au moins une erreur.

`standards.complete` vaut `false` si le moteur officiel est indisponible. Dans ce cas, un avertissement est ajouté et le résultat ne peut pas devenir silencieusement « prêt ».

## Vérifications d’identité

VIES reçoit un pays et un numéro national, avec ou sans préfixe dans le champ `vatNumber` :

```json
{ "countryCode": "FR", "vatNumber": "40303265045" }
```

Peppol Directory reçoit l’identifiant complet `schéma:valeur` :

```json
{ "participantId": "9930:de299939922" }
```

Une réponse normalisée utilise toujours l’un des trois états suivants :

- `verified` : la source a répondu positivement à cet instant ;
- `not_verified` : la source a répondu mais n’a pas confirmé l’identifiant ;
- `unavailable` : délai dépassé, erreur HTTP ou source inaccessible ; cet état ne doit jamais être interprété comme un succès ou un échec d’identité.

```json
{
  "schema": "settlemesh-identity-check",
  "requestId": "2c51c119-26cf-4eec-a763-827703766faa",
  "source": "VIES",
  "status": "verified",
  "identifier": "FR40303265045",
  "checkedAt": "2026-10-07T12:00:00.000Z",
  "stored": false,
  "legalName": "ACME SA",
  "address": "Paris",
  "message": "Numéro déclaré valide par VIES au moment de la requête."
}
```

Pour Peppol, la réponse peut aussi contenir le pays, la date d’inscription et le nombre de types de documents déclarés. Elle n’expose pas les contacts ni la liste brute des capacités. Une présence dans le Directory n’est ni une preuve de joignabilité SMP ni une garantie de livraison.

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
| 400 | `INVALID_VAT_COUNTRY`, `INVALID_VAT_NUMBER`, `INVALID_PEPPOL_ID` | Identifiant européen hors contrat |
| 401 | `AUTH_REQUIRED`, `INVALID_API_KEY` | Clé absente ou invalide |
| 401 | `API_KEY_REVOKED` | Clé marquée `revokedAt` dans le fichier de registre ; la révocation est relue à chaud, sans redémarrage |
| 404 | `NOT_FOUND` | Route API inconnue |
| 405 | `METHOD_NOT_ALLOWED` | Méthode HTTP non prise en charge |
| 413 | `BODY_TOO_LARGE`, `XML_TOO_LARGE` | Limite de taille dépassée |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` différent de JSON |
| 422 | `XML_REQUIRED`, `INVALID_XML`, `UNSAFE_XML`, `INVALID_PROFILE` | Données métier invalides ou DOCTYPE refusé |
| 429 | `RATE_LIMITED` | Limite de débit atteinte |
| 429 | `UPSTREAM_RATE_LIMITED` | Limite officielle de Peppol Directory atteinte |
| 500 | `VALIDATION_FAILED` | Erreur interne non prévue |
| 503 | `AUTH_NOT_CONFIGURED` | Aucune clé n'est configurée côté serveur |

## Limites et sécurité du pilote

- corps HTTP : 2 Mo maximum ;
- XML : 1 Mo maximum ;
- 120 appels par minute et par adresse IP en mémoire du processus (réinitialisée à chaque redémarrage), comme protection générale ;
- quota par organisation, 60 appels par minute par défaut et configurable entre 1 et 10 000 ;
- toutes les clés d'une même organisation partagent son quota ;
- XML UBL/CII uniquement ; le PDF Factur-X reste traité dans le navigateur ;
- déclarations `DOCTYPE` refusées pour éviter toute résolution d'entité non fiable ;
- aucune persistance ;
- aucun contenu de facture dans les logs applicatifs ;
- clé secrète jamais stockée dans la configuration : seul son hash SHA-256 est chargé, en mémoire (`SETTLEMESH_API_KEYS`) ou dans le fichier de registre (`SETTLEMESH_REGISTRY_FILE`) ;
- avec le fichier de registre : rôles `owner`/`admin`/`viewer` résolus côté serveur et renvoyés dans la réponse, révocation (`revokedAt`) et quotas persistants relus à chaud ;
- comparaison des hashes en temps constant et réponse générique en cas de clé invalide ;
- organisation dérivée de la clé côté serveur, sans faire confiance au corps de requête ;
- fermeture par défaut de la validation si aucune clé n'est configurée ;
- pas de CORS ouvert par défaut ;
- vérifications d’identité déclenchées explicitement, sans cache ni persistance ;
- délai amont de 8 secondes et état `unavailable` distinct d’un résultat négatif ;
- limite Peppol Directory de deux recherches par seconde appliquée au mieux par processus ou isolate ;
- en-têtes `nosniff`, `no-referrer` et permissions sensibles désactivées ;
- aucun compte utilisateur, session humaine, interface d'administration, journal d'audit persistant ni SLA dans cette version locale ; un rôle `owner`/`admin`/`viewer` est rattaché à la clé d'organisation et résolu côté serveur.

Avant tout déploiement Internet, il faut au minimum basculer le registre des clés sur un stockage chiffré managé (l'adaptateur plateforme managée prévu remplacera le fichier local sans changer le contrat), placer tout secret dans un gestionnaire de secrets, ajouter TLS géré, journal d'audit sans contenu sensible, observabilité, politique de rétention et revue de sécurité.

## Versionnement

La version majeure est portée dans l'URL (`/api/v1`) et dans `apiVersion`. Une modification incompatible doit créer `/api/v2`. Les ajouts compatibles peuvent enrichir une réponse v1 sans supprimer ni changer le sens des champs existants.

Le contrat machine complet est disponible dans [`openapi.yaml`](./openapi.yaml).
