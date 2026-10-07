# Règle permanente de travail — SettleMesh

## Dashboard Gate obligatoire

Avant toute modification de code, d'interface, de règle métier, de dépendance, de documentation produit ou de configuration dans ce dépôt :

1. lire intégralement `PROJECT_DASHBOARD.md` et `README.md` ;
2. vérifier `git status` et ne jamais écraser un changement existant sans l'identifier ;
3. nommer les modules, parcours, données, exports, invariants et tests affectés ;
4. contrôler les quatre groupes d'invariants du dashboard : conformité, confidentialité, compensation et expérience ;
5. vérifier explicitement si le changement pourrait faire de SettleMesh un détenteur de fonds, un initiateur de paiement, un décideur automatique d'extinction de créance ou l'auteur d'une promesse de conformité juridique ; si oui, ne pas implémenter ce comportement sans décision humaine, analyse juridique et mise à jour du dashboard ;
6. définir les critères d'acceptation et la stratégie de test avant l'édition.

Pendant la modification :

- conserver le traitement local et la minimisation des données tant qu'une architecture serveur approuvée n'existe pas ;
- ne jamais mélanger des devises dans le moteur de compensation ;
- préserver la position nette de chaque participant et la traçabilité vers les factures ;
- exclure les obligations invalides, litigieuses, cédées ou non éligibles ;
- distinguer clairement validation officielle, règle acheteur, simulation et fonctionnalité future ;
- échapper les données dynamiques et neutraliser les formules dans les exports tabulaires ;
- ajouter ou adapter les tests correspondant au risque introduit.

Après toute modification :

1. exécuter `npm test`, `npm run check` et `git diff --check` ;
2. pour une modification visuelle, tester la vue concernée dans un navigateur, en bureau et mobile, puis vérifier les erreurs console ;
3. relire le diff pour détecter secrets, données sensibles, artefacts volumineux ou changement hors périmètre ;
4. mettre à jour `PROJECT_DASHBOARD.md` dès qu'un comportement, statut, risque, invariant, test, fichier, version, décision ou élément de roadmap change ;
5. mettre à jour `README.md` lorsque le mode d'emploi ou le périmètre visible change ;
6. dans le compte rendu, préciser le résultat, les validations effectuées et les limites restantes.

Une tâche ne doit pas être déclarée terminée si le code et le tableau de bord se contredisent.

