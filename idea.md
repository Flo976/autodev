# Ideas — hive-autodev

## Repo GitHub dedié + refactorisation

**Objectif** : Créer un repo GitHub pour le script autodev, et le refactoriser pour qu'il soit maintenable plus facilement et qu'on puisse lui ajouter de nouvelles fonctionnalités.

**Pistes** :
- Extraire le script dans son propre repo (hors du monorepo sooatek)
- Découper `hive-autodev.mjs` en modules (jira API, git ops, Claude runner, sprint recap, config...)
- Config par projet (`projects/{key}.json`) pour supporter plusieurs projets Jira
- Rendre les status IDs, transitions, repo path, etc. configurables
- Faciliter l'ajout de nouvelles features (plugins ? hooks ?)

### Analyse des valeurs hardcodées (6)

| Constante | Valeur actuelle | Utilisée |
|---|---|---|
| `PROJECT_KEY` | `"HIVE"` | JQL, branch naming, ticket key parsing |
| `REPO_PATH` | `".../GitHub/hive2"` | git ops, Claude cwd, file writes |
| `GH_REPO` | `"Flo976/hive2"` (inline) | `gh pr create/merge/list` |
| `STATUS.*` | `10207/10208/10209` | Transitions, JQL filters |
| Prompt text | `"projet Hive"`, `"repo hive2"` | Claude instructions |
| Transition names | `"En cours"`, `"Terminé(e)"`, `"À faire"` | `transitionTicket()` |

### Approche : fichier de config par projet

Un fichier `projects/{key}.json` par projet :

```json
{
  "projectKey": "HIVE",
  "repoPath": "/mnt/c/Users/Florent Didelot/Documents/GitHub/hive2",
  "ghRepo": "Flo976/hive2",
  "statuses": {
    "TODO": "10207",
    "IN_PROGRESS": "10208",
    "DONE": "10209"
  },
  "transitions": {
    "start": "En cours",
    "done": "Terminé(e)",
    "reopen": "À faire"
  },
  "promptContext": "projet Hive (agent IA multi-tenant SaaS)"
}
```

**Usage** : `node hive-autodev.mjs --project HIVE --next`

**Changements** :
1. Remplacer les constantes globales par un objet `config` chargé au démarrage
2. Ajouter `--project KEY` au CLI (fallback sur `HIVE` pour compat)
3. Dériver `PROJECT_KEY` de la config plutôt que du nom de fichier du ticket

**Risque** : les status IDs varient entre projets Jira (team-managed vs company-managed). La config par projet les rend explicites.

---

## Bootstrapping du contexte projet

**Objectif** : Au démarrage, le script vérifie qu'un dossier `autodev/` existe dans le repo cible avec des fichiers de contexte projet. Si incomplets ou manquants, le script refuse de se lancer.

### Fichiers de contexte (`autodev/` dans le repo cible)

| Fichier | Rôle |
|---|---|
| `index.md` | Explique à quoi sert chaque fichier du dossier autodev |
| `memory.md` | Mémoire projet : conventions, décisions techniques, patterns récurrents |
| `soul.md` | Identité du projet : vision, objectifs, contraintes, stack, architecture |
| `plan.md` | Plan courant : roadmap, priorités, prochaines étapes |
| `sprint-{N}.md` | Contexte du sprint en cours : objectifs, scope, tickets clés |

### Comportement au démarrage

1. Vérifier si `{REPO_PATH}/autodev/` existe
2. **Si non** : créer le dossier + fichiers templates avec sections à remplir
3. Vérifier si `CLAUDE.md` existe dans le repo
   - **Si non** : lancer `claude /init`, puis injecter les références vers `autodev/`
   - **Si oui** : vérifier qu'il référence `autodev/`, sinon ajouter la section
4. **Valider la complétude** : chaque fichier doit contenir plus que le template vide
   - Si un fichier est encore au template → refuser de lancer + lister les fichiers à remplir
   - Message : `"Contexte projet incomplet. Remplissez les fichiers suivants avant de lancer autodev :"`

### Section à injecter dans CLAUDE.md

