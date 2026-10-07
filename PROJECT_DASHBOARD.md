# SettleMesh — tableau de bord produit et technique

> Source de vérité vivante du projet. Toute modification du produit doit commencer par la lecture de ce document et se terminer par sa mise à jour si le périmètre, le comportement, les risques, les tests ou la feuille de route ont changé. La règle exécutoire se trouve dans `AGENTS.md`.

## 0. Carte d'identité

| Champ | Valeur actuelle |
|---|---|
| Produit | **SettleMesh**, avec le module d'acquisition **SettleMesh CheckLink** et l'upsell **SettleMesh Net** |
| Version du code | `0.9.0` |
| État | MVP fonctionnel durci, avec métriques pilote locales, connecteurs VIES/Peppol sans persistance, Worker publié et API de validation locale authentifiée ; pas encore un service multi-utilisateurs en production |
| Dernière revue | 7 octobre 2026 |
| Dépôt | `williammartin75/SettleMesh`, branche `main` |
| Hébergement configuré | Worker Sites servant les assets construits et les routes d’identité VIES/Peppol ; l’API Node de validation des factures n’est pas déployée |
| Langue actuelle | Français |
| Architecture | HTML, CSS et JavaScript natifs sous `web/` ; Worker sans stockage pour les connecteurs d’identité ; serveur Node local pour l’ensemble de l’API pilote `/api/v1` |
| Promesse courte | **Rendre les factures conformes avant envoi, puis identifier les paiements qui peuvent être compensés.** |
| Wedge d'acquisition | CheckLink gratuit ou peu coûteux partagé par un acheteur avec ses fournisseurs |
| Upsell | SettleMesh Net : simulation et orchestration de compensations interentreprises |
| Position réglementaire du MVP | Outil de contrôle et d'aide à la décision ; ne conserve pas de fonds, n'initie pas de paiement et ne constate pas seul l'extinction juridique d'une dette |
| Tests automatisés | 53 tests au 7 octobre 2026 |

## 1. Vision et thèse produit

### 1.1 Problème résolu

Les factures électroniques échouent souvent pour deux familles de raisons :

1. la facture ne respecte pas une norme technique ou un format accepté ;
2. elle respecte la norme générale mais pas les exigences particulières du destinataire : bonne entité, bonne TVA, adresse électronique, numéro de commande, référence acheteur ou devise.

Même après validation, chaque entreprise continue normalement à exécuter tous ses paiements bruts. Dans un réseau où les mêmes acteurs s'achètent et se vendent des services, une partie de ces flux peut se neutraliser économiquement.

### 1.2 Réponse de SettleMesh

Le produit suit une chaîne de valeur en deux temps :

```text
Profil de réception de l'acheteur
        ↓
CheckLink partagé au fournisseur
        ↓
Prévalidation locale de la facture
        ↓
Obligation acceptée et exploitable
        ↓
Détection de dettes réciproques ou cycliques
        ↓
Proposition de compensation soumise à accord
        ↓
Paiement du seul solde résiduel via un partenaire futur
```

### 1.3 Pourquoi le produit peut créer un effet réseau

- Chaque acheteur partage son CheckLink avec plusieurs fournisseurs.
- Chaque fournisseur découvre le produit au moment où il veut être payé.
- Un fournisseur peut ensuite créer son propre profil de réception et inviter ses partenaires.
- Plus il existe d'obligations validées entre entreprises, plus SettleMesh Net peut détecter de boucles compensables.
- La conformité apporte une valeur immédiate même avec une seule entreprise ; la compensation augmente ensuite la valeur avec la densité du réseau.

### 1.4 Ce que le produit ne doit pas devenir trop tôt

- Une nouvelle plateforme de facturation généraliste remplaçant les ERP.
- Une Plateforme Agréée de facturation électronique construite de zéro.
- Un établissement détenant les fonds de ses clients.
- Un service initiant des paiements sans partenaire habilité ni analyse réglementaire.
- Une promesse de conformité juridique absolue.
- Un moteur de compensation opaque modifiant des créances sans accord des parties.

## 2. Utilisateurs, clients et partenaires

### 2.1 Utilisateur acheteur / équipe finance

Objectifs : réduire les rejets, les échanges par e-mail, le coût du traitement fournisseur et les paiements inutiles.

Actions actuelles :

- configurer un profil de réception ;
- générer et partager un CheckLink ;
- consulter les contrôles réalisés dans son navigateur ;
- importer un registre d'obligations ;
- visualiser des opportunités de compensation.

### 2.2 Utilisateur fournisseur

Objectifs : savoir exactement comment facturer un client, corriger les erreurs avant l'envoi et être payé plus vite.

Actions actuelles :

- ouvrir un CheckLink sans compte ;
- voir les exigences du destinataire ;
- déposer une facture XML ou Factur-X ;
- recevoir un diagnostic et des instructions de correction ;
- télécharger un rapport lisible ou JSON.

### 2.3 Logiciel de facturation / ERP

Valeur potentielle : intégrer un contrôle spécialisé multi-pays sans maintenir en interne chaque artefact normatif et chaque règle acheteur.

Intégration future attendue : API de validation, widget embarqué, webhook de résultat, synchronisation des obligations et retour de statut.

### 2.4 Plateforme Agréée, opérateur Peppol ou prestataire de paiement

Valeur potentielle : recevoir des documents de meilleure qualité, réduire les rejets, enrichir son offre et exécuter les paiements résiduels sans que SettleMesh manipule directement les fonds.

### 2.5 Investisseur / programme entrepreneurial

Ce qui rend le projet défendable :

- point d'entrée simple et partageable ;
- coût marginal faible pour le contrôle local ;
- données structurées permettant un second produit à forte valeur ;
- expansion européenne par connecteurs et règles versionnées ;
- potentiel d'effet réseau sur les obligations interentreprises ;
- trajectoire possible de SaaS vers infrastructure financière sans exiger cet agrément dès le MVP.

## 3. Tableau de bord fonctionnel

Légende :

- **Opérationnel** : présent dans l'interface et couvert au moins partiellement par des tests.
- **Partiel** : utile pour une démonstration mais incomplet pour un pilote réel.
- **Prévu** : absent du code actuel.
- **Bloqué partenaire / juridique** : ne doit pas être activé sans cadre supplémentaire.

