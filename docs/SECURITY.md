# Sécurité, confidentialité et modèle de menace

> Revue interne du 7 octobre 2026, périmètre SettleMesh `0.8.0`. Ce document décrit des mesures techniques et des risques ; il ne constitue ni un audit externe, ni un avis juridique, ni une déclaration de conformité au RGPD.

## 1. Périmètre et méthode

La revue couvre le frontend statique publié depuis `dist/`, le stockage navigateur, l'import XML/PDF/CSV, le moteur de compensation et l'API Node locale. Elle s'appuie sur une revue de code inspirée de l'OWASP WSTG, des tests actifs limités à `localhost`, un contrôle passif du Site publié et `npm audit`.

Constats vérifiés au 7 octobre 2026 :

- le Site publié répond par une page `401` avant authentification ChatGPT ; le contenu de l'application n'est donc pas publiquement inspectable sans session autorisée ;
- l'interface métier n'émet pas de requête vers un backend SettleMesh et les validateurs sont servis localement ;
- l'API refuse les requêtes de validation sans clé, les médias non JSON, les corps trop volumineux et les XML avec `DOCTYPE` ;
- `npm audit`, dépendances de développement incluses, ne signale aucune vulnérabilité connue ;
- les données dynamiques affichées et les exports CSV sont échappés ou neutralisés.

## 2. Architecture de confiance

```text
Navigateur de l'utilisateur
  ├─ profil CheckLink et obligations Net ──> localStorage du même navigateur
  ├─ facture XML/PDF ──> mémoire locale ──> PDF.js / DOMParser / SaxonJS
  └─ export explicite ──> fichier choisi par l'utilisateur

Client intégrateur distinct
  └─ XML + clé Bearer ──> API Node locale ──> validation sans persistance
```

Frontières de confiance : fichier importé non fiable, fragment CheckLink visible par son destinataire, navigateur et extensions de l'utilisateur, origine du Site, clé API d'intégration, configuration serveur et dépendances vendoriées.

Actifs à protéger : contenu des factures, identifiants fiscaux, noms de parties, montants, obligations de paiement, règles acheteur, clés API, intégrité des résultats et positions nettes.

## 3. Inventaire et conservation des données

| Donnée | Emplacement | Conservation actuelle | Transmission automatique |
|---|---|---|---|
| XML/PDF importé | Mémoire du navigateur | Durée de l'onglet ou de l'analyse | Non |
| Résultat détaillé et anomalies | Mémoire du navigateur | Session courante | Non |
| Historique compact (numéro, fournisseur, TVA, montant, résultat) | `localStorage` | 30 jours, 100 entrées maximum | Non |
| Profil de réception | `localStorage` et fragment CheckLink partagé | Jusqu'à suppression locale ou remplacement | Non, sauf partage volontaire du lien |
| Métriques pilote agrégées | `localStorage` | Jusqu'à remise à zéro manuelle | Non ; export volontaire |
| Obligations SettleMesh Net | `localStorage` | Jusqu'à nouvel import ou suppression locale | Non ; export volontaire |
| XML envoyé à l'API locale | Mémoire du processus | Durée de la requête | Appel explicite du client intégrateur |
| Hash de clé API | Variable de configuration serveur | Durée du processus | Non |

L'historique persistant ne contient ni XML brut, ni acheteur, ni endpoint, ni référence de commande, ni détail des contrôles. Le dernier diagnostic complet n'est plus écrit dans `localStorage` à partir de la version `0.8.0`.

## 4. Menaces et mesures

| Menace | Impact | Mesure actuelle | Risque résiduel |
|---|---|---|---|
| XSS lisant `localStorage` | Fuite de données financières | échappement systématique, CSP, dépendances same-origin | une extension navigateur ou une future injection pourrait lire les données locales |
| XML avec entités externes | lecture locale, SSRF ou déni de service | rejet de `DOCTYPE` côté navigateur et API | maintenir ce rejet dans tout nouveau parseur |
| PDF ou XML pathologique | saturation CPU/mémoire | limites de lot et de taille, traitement local | ajouter isolation worker, délais et tests de charge avant production |
| Clickjacking | action trompeuse | `frame-ancestors 'none'` et `X-Frame-Options: DENY` sur le serveur Node | le Site statique dépend des en-têtes de l'hébergeur ; la balise CSP ne peut pas définir `frame-ancestors` |
| Traversée de répertoire | lecture de fichiers serveur | résolution canonique sous `dist/`, refus hors racine | couvert par test automatisé local |
| Fuite ou brute force d'une clé API | accès interorganisation | clés fortes, hash SHA-256, comparaison constante, quotas | secrets, révocation et quotas restent en mémoire : blocage production |
| Déni de service API | indisponibilité | limites 1/2 Mo et quotas IP/organisation | quotas non distribués et absence de protection d'infrastructure |
| Injection dans export CSV | exécution de formule | préfixe de neutralisation pour `=`, `+`, `-`, `@` | prévenir les régressions lors de nouveaux exports |
| Mauvaise compensation | erreur financière/juridique | devise isolée, exclusions, positions nettes testées, simulation uniquement | déclarations de litige/cession non vérifiées et absence d'accord signé |
| Dépendance ou artefact compromis | résultat de validation falsifié | versions figées et licences vendoriées | ajouter inventaire SBOM, checksums et processus de mise à jour signé |
| Règle normative périmée | faux sentiment de conformité | versions visibles et indisponibilité traitée en avertissement | veille et cadence de mise à jour à instaurer |

