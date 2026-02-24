# Ideas — Exploitation des APIs Atlassian

## Etat actuel

| Domaine | Ce qui existe |
|---------|--------------|
| **Jira** | fetch ticket, transition, comment, create, search JQL, check dependencies |
| **Confluence** | publier un rapport d'implémentation (create/update page) |
| **Sprint** | détecter fin de sprint, générer recap markdown, PR recap |
| **Verify** | audit fonctionnel des tâches done, créer tickets pour les problèmes |

---

## 1. Release Management (Jira Versions API)

API : `/rest/api/3/version`

- **Créer une release** automatiquement quand un sprint est terminé
- **Assigner `fixVersion`** à chaque ticket merged (`PUT /rest/api/3/issue/{key}` avec le champ `fixVersions`)
- **Générer les release notes** via JQL `fixVersion = "v1.2.0"` — lister tous les tickets par type (feat/fix/chore)
- **Marquer la release comme "released"** avec la date (`PUT /rest/api/3/version/{id}`)
- **Publier les release notes sur Confluence** automatiquement

```
autodev --project HIVE --release "v1.2.0"           # crée release + assigne versions + notes
autodev --project HIVE --release --auto              # version auto depuis le dernier tag git
```

## 2. Sprint Management (Agile API)

API : `/rest/agile/1.0/`

- **Fermer un sprint** programmatiquement (`POST /rest/agile/1.0/sprint/{id}` avec `state: "closed"`)
- **Créer le sprint suivant** et y déplacer les tickets non terminés
- **Calculer la vélocité** : compter les story points des tickets done par sprint
- **Sprint planning assisté** : suggérer les tickets du prochain sprint en fonction de la vélocité moyenne et des dépendances

```
autodev --project HIVE --close-sprint               # ferme le sprint, déplace les restants, crée le suivant
autodev --project HIVE --velocity                    # affiche la vélocité sur les N derniers sprints
autodev --project HIVE --plan-sprint                 # suggère le contenu du prochain sprint
```

## 3. Epic Decomposition & Backlog Automation

- **Auto-décomposer un epic** en stories via Claude : lire la description de l'epic, analyser le code, proposer un découpage en tâches, les créer dans Jira avec les bons liens `is child of`
- **Enrichir les tickets** automatiquement : ajouter des acceptance criteria, estimer les story points, assigner les composants Jira en fonction des fichiers impactés
- **Ordonner le backlog** : détecter les dépendances implicites (même fichiers modifiés) et créer les liens `is blocked by`

```
autodev --project HIVE --decompose HIVE-100          # décompose l'epic en stories
autodev --project HIVE --enrich                       # enrichit les tickets TODO (AC, points, composants)
autodev --project HIVE --reorder                      # détecte et crée les liens de dépendance
```

## 4. Confluence Knowledge Base

Au-delà du simple rapport d'implémentation :

- **Architecture vivante** : après chaque sprint, mettre à jour une page Confluence "Architecture" avec le graphe des modules, les APIs, les dépendances — généré par Claude en lisant le code
- **Changelog par release** : page Confluence structurée avec les changements groupés par epic/feature
- **Retrospective auto** : générer un brouillon de retro (ce qui a marché, ce qui a bloqué, métriques) à partir des données Jira (tickets bloqués, temps moyen, etc.)
- **Decision log** : créer automatiquement une entrée dans le decision log Confluence quand un ticket `BLOCKED.md` est résolu avec une approche alternative
- **Runbooks** : générer des runbooks opérationnels à partir du code (routes API, configs, commandes)

```
autodev --project HIVE --update-docs                  # met à jour l'archi sur Confluence
autodev --project HIVE --changelog "v1.2.0"           # publie le changelog sur Confluence
autodev --project HIVE --retro "Sprint 3"             # génère un brouillon de retro
```

## 5. Quality Gates & Metrics

- **Worklogs automatiques** : logger le temps passé par Claude sur chaque ticket (`POST /rest/api/3/issue/{key}/worklog`)
- **Labels automatiques** : tagger les tickets avec `autodev-processed`, `autodev-blocked`, `needs-review` etc.
- **Composants Jira** : assigner automatiquement les composants en fonction des fichiers modifiés (frontend/backend/infra)
- **Dashboard Jira** : créer un filtre JQL sauvegardé pour le suivi autodev + un dashboard
- **SLA tracking** : mesurer le temps entre creation → done, détecter les tickets qui stagnent

```
autodev --project HIVE --dashboard                    # crée/met à jour le dashboard Jira
autodev --project HIVE --stale                        # liste les tickets en cours depuis trop longtemps
```

## 6. Webhooks / Mode Réactif

Au lieu de poll avec `--next` :

- **Ecouter les webhooks Jira** : quand un ticket passe en "A faire", autodev le traite automatiquement
- **Réagir aux commentaires** : si un reviewer commente "autodev fix this", autodev relance sur le ticket
- Mode serveur (`autodev --serve`) qui tourne en continu