| Domaine | Fonction | Statut | Limite ou prochaine condition |
|---|---|---:|---|
| Acquisition | CheckLink partageable sans compte fournisseur | Opérationnel | Profil encodé dans le fragment d'URL, pas de gestion centralisée |
| Profil | Identité, pays, TVA, Peppol, canal | Opérationnel | Pays proposés : FR, BE, DE, NL, LU |
| Profil | Formats, devises et règles propres à l'acheteur | Opérationnel | Validation de saisie encore légère |
| Profil | Export/import JSON portable | Opérationnel | Fichier local, pas de gestion de versions distante |
| Facture | Lecture UBL Invoice et CreditNote | Opérationnel | Sous-ensembles testés, pas toutes les variantes nationales |
| Facture | Lecture CII | Opérationnel | Sous-ensembles testés |
| Facture | Extraction XML d'un PDF Factur-X | Opérationnel | Ne certifie pas encore le conteneur PDF/A-3 |
| Normes | EN 16931 v1.3.16 UBL/CII | Opérationnel | Artefacts à surveiller et mettre à jour |
| Normes | Peppol BIS Billing 3.0.21 | Opérationnel | Déclenché sur les UBL déclarant un profil Peppol |
| Règles acheteur | Entité, TVA, devise, références, endpoint | Opérationnel | Les règles doivent rester explicables et déterministes |
| Résultat | Score, statut et corrections | Opérationnel | Score produit, pas une certification officielle |
| Lots | Jusqu'à 20 fichiers, 20 Mo chacun | Opérationnel | Traitement séquentiel dans le navigateur |
| Rapports | TXT, JSON et CSV | Opérationnel | Pas de signature ni piste d'audit serveur |
| Historique | Recherche, filtre, export et suppression locale | Opérationnel | Champs minimisés, 100 résultats et 30 jours maximum dans le navigateur ; diagnostic détaillé limité à la session |
| Mesure pilote | Compteurs d’activation agrégés, export JSON et remise à zéro | Opérationnel | Stockage local uniquement ; aucune ouverture externe ou correction inter-session mesurable sans télémétrie consentie |
| Intégration | API de validation `/api/v1` | Partiel | Endpoint local authentifié par clé d'organisation ; secrets, quotas et audit persistants ainsi que déploiement de production absents |
| Netting | Import CSV d'obligations | Opérationnel | 2 Mo et 500 obligations conservées localement |
| Netting | Compensation bilatérale | Opérationnel | Simulation seulement, accord requis |
| Netting | Cycles triangulaires | Opérationnel | Cycles de trois uniquement |
| Netting | Isolation par devise | Opérationnel | Aucune conversion de change |
| Netting | Exclusion litige / cession / statut | Opérationnel | Déclarations fournies par l'importeur, non vérifiées extérieurement |
| Netting | Positions nettes et paiements résiduels | Opérationnel | Aucun ordre de paiement n'est émis |
| Netting | Export des propositions et allocations | Opérationnel | Document de travail, pas un accord signé |
| Identité | Clés API d'organisation | Partiel | Hashes et quotas en mémoire ; aucun compte, session, membre ou rôle utilisateur |
| Identité | Comptes, organisations multi-utilisateurs, rôles | Prévu | Nécessite stockage d'identité, sessions, invitations et droits persistants |
| Réseau | Invitations et contreparties vérifiées | Prévu | Condition du vrai effet réseau |
| Connecteurs | VIES | Opérationnel | Requête explicite sans stockage ; réponse ponctuelle, disponibilité amont et portée juridique limitées |
| Connecteurs | Peppol Directory | Opérationnel | Recherche exacte limitée à 2/s ; présence d’annuaire distincte de la joignabilité SMP |
| Connecteurs | PDP/PA et ERP | Prévu | APIs, authentification, quotas et gouvernance à cadrer |
| Workflow | Acceptation multilatérale de la compensation | Prévu | Signature, horodatage et règles juridiques |
| Paiement | Exécution du résiduel | Bloqué partenaire / juridique | À confier à un PSP/établissement habilité après analyse |
| Production | Journal d'audit, supervision, sauvegarde | Prévu | Obligatoire avant données réelles sensibles |

## 4. Pages de l'application actuelle

### 4.1 Vue d'ensemble — route `#overview`

Rôle : cockpit de l'entreprise destinataire et point d'entrée vers les deux boucles de valeur.

Éléments présents :

- promesse CheckLink ;
- taux de complétude du profil ;
- nombre de contrôles locaux ;
- nombre et taux de factures prêtes ;
- nombre d'anomalies évitées ;
- impact pilote agrégé : CheckLinks copiés, fichiers soumis, taux analysable, taux prêt et temps moyen ;
- export JSON volontaire et remise à zéro des métriques locales ;
- CheckLink copiable ;
- état des éléments de préparation ;
- aperçu de l'expérience fournisseur ;
- quatre derniers contrôles ;
- bannière d'upsell vers SettleMesh Net.

Décision produit : cette page doit toujours montrer la progression vers une action mesurable, et non devenir une collection de graphiques décoratifs.

### 4.2 Mon CheckLink — route `#profile`

Rôle : configurer une fois les exigences de réception et produire un lien autonome.

Champs d'identité :

- nom affiché ;
- raison sociale ;
- pays ;
- numéro de TVA ;
- identifiant Peppol ;
- plateforme ou canal de réception.

Champs de règles :

- formats UBL, CII et Factur-X ;
- devises ISO acceptées ;
- adresse de soumission ;
- numéro de commande BT-13 obligatoire ou facultatif ;
- référence acheteur BT-10 obligatoire ou facultative ;
- adresse électronique BT-49 obligatoire ou facultative ;
- pièce justificative demandée ;
- instructions complémentaires en texte libre.

Comportements :

- sauvegarde dans `localStorage` ;
- recalcul du taux de complétude ;
- régénération immédiate du lien ;
- export JSON versionné ;
- import JSON avec contrôles de structure, taille maximale 100 Ko, formats connus et devises ISO.

### 4.3 Tester une facture — route `#checker`

Rôle : permettre au fournisseur de corriger sa facture avant de la transmettre.

Entrées :

- glisser-déposer ou sélection de fichiers ;
- XML `.xml`, `.ubl`, `.cii` ;
- PDF `.pdf` contenant un XML Factur-X exploitable ;
- collage manuel de XML ;
- exemple conforme ;
- exemple volontairement erroné ;
- lot de 20 fichiers maximum ;
- 20 Mo maximum par fichier.

Sorties :

- statut `Prête à envoyer`, `À vérifier` ou `Correction requise` ;
- score sur 100 ;
- contrôles détaillés avec champ BT/BG associé ;
- explication et correction suggérée ;
- résumé du document ;
- rapport texte ;
- rapport JSON structuré ;
- synthèse et export CSV d'un lot.

