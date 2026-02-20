# Prompt pour Claude Code (WSL) — Hive AutoDev MVP

## Prompt

Crée un script Node.js `hive-autodev.mjs` qui automatise l'exécution de tickets Jira via Claude Code CLI. C'est un MVP.

### Contexte technique

**Jira :**
- Projet : `HIVE` (team-managed, software)
- API : REST v3 — ATTENTION l'endpoint search est `/rest/api/3/search/jql` (PAS `/rest/api/3/search`, celui-là est déprécié et retourne une erreur)
- Statuts : `À faire` (10207), `En cours` (10208), `Terminé(e)` (10209)
- Credentials dans `/mnt/c/Users/Florent Didelot/Desktop/sooatek/.env` (format bash : `JIRA_EMAIL`, `JIRA_BASE_URL`, `JIRA_API_TOKEN`)

**Repo cible :**
- Path : `/mnt/c/Users/Florent Didelot/Documents/GitHub/hive2`
- Remote : `https://github.com/Flo976/hive2.git`
- Branche principale : `main`

**Outils disponibles :** `node` (v22), `git`, `gh` CLI, `claude` CLI (Claude Code 2.x)

### Fonctionnement MVP

```
hive-autodev [HIVE-42]        # Exécuter un ticket spécifique
hive-autodev --next            # Prendre le prochain ticket "À faire" sans dépendance bloquante
hive-autodev --dry-run HIVE-42 # Analyse sans exécution
```

### Pipeline pour chaque ticket

1. **Fetch ticket** : Récupérer via Jira API le ticket avec :
   - summary, description, acceptance criteria (champ `description` en ADF → convertir en texte lisible)
   - priority, issuetype
   - epic parent (`parent` field)
   - tickets liés (`issuelinks`) — vérifier leur statut
   - commentaires (`comment`)

2. **Vérifier les dépendances** : Si le ticket a des `issuelinks` de type "is blocked by" dont le statut n'est pas "Terminé(e)", le ticket est bloqué → skip et passer au suivant (mode `--next`) ou expliquer pourquoi (mode ticket spécifique).

3. **Transition Jira → "En cours"** : Utiliser `/rest/api/3/issue/{key}/transitions` pour passer le ticket en "En cours" (transitionId à récupérer dynamiquement).

4. **Créer branche git** :
   ```
   git checkout main && git pull
   git checkout -b feat/HIVE-{number}-{slug}
   ```
   Le slug est généré depuis le summary (kebab-case, max 40 chars).

5. **Construire le prompt Claude** : Assembler un prompt structuré avec tout le contexte du ticket, le passer à Claude Code :
   ```
   claude --dangerously-skip-permissions -p "..." --output-format json
   ```
   Le prompt doit inclure :
   - Le contenu du ticket (summary, description, acceptance criteria)
   - Le contexte de l'epic parent
   - Les instructions : travailler dans le repo, committer avec des messages clairs, respecter les conventions du projet

6. **Évaluer le résultat** : Analyser l'output JSON de Claude Code :
   - Si `result` contient du travail effectif (commits créés, fichiers modifiés) → succès
   - Si Claude indique qu'il ne peut pas réaliser la tâche → échec, loguer la raison

7. **En cas de succès** :
   - Push la branche : `git push -u origin feat/HIVE-{number}-{slug}`
   - Créer une PR via `gh pr create` avec le lien vers le ticket Jira
   - Commenter dans Jira : PR créée + lien
   - NE PAS merger automatiquement dans le MVP (toujours review humaine)
   - NE PAS transitionner en "Terminé(e)" dans le MVP

8. **En cas d'échec** :
   - Commenter dans Jira : raison de l'échec
   - Remettre le ticket en "À faire"
   - Si mode `--next` : tenter le ticket suivant (max 3 tentatives)
   - Abandonner la branche locale

### Contraintes d'implémentation

- **Un seul fichier** : `hive-autodev.mjs` (pas de dépendances npm, utiliser `fetch` natif de Node 22)
- **Charger `.env`** manuellement (lire le fichier, parser les lignes `KEY=VALUE`)
- **Logs clairs** dans la console : chaque étape affichée avec un préfixe `[HIVE-XX]`
- **Gestion d'erreur** : si une étape échoue, cleanup (revenir sur main, supprimer la branche locale) et reporter dans Jira
- **Pas d'interactivité** : le script tourne sans input utilisateur
- **Le champ description Jira est en ADF (Atlassian Document Format)** : extraire le texte brut récursivement depuis la structure JSON (parcourir les nodes `type: "text"`)

### Structure attendue du fichier

```
hive-autodev.mjs
├── loadEnv()              — charger .env
├── jiraFetch(path)        — wrapper API Jira (auth, base URL)
├── fetchTicket(key)       — récupérer ticket + contexte complet
├── checkDependencies()    — vérifier liens bloquants
├── transitionTicket()     — changer le statut Jira
├── commentTicket()        — ajouter un commentaire Jira
├── createBranch()         — git checkout -b
├── buildPrompt()          — assembler le prompt pour Claude
├── executeWithClaude()    — lancer claude CLI
├── evaluateResult()       — analyser l'output
├── handleSuccess()        — push, PR, comment
├── handleFailure()        — cleanup, comment, rollback
├── findNextTicket()       — trouver le prochain ticket faisable
├── main()                 — orchestration CLI
```