## 5. Résultats OWASP WSTG

| ID | Sévérité | Résultat | Impact / remédiation |
|---|---|---|---|
| WSTG-CONF-05 | Moyen, corrigé `0.8.0` | en-têtes CSP, anti-frame, nosniff, referrer et permissions appliqués par le serveur local | vérifier les en-têtes équivalents chez tout hébergeur de production |
| WSTG-CLNT-03 | Moyen, corrigé `0.8.0` | historique auparavant trop détaillé dans `localStorage` | liste blanche, rétention de 30 jours et absence de `lastResult` persistant |
| WSTG-INPV-07 | Faible, corrigé `0.8.0` | rejet `DOCTYPE` harmonisé entre navigateur et API | conserver le test à chaque nouveau format XML |
| WSTG-ATHN-01 | Élevé, ouvert | aucune identité humaine, session ou rôle | acceptable pour le MVP local ; obligatoire avant données partagées côté serveur |
| WSTG-ATHZ-01 | Élevé, ouvert | aucune autorisation objet/membre car aucun registre serveur n'existe | concevoir une matrice d'accès et des tests d'isolation avant synchronisation |
| WSTG-SESS-01 | Élevé, ouvert | aucune gestion de session applicative | choisir un fournisseur d'identité, cookies `Secure`/`HttpOnly`/`SameSite` et rotation avant production |
| WSTG-CRYP-01 | Élevé, ouvert | TLS non terminé par l'API locale | exiger TLS 1.2+ au proxy, gestionnaire de secrets et chiffrement au repos en production |
| WSTG-BUSL-01 | Critique, maîtrisé dans le MVP | la simulation Net pourrait être prise pour une exécution | aucune extinction, aucun ordre et aucun fonds ; accord humain et analyse juridique restent obligatoires |
| WSTG-ERRH-01 | Faible, satisfaisant | réponses structurées sans contenu de facture ; logs serveur minimisés | ajouter corrélation et procédure d'incident sans données sensibles |
| WSTG-INFO-02 | Information, satisfaisant | fichiers serveur hors `dist/` non servis localement | vérifier à nouveau sur l'infrastructure de production authentifiée |

## 6. Lecture RGPD préliminaire

Une facture ou un profil peut contenir des données personnelles : nom d'entrepreneur individuel, adresse e-mail, identifiant fiscal ou détail de prestation. Le traitement local limite l'exposition, mais ne supprime pas les obligations de l'entreprise qui utilise SettleMesh.

Avant tout pilote avec données réelles, il faut déterminer pour chaque flux le responsable de traitement et, le cas échéant, le sous-traitant ; documenter finalités, base légale, catégories, destinataires, durées et droits ; signer les accords nécessaires ; localiser l'hébergement ; prévoir effacement, export, journal d'accès, notification d'incident et analyse d'impact si le risque le justifie. Le profil CheckLink doit être considéré comme visible par toute personne recevant le lien.

## 7. Portes obligatoires avant production

- revue juridique et RGPD externe sur le marché et la verticale choisis ;
- comptes, sessions, MFA administrateur, organisations et rôles testés en isolation ;
- gestionnaire de secrets, révocation de clés, quotas persistants et journaux minimisés ;
- TLS au point d'entrée, en-têtes contrôlés sur l'hébergement réel, sauvegardes et chiffrement au repos ;
- tests de charge et de fichiers hostiles, scan de dépendances continu, SBOM et procédure de mise à jour ;
- politique de conservation configurable et mécanisme d'effacement pour les données serveur futures ;
- pentest indépendant avant exposition de factures réelles ;
- analyse juridique, comptable et réglementaire séparée avant tout workflow de compensation effective ou paiement.

## 8. Signalement et incident

Ne pas publier de facture, clé ou vulnérabilité exploitable dans une issue publique. Signaler le problème au propriétaire du dépôt par un canal privé en indiquant version, surface affectée, reproduction minimale sans données réelles et impact présumé. En cas d'incident : isoler la surface, révoquer les clés concernées, préserver uniquement les preuves nécessaires, évaluer les obligations de notification, corriger, tester puis documenter la décision.