Confidentialité actuelle : dans l'interface, le fichier est traité en mémoire et aucune requête contenant son contenu n'est envoyée à un serveur SettleMesh. Le XML brut est retiré avant l'enregistrement du résultat dans l'historique. L'API v1 de validation constitue un canal distinct et explicite : son client envoie le XML au serveur local, qui le traite sans le persister ni le renvoyer. Les routes d’identité ne reçoivent jamais le contenu d’une facture.

### 4.4 SettleMesh Net — route `#netting`

Rôle : transformer un registre d'obligations acceptées en propositions de réduction des flux bruts.

Entrées CSV obligatoires :

| Champ canonique | Alias acceptés principaux | Rôle |
|---|---|---|
| `invoice_number` | invoice, facture, numero_facture, reference | Référence unique de facture |
| `debtor` | debiteur, acheteur, buyer, client | Partie qui doit payer |
| `creditor` | crediteur, fournisseur, supplier, vendor | Partie qui doit recevoir |
| `amount` | montant, total, payable_amount | Montant positif de l'obligation |
| `currency` | devise | Code ISO à trois lettres |
| `due_date` | echeance, date_echeance | Ordre de consommation des obligations |
| `status` | statut | Éligibilité de la facture |
| `disputed` | litige, en_litige | Exclusion d'une facture litigieuse |
| `assigned` | cedee, cede, affacturee, factored | Exclusion d'une créance cédée |

Contraintes actuelles :

- CSV avec virgule ou point-virgule ;
- cellules citées prises en charge ;
- limite de 2 Mo ;
- 500 obligations maximum persistées ;
- montants arrondis à deux décimales ;
- aucune compensation entre devises ;
- seules les factures avec statut accepté, approuvé, validé ou dû sont éligibles ;
- facture litigieuse ou déclarée cédée exclue ;
- débiteur et créancier doivent être distincts ;
- le calcul consomme d'abord les obligations les plus proches en échéance, puis par référence.

Algorithme v0.3 :

1. normaliser les colonnes, les noms et les montants ;
2. séparer les obligations éligibles et exclues ;
3. grouper strictement par devise ;
4. détecter les dettes bilatérales opposées ;
5. consommer le minimum commun de chaque paire ;
6. détecter des cycles dirigés de trois entreprises ;
7. consommer le minimum disponible sur chaque branche du cycle ;
8. conserver l'allocation aux factures d'origine ;
9. calculer les résiduels et la position nette de chaque participant ;
10. exporter les propositions sans formules CSV exécutables.

Sorties :

- volume brut éligible ;
- volume compensable ;
- cash résiduel ;
- taux de compensation par devise ;
- nombre de flux avant et après ;
- propositions bilatérales ou triangulaires ;
- factures mobilisées dans chaque proposition ;
- position nette par entreprise et par devise ;
- paiements résiduels ;
- nombre d'obligations exclues ;
- export CSV des propositions.

Définition importante : `grossReduction` représente la somme des branches neutralisées. Une compensation bilatérale de 25 000 € sur deux branches réduit 50 000 € de volume brut ; un cycle de 70 000 € sur trois branches réduit 210 000 €.

### 4.5 Contrôles — route `#history`

Rôle : rendre les validations locales retrouvables et exportables.

Fonctions :

- 100 résultats maximum et 30 jours de rétention, les plus récents en premier ;
- recherche sur facture, fournisseur et données associées ;
- filtre par résultat ;
- score et date ;
- export CSV ;
- suppression complète avec confirmation.

Limite : l'historique appartient au navigateur courant. Il ne constitue pas encore une piste d'audit partagée.

### 4.6 Sources & règles — route `#sources`

Rôle : rendre visible l'origine des validations et éviter l'effet « boîte noire ».

Sources actives :

- EN 16931 version 1.3.16 pour UBL et CII ;
- Peppol BIS Billing version 3.0.21 pour les UBL déclarant ce profil ;
- VIES pour une validation ponctuelle d’un numéro TVA ;
- Peppol Directory pour une recherche exacte de participant ;
- règles configurées par le destinataire.

Les deux connecteurs d’identité sont déclenchés uniquement au clic. Ils affichent `vérifié`, `non vérifié` ou `indisponible`, l’horodatage et les limites de portée. SettleMesh ne persiste ni l’identifiant vérifié ni la réponse. VIES ne certifie pas une entreprise ; Peppol Directory ne garantit ni la joignabilité SMP ni la livraison d’une facture.

## 5. Contrôles de facture détaillés

### 5.1 Extraction structurée

Le parseur extrait actuellement : syntaxe, type de document, identifiants de profil, numéro, date, devise, référence acheteur, commande, noms et identifiants fiscaux fournisseur/acheteur, endpoints, totaux, montant payable et nombre de lignes.

### 5.2 Contrôles produit déterministes

| Contrôle | Référence | Résultat bloquant possible |
|---|---|---:|
| Syntaxe UBL/CII reconnue | Document | Oui si non lisible avant analyse |
| Format accepté par l'acheteur | Format | Oui |
| Numéro de facture | BT-1 | Oui |
| Date d'émission | BT-2 | Oui |
| Devise acceptée | BT-5 | Oui |
| Nom fournisseur | BT-27 | Oui |
| TVA/identifiant fournisseur | BT-31 | Oui |
| Bonne entité acheteur | BT-44 | Oui |
| TVA acheteur correspondante | BT-48 | Oui |
| Numéro de commande exploitable | BT-13 | Selon profil |
| Référence acheteur exploitable | BT-10 | Selon profil |
| Endpoint correspondant | BT-49 | Selon profil |
| Cohérence HT + TVA = TTC | BT-109/110/112 | Oui si écart supérieur à 0,02 |
| Présence de lignes | BG-25 | Avertissement |

Les valeurs comme `N/A`, `none`, `aucun` ou `sans` ne sont pas considérées comme de vraies références.

### 5.3 Contrôles officiels

- SaxonJS exécute dans le navigateur les artefacts compilés en SEF.
- EN 16931 est exécuté pour UBL et CII.
- Peppol est ajouté si le `CustomizationID` indique Peppol.
- Au maximum 24 erreurs d'un rapport normatif sont détaillées à l'écran ; les suivantes sont condensées.
- Une indisponibilité du moteur officiel devient un avertissement explicite, pas une validation silencieuse.

### 5.4 Score et résultat

- `pass` vaut 1 dans le score.
- `warning` vaut 0,45.
- `error` vaut 0.
- `info` est exclu du dénominateur.
- Au moins une erreur produit le statut `blocked` / « Correction requise ».
- Sans erreur mais avec avertissement, le statut est `review` / « À vérifier ».
- Sans erreur ni avertissement, le statut est `ready` / « Prête à envoyer ».