```markdown
## Contexte autodev

Ce projet utilise [autodev](https://github.com/...) pour l'automatisation des tickets.

- Mémoire projet : `autodev/memory.md`
- Identité projet : `autodev/soul.md`
- Plan courant : `autodev/plan.md`
- Sprint en cours : `autodev/sprint-{N}.md`
- Index : `autodev/index.md`
```

### Flag CLI

- `--init` : forcer le bootstrapping même si les fichiers existent déjà (reset templates)
- Le check de complétude est bypassé en `--dry-run`

---

## Rapport d'implémentation Confluence automatique

**Objectif** : Après chaque ticket terminé, autodev vérifie si une page Confluence est liée dans la description du ticket Jira. Si oui, il la met à jour avec un rapport. Si non, il crée la page et y rédige le rapport.

### Comportement post-ticket (après merge PR)

1. Parser la description du ticket pour détecter un lien Confluence (`*.atlassian.net/wiki/...`)
2. **Si lien trouvé** : mettre à jour la page existante (ajouter une section "Implémentation")
3. **Si aucun lien** : créer une nouvelle page dans l'espace Confluence du projet
4. Rédiger le rapport via l'API Confluence REST (`/rest/api/content`)
5. Ajouter le lien de la page en commentaire Jira sur le ticket

### Contenu du rapport

- Résumé du ticket (key, summary, type)
- Fichiers modifiés (liste depuis la PR)
- Commits inclus
- Décisions techniques prises (extraites de la sortie Claude si possible)
- Lien vers la PR GitHub

### Prérequis

- Variables `.env` : `CONFLUENCE_BASE_URL`, `CONFLUENCE_SPACE_KEY` (ou dans la config par projet)
- Réutilise `JIRA_EMAIL` + `JIRA_API_TOKEN` (même auth Atlassian)
- Espace Confluence cible configurable par projet

---

## Exécution parallèle via git worktrees

**Objectif** : Quand plusieurs tickets n'ont aucune dépendance entre eux, autodev peut lancer N instances Claude en parallèle dans des worktrees git séparés, puis merger les résultats séquentiellement.

### Comportement

1. `findNextTicket()` évolue en `findNextTickets(n)` : récupère N tickets éligibles sans lien de blocage entre eux
2. Pour chaque ticket, créer un worktree isolé :
   - `git worktree add /tmp/autodev-HIVE-{N} -b feat/HIVE-{N}-slug main`
3. Lancer les instances Claude en parallèle (`Promise.all` / pool limité)
4. Attendre que toutes terminent
5. Merger séquentiellement dans `main` (squash PR dans l'ordre)
   - Si conflit de merge → mettre le ticket en échec, commenter dans Jira
6. Nettoyer les worktrees : `git worktree remove /tmp/autodev-HIVE-{N}`

### Détection de compatibilité

- Deux tickets sont parallélisables si :
  - Aucun lien "blocks" / "is blocked by" entre eux
  - Pas dans le même epic (heuristique : tickets du même epic risquent de toucher les mêmes fichiers)
  - Ou : analyse statique des fichiers probablement touchés (par type de ticket / epic)

### Flag CLI

- `--parallel N` : nombre max d'instances simultanées (défaut : 1 = comportement actuel)
- `--parallel auto` : déduit N selon le nombre de tickets indépendants disponibles (plafonné)

### Risques et mitigations

- **Conflits de merge** : merger dans l'ordre de création, rollback si conflit
- **Ressources** : chaque instance Claude consomme CPU/mémoire — plafonner à 3-4 max
- **Rate limiting Jira** : le throttle actuel (150ms) doit devenir per-instance ou global avec sémaphore

---

## README complet

**Objectif** : Une fois les idées ci-dessus implémentées, rédiger un README clair pour le repo autodev.

**Contenu attendu** :
- Présentation du projet (what / why)
- Prérequis (Node, Claude CLI, gh CLI, accès Jira/Confluence)
- Installation et configuration (`.env`, `projects/{key}.json`)
- Usage : tous les modes CLI avec exemples
- Architecture : description des modules et leur rôle
- Fonctionnalités : sprint recap, contexte projet, rapport Confluence, exécution parallèle
- Contribution / extension (comment ajouter un nouveau projet, une nouvelle feature)
