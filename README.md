# SettleMesh

SettleMesh transforme des factures conformes en flux de paiement plus simples. Le module **SettleMesh CheckLink** permet à une entreprise de configurer son profil de réception et de le partager avec ses fournisseurs. Ceux-ci contrôlent leur facture UBL, CII ou Factur-X avant transmission et reçoivent des corrections formulées en langage simple. **SettleMesh Net** détecte ensuite les obligations réciproques pouvant faire l'objet d'une compensation après accord des parties.

Le périmètre produit, l'état de chaque module, les invariants, les risques et la feuille de route sont centralisés dans [`PROJECT_DASHBOARD.md`](./PROJECT_DASHBOARD.md). Toute modification du dépôt est soumise à la règle de contrôle définie dans [`AGENTS.md`](./AGENTS.md).

## Fonctionnalités

- configuration de l’entité destinataire, de son numéro de TVA et de son identifiant Peppol ;
- sélection des formats, devises et références obligatoires ;
- liens instantanés autonomes et liens stables `#buyer/<organizationId>` chargeant les exigences publiées courantes ;
- lecture locale des factures XML UBL/CII, extraction du XML embarqué et précontrôle structurel PDF/A-3 des PDF Factur-X ;
- validation XSD locale UBL 2.1 / CII D16B (libxml2 WebAssembly), puis règles officielles EN 16931 v1.3.16 pour UBL et CII ;
- exécution locale des règles Peppol BIS Billing 3.0.21 pour les documents UBL Peppol ;
- règles nationales déclaratives, versionnées et sourcées selon le pays du profil de réception — France 1.3.0 (format du numéro de TVA intracommunautaire, clé de contrôle SIREN/SIRET de l'identifiant de routage, contrôle du profil Factur-X reçu, chemin de fer des sous-lignes EXTENDED rapproché du total de lignes, notices réforme et parcours CTC), Allemagne 1.0.0 (format TVA DE et Leitweg-ID en BT-10 sur les XRechnung, clé Mod 97-10) et Belgique 1.0.0 (format TVA BE et communication structurée en BT-83, clé Mod 97) ;
- vérification à la demande d’un numéro de TVA auprès de VIES, avec résultat horodaté `vérifié`, `non vérifié` ou `indisponible` ;
- recherche publique et comparaison des exigences de réception, sans compte ; aucune certification d'identité juridique de l'entreprise ;
- registre : recherche avec ouverture du lien stable, publication depuis « Mon CheckLink » après connexion et invitation préalable ; comparaison visible dans le parcours fournisseur ;
- compteurs d'usage minimisés : profil publié activé par l'acheteur ET accord distinct du fournisseur, organisation réelle (pas le nom), jeton signé de 5 minutes ; lecture agrégée par clé admin/owner, pagination et export CSV neutralisé ; signaux déclaratifs, pas preuve de traction ;
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
- aucune requête de mesure sans les deux accords ; le corps ne porte aucune donnée de facture mais le transport transmet les métadonnées réseau usuelles à l'hébergeur, donc aucun anonymat absolu promis ;
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

Le serveur local expose santé, validation XML, identité, membres et registre. Le Worker `0.24.0` expose identité, recherche, résolution des liens stables, comparaison, mesure d'usage et publication authentifiée. Il utilise l'identité Sites (connexion ChatGPT) puis vérifie une invitation explicite dans `settlemesh_members` : être connecté ne suffit pas. Le serveur local conserve son mécanisme mot de passe/MFA ; aucun mot de passe SettleMesh n'est demandé sur le Worker. La validation XML API et l'administration des clés restent locales. Secrets `SETTLEMESH_SUPABASE_*` requis côté serveur ; sans eux, les fonctions de base répondent explicitement indisponibles. Aucune clé dans le navigateur.

La configuration des clés garde la priorité fichier > Supabase > environnement. Les rôles et révocations d'environnement sont conservés ; seul un rôle omis garde le défaut historique owner. Voir [`docs/API.md`](./docs/API.md) et [`docs/openapi.yaml`](./docs/openapi.yaml). Schéma reproductible : [`migrations/001_pilot.sql`](./migrations/001_pilot.sql), à appliquer consciemment dans la base dédiée, jamais automatiquement. Le trigger de versions atomiques n'est actif qu'après application de cette migration. Audit externe, purge, chiffrement des secrets TOTP locaux et supervision restent des portes de production.

Vérification reproductible : `npm ci`, `npm test`, `npm run check`, `npm run build:site`, `git diff --check` ; GitHub Actions exécute ces contrôles à chaque push/PR. Les schémas XSD et leurs empreintes sont vendorizés ; `scripts/fetch-xsd-assets.mjs` est une acquisition explicite depuis OASIS/OpenPeppol, pas une étape réseau pendant un contrôle. `npm run build:validator` reconstruit les moteurs locaux, y compris le WebAssembly.

## Démonstration

Dans **Tester une facture**, utiliser :

- **Exemple avec erreurs** pour observer la mauvaise entité, la TVA incorrecte, l’adresse de réception différente et l’absence de commande ;
- **Exemple conforme** pour obtenir un résultat prêt à envoyer.

Un PDF Factur-X déclenche en plus des contrôles locaux sur la déclaration PDF/A-3, le niveau déclaré, les propriétés XMP Factur-X, le nom du XML embarqué et son association au catalogue PDF. Le diagnostic contient toujours un contrôle de portée rappelant que cette inspection structurelle ne remplace pas une validation ISO 19005-3 complète avec veraPDF.

Il est aussi possible de déposer jusqu’à 20 fichiers en une fois. Le tableau de synthèse ouvre ensuite le diagnostic détaillé de chaque facture et s’exporte en CSV.

Dans **Mon CheckLink**, le profil peut être exporté en JSON puis réimporté dans un autre navigateur. Dans **Contrôles**, l’historique peut être recherché, filtré et exporté en CSV. Il est conservé uniquement dans le navigateur, pendant 30 jours et dans la limite de 100 résultats ; le diagnostic détaillé reste limité à la session courante.

La **Vue d'ensemble** contient aussi un bloc « Mesure pilote ». Ses compteurs sont enregistrés dans le navigateur, séparément de l'historique limité à 100 résultats. Ils peuvent être exportés volontairement en JSON ou remis à zéro sans supprimer l'historique. Cet export ne contient pas le XML, les numéros de facture, les fournisseurs, les montants ni les identifiants fiscaux.

La mesure d'usage nécessite un profil publié qui l'active et la case facultative du fournisseur dans **Tester une facture**. Les anciens liens instantanés ne transmettent aucun événement. Les requêtes utilisent l'organisation du registre et un jeton signé en en-tête ; le serveur vérifie à nouveau publication et activation. Aucun contenu de facture n'est envoyé. Les agrégats se lisent avec une clé admin ou owner : `GET /api/v1/metrics?from=…&to=…` et `/api/v1/metrics/export?from=…&to=…`. Ce sont des événements déclaratifs, reproductibles par un visiteur : ni personnes uniques, ni revenus, ni rejets évités. Une déduplication persistante et une politique de purge restent nécessaires avant usage commercial de ces statistiques.

Dans **Sources & règles**, les contrôles VIES et Peppol Directory sont lancés manuellement. Un état « vérifié » signifie uniquement que la source a répondu positivement à l’instant indiqué. Les identifiants et réponses ne sont pas ajoutés à l’historique SettleMesh ni au stockage du navigateur.

## SettleMesh Net

Limites : 500 factures et 80 participants, devises ISO à deux décimales uniquement. Référence, devise, statut d'acceptation (`accepted`, `approved`, `accepte[e]`, `approuve[e]`), déclarations `disputed` et `assigned` sont explicites. Un statut `due` ou `validated` seul ne prouve pas l'acceptation. Toute référence dupliquée pour le même créancier est exclue en entier ; chaque exclusion est affichée. Une limite dépassée refuse le fichier entier, sans remplacer le registre courant. Les identités des parties restent déclaratives ; aucun rapprochement juridique automatique par nom.

La page **SettleMesh Net** contient un réseau de démonstration et accepte un registre CSV utilisant les colonnes suivantes :

```text
invoice_number;debtor;creditor;amount;currency;due_date;status;disputed;assigned
```

Le moteur regroupe les obligations par devise, compense d’abord les dettes bilatérales, puis détecte les cycles triangulaires. Il conserve la position nette de chaque participant et exporte les propositions avec l’allocation aux factures d’origine. La simulation peut être bornée par un cut-off : « toutes les échéances » (défaut), « cut-off aujourd'hui » ou une date personnalisée au format `AAAA-MM-JJ`. Les obligations postérieures au cut-off ou sans échéance exploitable sont différées et signalées par un compteur distinct, jamais supprimées, et la somme des positions nettes reste inchangée. L'export CSV mentionne le cut-off retenu dans la colonne `scenario_cutoff`.

Cette fonctionnalité est une simulation d’aide à la décision. Elle ne déplace aucun fonds, n’initie aucun paiement et ne constate pas juridiquement l’extinction des créances. Toute mise en production nécessite notamment un accord entre les parties et une validation juridique, comptable et fiscale.

## Périmètre

Les contrôles sont une aide à la préparation et ne constituent ni une certification juridique ni une garantie d'acceptation. Les artefacts EN 16931 et Peppol sont exécutés dans le navigateur, sans envoi de la facture à un serveur. Les règles nationales sont des packs déclaratifs versionnés (module client `web/rules/`), chargés localement, avec source citée et date d'effet ; les packs disponibles aujourd'hui sont France 1.3.0, Allemagne 1.0.0 et Belgique 1.0.0. VIES vérifie ponctuellement un statut TVA ; Peppol Directory indique une présence d’annuaire, pas la joignabilité SMP ni la capacité réelle à recevoir un document donné. Pour Factur-X, le MVP détecte des incohérences structurelles PDF/A-3 visibles mais ne contrôle pas exhaustivement les polices, couleurs, profils ICC, actions et autres règles ISO 19005-3 : veraPDF ou un validateur équivalent reste nécessaire. Les règles nationales supplémentaires ne sont pas encore intégrées.

Revue 0.24.0 : voir le §19 de `PROJECT_DASHBOARD.md` pour les correctifs, tests et limites. Publication privée confirmée (version Sites 11, code `d8a7756`) et code poussé sur GitHub. Le Site reste privé par décision explicite : un testeur EWOR doit être invité via Sites. Les contrôles techniques hébergés répondent correctement, mais l'accès visiteur dans le navigateur n'est pas validé : erreur 500 puis vérification de sécurité lors de la connexion plateforme, à terminer avant un essai externe. La connexion de la base hébergée n'est pas présumée autorisée ; tant qu'elle n'est pas configurée, publication/registre/mesure distante restent indisponibles. La démonstration locale et les liens instantanés non authentifiés restent utilisables ; aucune traction n'est présentée comme acquise.