Le score est un indicateur d'expérience utilisateur. Il ne doit jamais être présenté comme un taux officiel de conformité ou une garantie d'acceptation.

## 6. Parcours utilisateurs de référence

### 6.1 Parcours acheteur — activation CheckLink

1. Ouvrir « Mon CheckLink ».
2. Renseigner l'identité légale et les identifiants de réception.
3. Choisir les formats, devises et références obligatoires.
4. Enregistrer.
5. Copier le lien généré.
6. L'ajouter aux bons de commande, portails fournisseurs, signatures ou guides de facturation.
7. Suivre localement les contrôles réalisés sur le navigateur de démonstration.

Critère de succès pilote : le fournisseur comprend les exigences et corrige sa facture sans intervention manuelle de l'équipe finance.

### 6.2 Parcours fournisseur — prévalidation

1. Ouvrir le CheckLink reçu.
2. Vérifier l'identité et les exigences du client.
3. Déposer la facture.
4. Lire le statut et les anomalies.
5. Corriger dans le logiciel d'origine.
6. Relancer le contrôle.
7. Télécharger le rapport si nécessaire.
8. Envoyer la facture par le canal officiel du client.

Critère de succès pilote : réduction des rejets de premier passage et du délai entre émission et acceptation.

### 6.3 Parcours trésorier — simulation SettleMesh Net

1. Exporter les factures acceptées depuis l'ERP.
2. Mapper les colonnes sur le modèle CSV.
3. Marquer les litiges et créances cédées.
4. Importer le registre.
5. Examiner les exclusions.
6. Vérifier les positions nettes et les propositions.
7. Exporter les propositions.
8. Obtenir l'accord des parties hors produit dans le MVP.
9. Comptabiliser la compensation selon le cadre validé.
10. Régler les soldes restants via les canaux habituels.

Critère de succès pilote : valeur économiquement neutralisable démontrée, sans erreur de position nette et avec traçabilité facture par facture.

## 7. Architecture et responsabilités des fichiers

```text
SettleMesh/
├── AGENTS.md                    règle de contrôle avant/après modification
├── PROJECT_DASHBOARD.md         source de vérité produit et technique
├── README.md                    prise en main courte
├── package.json                 version, scripts et dépendances
├── .openai/hosting.json         identité et configuration du Worker Sites
├── web/
│   ├── index.html               structure des six vues
│   ├── styles.css               design system et responsive
│   ├── app.js                   état, navigation, rendu et interactions
│   ├── identity.js              client same-origin VIES / Peppol
│   ├── storage.js               persistance locale et migration de l'ancienne marque
│   ├── svrl.js                  lecture partagée des rapports de validation officiels
│   ├── core.js                  profil, parsing et validation métier facture
│   ├── facturx.js               extraction du XML embarqué dans un PDF
│   ├── standards.js             exécution EN 16931 et Peppol
│   ├── metrics.js               agrégats d’activation locaux et export à liste blanche
│   ├── netting.js               parsing CSV et moteur de compensation
│   ├── validation/              artefacts XSLT compilés en SEF
│   └── vendor/                  runtimes PDF.js et SaxonJS pour le navigateur
├── worker/
│   ├── index.js                 routes d’identité, quotas et service des assets
│   └── identity.mjs             validation des entrées et appels officiels normalisés
├── dist/                        artefact Worker généré et ignoré par Git
│   ├── client/                  copie de web/ pour publication
│   └── server/                  Worker et configuration des assets
├── scripts/
│   ├── serve.mjs                lancement de l'application et de l'API locale, port 4173
│   ├── create-api-key.mjs       génération locale d'une clé et de son hash de configuration
│   ├── build-site-worker.mjs    construction déterministe de dist/
│   └── build-validation-assets.mjs
│                                compilation/copie des moteurs normatifs
├── test/
│   ├── core.test.js             profil, règles et exports
│   ├── standards.test.js        artefacts officiels et Factur-X réel
│   ├── netting.test.js          invariants de compensation et CSV
│   ├── storage.test.js          priorité et migration du stockage local
│   ├── metrics.test.js          agrégation, bornes et confidentialité des métriques
│   ├── identity.test.js         VIES, Peppol, états et minimisation des réponses
│   ├── api.test.js              contrat HTTP, confidentialité et limites API
│   ├── auth.test.js             clés, hashes, rotation et configuration d'organisation
│   └── fixtures/                documents de test
├── server/
│   ├── auth.mjs                 génération, configuration et authentification des clés API
│   ├── server.mjs               HTTP, routage, limites et fichiers statiques
│   └── validation.mjs           validation serveur EN 16931 / Peppol
├── docs/
│   ├── API.md                   guide humain d'intégration
│   ├── openapi.yaml             contrat OpenAPI 3.1
│   └── SECURITY.md              revue OWASP/RGPD, modèle de menace et portes de production
└── vendor/                      sources et licences normatives
```

### 7.1 Modèle d'état local

Clé `localStorage` : `settlemesh-v1`. Au premier chargement, l'application recherche aussi l'ancienne clé `eurule-checklink-v1` et copie son contenu valide afin de préserver les profils, l'historique et les obligations existants.

```text
profile      configuration de réception de l'entreprise
history      historique compact, 100 résultats et 30 jours maximum, sans XML ni détail des contrôles
metrics      compteurs d’activation agrégés, sans contenu ni identifiant de facture
netting
  obligations  jusqu'à 500 obligations normalisées
  source       nom descriptif du registre chargé
```

`lastResult`, le dernier diagnostic détaillé, reste uniquement en mémoire pendant la session et n'est jamais écrit dans `localStorage`.

### 7.2 Modèle de partage CheckLink

Le profil compact est sérialisé en JSON, encodé en UTF-8 puis en Base64 URL-safe dans le fragment `#check/...`. Le fragment n'est normalement pas envoyé au serveur HTTP. L'application passe alors en expérience fournisseur publique et utilise le profil contenu dans le lien.

Conséquence : toute donnée placée dans le profil est visible par le destinataire du lien. Ne jamais y ajouter de secret, clé API, information bancaire ou donnée confidentielle.

### 7.3 Dépendances

- `SaxonJS 2.7.0` : exécution des règles XSLT compilées.
- `xslt3 2.7.0` : compilation des artefacts de validation.
- `pdfjs-dist 6.4.299` : lecture des pièces jointes PDF.
- `@xmldom/xmldom 0.9.12` : parsing XML dans le runtime Node de l'API.
- Aucun framework frontend.
- Services externes appelés uniquement à la demande : VIES (`ec.europa.eu`) et Peppol Directory (`directory.peppol.eu`).