## 7. Pipeline Complet de Release

Orchestrer le flow complet :

```
Sprint terminé
  → fermer le sprint Jira
  → déplacer les tickets restants au sprint suivant
  → créer une version Jira (v1.2.0)
  → assigner fixVersion aux tickets done
  → générer les release notes (Markdown + Confluence)
  → créer un tag git + GitHub Release
  → publier la retro sur Confluence
  → créer le sprint suivant
  → notifier l'équipe (webhook Slack/Teams)
```

## 8. Agent de Planning — Plan → Sprints → Tâches → Jira

Un agent interactif qui transforme un plan d'implémentation Markdown en sprints et tâches Jira, avec validation humaine à chaque étape.

**Utilisation obligatoire du skill `superpowers:brainstorming`** à l'étape 0 pour challenger le plan avant toute exécution.

### Flow

```
Plan Markdown (input)
  │
  ▼
┌─────────────────────────────────────────────┐
│ Étape 0 — Analyse du plan (brainstorming)   │
│                                             │
│ OBLIGATOIRE : invoquer le skill             │
│ superpowers:brainstorming avant toute       │
│ action.                                     │
│                                             │
│ Claude analyse le plan et produit :         │
│                                             │
│ A) Questions de clarification               │
│    - Ambiguïtés dans le plan                │
│    - Choix techniques non tranchés          │
│    - Cas limites non couverts               │
│    - Contradictions ou incohérences         │
│    - Périmètre flou ("améliorer X")         │
│                                             │
│ B) Prérequis à rassembler par l'humain      │
│    - Accès / credentials nécessaires        │
│    - APIs tierces à documenter              │
│    - Décisions produit en attente           │
│    - Assets manquants (maquettes, specs)    │
│    - Données de test / environnements       │
│    - Dépendances externes (libs, services)  │
│    - Validations légales / sécu / RGPD      │
│                                             │
│ C) Risques identifiés                       │
│    - Complexité sous-estimée                │
│    - Dépendances circulaires                │
│    - Points de blocage prévisibles          │
│                                             │
│ → VALIDATION HUMAINE                        │
│   L'humain répond aux questions,            │
│   rassemble les prérequis, et confirme      │
│   que le plan est prêt pour le découpage.   │
│   Le plan peut être mis à jour suite aux    │
│   réponses.                                 │
└─────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────┐
│ Étape 1 — Découpage en sprints              │
│                                             │
│ Claude lit le plan (enrichi par l'étape 0)  │
│ et propose un découpage en sprints          │
│ cohérents :                                 │
│ - Grouper par thème/dépendances             │
│ - Estimer la charge par sprint              │
│ - Identifier l'ordre (dépendances inter-    │
│   sprints)                                  │
│ - Vérifier que les prérequis sont couverts  │
│   avant le sprint qui en dépend             │
│ Output : liste de sprints avec scope        │
│                                             │
│ → VALIDATION HUMAINE                        │
│   L'humain revoit, ajuste, valide les       │
│   sprints proposés                          │
└─────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────┐
│ Étape 2 — Détail des tâches par sprint      │
│                                             │
│ Pour chaque sprint validé, lancer un Claude │
│ avec le contexte :                          │
│ - Le plan global (enrichi)                  │
│ - Le scope du sprint                        │
│ - L'état du code (CLAUDE.md, archi)         │
│ - Les sprints précédents (ce qui sera       │
│   déjà implémenté)                          │
│ - Les réponses aux questions de l'étape 0   │
│ - Les prérequis confirmés comme réunis      │
│                                             │
│ Claude produit pour chaque sprint :         │
│ - Liste de tâches détaillées                │
│ - Description technique (acceptance         │
│   criteria)                                 │
│ - Estimation (story points)                 │
│ - Dépendances intra-sprint (liens           │
│   "is blocked by")                          │
│ - Type de ticket (Story, Task, Bug)         │
│                                             │
│ Les sprints sont traités en parallèle       │
│ (1 Claude par sprint)                       │
└─────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────┐
│ Étape 3 — Validation humaine des tâches     │
│                                             │
│ Présenter à l'humain :                      │
│ - Les tâches de chaque sprint               │
│ - Un résumé de l'état attendu du projet     │
│   à la fin de chaque sprint                 │
│ - Les dépendances détectées                 │
│ - Les risques identifiés                    │
│ - Les prérequis non encore réunis (alerte)  │
│                                             │
│ L'humain peut :                             │
│ - Modifier/supprimer/ajouter des tâches     │
│ - Réorganiser entre sprints                 │
│ - Valider sprint par sprint ou en bloc      │
└─────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────┐
│ Étape 4 — Import dans Jira                  │
│                                             │
│ Une fois validé, créer dans Jira :          │
│ - Les sprints (Agile API)                   │
│ - Un epic par sprint (ou par thème)         │
│ - Les tickets avec :                        │
│   · summary, description (ADF)             │
│   · issueType, priority, story points       │
│   · sprint assignment                       │
│   · liens de dépendance (is blocked by)     │
│   · labels (autodev-planned)                │
│ - Rapport de création (N tickets créés,     │
│   liens, sprints)                           │
│                                             │
│ Les tickets sont prêts pour --next          │
└─────────────────────────────────────────────┘
```

