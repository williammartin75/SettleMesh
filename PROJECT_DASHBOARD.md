# SettleMesh — tableau de bord produit et technique

> Source de vérité vivante du projet. Toute modification du produit doit commencer par la lecture de ce document et se terminer par sa mise à jour si le périmètre, le comportement, les risques, les tests ou la feuille de route ont changé. La règle exécutoire se trouve dans `AGENTS.md`.

## 0. Carte d'identité

| Champ | Valeur actuelle |
|---|---|
| Produit | **SettleMesh**, avec le module d'acquisition **SettleMesh CheckLink** et l'upsell **SettleMesh Net** |
| Version du code | `0.22.0` |
| État | MVP fonctionnel durci, avec précontrôle local du conteneur Factur-X, moteur de packs de règles nationales (France 1.3.0, Allemagne 1.0.0, Belgique 1.0.0), registre d'organisations persistant (fichier local ou base managée Supabase ; hashes, rôles, révocation et quotas, relecture à chaud) et API d'administration des clés appliquant la matrice de rôles, comptes humains e-mail + mot de passe scrypt avec sessions serveur de 24 h, cookies durcis et MFA propriétaire TOTP sans dépendance, registre public d'exigences de réception (recherche et vérification de CheckLink sans compte) **et première interface navigateur** (recherche, publication opt-in, bouton de vérification fournisseur), métriques pilote locales **et télémétrie d'activation consentie, minimisée et anonyme** (`/api/v1/metrics`, consentement explicite porté par le profil CheckLink), connecteurs VIES/Peppol sans persistance, Worker publié, API de validation locale authentifiée et scénario de cut-off local pour la compensation ; pas encore un service multi-utilisateurs en production |
| Dernière revue | 8 octobre 2026 |
| Dépôt | `williammartin75/SettleMesh`, branche `main` |
| Hébergement configuré | Worker Sites servant les assets construits et les routes d’identité VIES/Peppol ; l’API Node de validation des factures n’est pas déployée |
| Langue actuelle | Français |
| Architecture | HTML, CSS et JavaScript natifs sous `web/` ; Worker sans stockage pour les connecteurs d’identité ; serveur Node local pour l’ensemble de l’API pilote `/api/v1` |
| Promesse courte | **Rendre les factures conformes avant envoi, puis identifier les paiements qui peuvent être compensés.** |
| Wedge d'acquisition | CheckLink gratuit ou peu coûteux partagé par un acheteur avec ses fournisseurs |
| Upsell | SettleMesh Net : simulation et orchestration de compensations interentreprises |
| Position réglementaire du MVP | Outil de contrôle et d'aide à la décision ; ne conserve pas de fonds, n'initie pas de paiement et ne constate pas seul l'extinction juridique d'une dette |
| Tests automatisés | 147 tests au 8 octobre 2026 |

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
| Facture | Extraction XML d'un PDF Factur-X | Opérationnel | XML et métadonnées du conteneur traités localement |
| Facture | Précontrôle structurel PDF/A-3 | Partiel | XMP, profil Factur-X, nom du XML et association `/AF` ; validation ISO exhaustive veraPDF encore absente |
| Normes | EN 16931 v1.3.16 UBL/CII | Opérationnel | Artefacts à surveiller et mettre à jour |
| Normes | Peppol BIS Billing 3.0.21 | Opérationnel | Déclenché sur les UBL déclarant un profil Peppol |
| Normes | EN 16931 révisée | Point de veille, à jour | L'artefact de validation EC le plus récent est la 1.3.16 (avril 2026), déjà vendroie et exécutée ; Peppol BIS 3.0.21 (mai 2026) l'intègre également. La révision CEN EN 16931-1:2026 n'a pas encore d'artefacts runtime publiés : surveiller CEN/TC 434 et OpenPeppol |
| Règles acheteur | Entité, TVA, devise, références, endpoint | Opérationnel | Les règles doivent rester explicables et déterministes |
| Règles nationales | Packs France 1.3.0, Allemagne 1.0.0, Belgique 1.0.0 | Partiel | Déclaratifs, datés et sourcés ; IT/ES/PL et le reste du périmètre français à venir |
| Résultat | Score, statut et corrections | Opérationnel | Score produit, pas une certification officielle |
| Lots | Jusqu'à 20 fichiers, 20 Mo chacun | Opérationnel | Traitement séquentiel dans le navigateur |
| Rapports | TXT, JSON et CSV | Opérationnel | Pas de signature ni piste d'audit serveur |
| Historique | Recherche, filtre, export et suppression locale | Opérationnel | Champs minimisés, 100 résultats et 30 jours maximum dans le navigateur ; diagnostic détaillé limité à la session |
| Mesure pilote | Compteurs d’activation agrégés, export JSON et remise à zéro | Opérationnel | Stockage local ; **télémétrie serveur consentie, minimisée et anonyme depuis 0.22.0** (`/api/v1/metrics`, consentement explicite porté par le profil, ligne organisation/jour/action/quantité 1) ; aucune ouverture externe des compteurs locaux ni correction inter-session sans consentement |
| Intégration | API de validation `/api/v1` | Partiel | Endpoint local authentifié par clé d'organisation ; secrets, quotas et audit persistants ainsi que déploiement de production absents |
| Netting | Import CSV d'obligations | Opérationnel | 2 Mo et 500 obligations conservées localement |
| Netting | Compensation bilatérale | Opérationnel | Simulation seulement, accord requis |
| Netting | Cycles triangulaires | Opérationnel | Cycles de trois uniquement |
| Netting | Isolation par devise | Opérationnel | Aucune conversion de change |
| Netting | Exclusion litige / cession / statut | Opérationnel | Déclarations fournies par l'importeur, non vérifiées extérieurement |
| Netting | Scénario de cut-off daté | Opérationnel | Simulation locale uniquement ; les obligations postérieures au cut-off ou sans échéance exploitable sont différées et comptées séparément, jamais supprimées ni requalifiées |
| Netting | Positions nettes et paiements résiduels | Opérationnel | Aucun ordre de paiement n'est émis |
| Netting | Export des propositions et allocations | Opérationnel | Document de travail, pas un accord signé |
| Identité | Registre d'organisations persistant (hashes, rôles, révocation, quotas) | Partiel | Fichier local ou stockage managé Supabase (`SETTLEMESH_SUPABASE_*`), relus sans redémarrage, clés uniquement hashées ; rôles résolus et renvoyés, API d'administration de clés appliquant la matrice owner/admin/viewer (0.16.0) ; revue RGPD externe requise pour des données réelles |
| Identité | Membres humains, login/logout, sessions et cookies durcis | Partiel | Stockage managé uniquement (e-mail + mot de passe scrypt, sessions 24 h en table, cookie `HttpOnly`/`SameSite=Lax`, badge `members`) ; **MFA propriétaire TOTP actif depuis 0.18.0** (`/auth/mfa/setup` → `/auth/mfa/enable`, code exigé au login, rattrapage affiché pour un owner sans MFA) ; **connexion et publication d'exigences disponibles dans l'interface depuis 0.20.0** (garde CSRF par en-tête) ; pas de réinitialisation de mot de passe ni de rendu QR, revue RGPD externe requise pour des données personnelles réelles (e-mail salarié) |
| Identité | Comptes, organisations multi-utilisateurs, rôles | Partiel | Comptes humains par e-mail et rôle disponibles en 0.17.0 ; multi-organisation, invitations, changement/oubli de mot de passe et interface de gestion restent à construire |
| Réseau | Registre public d'exigences de réception (recherche et vérification sans compte) | Partiel | API et stockage actifs (0.19.0), publication opt-in testée, réponses minimisées ; **interface navigateur active depuis 0.20.0** (recherche dans Sources & règles, publication dans Mon CheckLink, bouton « Vérifier ce CheckLink » chez le fournisseur) ; signature du profil pas encore implémentée |
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
- le calcul consomme d'abord les obligations les plus proches en échéance, puis par référence ;
- avec un cut-off daté : les obligations postérieures à la date ou sans échéance exploitable sont mises de côté comme « différées » et comptées séparément dans le résumé, sans modifier la position nette du périmètre retenu ; la date doit être au format `AAAA-MM-JJ` et une date invalide est rejetée.