### 7.4 API de validation v1

Le serveur local expose `GET /api/v1/health`, `POST /api/v1/validate`, `POST /api/v1/identity/vies` et `POST /api/v1/identity/peppol`. La validation reçoit un JSON contenant le XML, un profil optionnel et un nom de source. Elle exige une clé Bearer dont seul le hash SHA-256 est configuré côté serveur, détermine l'organisation depuis cette clé, puis exécute les contrôles produit, EN 16931 et, si applicable, Peppol. La réponse ne contient pas le XML brut et porte `stored: false`.

Le Worker publié n’expose que les deux routes d’identité. Elles sont same-origin, limitées, sans base de données et renvoient une réponse normalisée `verified`, `not_verified` ou `unavailable`. Le pays et le numéro TVA ou l’identifiant Peppol transitent vers la source officielle après un clic explicite. SettleMesh ne met en cache ni la requête ni la réponse.

Limites : corps HTTP de validation de 2 Mo, XML de 1 Mo, protection générale de 120 requêtes par minute et par adresse IP, puis quota configurable par organisation de 60 par défaut. L'API accepte uniquement JSON et XML UBL/CII et refuse les déclarations `DOCTYPE`. Sans configuration de clé la validation reste fermée. Les routes d’identité utilisent un délai amont de 8 secondes ; Peppol est limité au mieux à deux recherches par seconde, conformément à sa documentation publique. Aucun endpoint n’ouvre CORS. Le serveur et le Worker appliquent CSP, anti-frame, `nosniff`, politiques referrer/permissions et isolation cross-origin. Les secrets, révocations et quotas distribués ne sont pas encore persistants. Le contrat de référence est `docs/openapi.yaml`.

## 8. Invariants à ne jamais casser

### 8.1 Invariants conformité

- Une règle officielle et une règle propre à l'acheteur doivent rester identifiables.
- Une indisponibilité d'un validateur ne doit jamais être convertie en succès.
- Une facture non reconnue ne doit pas être évaluée comme conforme.
- Le score ne doit pas être présenté comme certification juridique.
- Les versions EN 16931 et Peppol actives doivent être affichées et documentées.

### 8.2 Invariants confidentialité

- L'interface navigateur ne transmet pas le contenu des factures à un backend SettleMesh ; seul un client intégrateur appelle explicitement l'API locale de validation.
- Une vérification d’identité doit rester une action explicite et ne transmettre que le pays/numéro TVA ou l’identifiant Peppol nécessaire à la source annoncée.
- Les requêtes et réponses VIES/Peppol ne doivent pas être persistées ni entrer dans la télémétrie ; une panne amont doit rester `indisponible`, jamais `vérifié` ou `non vérifié`.
- Le XML brut ne doit pas entrer dans l'historique persistant.
- Le diagnostic détaillé ne doit pas être persisté ; l'historique est limité à une liste blanche de champs, 100 entrées et 30 jours.
- L'API ne doit ni persister, ni renvoyer, ni journaliser le XML brut.
- Une clé API brute ne doit jamais être enregistrée dans le dépôt, le CheckLink, les logs ou une réponse ; seul son hash peut être configuré côté serveur.
- L'organisation d'une requête API doit être déterminée par le serveur depuis la clé authentifiée, jamais acceptée depuis le corps client.
- Les exports CSV doivent neutraliser les cellules commençant par `=`, `+`, `-` ou `@`.
- Les nouvelles limites de taille doivent être explicites côté interface et code.
- Aucune donnée sensible ne doit être ajoutée au fragment du CheckLink.

### 8.3 Invariants compensation

- Ne jamais compenser entre deux devises différentes.
- Ne jamais inclure une obligation non positive, contestée, cédée ou au statut non éligible.
- Préserver la position nette de chaque participant dans chaque devise.
- Conserver le lien entre proposition et factures d'origine.
- Afficher qu'un accord de toutes les parties est requis.
- Ne jamais présenter une simulation comme une extinction déjà effective.
- Ne jamais initier ou détenir un paiement sans architecture et partenaire autorisés.

### 8.4 Invariants expérience

- Le fournisseur doit pouvoir tester une facture sans créer de compte.
- Une erreur doit dire quoi corriger et, si possible, dans quel champ BT/BG.
- Un état vide, un état de chargement, un succès et un échec doivent être compréhensibles.
- La navigation par clavier sur les zones de dépôt doit continuer à fonctionner.
- Les pages doivent rester utilisables en largeur mobile.

## 9. Sécurité, droit et limites déclarées

### 9.1 Position actuelle

SettleMesh v0.9 fournit un précontrôle technique, des vérifications VIES/Peppol ponctuelles, des métriques pilote agrégées locales, une API locale authentifiée d'intégration et une simulation de compensation. Le produit n'émet pas d'avis juridique, ne certifie pas une entreprise, ne garantit pas l'acceptation d'une facture et n'opère pas de règlement.

### 9.2 Revue sécurité et RGPD interne

La revue du 7 octobre 2026 est consignée dans `docs/SECURITY.md`. Elle couvre le frontend, le Worker, le stockage navigateur, les imports non fiables, les connecteurs externes, l'API locale, les dépendances, les actifs, frontières de confiance, menaces et portes de production. La version `0.8.0` a ajouté CSP, protections anti-frame/cross-origin, rejet des `DOCTYPE` et rétention de 30 jours ; la version `0.9.0` ajoute la minimisation et la non-persistance des vérifications VIES/Peppol, des délais et quotas explicites et trois états non ambigus. `npm audit` ne signale aucune vulnérabilité connue à la date de la revue.

Cette revue est interne et préliminaire. Elle ne vaut ni pentest indépendant, ni analyse juridique, ni validation RGPD. Comptes, rôles, TLS de production, gestionnaire de secrets, révocation, quotas persistants, chiffrement au repos et procédure d'incident testée restent des prérequis avant des données réelles partagées.

### 9.3 Analyse obligatoire avant un pilote de compensation réelle

- droit applicable à la compensation conventionnelle dans chaque pays visé ;
- opposabilité, date d'effet et preuve de l'accord ;
- traitement comptable et fiscal ;
- cas d'insolvabilité ou de procédure collective ;
- créances cédées, nanties, affacturées ou indisponibles ;
- sanctions, gel des avoirs, KYC/KYB et lutte anti-blanchiment selon le rôle réel ;
- qualification du service au regard de PSD2/PSD3, PSR et réglementations locales si un paiement est initié ;
- RGPD, sous-traitance, durées de conservation et hébergement ;
- responsabilité contractuelle liée aux calculs.

