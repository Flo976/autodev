# Design : Refactorisation autodev

**Date** : 2026-02-20
**Statut** : Approuve

## Contexte

`hive-autodev.mjs` est un script monolithique de ~970 lignes qui automatise l'execution de tickets Jira via Claude Code CLI. Il est actuellement couple au projet HIVE. L'objectif est de le rendre multi-projet, maintenable, et extensible.

**Audience** : Perso/Sooatek d'abord, open-source plus tard.
**Dependances npm** : Pas de contrainte, on utilise ce qui est pratique.
**Priorite** : Bootstrapping contexte > config multi-projet > Confluence > worktrees paralleles.

## Architecture : Multi-fichiers ESM plats

```
autodev/
  bin/autodev.mjs              # CLI entry point (commander)
  lib/
    config.mjs                 # Charge projects/{key}.json + .env
    log.mjs                    # Logging avec prefixe [TICKET] / [AUTODEV]
    jira.mjs                   # jiraFetch, fetchTicket, transitions, comments, search
    git.mjs                    # git(), slugify(), createBranch(), cleanupBranch()
    claude.mjs                 # executeWithClaude(), evaluateResult()
    github.mjs                 # PR create/merge via gh CLI
    sprint.mjs                 # checkSprintCompletion, generateRecap, createSprintBranch
    context.mjs                # ensureProjectContext(), validateCompleteness()
    confluence.mjs             # createPage, updatePage, generateReport
    adf.mjs                    # adfToText
  projects/
    HIVE.json                  # Config projet HIVE
  templates/                   # Templates pour bootstrapping contexte
    index.md
    memory.md
    soul.md
    plan.md
    sprint.md
  package.json                 # type: "module", deps: commander, dotenv
  .env.example
```

Chaque module exporte des fonctions pures (ou quasi-pures) qui recoivent la config en parametre. Plus de constantes globales.

## Config multi-projet

Fichier `projects/{KEY}.json` :

```json
{
  "projectKey": "HIVE",
  "repoPath": "/mnt/c/Users/Florent Didelot/Documents/GitHub/hive2",
  "ghRepo": "Flo976/hive2",
  "statuses": { "TODO": "10207", "IN_PROGRESS": "10208", "DONE": "10209" },
  "transitions": { "start": "En cours", "done": "Termine(e)", "reopen": "A faire" },
  "promptContext": "projet Hive (agent IA multi-tenant SaaS)",
  "confluence": { "spaceKey": "HIVE", "parentPageId": "optional" }
}
```

**CLI** :
```
autodev HIVE-42                          # deduit le projet du prefixe
autodev --project HIVE --next
autodev --project HIVE --auto-close --next
autodev --project HIVE --init
autodev --project HIVE --parallel 3 --auto-close --next
autodev --dry-run HIVE-42
```

Le projet est deduit du prefixe du ticket (HIVE-42 → projects/HIVE.json) ou specifie via `--project`.

## Bootstrapping contexte projet

Au demarrage, `context.mjs` verifie le repo cible.

**Fichiers crees dans `{repoPath}/autodev/`** :

| Fichier | Role |
|---|---|
| `index.md` | Explique chaque fichier du dossier (pre-rempli) |
| `memory.md` | Conventions, decisions techniques, patterns |
| `soul.md` | Vision, objectifs, stack, architecture |
| `plan.md` | Roadmap, priorites, prochaines etapes |
| `sprint-current.md` | Objectifs du sprint en cours, scope |

**Logique** :

1. `ensureProjectContext(config)` appele au demarrage
2. Si `autodev/` n'existe pas → creer + copier les templates depuis `templates/`
3. Verifier `CLAUDE.md` :
   - N'existe pas → `execSync("claude /init")` dans le repo, puis injecter la section autodev
   - Existe sans reference autodev → append la section
   - Existe avec reference → rien
4. `validateCompleteness()` : chaque `.md` (sauf `index.md`) doit contenir au moins une ligne de contenu (pas juste des headings/placeholders). Sinon : lister les fichiers manquants et exit(1).

**Bypass** : `--dry-run` et `--init` passent la validation de completude.

**Section injectee dans CLAUDE.md** :
```markdown
## Contexte autodev

Ce projet utilise autodev pour l'automatisation des tickets Jira.
Consultez les fichiers suivants pour le contexte projet :

- Memoire projet : `autodev/memory.md`
- Identite projet : `autodev/soul.md`
- Plan courant : `autodev/plan.md`
- Sprint en cours : `autodev/sprint-current.md`
- Index : `autodev/index.md`
```

## Rapport Confluence automatique

Apres chaque ticket termine (autoClose=true), `confluence.mjs` genere un rapport.

**Flow** :

1. Parser `ticket.description` pour un lien Confluence (`*.atlassian.net/wiki/...`)
2. Si lien → mettre a jour la page (ajouter section "Implementation")
3. Si pas de lien → creer une nouvelle page dans l'espace configure
4. Commenter dans Jira avec le lien Confluence

**Contenu du rapport** :
- Resume du ticket (key, summary, type)
- Fichiers modifies
- Commits inclus
- Extrait de la sortie Claude (500 chars)
- Lien vers la PR GitHub

**Auth** : Reutilise JIRA_EMAIL + JIRA_API_TOKEN (Atlassian Cloud). API Confluence REST v2.

**Optionnel** : Si `config.confluence` est absent, la feature est desactivee silencieusement.

## Execution parallele via worktrees

Active par `--parallel N` (defaut: 1 = sequentiel).

**Flow** :

1. `findNextTickets(n)` : recuperer N tickets eligibles
   - Pas de lien de blocage entre les tickets selectionnes
   - Pas dans le meme epic (heuristique anti-conflit)
2. Creer un worktree par ticket : `git worktree add /tmp/autodev-{KEY} -b feat/{KEY}-{slug} main`
3. Lancer processTicket() en parallele (semaphore max N)
4. Merger sequentiellement (un a la fois, rebase si conflit)
5. Cleanup : `git worktree remove /tmp/autodev-{KEY}`

**Gardes** :
- Cap a 4 workers max
- Semaphore global pour le throttle Jira (150ms partage entre instances)
- Si merge echoue apres rebase → marquer comme failed

## Ordre d'implementation

```
1. Refactorisation modules + config multi-projet (fondation)
   ↓
2. Bootstrapping contexte projet
   ↓
3. Rapport Confluence automatique
   ↓
4. Execution parallele via worktrees
   ↓
5. README
```

Chaque step est testable independamment.