Scénarios disponibles depuis v0.10.1 : « toutes les échéances » (comportement historique), « cut-off aujourd'hui » (date locale du jour) et « cut-off personnalisé » (date choisie). Le scénario est persisté dans le stockage local et la colonne `scenario_cutoff` est ajoutée à l'export CSV des propositions, dont le nom de fichier mentionne la date.

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
- nombre d'obligations différées par un cut-off et motif ;
- export CSV des propositions avec la colonne `scenario_cutoff`.

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
- précontrôle local PDF/A-3 des conteneurs Factur-X ;
- pack de règles nationales versionné selon le pays du profil : France 1.3.0 (format du TVA intracommunautaire, clé de contrôle SIREN/SIRET de l'identifiant de routage, profil Factur-X adapté à la réception, chemin de fer des sous-lignes EXTENDED rapproché de BT-106, notice du parcours CTC, notice du calendrier de réception obligatoire), Allemagne 1.0.0 (format TVA DE, Leitweg-ID en BT-10 déclenchée sur les XRechnung avec clé Mod 97-10) et Belgique 1.0.0 (format TVA BE, communication structurée BT-83 à clé Mod 97) ;
- VIES pour une validation ponctuelle d’un numéro TVA ;
- Peppol Directory pour une recherche exacte de participant ;
- règles configurées par le destinataire.

Les deux connecteurs d’identité sont déclenchés uniquement au clic. Ils affichent `vérifié`, `non vérifié` ou `indisponible`, l’horodatage et les limites de portée. SettleMesh ne persiste ni l’identifiant vérifié ni la réponse. VIES ne certifie pas une entreprise ; Peppol Directory ne garantit ni la joignabilité SMP ni la livraison d’une facture.

Les packs nationaux sont une donnée déclarative figée (pays, version, date d’effet, source citée) chargée localement sans requête réseau. Un pack ne peut transformer ni une indisponibilité de validateur en succès, ni une donnée absente en échec prématuré. Les règles de profil Factur-X n’ont d’avis que sur un conteneur réellement lu, restent silencieuses sinon, et une règle informative non déclenchée n’apparaît pas. La carte « Règles nationales » de cette page affiche les packs actifs pour le pays du profil, leur version et leur source. Veille : l’artefact de validation EC le plus récent est la 1.3.16 (avril 2026), déjà exécuté ; Peppol BIS 3.0.21 (mai 2026) l’intègre également. La révision CEN EN 16931-1:2026 n’a pas encore d’artefacts runtime publiés : surveiller CEN/TC 434 et OpenPeppol.

## 5. Contrôles de facture détaillés

### 5.1 Extraction structurée

Le parseur extrait actuellement : syntaxe, type de document, identifiants de profil, numéro, date, devise, référence acheteur, commande, noms et identifiants fiscaux fournisseur/acheteur, endpoints, totaux, montant payable, nombre de lignes et, pour le CII, la structure du chemin de fer Factur-X (lignes, sous-lignes via `ram:ParentLineID`, somme des lignes de premier niveau, références de parent orphelines).

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
- Pour Factur-X, SettleMesh vérifie localement `pdfaid:part`, le niveau PDF/A déclaré, les propriétés XMP Factur-X, la concordance du nom XML et les marqueurs `/AF` et `/AFRelationship` lisibles.
- Ce précontrôle ne vérifie pas toutes les règles ISO 19005-3, notamment les polices, espaces colorimétriques, profils ICC, actions ou contraintes de rendu ; seul un validateur complet tel que veraPDF peut fournir ce niveau de contrôle.
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
│   ├── rules/                   packs de règles nationales déclaratifs et versionnés
│   ├── facturx.js               extraction XML et précontrôle structurel PDF/A-3
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
│   ├── serve.mjs                lancement de l'application et de l'API locale, port 4173 par défaut, surchargeable par la variable d'environnement PORT
│   ├── create-api-key.mjs       génération locale d'une clé et de son hash de configuration
│   ├── registry-key.mjs         ajout d'une clé hashée au fichier de registre, avec rôle
│   ├── registry-push.mjs        migration d'un registre local vers Supabase (upsert atomique)
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
│   ├── registry.mjs             registre d'organisations (fichier local : hashes, rôles, révocation)
│   ├── registry-supabase.mjs    adaptateur du registre vers PostgREST/Supabase (fetch natif)
│   ├── members.mjs              membres humains (scrypt) et sessions de 24 h
│   ├── totp.mjs                 TOTP RFC 6238 et Base32 RFC 4648 (sans dépendance)
│   ├── admin.mjs                administration des clés (matrice de rôles)
│   ├── requirements.mjs         registre public d'exigences (liste blanche, vérification CheckLink)
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
  scenario     mode de simulation du Net : toutes les échéances ou cut-off daté
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

Limites : corps HTTP de validation de 2 Mo, XML de 1 Mo, protection générale de 120 requêtes par minute et par adresse IP, puis quota configurable par organisation de 60 par défaut. L'API accepte uniquement JSON et XML UBL/CII et refuse les déclarations `DOCTYPE`. Sans configuration de clé la validation reste fermée. Les routes d’identité utilisent un délai amont de 8 secondes ; Peppol est limité au mieux à deux recherches par seconde, conformément à sa documentation publique. Aucun endpoint n’ouvre CORS. Le serveur et le Worker appliquent CSP, anti-frame, `nosniff`, politiques referrer/permissions et isolation cross-origin. Le contrat de référence est `docs/openapi.yaml`.

Depuis la version 0.15.0, le stockage managé est actif : en présence de `SETTLEMESH_SUPABASE_PROJECT_REF` et `SETTLEMESH_SUPABASE_SERVICE_KEY` (variables d'environnement utilisateur, jamais dans le dépôt), le registre est chargé depuis la table `public.settlemesh_registry` du projet (RLS activée, aucune policy : seul le service_role lit et écrit) via PostgREST en `fetch` natif, sans dépendance nouvelle. Priorité de chargement : fichier local > Supabase > variable d'environnement. La lecture est mise en cache 5 s et les écritures passent par `npm run registry:push -- <registre.json>` (upsert atomique d'une ligne `id=1`, document complet) ; le badge `supabase` est exposé dans `/health` sous `authentication`. Cycle vérifié le 8 octobre 2026 sur le projet réel : pousser → valider (200, rôle renvoyé) → révoquer dans le fichier → re-pousser → revalider (401 `API_KEY_REVOKED`) **sans redémarrage du serveur**.

Depuis la version 0.16.0, les clés s'administrent par API sous `/api/v1/admin/*` (authentification Bearer, matrice de rôles appliquée serveur) : `GET /admin/keys` liste les clés de sa propre organisation, `POST /admin/keys` crée une clé (rôle au plus élevé du demandeur ; un `admin` ne peut jamais créer de `owner`), `PATCH /admin/keys/{keyId}` change le rôle (owner uniquement) ou `revokedAt` (admin ou owner), `DELETE /admin/keys/{keyId}` révoque immédiatement et `PATCH /admin/organization` ajuste le quota (owner uniquement). Toutes les mutations réécrivent le document complet du registre (fichier, puis validation par règles) et respectent l'isolation stricte entre organisations (`KEY_NOT_FOUND` pour une clé d'une autre organisation). L'administration exige un registre persistant : avec `SETTLEMESH_API_KEYS` seul, la réponse est `409 ADMIN_REQUIRES_REGISTRY`.

Depuis la version 0.17.0, des comptes humains existent : `POST /api/v1/auth/login`, `/logout` et `GET /me`, cookie `settlemesh_session` `HttpOnly`/`SameSite=Lax` de 24 h, mot de passe haché scrypt. Depuis la version 0.18.0, le MFA propriétaire (TOTP RFC 6238 en `server/totp.mjs`, sans dépendance) s'enrôle via `POST /auth/mfa/setup` (secret Base32 + URI otpauth, stocké inactif) puis `/auth/mfa/enable` (code vérifié avec fenêtre ±1 pas) ; au login, un compte MFA actif exige un code valide (`401 MFA_REQUIRED`) et un owner sans MFA se connecte avec `mfaEnrollmentRequired: true` ; `/auth/mfa/disable` exige le mot de passe ; `POST /auth/password` permet le changement de mot de passe authentifié par session. Le QR code reste à rendre côté interface. Toute indisponibilité du stockage reste `503 MEMBERS_UNAVAILABLE`, jamais maquillée en mauvais identifiants (invariant testé).

## 8. Invariants à ne jamais casser

### 8.1 Invariants conformité

- Une règle officielle et une règle propre à l'acheteur doivent rester identifiables.
- Une indisponibilité d'un validateur ne doit jamais être convertie en succès.
- Une facture non reconnue ne doit pas être évaluée comme conforme.
- Le score ne doit pas être présenté comme certification juridique.
- Un précontrôle PDF/A-3 ne doit jamais être présenté comme une validation ISO 19005-3 exhaustive ; sa portée et l’orientation veraPDF doivent rester visibles.
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
- La télémétrie serveur doit rester consentie, minimisée et anonyme : aucun envoi sans consentement explicite porté par le profil CheckLink, et aucune ligne d'événement ne peut porter de contenu de facture, d'identifiant fiscal, d'adresse IP ou de session.
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

SettleMesh v0.11 fournit un précontrôle technique incluant la structure hybride Factur-X/PDF/A-3, des packs de règles nationales versionnés, des vérifications VIES/Peppol ponctuelles, des métriques pilote agrégées locales, une API locale authentifiée d'intégration et une simulation de compensation. Le produit n'émet pas d'avis juridique, ne délivre pas de certification PDF/A, ne certifie pas une entreprise, ne garantit pas l'acceptation d'une facture et n'opère pas de règlement.

### 9.2 Revue sécurité et RGPD interne

La revue du 7 octobre 2026 est consignée dans `docs/SECURITY.md`. Elle couvre le frontend, le Worker, le stockage navigateur, les imports non fiables, les connecteurs externes, l'API locale, les dépendances, les actifs, frontières de confiance, menaces et portes de production. La version `0.8.0` a ajouté CSP, protections anti-frame/cross-origin, rejet des `DOCTYPE` et rétention de 30 jours ; la version `0.9.0` ajoute la minimisation et la non-persistance des vérifications VIES/Peppol ; la version `0.10.0` inspecte localement les marqueurs PDF/A-3 et documente explicitement l’écart avec une validation ISO exhaustive. `npm audit` ne signale aucune vulnérabilité connue à la date de la revue. Le 8 octobre 2026, le modèle de menace ajoute l'imitation du CheckLink par un tiers malveillant (hameçonnage ciblant les fournisseurs) et ses mitigations ; l'architecture de confiance associée (redevabilité sans garde, confiance déléguée) est consignée dans `Strategic Study/05-confiance-architecture.md`.

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

Le MVP ne transmet aucune télémétrie **sans consentement**. Depuis 0.22.0, une télémétrie d'activation existe, **consentie, minimisée et anonyme** : l'acheteur coche explicitement « Mesurer l'activation » dans son profil (`usageMetricsConsent`, défaut absent), le consentement voyage dans le fragment CheckLink, et la page fournisseur ne signale que des compteurs `organisation, jour, action, quantité 1` (checklink_copied · invoice_checked · invoice_ready) via `/api/v1/metrics/events` — jamais de numéro de facture, fournisseur, montant, identifiant fiscal, XML, adresse IP ni identifiant de session. Sans consentement, zéro octet ne quitte le navigateur fournisseur (invariant testé par interception fetch). La lecture agrégée exige une clé admin/owner et reste bornée à l'organisation authentifiée ; les compteurs locaux restent à liste blanche, export volontaire et remise à zéro indépendante de l'historique. Toute extension (fournisseurs identifiables, cookies, période sous le jour, tiers) reste hors périmètre sans nouvelle décision.

## 12. Tests et critères de qualité

### 12.1 Commandes obligatoires

```powershell
npm test
npm run check
git diff --check
npm run serve
```

Pour les changements d'interface, compléter par un contrôle navigateur de la page concernée, au minimum en bureau et largeur mobile, et vérifier l'absence d'erreur console.

### 12.2 Couverture actuelle des 147 tests

`test/reporting-client.test.js` — 3 tests :

- **INVARIANT ABSOLU** : sans consentement (champ absent ou faux), aucune requête n'est déclenchée — zéro octet ne quitte le navigateur fournisseur, y compris pour un lien CheckLink ancien ;
- avec consentement : un seul événement, corps exactement `{ organizationId, action, day }`, route same-origin `/api/v1/metrics/events` ;
- un échec d'envoi reste silencieux et ne perturbe jamais l'expérience fournisseur.

`test/metrics-server.test.js` — 7 tests :

- liste blanche de l'événement : numéro de facture, fournisseur, montant, TVA, XML, IP ou session ignorés et jamais transportés ; formes invalides rejetées (slug, action inconnue, jour malformé ou futur) ;
- bornes de période : ordre, format, maximum 92 jours ;
- agrégation par jour et action, lignes d'autres organisations et hors période ignorées ;
- export CSV neutralisé (`=`, `+`, `-`, `@` préfixés) ;
- HTTP : événement accepté 202 anonyme, stockage absent → `503 METRICS_UNAVAILABLE` explicite ;
- HTTP : lecture `403 FORBIDDEN_ROLE` pour un viewer, isolation stricte entre organisations, lignes hors période ignorées ;
- HTTP : export CSV authentifié (401 sans clé, 403 viewer, 400 sur période invalide).

`test/failures.test.js` — 3 tests :

- verrou progressif ouvert au seuil, expiration avec la fenêtre ;
- réinitialisation au succès, sans pollution entre couples ip/e-mail ;
- HTTP : 5 échecs → `401 INVALID_CREDENTIALS` puis `429 LOGIN_LOCKED` même avec le bon mot de passe, autre e-mail non affecté.

`test/requirements.test.js` — 9 tests :

- liste blanche stricte : contenu de facture, d'obligation, secret ou champ inconnu écarté, normalisation vérifiée ;
- adaptateur : upsert atomique par organisation et recherche filtrée sur `published=eq.true`, minimisation (pas d'e-mail de soumission ni instructions) ;
- HTTP : publication opt-in explicite, viewer refusé (403), brouillon non cherchable puis cherchable après publication, le tout sans compte pour la recherche ;
- vérification officielle : `verified`/`mismatch` (noms de champs divergents)/`not_published`/`unknown` distingués, `stored: false` ;
- l'organisation B écrit toujours dans son propre espace, jamais dans celui de l'organisation A ;
- mutation via session membre : `403 CSRF_REQUIRED` sans l'en-tête `X-SettleMesh-CSRF`, `403 FORBIDDEN_ROLE` pour une session viewer, publication 201 pour un owner avec en-tête CSRF (organisation propre uniquement) ;
- sans stockage configuré : `503 REQUIREMENTS_UNAVAILABLE` côté public et authentifié ;
- recherche TVA généralisée : tout numéro intracommunautaire nettoyé (`/^[A-Z]{2}[0-9A-Z]{5,}$/`) déclenche la condition TVA, pas seulement les « FR » ;
- incrément de version : chaque écriture d'exigences renvoie une `version` accrue.

`test/requirements-client.test.js` — 1 test :

- client navigateur : routes same-origin uniquement, en-tête `X-SettleMesh-CSRF` présent sur les mutations de session et absent des lectures.

`test/auth-mfa.test.js` — 8 tests :

- base32 conforme aux vecteurs RFC 4648 ;
- TOTP conforme aux vecteurs RFC 6238 (T=59 → 287082, etc.) ;
- vérification avec fenêtre ±1 pas, refus hors fenêtre et hors format ;
- URI `otpauth` bien formée, secret canonique de 20 octets ;
- login owner avec MFA : sans code → `401 MFA_REQUIRED`, avec le bon code → 200 ;
- viewer sans MFA : login direct sans drapeau d'enrôlement ;
- owner sans MFA actif : login toléré avec `mfaEnrollmentRequired: true` ;
- setup → enable (mauvais code refusé) → disable (mot de passe requis) → changement de mot de passe qui invalide l'ancien.

`test/members-sessions.test.js` — 5 tests :

- scrypt : hachage non réversible, vérification positive/négative, format contrôlé ;
- adaptateur : normalisation d'e-mail, création de membre et de session via PostgREST simulé ;
- session périmée → `401 SESSION_EXPIRED` ; aucune session → `401 AUTH_REQUIRED` ;
- login complet : mauvais mot de passe → `401 INVALID_CREDENTIALS` sans cookie, bon mot de passe → cookie `HttpOnly`/`SameSite=Lax`, `/me`, puis logout efface la session côté serveur ;
- sans stockage membres → `409 MEMBERS_UNAVAILABLE`.

`test/registry-admin.test.js` — 3 tests (ports éphémères, isolation par fichiers) :

- matrice de rôles appliquée : `viewer → 403 FORBIDDEN_ROLE`, listes admin/owner limitées à leur organisation ;
- full HTTP : création (201, clé brute une fois), validation de la nouvelle clé (200), promotion interdite à un admin, changement de rôle owner, `KEY_NOT_FOUND`, révocation par DELETE puis `401 API_KEY_REVOKED`, changement de quota owner uniquement ;
- `409 ADMIN_REQUIRES_REGISTRY` sans registre, et `KEY_NOT_FOUND` pour une clé d'une autre organisation.

`test/registry-supabase.test.js` — 6 tests (fetch simulé, aucun réseau dans la suite) :

- chargement d'une ligne existante : clés, rôles et révocations exposés, `API_KEY_REVOKED` observable ;
- cache de lecture avec fenêtre de sondage, forçage explicite ;
- écriture = upsert atomique `id=1` avec revalidation du document ;
- document invalide refusé avant toute requête réseau ;
- clé service_role invalide → indisponibilité explicite (503) ;
- aucune ligne → aucune clé (validation fermée).

`test/registry.test.js` — 9 tests :

- document de registre valide : entrées figées avec rôle, quota et révocation ;
- refus d'un hash en clair, d'un rôle inconnu, d'une clé dupliquée et d'un doublon de hash ;
- clé révoquée : `API_KEY_REVOKED` et non un refus générique ;
- configuration d'environnement historique acceptée avec rôle owner par défaut ;
- relecture du fichier de registre après modification, sans redémarrage ;
- revocation appliquée par le serveur sans redémarrage, rôle renvoyé dans la réponse ;
- fichier illisible ou de schéma faux rejeté ;
- écriture atomique sans fichier temporaire résiduel ;
- organisation sans clé refusée.

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

`test/netting.test.js` — 7 tests :

- compensation bilatérale et triangulaire ;
- conservation des positions nettes ;
- import CSV français et exclusion du litige ;
- séparation des devises ;
- cut-off daté appliqué sans modifier la somme des positions nettes du périmètre ;
- écart prudent des échéances absentes ou invalides dans un scénario daté, rejet d'un format de cut-off invalide ;
- neutralisation de l'injection de formule CSV et présence de `scenario_cutoff` dans l'export.

`test/rules.test.js` — 23 tests :

- pack France : échec prudemment bloquant sur un TVA FR malformé et notice de réforme ;
- numéro de TVA français bien formé admis ;
- aucune règle nationale française pour un autre pays (le pack du pays du destinataire reste actif) ;
- fenêtre de date d'effet des packs respectée ;
- types de règle inconnus ignorés prudemment ;
- identifiants hors préfixe national sans avis ;
- clé SIREN valide admise sur l'identifiant de routage ;
- préfixe de schéma EAS retiré avant le contrôle SIREN ;
- pseudo-SIREN avec clé Luhn invalide signalée ;
- SIRET à 14 chiffres contrôlé via sa partie SIREN ;
- adresse électronique de routage non prise pour un SIRET ;
- profil Factur-X MINIMUM signalé comme inadapté à la réception ;
- profil Factur-X EN 16931 admis pour la réception ;
- parcours EXTENDED-CTC-FR annoncé par une notice informative ;
- règles de profil silencieuses sans conteneur Factur-X lu ;
- chemin de fer cohérent (sous-lignes rapprochées de BT-106) admis ;
- écart entre lignes de premier niveau et BT-106 signalé avec son montant ;
- sous-ligne orpheline (ParentLineID inexistant) bloquée ;
- règle chemin de fer silencieuse sans sous-lignes, sur UBL et CII ;
- tolérance numérique exigée pour la règle chemin de fer ;
- `validatePack` exige warnOn ou noticeOn pour une règle de profil Factur-X ;
- `validatePack` rejette les packs incomplets ou non sourcés ;
- déterminisme des contrôles nationaux.

`test/rules-countries.test.js` — 12 tests :

- pack Allemagne : Leitweg-ID réelle validée et TVA DE conforme ;
- Leitweg-ID avec clé Mod 97-10 invalide signalée ;
- structure non-Leitweg signalée sur une XRechnung ;
- XRechnung sans Käuferreferenz bloquée ;
- règle Leitweg-ID silencieuse hors XRechnung ;
- TVA allemand malformé signalé ;
- pack Belgique : communication structurée canonique et TVA BE validés ;
- communication structurée avec clé invalide : avertissement avec la clé attendue ;
- référence de paiement hors VCS silencieuse ;
- packs DE et BE actifs avec version ;
- pack belge appliqué via `validateInvoice` sur un UBL complet ;
- `validatePack` exige un déclencheur pour la règle Leitweg-ID.

`test/standards.test.js` — 6 tests :

- exemple UBL conforme à EN 16931 et Peppol ;
- détection d'un total TTC erroné ;
- extraction et validation du CII embarqué dans un vrai PDF Factur-X, avec précontrôle PDF/A-3 positif ;
- rejet d’une déclaration PDF/A différente de la partie 3 ;
- rejet d’une relation de fichier associé invalide ;
- rejet d’un nom de XML différent de la propriété XMP Factur-X.

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
- contrôler le PDF Factur-X de fixture et vérifier la règle nationale de profil : `pass` sur un profil EN 16931, `warning` sur un profil MINIMUM, notice sur EXTENDED-CTC-FR ;
- avec une clé admin, lister `/api/v1/admin/keys`, créer une clé viewer, la valider, la révoquer par DELETE puis vérifier le `401 API_KEY_REVOKED` à chaud ;
- créer un membre owner, activer son MFA (setup puis enable avec le code de l'application), vérifier que le login sans code répond `401 MFA_REQUIRED` et que le changement de mot de passe invalide l'ancien ;
- contrôler un CII EXTENDED avec sous-lignes (chemin de fer) et vérifier le rapprochement BT-106 ainsi que le signalement d'un ParentLineID orphelin ;
- vérifier que les diagnostics français affichent les contrôles nationaux : format TVA FR, clé SIREN/SIRET du routage et notice de réforme ;
- importer un UBL, un CII et le PDF Factur-X de fixture ;
- vérifier que le Factur-X affiche PDF/A-3B déclaré, le profil, le nom XML, la relation `/AF` et la limite « précontrôle » ;
- traiter un lot mixte avec fichier invalide ;
- exporter TXT, JSON et CSV ;
- rechercher et filtrer l'historique ;
- importer puis exporter un profil ;
- vérifier un numéro TVA valide et invalide, puis distinguer une panne VIES ;
- vérifier un participant Peppol présent et absent, sans interpréter la présence comme une garantie de livraison ;
- charger le réseau de démonstration Net ;
- vérifier 315 000 € brut, 260 000 € compensable, 55 000 € résiduel et 82,5 % ;
- basculer le scénario Net entre « toutes les échéances », « cut-off aujourd'hui » et une date personnalisée, et vérifier que les obligations différées restent visibles et que la somme des positions nettes reste nulle ;
- importer un CSV multidevise ;
- vérifier qu'une facture litigieuse et une créance cédée sont exclues ;
- vérification officielle publique d'un CheckLink : publier les exigences d'une organisation puis vérifier `verified`, `mismatch`, `not_published` et `unknown` via `/api/v1/requirements/verify`, sans compte ;
- dans l'interface : rechercher une exigence dans « Sources & règles », se connecter en membre puis publier/dépublier, et cliquer « Vérifier ce CheckLink » dans l'aperçu fournisseur ;
- métriques consenties : cocher « Mesurer l'activation » dans Mon CheckLink, copier le CheckLink, contrôler une facture, puis lire `GET /api/v1/metrics?from=…&to=…` avec une clé admin ; décocher la case, vider le stockage du navigateur et constater (réseau du navigateur) qu'aucun événement ne part ; inspecter la table `settlemesh_metrics` pour vérifier qu'aucune ligne ne porte de donnée de facture ;
- tester la navigation clavier et la largeur mobile.

## 13. Feuille de route ordonnée

### P0 — rendre le pilote crédible

- [x] Adopter SettleMesh comme marque mère, SettleMesh CheckLink comme module de conformité et SettleMesh Net comme module de compensation, avec migration rétrocompatible des données Eurule.
- [ ] Ajouter comptes, sessions et organisations multi-utilisateurs avec membres et rôles ; l'API possède déjà une authentification technique par clé d'organisation. Décision du 8 octobre 2026 : registre d'organisations persisté en deux étapes (« option C échelonné ») — v0.14-0.15 : organisations, rôles, révocation et quotas persistés (fichier `settlemesh-registry-1` relu à chaud, puis plateforme Supabase branchée via PostgREST en fetch natif, cycle réel pousser→valider→révoquer→401 vérifié) ; v0.16-0.17 (étapes 2a et 2b-1) : API d'administration des clés avec matrice appliquée, puis comptes humains e-mail + mot de passe scrypt et sessions serveur de 24 h avec cookies durcis ; étape 2b-2 : MFA propriétaire ; étape 2b-3 : interface navigateur de gestion. Aucun contenu de facture ne transite vers ce registre. Si des données personnelles du périmètre de l'Europe sont traitées, les obligations RGPD (transferts internationaux, SCC, DPA) s'appliquent indépendamment du lieu d'hébergement et restent documentées par la revue externe.
- [ ] Stocker profils et journaux côté serveur avec chiffrement, rétention et droits d'accès ; distinct du registre d'organisations (clés, rôles, révocation, quotas) qui est persisté localement depuis 0.14.0 puis sur base managée Supabase depuis 0.15.0 — aucun profil ni journal de facturation ne transite par le registre ; l'onboarding veraPDF et le chiffrement au repos productif restent requis.
- [x] Créer une API de validation versionnée avec contrat OpenAPI, validation serveur et absence de persistance ; le déploiement reste lié à la gestion persistante des secrets, quotas et audits.
- [x] Protéger l'API pilote avec clés Bearer hashées, organisation déterminée côté serveur et rotation ; depuis 0.14.0 révocation et quotas persistés via le registre local, et depuis 0.16.0 l'API d'administration applique la matrice de rôles (owner/admin/viewer, isolation testée) ; gestionnaire de secrets et pentest externes restent requis avant production.
- [ ] Ajouter les contrôles nationaux du premier marché cible. Réalisé le 8 octobre 2026 : moteur de packs déclaratifs versionnés + packs France 1.3.0 (TVA, SIREN/SIRET, profil Factur-X, chemin de fer, notices), Allemagne 1.0.0 (TVA DE, Leitweg-ID BT-10 sur XRechnung) et Belgique 1.0.0 (TVA BE, communication structurée BT-83) ; la mise à jour des artefacts vers la révision EN 16931-1:2026, l'Italie, l'Espagne et la Pologne (KSeF) restent à prioriser.
- [ ] Vérifier exhaustivement la conformité PDF/A-3 de Factur-X ; le précontrôle structurel local XMP, profil et association XML est actif, mais une intégration veraPDF ou équivalente reste nécessaire pour clore ce point.
- [x] Ajouter VIES et Peppol Directory avec états `vérifié`, `indisponible`, `non vérifié` distincts, requêtes explicites et aucune persistance côté SettleMesh.
- [x] Instrumenter localement les métriques d'activation sans collecter le contenu ni les identifiants des factures ; toute télémétrie serveur reste soumise à consentement et analyse RGPD.
- [x] Réaliser une revue sécurité/RGPD interne et un modèle de menace OWASP ; le pentest et les validations juridique/RGPD externes restent obligatoires avant production.
- [ ] Obtenir 3 à 5 entreprises pilotes et mesurer les rejets évités.

### P1 — transformer Net en workflow collaboratif

- [ ] Créer un registre serveur d'obligations avec droits par partie.
- [ ] Importer depuis ERP/comptabilité et dédupliquer les factures.
- [ ] Vérifier que chaque partie reconnaît la même obligation.
- [ ] Ajouter périodes de netting, dates de cut-off et scénarios ; le cut-off daté de simulation est disponible localement depuis 0.10.1, sans workflow serveur ni scénarios multi-périodes persistés.
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
| Précontrôle PDF/A-3 interprété comme certification | Critique | Libellé « précontrôle local », contrôle de portée toujours présent et recommandation veraPDF ; aucune promesse ISO exhaustive |
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
| Compromission ou mauvaise isolation d'une clé API pilote | Critique | Clés fortes, hashes uniquement (jamais en clair), comparaison constante, organisation déterminée côté serveur, rotation, révocation et quotas persistés via le registre fichier 0.14.0 ; ne pas déployer avant gestionnaire de secrets, TLS, chiffrement au repos et pentest externe |
| CheckLink imité par un tiers malveillant (hameçonnage fournisseur) | Critique | Identité de l'acheteur lisible dans le lien et la page, parcours fournisseur sans compte, sans identifiant ni donnée bancaire ; vérification officielle publique d'un CheckLink contre les exigences publiées depuis 0.19.0 (verified/mismatch/not_published/unknown), **et bouton « Vérifier ce CheckLink » visible du fournisseur depuis 0.20.0** ; menace consignée dans `docs/SECURITY.md` | signature du profil dans le lien reste à construire ; sensibiliser à l'origine du lien |

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
| 2026-10-07 | Ajouter un précontrôle structurel PDF/A-3 dans le navigateur | Détecter les conteneurs Factur-X manifestement incohérents sans transmettre la facture ni prétendre reproduire un validateur ISO complet | XMP, nom du XML et association PDF deviennent des contrôles traçables ; veraPDF reste requis pour une validation exhaustive |
| 2026-10-08 | Ajouter un scénario de cut-off daté à la simulation Net | Permettre au trésorier de borner la simulation à une date sans altérer les positions nettes ni présumer d'une extinction juridique anticipée | Les obligations hors cut-off sont différées et signalées par un compteur distinct, la date doit être `AAAA-MM-JJ`, l'export CSV trace le scénario via `scenario_cutoff` ; périodes récurrentes, workflow serveur et scénarios multi-parties restent en P1 |
| 2026-10-08 | Adopter un registre d'organisations persisté en deux étapes, sur plateforme Postgres managée | Rester local dans le MVP tout en préparant l'isolation multi-clients ; réutiliser la clé d'organisation hashée déjà testée | Étape 1 (v0.11) : organisations, membres, rôles et révocation persistés, quotas persistants, tests d'isolation inter-organisation ; étape 2 (v0.12) : sessions humaines durcies et MFA propriétaire ; aucune facture ni obligation ne transite vers ce registre ; aucune région imposée par le produit, mais DPA, transferts internationaux et avis RGPD externes restent requis avant données réelles |
| 2026-10-08 | Introduire des packs de règles nationales déclaratifs et versionnés | Rendre les exigences par pays additives et modulaires sans dépendre d'un seul marché national : factures européennes traitables depuis n'importe où | Packs France 1.3.0 (TVA, SIREN/SIRET, profil Factur-X, chemin de fer, notices), Allemagne 1.0.0 (TVA, Leitweg-ID BT-10 déclenchée sur XRechnung, clé Mod 97-10) et Belgique 1.0.0 (TVA, communication structurée BT-83, clé Mod 97), source toujours citée, `validatePack` rejette un pack incomplet ; Italie, Espagne, Pologne (KSeF) et la mise à jour EN 16931-1:2026 restent à prioriser |
| 2026-10-08 | Rendre le registre d'organisations persistant localement avant l'adaptateur plateforme managée | Fermer les portes production « révocation et quotas persistants » avec les moyens disponibles, tout en préparant la migration Supabase sans changer le contrat | Fichier `settlemesh-registry-1` : hashes SHA-256 uniquement, rôles owner/admin/viewer, revokedAt, quotas ; relecture à chaud (mtime), CLI `npm run registry:key` à écriture atomique, rôle renvoyé dans la réponse de validation ; comptes humains, sessions et MFA restent en étape 2, pentest et revue RGPD externes toujours requis |
| 2026-10-08 | Brancher le registre sur la plateforme managée Supabase via PostgREST en fetch natif | Fermer la porte « adaptateur plateforme managée » sans dépendance nouvelle ni changement de contrat ; clé service_role limitée à un projet plutôt qu'un token compte-entier | Table `public.settlemesh_registry` durcie par RLS (aucune policy : seul le service_role lit/écrit), lecture en cache 5 s, `npm run registry:push` à upsert atomique, priorité fichier local > Supabase > mémoire, `.balise supabase` dans /health ; cycle réel pousser→valider→révoquer→401 vérifié sans redémarrage ; vérification RGPD externe et pentest toujours requis, RLS peut gagner par la suite des policies par organisation |
| 2026-10-08 | Ajouter l'API d'administration des clés avec application de la matrice de rôles (étape 2a) | Donner un usage réel aux rôles owner/admin/viewer (ils n'étaient qu'informables) tout en gardant les sessions humaines et le MFA pour une étape ultérieure | `GET/POST/PATCH/DELETE /api/v1/admin/*` avec isolation par organisation testée, écriture du document complet revalidée par le registre, révocation immédiatement effective sur la source active, `409 ADMIN_REQUIRES_REGISTRY` sans registre persistant ; un admin ne peut jamais créer ni promouvoir vers owner ; l'UI navigateur de gestion n'existe pas encore |
| 2026-10-08 | Ajouter membres humains et sessions durcies (étape 2b-1) sans MFA | Ouvrir la voie à l'interface de gestion tout en bornant l'exposition : e-mail + mot de passe haché scrypt, sessions 24 h côté serveur, cookie `HttpOnly`/`SameSite=Lax` ; toute indisponibilité du stockage reste `503` et jamais maquillée en mauvais identifiants | `POST /api/v1/auth/login`, `/logout`, `GET /me` ; tables `public.settlemesh_members` et `public.settlemesh_sessions` (RLS sans policy), MFA propriétaire en 2b-2 et interface navigateur de gestion en 2b-3 ; aucun mot de passe enterré, aucun secret du stockage dans le dépôt ; revue RGPD externe requise avant données personnelles réelles |
| 2026-10-08 | Activer le MFA propriétaire TOTP RFC 6238 (étape 2b-2) | Renforcer les comptes sensibles avec un second facteur sans dépendance nouvelle ; enrôlement en deux temps (setup inactif, puis validation par code) pour éviter l'auto-verrouillage | `/auth/mfa/setup` + `/auth/mfa/enable` (fenêtre ±1 pas, comparaison temps constant) + `/auth/mfa/disable` (mot de passe requis) + `/auth/password` (changement authentifié) ; au login un code valide est exigé (`401 MFA_REQUIRED`), le rattrapage d'un owner sans MFA est affiché (`mfaEnrollmentRequired`) ; le compteur HOTP est codé sur 8 octets, validé par les vecteurs RFC 6238 ; QR code restant à rendre en 2b-3, revue RGPD externe requise avant données personnelles réelles |
| 2026-10-08 | Créer le registre public d'exigences de réception (étape 4 du pack) | Permettre à un fournisseur de trouver et vérifier les exigences d'un client sans compte, et réduire la menace « CheckLink imité » par une vérification officielle publique | Table `public.settlemesh_requirements` (RLS sans policy), publication opt-in explicite jamais silencieuse, matrice admin/owner et organisation résolue côté serveur, recherche minimisée sans compte, vérification `verified/mismatch/not_published/unknown` avec format CheckLink inchangé ; interface navigateur de recherche et signature du profil restent à construire |
| 2026-10-08 | Ouvrir la première interface navigateur du registre (étape 2b-3) | Rendre visible le backend dans le produit : recherche dans Sources & règles, publication opt-in dans Mon CheckLink (session membre), et bouton « Vérifier ce CheckLink » vu du fournisseur | Les mutations par session exigent l'en-tête CSRF `X-SettleMesh-CSRF` (impossible à forger entre sites avec SameSite=Lax), testé au serveur et au client ; le publish UI recharge le profil courant entier (rél. vérifié : 201 puis `verified` en navigateur, 0 erreur console) ; signature du profil du lien reste à construire |
| 2026-10-08 | Verrouiller progressivement le login (5 échecs / 10 min par IP+e-mail) | Fermer le risque résiduel « brute force ciblé » du modèle de menace avec des moyens locaux, sans introduire d'énumération (message verrouillé distinct du message identifiants) | `429 LOGIN_LOCKED` après 5 échecs, fenêtre 10 min, traqueur en mémoire borné et purge, réinitialisé au succès ; par processus : protection distribuée et retards aléatoires restent à ajouter avant exposition |
| 2026-10-08 | **Décision de valeurs (au nom de l'humain)** : accepter une télémétrie d'activation consentie, minimisée et anonyme | L'acheteur doit pouvoir voir la valeur réelle de son CheckLink (fournisseurs actifs, factures contrôlées, factures prêtes) sans espionner personne : consentement explicite coché dans le profil, transporté dans le lien, ligne serveur réduite à organisation/jour/action/quantité 1 — rien qui puisse rattacher un événement à une facture ou une personne | `POST /api/v1/metrics/events` (sans compte, liste blanche stricte, jour futur refusé, limite IP) et lecture agrégée admin/owner (`GET /api/v1/metrics`, export CSV neutralisé) ; sans consentement, zéro octet ne quitte le navigateur fournisseur (invariant testé) ; fournisseurs identifiables, cookies de mesure, périodes sous le jour, tiers et interface de lecture restent hors périmètre sans nouvelle décision ; le SQL de la table `public.settlemesh_metrics` reste à exécuter par l'humain |

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