### 9.4 Principe d'architecture cible

SettleMesh calcule et orchestre. Un partenaire réglementé exécute le mouvement de fonds résiduel. Toute évolution s'écartant de ce principe doit être explicitement décidée, analysée et ajoutée au journal des décisions.

## 10. Modèle commercial de travail

### 10.1 Boucle gratuite / acquisition

- profil de réception simple ;
- CheckLink partageable ;
- contrôle unitaire local ;
- démonstration immédiate sans intégration.

Objectif : créer la distribution par les documents opérationnels déjà envoyés aux fournisseurs.

### 10.2 Offre SaaS conformité

Fonctions monétisables futures : équipe et rôles, profils multiples, API, lots industriels, règles nationales, journal d'audit, statistiques, connecteurs ERP et support.

Hypothèse de tarification à tester : abonnement par entité, volume de validations ou niveau d'intégration. Aucun prix n'est encore validé.

### 10.3 Upsell SettleMesh Net

Fonctions monétisables futures : détection continue, scénarios, workflow d'accord, preuve d'acceptation, intégration comptable, surveillance des cessions et orchestration du paiement résiduel.

Hypothèses de tarification à tester : abonnement premium plus frais fixe par cycle accepté, ou part plafonnée de la valeur opérationnelle créée. Une commission assimilable à une activité réglementée doit être vérifiée avant commercialisation.

### 10.4 Unité de valeur à mesurer

- conformité : rejet évité, temps finance économisé, délai d'acceptation réduit ;
- netting : volume brut neutralisé, nombre de virements évités, frais bancaires évités, liquidité temporairement préservée ;
- réseau : entreprises actives reliées, obligations croisées et densité des cycles.

## 11. Indicateurs produit

### 11.1 Acquisition

- CheckLinks créés ;
- fournisseurs uniques ayant ouvert un lien ;
- taux ouverture → premier contrôle ;
- nouveaux profils créés par des fournisseurs exposés à un CheckLink ;
- coefficient d'invitation par entreprise.

### 11.2 Activation conformité

- profils complétés à 100 % ;
- factures analysées ;
- taux de fichiers lisibles ;
- taux de factures prêtes au premier passage ;
- taux de correction puis réussite ;
- anomalies par catégorie BT/BG ;
- temps moyen avant résultat.

### 11.3 Valeur SettleMesh Net

- obligations éligibles / importées ;
- volume brut importé ;
- volume et pourcentage compensables par devise ;
- flux avant / après ;
- propositions vues, exportées, acceptées et exécutées ;
- délai d'accord ;
- erreur de rapprochement ou proposition annulée ;
- économie déclarée et liquidité préservée.

### 11.4 Fiabilité

- erreurs JavaScript ;
- échecs du moteur normatif ;
- temps de validation P50/P95 ;
- taux d'import CSV rejeté ;
- incidents de confidentialité ;
- divergence de position nette, dont la cible est strictement zéro.

Le MVP ne transmet aucune télémétrie. Il conserve uniquement dans le navigateur des compteurs agrégés de profil, partage et validation, sans XML, numéro de facture, fournisseur, montant ni identifiant fiscal. Leur export est volontaire et leur remise à zéro indépendante de l’historique. Toute collecte serveur future doit être consentie, minimisée et documentée.

## 12. Tests et critères de qualité

### 12.1 Commandes obligatoires

```powershell
npm test
npm run check
git diff --check
npm run serve
```

Pour les changements d'interface, compléter par un contrôle navigateur de la page concernée, au minimum en bureau et largeur mobile, et vérifier l'absence d'erreur console.

### 12.2 Couverture actuelle des 53 tests

`test/core.test.js` — 13 tests :

- encodage et décodage du profil ;
- export et réimport d'un profil portable ;
- import rétrocompatible d'un ancien profil Eurule ;
- slug et lien partageable ;
- complétude ;
- mauvaise entité ;
- facture conforme ;
- rapport lisible ;
- cohérence des exemples UBL ;
- rejet des placeholders de commande ;
- intégration des contrôles officiels dans le score ;
- rejet d'un `DOCTYPE` avant parsing XML côté navigateur ;
- résumé compatible avec un historique compact sans détail des contrôles.

`test/netting.test.js` — 5 tests :

- compensation bilatérale et triangulaire ;
- conservation des positions nettes ;
- import CSV français et exclusion du litige ;
- séparation des devises ;
- neutralisation de l'injection de formule CSV.

`test/standards.test.js` — 3 tests :

- exemple UBL conforme à EN 16931 et Peppol ;
- détection d'un total TTC erroné ;
- extraction et validation du CII embarqué dans un vrai PDF Factur-X.

`test/storage.test.js` — 4 tests :

- récupération et réécriture d'une sauvegarde locale Eurule sous la clé SettleMesh ;
- priorité de la sauvegarde courante et repli sur une ancienne sauvegarde valide si la nouvelle est illisible ;
- minimisation de l'historique et purge des résultats de plus de 30 jours ;
- absence de persistance du dernier diagnostic détaillé.

`test/metrics.test.js` — 4 tests :

- initialisation depuis l’historique existant sans copie d’identifiants ;
- agrégation des actions, lots, résultats, formats et durées ;
- export JSON à liste blanche avec garanties de confidentialité explicites ;
- normalisation et bornage d’une sauvegarde altérée.

`test/identity.test.js` — 8 tests :

- normalisation et rejet des entrées VIES ;
- formes d’identifiant Peppol acceptées ;
- résultat VIES positif minimisé ;
- distinction VIES négatif / indisponible ;
- extraction Peppol sans contacts ni capacités brutes ;
- absence de participant Peppol ;
- routes navigateur strictement same-origin.

`test/api.test.js` — 13 tests :

- santé, version et absence de persistance ;
- validation complète d'un UBL sans restitution du XML ;
- erreur XML structurée ;
- rejet des déclarations `DOCTYPE` ;
- refus des méthodes et types de média non prévus ;
- limitation de débit explicite ;
- refus d'une clé absente ou invalide ;
- fermeture de l'API quand aucune clé n'est configurée ;
- vérifications VIES/Peppol sans clé et sans persistance ;
- rejet des entrées et méthodes invalides des routes d’identité ;
- isolation du quota par organisation ;
- rejet des requêtes dépassant la taille maximale ;
- en-têtes de sécurité, refus des méthodes statiques non prévues et des traversées de répertoire.

`test/auth.test.js` — 3 tests :

- génération d'une clé forte et conservation du hash uniquement ;
- rotation de plusieurs clés pour une même organisation ;
- rejet des configurations faibles, en clair ou dupliquées.

