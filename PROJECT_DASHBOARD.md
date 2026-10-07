# SettleMesh — tableau de bord produit et technique

> Source de vérité vivante du projet. Toute modification du produit doit commencer par la lecture de ce document et se terminer par sa mise à jour si le périmètre, le comportement, les risques, les tests ou la feuille de route ont changé. La règle exécutoire se trouve dans `AGENTS.md`.

## 0. Carte d'identité

| Champ | Valeur actuelle |
|---|---|
| Produit | **SettleMesh**, avec le module d'acquisition **SettleMesh CheckLink** et l'upsell **SettleMesh Net** |
| Version du code | `0.4.0` |
| État | MVP fonctionnel, statique et démontrable ; pas encore un service multi-entreprises en production |
| Dernière revue | 7 octobre 2026 |
| Dépôt | `williammartin75/SettleMesh`, branche `main` |
| Hébergement configuré | Site statique dont la racine de publication est `dist/` |
| Langue actuelle | Français |
| Architecture | HTML, CSS et JavaScript natifs ; traitement local dans le navigateur ; aucune API métier serveur |
| Promesse courte | **Rendre les factures conformes avant envoi, puis identifier les paiements qui peuvent être compensés.** |
| Wedge d'acquisition | CheckLink gratuit ou peu coûteux partagé par un acheteur avec ses fournisseurs |
| Upsell | SettleMesh Net : simulation et orchestration de compensations interentreprises |
| Position réglementaire du MVP | Outil de contrôle et d'aide à la décision ; ne conserve pas de fonds, n'initie pas de paiement et ne constate pas seul l'extinction juridique d'une dette |
| Tests automatisés | 21 tests au 7 octobre 2026 |

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
| Historique | Recherche, filtre et suppression locale | Opérationnel | 100 résultats maximum dans le navigateur |
| Netting | Import CSV d'obligations | Opérationnel | 2 Mo et 500 obligations conservées localement |
| Netting | Compensation bilatérale | Opérationnel | Simulation seulement, accord requis |
| Netting | Cycles triangulaires | Opérationnel | Cycles de trois uniquement |
| Netting | Isolation par devise | Opérationnel | Aucune conversion de change |
| Netting | Exclusion litige / cession / statut | Opérationnel | Déclarations fournies par l'importeur, non vérifiées extérieurement |
| Netting | Positions nettes et paiements résiduels | Opérationnel | Aucun ordre de paiement n'est émis |
| Netting | Export des propositions et allocations | Opérationnel | Document de travail, pas un accord signé |
| Identité | Comptes, organisations, rôles | Prévu | Nécessite backend et authentification |
| Réseau | Invitations et contreparties vérifiées | Prévu | Condition du vrai effet réseau |
| Connecteurs | VIES, Peppol Directory, PDP/PA, ERP | Prévu | APIs, quotas, disponibilité et conformité à cadrer |
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

Confidentialité actuelle : le fichier est traité en mémoire. Le XML brut est retiré avant l'enregistrement du résultat dans l'historique. Aucune requête métier vers un serveur SettleMesh n'est effectuée.

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

- 100 résultats maximum, les plus récents en premier ;
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
- règles configurées par le destinataire.

Connecteur seulement annoncé : VIES. Il n'est pas encore exécuté.

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
├── .openai/hosting.json         publication statique de dist/
├── dist/
│   ├── index.html               structure des six vues
│   ├── styles.css               design system et responsive
│   ├── app.js                   état, navigation, rendu et interactions
│   ├── storage.js               persistance locale et migration de l'ancienne marque
│   ├── core.js                  profil, parsing et validation métier facture
│   ├── facturx.js               extraction du XML embarqué dans un PDF
│   ├── standards.js             exécution EN 16931 et Peppol
│   ├── netting.js               parsing CSV et moteur de compensation
│   ├── validation/              artefacts XSLT compilés en SEF
│   └── vendor/                  runtimes PDF.js et SaxonJS pour le navigateur
├── scripts/
│   ├── serve.mjs                serveur statique local, port 4173
│   └── build-validation-assets.mjs
│                                compilation/copie des moteurs normatifs
├── test/
│   ├── core.test.js             profil, règles et exports
│   ├── standards.test.js        artefacts officiels et Factur-X réel
│   ├── netting.test.js          invariants de compensation et CSV
│   ├── storage.test.js          priorité et migration du stockage local
│   └── fixtures/                documents de test
└── vendor/                      sources et licences normatives
```

### 7.1 Modèle d'état local

Clé `localStorage` : `settlemesh-v1`. Au premier chargement, l'application recherche aussi l'ancienne clé `eurule-checklink-v1` et copie son contenu valide afin de préserver les profils, l'historique et les obligations existants.

```text
profile      configuration de réception de l'entreprise
history      jusqu'à 100 résultats sans XML brut
lastResult   dernier résultat affichable
netting
  obligations  jusqu'à 500 obligations normalisées
  source       nom descriptif du registre chargé
```

### 7.2 Modèle de partage CheckLink

Le profil compact est sérialisé en JSON, encodé en UTF-8 puis en Base64 URL-safe dans le fragment `#check/...`. Le fragment n'est normalement pas envoyé au serveur HTTP. L'application passe alors en expérience fournisseur publique et utilise le profil contenu dans le lien.