### CLI

```
autodev --project HIVE --plan docs/plan.md                    # lance le flow complet (étapes 0-4)
autodev --project HIVE --plan docs/plan.md --step analyze     # étape 0 seule (brainstorming / questions)
autodev --project HIVE --plan docs/plan.md --step sprints     # étape 1 seule (découpage)
autodev --project HIVE --plan docs/plan.md --step tasks       # étape 2 seule (détail tâches)
autodev --project HIVE --plan docs/plan.md --import           # étape 4 seule (import Jira)
autodev --project HIVE --plan docs/plan.md --dry-run          # preview sans créer dans Jira
```

### Principes

- **Brainstorming obligatoire** : le skill `superpowers:brainstorming` est invoqué systématiquement à l'étape 0 pour challenger le plan, poser les bonnes questions, et lister les prérequis — avant toute décomposition
- **Human-in-the-loop** : chaque étape attend une validation avant de passer à la suivante
- **Prérequis explicites** : l'agent identifie ce que l'humain doit rassembler (accès, specs, décisions) et le traque jusqu'à confirmation
- **Parallélisme** : les sprints sont détaillés en parallèle (1 Claude par sprint) pour gagner du temps
- **Contexte cumulatif** : chaque sprint reçoit le contexte des sprints précédents + les réponses aux questions de l'étape 0
- **Idempotent** : l'état intermédiaire est sauvegardé dans `autodev/plan-state.json` pour pouvoir reprendre en cas d'interruption
- **Dry-run** : possibilité de voir le résultat final sans rien créer dans Jira

---

## 9. Sprint Branches — Branche par sprint

Chaque sprint doit avoir une branche de sprint pré-créée (ex: `sprint/sprint-3`). Chaque tâche doit être créée depuis la branche de sprint en cours et mergée dedans (au lieu de `main`). La branche de sprint est mergée dans `main` à la fin du sprint.

```
main
  └── sprint/sprint-3
        ├── feat/HIVE-406-fix-ts-build
        ├── feat/HIVE-407-fix-eslint
        └── feat/HIVE-408-fix-db-test
```

- `autodev` crée les branches de feature depuis `sprint/sprint-X` au lieu de `main`
- Les PRs ciblent `sprint/sprint-X` au lieu de `main`
- À la fin du sprint, une PR `sprint/sprint-X → main` regroupe tout le travail

---

## 10. CLI Interactive — Améliorations

### 10A. Recap + prochaine étape suggérée

Après chaque action dans la CLI interactive, afficher un texte contextuel qui résume ce qui vient d'être fait et suggère la prochaine action logique :

```
Apres "Executer un ticket" :
  → Prochaine etape : Executer le prochain ticket ou verifier les taches done

Apres "Close sprint" :
  → Prochaine etape : Demarrer le sprint suivant sur Jira, ou verifier le sprint termine (--verify)

Apres "Release" :
  → Prochaine etape : Fermer le sprint ou mettre a jour Confluence

Apres "Verify" :
  → Prochaine etape : Corriger les tickets crees ou lancer une release

Apres "Export" :
  → Prochaine etape : Partager le fichier genere ou lancer une verification

Apres "Init" :
  → Prochaine etape : Executer un ticket ou configurer le projet
```

Les suggestions sont statiques (basées sur l'action choisie, pas sur le résultat réel), affichées en dim après le retour de la commande.

### 10B. Ajouter un projet depuis la CLI

Option dans le menu principal : "Ajouter un projet" (entre "Init projet" et "Changer de projet").

Demande interactivement :
- `projectKey` (ex: HIVE)
- `repoPath` (chemin absolu du repo)
- `ghRepo` (ex: Flo976/hive2)
- `statuses` : TODO ID, IN_PROGRESS ID, DONE ID
- `transitions` : start name, done name, reopen name
- `promptContext` (description courte du projet)

Crée `projects/{KEY}.json` avec les valeurs saisies. Vérifie que le fichier n'existe pas déjà avant de créer.

---

## Priorisation suggérée

| Priorité | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Release management (versions + notes) | Moyen | Très fort |
| 2 | Sprint close + create next | Faible | Fort |
| 3 | Auto-labels + composants | Faible | Moyen |
| 4 | Confluence changelog/retro | Moyen | Fort |
| 5 | Epic decomposition | Fort | Très fort |
| 6 | Vélocité + métriques | Moyen | Moyen |
| 7 | Worklogs automatiques | Faible | Faible |
| 8 | Agent de planning (plan → sprints → tâches → Jira) | Fort | Très fort |
| 9 | Webhook mode | Fort | Fort |