### 12.3 Tests manuels de référence

- modifier le profil et vérifier que les trois aperçus changent ;
- copier puis ouvrir le CheckLink dans un nouvel onglet ;
- tester les deux factures de démonstration ;
- importer un UBL, un CII et le PDF Factur-X de fixture ;
- traiter un lot mixte avec fichier invalide ;
- exporter TXT, JSON et CSV ;
- rechercher et filtrer l'historique ;
- importer puis exporter un profil ;
- vérifier un numéro TVA valide et invalide, puis distinguer une panne VIES ;
- vérifier un participant Peppol présent et absent, sans interpréter la présence comme une garantie de livraison ;
- charger le réseau de démonstration Net ;
- vérifier 315 000 € brut, 260 000 € compensable, 55 000 € résiduel et 82,5 % ;
- importer un CSV multidevise ;
- vérifier qu'une facture litigieuse et une créance cédée sont exclues ;
- tester la navigation clavier et la largeur mobile.

## 13. Feuille de route ordonnée

### P0 — rendre le pilote crédible

- [x] Adopter SettleMesh comme marque mère, SettleMesh CheckLink comme module de conformité et SettleMesh Net comme module de compensation, avec migration rétrocompatible des données Eurule.
- [ ] Ajouter comptes, sessions et organisations multi-utilisateurs avec membres et rôles ; l'API possède déjà une authentification technique par clé d'organisation.
- [ ] Stocker profils et journaux côté serveur avec chiffrement, rétention et droits d'accès.
- [x] Créer une API de validation versionnée avec contrat OpenAPI, validation serveur et absence de persistance ; le déploiement reste lié à la gestion persistante des secrets, quotas et audits.
- [x] Protéger l'API pilote avec clés Bearer hashées, organisation déterminée côté serveur, rotation et quotas en mémoire ; secrets et quotas persistants restent requis avant production.
- [ ] Ajouter les contrôles nationaux du premier marché cible.
- [ ] Vérifier la conformité PDF/A-3 de Factur-X, pas seulement le XML embarqué.
- [x] Ajouter VIES et Peppol Directory avec états `vérifié`, `indisponible`, `non vérifié` distincts, requêtes explicites et aucune persistance côté SettleMesh.
- [x] Instrumenter localement les métriques d'activation sans collecter le contenu ni les identifiants des factures ; toute télémétrie serveur reste soumise à consentement et analyse RGPD.
- [x] Réaliser une revue sécurité/RGPD interne et un modèle de menace OWASP ; le pentest et les validations juridique/RGPD externes restent obligatoires avant production.
- [ ] Obtenir 3 à 5 entreprises pilotes et mesurer les rejets évités.

### P1 — transformer Net en workflow collaboratif

- [ ] Créer un registre serveur d'obligations avec droits par partie.
- [ ] Importer depuis ERP/comptabilité et dédupliquer les factures.
- [ ] Vérifier que chaque partie reconnaît la même obligation.
- [ ] Ajouter périodes de netting, dates de cut-off et scénarios.
- [ ] Étendre l'algorithme au netting multilatéral général, avec optimisation documentée.
- [ ] Ajouter propositions, invitations, commentaires et acceptation multilatérale.
- [ ] Générer un relevé d'accord immuable et export comptable.
- [ ] Gérer annulation, litige tardif et rupture d'un cycle.
- [ ] Ajouter alertes d'échéance et tableau de rapprochement.
- [ ] Tester le pricing sur la valeur créée.

### P2 — exécution et expansion européenne

- [ ] Sélectionner un partenaire bancaire/PSP réglementé.
- [ ] Exécuter uniquement les paiements résiduels via ce partenaire.
- [ ] Ajouter KYB, sanctions et contrôles requis selon le rôle exact.
- [ ] Ajouter connecteurs aux Plateformes Agréées, Peppol et principaux ERP.
- [ ] Versionner les règles par pays et par date d'effet.
- [ ] Ajouter langues et devises de nouveaux marchés sans conversion automatique implicite.
- [ ] Définir SLA, supervision et procédure d'incident.
- [ ] Préparer audit externe et assurances adaptées.

### Hors périmètre tant qu'aucune décision explicite n'est prise

- marketplace de financement de factures ;
- achat ou cession de créances par SettleMesh ;
- portefeuille de fonds ;
- conversion de devises ;
- octroi de crédit ;
- compensation imposée sans accord ;
- remplacement complet d'un ERP ou d'une Plateforme Agréée.

## 14. Risques et réponses

| Risque | Impact | Réponse actuelle / prévue |
|---|---|---|
| Les ERP construisent eux-mêmes le contrôle | Élevé | Être plus rapide sur les règles multi-pays et fournir une brique intégrable |
| Le produit dépend trop du réseau | Élevé | CheckLink apporte une valeur autonome dès la première entreprise |
| Faux sentiment de conformité | Critique | Sources/version visibles, avertissements et limites explicites |
| Mauvaise compensation | Critique | Invariants testés, allocation facture, accord requis, aucune exécution automatique |
| Créance cédée ou litigieuse incluse | Critique | Champs d'exclusion aujourd'hui ; vérification et preuves à construire |
| Fuite de données de facturation | Critique | Traitement local, historique à liste blanche sur 30 jours, CSP et modèle de menace ; architecture serveur, chiffrement, droits et audit externe avant données réelles partagées |
| Règles officielles obsolètes | Élevé | Versions affichées, artefacts vendoriés, processus de mise à jour à instaurer |
| Identités d'entreprises ambiguës | Élevé | VIES et Peppol ponctuels, horodatés et non persistés ; KYB complet et identifiants légaux demain |
| Indisponibilité ou quota d’une source officielle | Élevé | Timeout, état `indisponible` distinct, limite Peppol 2/s et lien direct vers la source ; aucun succès par défaut |
| Identifiant transmis à une source externe sans compréhension | Élevé | Action manuelle, libellé de la source, donnée minimale et avertissement de non-persistance ; information RGPD externe à valider avant pilote réel |
| CSV incorrect ou malveillant | Moyen | Limites, validation, échappement HTML et neutralisation des formules |
| Métriques pilote interprétées comme audience globale | Moyen | Libellés « local », export volontaire et distinction explicite entre CheckLink copié et ouverture externe non mesurée |
| Réapparition de l'ancienne marque Eurule | Faible | SettleMesh est la marque mère depuis v0.4 ; les anciens profils et données locales restent importables uniquement pour compatibilité |
| Compromission ou mauvaise isolation d'une clé API pilote | Critique | Clés fortes, hashes uniquement, comparaison constante, organisation côté serveur, rotation et quotas en mémoire ; ne pas déployer avant gestionnaire de secrets, révocation, quotas persistants et pentest externe |

