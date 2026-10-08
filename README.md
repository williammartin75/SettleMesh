# SettleMesh

SettleMesh transforme des factures conformes en flux de paiement plus simples. Le module **SettleMesh CheckLink** permet à une entreprise de configurer son profil de réception et de le partager avec ses fournisseurs. Ceux-ci contrôlent leur facture UBL, CII ou Factur-X avant transmission et reçoivent des corrections formulées en langage simple. **SettleMesh Net** détecte ensuite les obligations réciproques pouvant faire l'objet d'une compensation après accord des parties.

Le périmètre produit, l'état de chaque module, les invariants, les risques et la feuille de route sont centralisés dans [`PROJECT_DASHBOARD.md`](./PROJECT_DASHBOARD.md). Toute modification du dépôt est soumise à la règle de contrôle définie dans [`AGENTS.md`](./AGENTS.md).

## Fonctionnalités

- configuration de l’entité destinataire, de son numéro de TVA et de son identifiant Peppol ;
- sélection des formats, devises et références obligatoires ;
- génération d’un CheckLink autonome et partageable ;
- lecture locale des factures XML UBL/CII, extraction du XML embarqué et précontrôle structurel PDF/A-3 des PDF Factur-X ;
- exécution locale des règles officielles EN 16931 v1.3.16 pour UBL et CII ;
- exécution locale des règles Peppol BIS Billing 3.0.21 pour les documents UBL Peppol ;
- règles nationales déclaratives, versionnées et sourcées selon le pays du profil de réception — France 1.3.0 (format du numéro de TVA intracommunautaire, clé de contrôle SIREN/SIRET de l'identifiant de routage, contrôle du profil Factur-X reçu, chemin de fer des sous-lignes EXTENDED rapproché du total de lignes, notices réforme et parcours CTC), Allemagne 1.0.0 (format TVA DE et Leitweg-ID en BT-10 sur les XRechnung, clé Mod 97-10) et Belgique 1.0.0 (format TVA BE et communication structurée en BT-83, clé Mod 97) ;
- vérification à la demande d’un numéro de TVA auprès de VIES, avec résultat horodaté `vérifié`, `non vérifié` ou `indisponible` ;
- recherche publique et vérification officielle des exigences de réception d'une entreprise, sans compte, à partir de son registre publié (publication opt-in, réponses minimisées) ;
- interface du registre dans l'app : recherche dans « Sources & règles », publication opt-in depuis « Mon CheckLink » après connexion membre (avec MFA si actif), et bouton « Vérifier ce CheckLink » dans l'aperçu fournisseur ;
- métriques d'activation **consenties** : une case explicite du profil (`usageMetricsConsent`, défaut désactivé) autorise les fournisseurs qui utilisent le CheckLink à signaler des compteurs anonymes (jour, action, quantité) via `POST /api/v1/metrics/events` — jamais de facture, fournisseur, montant ou identifiant ; sans cette case, zéro octet ne quitte leur navigateur ; lecture agrégée par clé Bearer admin/owner (`GET /api/v1/metrics`, export CSV neutralisé) ;
- recherche exacte d’un identifiant dans Peppol Directory, avec les mêmes états explicites et sans confusion avec une garantie de joignabilité ;
- contrôles du destinataire, de la TVA, de l’adresse électronique, du numéro de commande et des totaux ;
- diagnostic détaillé avec références EN 16931 `BT-*` ;
- rapport téléchargeable et historique local minimisé, limité à 100 entrées et 30 jours ;
- contrôle en lot de 20 factures avec synthèse consolidée ;
- exports de rapports lisibles, JSON et CSV pour intégration dans un workflow ;
- recherche et filtrage de l’historique local ;
- export et import sécurisé du profil de réception ;
- simulation de compensation bilatérale et triangulaire entre entreprises avec SettleMesh Net, avec scenario « toutes les échéances », « cut-off aujourd'hui » ou cut-off daté personnalisé passé par le trésorier ;
- import d’un registre de factures en CSV, exclusion des créances litigieuses ou cédées et séparation stricte par devise ;
- calcul du volume compensable, des positions nettes et des paiements résiduels ;
- export CSV des propositions de compensation et des factures mobilisées ;
- API locale versionnée `/api/v1`, protégée par clé Bearer rattachée à une organisation, pour intégrer la validation UBL/CII dans un ERP ou un logiciel de facturation ;
- tableau d’impact pilote avec métriques agrégées locales : CheckLinks copiés, fichiers soumis, taux analysable, taux prêt et temps moyen ;
- export JSON volontaire de ces métriques, sans contenu, identifiant, montant ou fournisseur de facture ;
- interface fournisseur utilisable sans compte ;
- aucune transmission serveur du contenu des factures depuis l'interface navigateur, aucune télémétrie automatique et aucune persistance dans les APIs pilotes ;
- la seule collecte serveur existante est la télémétrie d'activation **consentie et anonyme** (0.22.0) : déclenchée uniquement si le profil CheckLink porte le consentement explicite de l'acheteur, réduite à jour + action + quantité, sans contenu de facture ni identifiant personnel ;
- transmission minimale du pays et du numéro TVA ou de l’identifiant Peppol uniquement après un clic explicite, le temps d’interroger la source officielle.

Le modèle de menace, l'inventaire des données, la revue OWASP/RGPD préliminaire et les portes de mise en production sont documentés dans [`docs/SECURITY.md`](./docs/SECURITY.md).

## Utilisation locale

```powershell
npm test
npm run check
npm run build:validator
npm run build:site
npm run api:key -- atelier-nova
npm run serve
```

Puis ouvrir `http://127.0.0.1:4173`. Le port par défaut est `4173` et peut être remplacé par la variable d'environnement `PORT` (par exemple `$env:PORT = "8081"`), le cas échéant ouvrir l'URL affichée par le serveur.

La commande `api:key` affiche une clé une seule fois et l'objet de configuration contenant uniquement son hash SHA-256. Placer cet objet dans la variable `SETTLEMESH_API_KEYS` avant de lancer le serveur. Aucun secret ne doit être ajouté au dépôt ou au CheckLink.

Depuis 0.14.0, la configuration des clés peut aussi être un **fichier de registre** persistant : `npm run registry:key -- <organisation> [owner|admin|viewer] [chemin]` ajoute une clé (hash uniquement) dans le fichier pointé par `SETTLEMESH_REGISTRY_FILE`. Le serveur relit le fichier à chaud : une clé ajoutée ou révoquée prend effet sans redémarrage, et une clé révoquée reçoit `401 API_KEY_REVOKED`. Le fichier ne contient jamais de clé brute.

Depuis 0.15.0, ce registre peut vivre sur une **base managée Supabase** : définir `SETTLEMESH_SUPABASE_PROJECT_REF` et `SETTLEMESH_SUPABASE_SERVICE_KEY` (variables d'environnement utilisateur, jamais dans le dépôt), créer la table `public.settlemesh_registry` (script SQL dans `docs/API.md`), puis migrer un registre local avec `npm run registry:push -- <registre.json>`. Priorité de chargement : fichier local > Supabase > variable `SETTLEMESH_API_KEYS`. La bascule est visible dans `GET /api/v1/health` (champs `registry` et `supabase`).

Depuis 0.16.0, les clés s'administrent directement par API avec la matrice de rôles appliquée par le serveur : `GET /api/v1/admin/keys` liste les clés de l'organisation authentifiée, `POST /api/v1/admin/keys` en crée une (rôle `viewer`/`admin`/`owner`, la clé brute n'apparaissant qu'une fois), `PATCH /api/v1/admin/keys/{keyId}` (rôle ou `revokedAt`), `DELETE /api/v1/admin/keys/{keyId}` (révocation immédiate, reprise à chaud par le serveur) et `PATCH /api/v1/admin/organization` (quota, owner uniquement). Un rôle `viewer` ne peut que valider ; un `admin` ne peut ni créer ni promouvoir vers `owner` ; toutes les opérations sont isolées par organisation. Ce mode exige un registre persistant (fichier ou Supabase).

Depuis 0.17.0, des **comptes humains** peuvent être créés (`npm run member:add -- <org> <email> [owner|admin|viewer]` — mot de passe fort affiché une seule fois, haché scrypt). Le serveur expose alors `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` et `GET /api/v1/auth/me` avec un cookie `settlemesh_session` `HttpOnly`/`SameSite=Lax` de 24 h (session côté serveur, table Supabase). Depuis 0.18.0, le **MFA propriétaire** (TOTP RFC 6238, sans dépendance) s'active via `/auth/mfa/setup` puis `/auth/mfa/enable` : au login, un compte MFA actif exige un code valide (`401 MFA_REQUIRED`) ; le changement de mot de passe passe par `POST /auth/password`.

Le serveur local expose également `GET /api/v1/health`, `POST /api/v1/validate`, `POST /api/v1/identity/vies` et `POST /api/v1/identity/peppol`. Le contrat, les exemples et les limites de sécurité sont décrits dans [`docs/API.md`](./docs/API.md) et [`docs/openapi.yaml`](./docs/openapi.yaml). Le Site publié embarque les deux routes d’identité et, depuis 0.23.0, les routes publiques du registre d’exigences (`GET /api/v1/requirements`, `POST /api/v1/requirements/verify`) et de la mesure consentie (`POST /api/v1/metrics/events`) dans un Worker sans stockage — secrets `SETTLEMESH_SUPABASE_*` du Worker requis, limites par adresse IP ; les mutations authentifiées et l’API de validation de factures restent sur le serveur local. La configuration des clés a trois sources exactement comme implémentées, avec la priorité **fichier de registre (`SETTLEMESH_REGISTRY_FILE`)** > **Supabase (`SETTLEMESH_SUPABASE_*`)** > **`SETTLEMESH_API_KEYS`** (mémoire du processus) : les deux premières persistent hashes SHA-256, rôles `owner`/`admin`/`viewer`, révocation appliquée à chaud (`401 API_KEY_REVOKED`) et quotas. Avant toute exposition Internet, un gestionnaire de secrets, TLS, des contrôles d'infrastructure et un pentest externe restent nécessaires.

## Démonstration

Dans **Tester une facture**, utiliser :

- **Exemple avec erreurs** pour observer la mauvaise entité, la TVA incorrecte, l’adresse de réception différente et l’absence de commande ;
- **Exemple conforme** pour obtenir un résultat prêt à envoyer.

Un PDF Factur-X déclenche en plus des contrôles locaux sur la déclaration PDF/A-3, le niveau déclaré, les propriétés XMP Factur-X, le nom du XML embarqué et son association au catalogue PDF. Le diagnostic contient toujours un contrôle de portée rappelant que cette inspection structurelle ne remplace pas une validation ISO 19005-3 complète avec veraPDF.

Il est aussi possible de déposer jusqu’à 20 fichiers en une fois. Le tableau de synthèse ouvre ensuite le diagnostic détaillé de chaque facture et s’exporte en CSV.

Dans **Mon CheckLink**, le profil peut être exporté en JSON puis réimporté dans un autre navigateur. Dans **Contrôles**, l’historique peut être recherché, filtré et exporté en CSV. Il est conservé uniquement dans le navigateur, pendant 30 jours et dans la limite de 100 résultats ; le diagnostic détaillé reste limité à la session courante.

La **Vue d'ensemble** contient aussi un bloc « Mesure pilote ». Ses compteurs sont enregistrés dans le navigateur, séparément de l'historique limité à 100 résultats. Ils peuvent être exportés volontairement en JSON ou remis à zéro sans supprimer l'historique. Cet export ne contient pas le XML, les numéros de facture, les fournisseurs, les montants ni les identifiants fiscaux.

Dans **Mon CheckLink**, la case « Mesurer l'activation (consenti) » autorise — et seulement si elle est cochée — les fournisseurs qui utilisent le CheckLink à signaler des compteurs anonymes côté serveur : jour, action (CheckLink copié, facture contrôlée, facture prête) et quantité. Aucun numéro de facture, fournisseur, montant, identifiant fiscal ou adresse IP n'est transmis ou stocké ; l'envoi part uniquement quand le lien décodé porte ce consentement, et zéro octet ne quitte le navigateur fournisseur sinon. Les agrégats se lisent avec une clé admin ou owner : `GET /api/v1/metrics?from=…&to=…` et `GET /api/v1/metrics/export?from=…&to=…` (CSV neutralisé).

Dans **Sources & règles**, les contrôles VIES et Peppol Directory sont lancés manuellement. Un état « vérifié » signifie uniquement que la source a répondu positivement à l’instant indiqué. Les identifiants et réponses ne sont pas ajoutés à l’historique SettleMesh ni au stockage du navigateur.

## SettleMesh Net

La page **SettleMesh Net** contient un réseau de démonstration et accepte un registre CSV utilisant les colonnes suivantes :

```text
invoice_number;debtor;creditor;amount;currency;due_date;status;disputed;assigned
```

Le moteur regroupe les obligations par devise, compense d’abord les dettes bilatérales, puis détecte les cycles triangulaires. Il conserve la position nette de chaque participant et exporte les propositions avec l’allocation aux factures d’origine. La simulation peut être bornée par un cut-off : « toutes les échéances » (défaut), « cut-off aujourd'hui » ou une date personnalisée au format `AAAA-MM-JJ`. Les obligations postérieures au cut-off ou sans échéance exploitable sont différées et signalées par un compteur distinct, jamais supprimées, et la somme des positions nettes reste inchangée. L'export CSV mentionne le cut-off retenu dans la colonne `scenario_cutoff`.

Cette fonctionnalité est une simulation d’aide à la décision. Elle ne déplace aucun fonds, n’initie aucun paiement et ne constate pas juridiquement l’extinction des créances. Toute mise en production nécessite notamment un accord entre les parties et une validation juridique, comptable et fiscale.

## Périmètre

Les contrôles sont une aide à la préparation et ne constituent ni une certification juridique ni une garantie d'acceptation. Les artefacts EN 16931 et Peppol sont exécutés dans le navigateur, sans envoi de la facture à un serveur. Les règles nationales sont des packs déclaratifs versionnés (module client `web/rules/`), chargés localement, avec source citée et date d'effet ; les packs disponibles aujourd'hui sont France 1.3.0, Allemagne 1.0.0 et Belgique 1.0.0. VIES vérifie ponctuellement un statut TVA ; Peppol Directory indique une présence d’annuaire, pas la joignabilité SMP ni la capacité réelle à recevoir un document donné. Pour Factur-X, le MVP détecte des incohérences structurelles PDF/A-3 visibles mais ne contrôle pas exhaustivement les polices, couleurs, profils ICC, actions et autres règles ISO 19005-3 : veraPDF ou un validateur équivalent reste nécessaire. Les règles nationales supplémentaires ne sont pas encore intégrées.