Conséquence : toute donnée placée dans le profil est visible par le destinataire du lien. Ne jamais y ajouter de secret, clé API, information bancaire ou donnée confidentielle.

### 7.3 Dépendances

- `SaxonJS 2.7.0` : exécution des règles XSLT compilées.
- `xslt3 2.7.0` : compilation des artefacts de validation.
- `pdfjs-dist 6.4.299` : lecture des pièces jointes PDF.
- Aucun framework frontend ni service externe à l'exécution métier actuelle.

## 8. Invariants à ne jamais casser

### 8.1 Invariants conformité

- Une règle officielle et une règle propre à l'acheteur doivent rester identifiables.
- Une indisponibilité d'un validateur ne doit jamais être convertie en succès.
- Une facture non reconnue ne doit pas être évaluée comme conforme.
- Le score ne doit pas être présenté comme certification juridique.
- Les versions EN 16931 et Peppol actives doivent être affichées et documentées.

### 8.2 Invariants confidentialité

- Le MVP ne transmet pas le contenu des factures à un backend SettleMesh.
- Le XML brut ne doit pas entrer dans l'historique persistant.
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

SettleMesh v0.4 fournit un précontrôle technique et une simulation. Le produit n'émet pas d'avis juridique, ne garantit pas l'acceptation d'une facture et n'opère pas de règlement.

### 9.2 Analyse obligatoire avant un pilote de compensation réelle

- droit applicable à la compensation conventionnelle dans chaque pays visé ;
- opposabilité, date d'effet et preuve de l'accord ;
- traitement comptable et fiscal ;
- cas d'insolvabilité ou de procédure collective ;
- créances cédées, nanties, affacturées ou indisponibles ;
- sanctions, gel des avoirs, KYC/KYB et lutte anti-blanchiment selon le rôle réel ;
- qualification du service au regard de PSD2/PSD3, PSR et réglementations locales si un paiement est initié ;
- RGPD, sous-traitance, durées de conservation et hébergement ;
- responsabilité contractuelle liée aux calculs.

### 9.3 Principe d'architecture cible

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

Le MVP local ne collecte actuellement aucune télémétrie. Toute collecte future doit être consentie, minimisée et documentée.

## 12. Tests et critères de qualité

### 12.1 Commandes obligatoires

```powershell
npm test
npm run check
git diff --check
npm run serve
```

Pour les changements d'interface, compléter par un contrôle navigateur de la page concernée, au minimum en bureau et largeur mobile, et vérifier l'absence d'erreur console.

### 12.2 Couverture actuelle des 21 tests

`test/core.test.js` — 11 tests :

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
- intégration des contrôles officiels dans le score.

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

`test/storage.test.js` — 2 tests :

- récupération et réécriture d'une sauvegarde locale Eurule sous la clé SettleMesh ;
- priorité de la sauvegarde courante et repli sur une ancienne sauvegarde valide si la nouvelle est illisible.

### 12.3 Tests manuels de référence

- modifier le profil et vérifier que les trois aperçus changent ;
- copier puis ouvrir le CheckLink dans un nouvel onglet ;
- tester les deux factures de démonstration ;
- importer un UBL, un CII et le PDF Factur-X de fixture ;
- traiter un lot mixte avec fichier invalide ;
- exporter TXT, JSON et CSV ;
- rechercher et filtrer l'historique ;
- importer puis exporter un profil ;
- charger le réseau de démonstration Net ;
- vérifier 315 000 € brut, 260 000 € compensable, 55 000 € résiduel et 82,5 % ;
- importer un CSV multidevise ;
- vérifier qu'une facture litigieuse et une créance cédée sont exclues ;
- tester la navigation clavier et la largeur mobile.

## 13. Feuille de route ordonnée

### P0 — rendre le pilote crédible

- [x] Adopter SettleMesh comme marque mère, SettleMesh CheckLink comme module de conformité et SettleMesh Net comme module de compensation, avec migration rétrocompatible des données Eurule.
- [ ] Ajouter une vraie authentification et des organisations multi-utilisateurs.
- [ ] Stocker profils et journaux côté serveur avec chiffrement, rétention et droits d'accès.
- [ ] Créer une API de validation versionnée.
- [ ] Ajouter les contrôles nationaux du premier marché cible.
- [ ] Vérifier la conformité PDF/A-3 de Factur-X, pas seulement le XML embarqué.
- [ ] Ajouter VIES et Peppol Directory avec états `vérifié`, `indisponible`, `non vérifié` distincts.
- [ ] Instrumenter les métriques d'activation sans collecter le contenu des factures.
- [ ] Réaliser revue sécurité, RGPD et modèle de menace.
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
| Fuite de données de facturation | Critique | Traitement local MVP ; architecture sécurité/RGPD avant serveur |
| Règles officielles obsolètes | Élevé | Versions affichées, artefacts vendoriés, processus de mise à jour à instaurer |
| Identités d'entreprises ambiguës | Élevé | Normalisation simple aujourd'hui ; KYB et identifiants légaux demain |
| CSV incorrect ou malveillant | Moyen | Limites, validation, échappement HTML et neutralisation des formules |
| Réapparition de l'ancienne marque Eurule | Faible | SettleMesh est la marque mère depuis v0.4 ; les anciens profils et données locales restent importables uniquement pour compatibilité |

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