## 15. Journal des décisions

| Date | Décision | Raisonnement | Conséquence |
|---|---|---|---|
| 2026-10-07 | Traiter les factures localement dans le MVP | Démontrer rapidement et limiter l'exposition des données | Pas de comptes, synchronisation ni audit partagé |
| 2026-10-07 | Utiliser des artefacts EN 16931 et Peppol versionnés | Produire des résultats vérifiables | Les versions et licences font partie du produit |
| 2026-10-07 | Faire du CheckLink le moteur d'acquisition | Valeur immédiate et distribution fournisseur | Le lien doit rester simple et sans compte |
| 2026-10-07 | Ajouter SettleMesh Net comme upsell | Monétiser les obligations déjà validées | Deuxième boucle produit orientée trésorerie |
| 2026-10-07 | Limiter v0.3 au bilatéral et aux cycles de trois | Moteur explicable et réalisable par petite équipe | Le multilatéral général reste en P1 |
| 2026-10-07 | Ne pas déplacer de fonds | Rester dans un périmètre de simulation pour le MVP | Partenaire réglementé requis avant exécution |
| 2026-10-07 | Exiger l'accord des parties | Une optimisation mathématique n'éteint pas seule une créance | Futur workflow de consentement et de preuve |
| 2026-10-07 | Faire de ce fichier la source de vérité | Éviter les dérives de périmètre et décisions perdues | Mise à jour obligatoire lors de changements matériels |
| 2026-10-07 | Adopter SettleMesh comme marque mère | Unifier la conformité et la compensation sous une seule promesse | CheckLink et Net deviennent deux modules SettleMesh ; les anciennes données Eurule sont migrées |
| 2026-10-07 | Versionner l'intégration de validation sous `/api/v1` | Offrir une surface stable aux ERP sans modifier le parcours CheckLink | XML transmis uniquement sur appel API explicite, non persisté, API locale tant que l'infrastructure de production manque |
| 2026-10-07 | Authentifier l'API pilote par clé hashée rattachée à une organisation | Fermer l'endpoint par défaut et préparer une facturation/quota par client sans stocker de compte utilisateur | Clé brute affichée une fois, organisation dérivée côté serveur, rotation possible ; identité humaine et persistance restent hors périmètre |
| 2026-10-07 | Mesurer l’activation par agrégats locaux exportables | Donner aux pilotes et investisseurs des preuves d’usage sans transmettre le contenu des factures | Compteurs à liste blanche dans le navigateur ; aucune télémétrie réseau ni mesure des ouvertures externes sans consentement |
| 2026-10-07 | Durcir le MVP après revue sécurité/RGPD interne | Réduire l'exposition locale et rendre les risques de production explicites sans promettre une conformité juridique | Historique compact sur 30 jours, diagnostic détaillé non persistant, CSP et anti-frame, modèle de menace documenté ; audit externe toujours requis |
| 2026-10-07 | Activer VIES et Peppol Directory derrière un Worker minimal | Les APIs officielles ne sont pas appelables fiablement depuis une page statique à cause des politiques navigateur, mais la vérification doit fonctionner dans le produit publié | Identifiant minimal transmis au clic, aucun stockage, trois états distincts, quotas/délais explicites ; le contenu des factures reste local |

## 16. Questions ouvertes à trancher

- Premier acheteur cible : PME, ETI, cabinet comptable, marketplace ou éditeur de facturation ?
- Premier pays et première verticale ?
- Qui paie : acheteur, logiciel, plateforme ou ensemble des participants au netting ?
- Quelle preuve d'accord rend la compensation opposable dans le marché pilote ?
- Quelle source confirme qu'une créance n'est ni cédée ni déjà réglée ?
- Quel partenaire peut exécuter les résiduels sans déplacer le périmètre réglementaire de SettleMesh ?
- Quelle métrique principale convaincre EWOR : croissance des CheckLinks, volume validé, taux de correction ou volume compensable ?
- Quelle partie doit rester gratuite pour maximiser la propagation ?

## 17. Gate obligatoire avant toute modification

Cette section est le résumé humain de la règle détaillée dans `AGENTS.md`.

### Avant de modifier

- [ ] Lire ce tableau de bord et le `README.md`.
- [ ] Lire `AGENTS.md` et toute instruction plus locale.
- [ ] Vérifier `git status` et préserver les changements existants.
- [ ] Identifier les pages, moteurs, données, exports et tests touchés.
- [ ] Vérifier les invariants conformité, confidentialité, netting et UX.
- [ ] Classer le changement : acquisition, conformité, réseau, netting, paiement ou infrastructure.
- [ ] Vérifier s'il change la position réglementaire ou nécessite une décision humaine.
- [ ] Définir les critères d'acceptation et tests avant de coder.

### Pendant la modification

- [ ] Maintenir des règles déterministes et explicables.
- [ ] Préserver les formats et données existants ou documenter la migration.
- [ ] Échapper toute donnée injectée dans le HTML ou un export.
- [ ] Ne pas mélanger les devises ni perdre la traçabilité facture.
- [ ] Ajouter ou adapter les tests correspondant au risque.
- [ ] Ne pas annoncer comme opérationnelle une intégration simulée.

### Après la modification

- [ ] Exécuter `npm test`.
- [ ] Exécuter `npm run check`.
- [ ] Exécuter `git diff --check`.
- [ ] Tester visuellement tout changement d'interface et vérifier la console.
- [ ] Mettre à jour ce document si le comportement, le statut, les limites, les risques, les tests, la version ou la roadmap ont changé.
- [ ] Mettre à jour le `README.md` si l'usage utilisateur a changé.
- [ ] Vérifier que les mentions réglementaires restent exactes.
- [ ] Résumer clairement ce qui a changé, ce qui a été testé et ce qui reste hors périmètre.

## 18. Définition de « terminé »

Une fonctionnalité n'est terminée que si :

1. son utilisateur, son problème et son résultat attendu sont identifiés ;
2. l'état normal, vide, erreur et chargement sont gérés si pertinents ;
3. les données sont validées aux frontières ;
4. les invariants métier et réglementaires sont conservés ;
5. les tests proportionnels au risque passent ;
6. l'interface a été contrôlée si elle change ;
7. les limites sont visibles dans le produit et dans la documentation ;
8. ce tableau de bord reflète le nouvel état réel ;
9. le dépôt ne contient pas de changement accidentel ;
10. le livrable peut être expliqué en une phrase mesurable.
