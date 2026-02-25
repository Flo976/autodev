# Design: Mode Batch (`--batch`)

Date: 2026-02-25

## Objectif

Nouveau mode CLI qui regroupe des taches liees en un seul lot execute par Claude dans une seule session, produisant une seule PR avec un commit par tache.

```bash
autodev --project HIVE --batch [--auto-close] [--dry-run]
```

## Flow en 3 phases

```
Phase 1: Collecte          Phase 2: Analyse          Phase 3: Execution
─────────────               ─────────────              ──────────────
findNextTickets(50)  ──►  Claude "analyste"    ──►   Validation humaine
  (tous les TODO           recoit les tickets          Quel groupe ?
   eligibles)              + contexte projet              |
                           propose des groupes            v
                           avec raisonnement        Claude "implementeur"
                                                      1 session
                                                      1 branche
                                                      N commits
                                                      1 PR
                                                      N transitions Jira
```

## Phase 1 : Collecte

Reutilise `findNextTickets` avec un `maxCount` eleve (50) pour recuperer tous les tickets eligibles (TODO, sprint actif, non bloques). Chaque ticket est enrichi avec sa description complete via `fetchTicket`.

## Phase 2 : Analyse (Claude analyste)

Un premier appel Claude recoit :
- La liste des tickets avec descriptions, liens, epic parent
- Le `promptContext` du projet
- Le `planFile` si configure

**Prompt** : "Analyse ces tickets et regroupe-les en lots coherents pour une implementation groupee. Criteres : dependances entre tickets, fichiers/modules impactes en commun, logique fonctionnelle partagee. Chaque groupe doit rester sous ~80K tokens de contexte. Retourne un JSON structure."

**Output attendu** (JSON parse depuis la sortie Claude) :

```json
[
  {
    "name": "Scheduler tests",
    "reason": "Tests du meme module scheduler-tools.ts, dependances sequentielles",
    "tickets": ["HIVE-170", "HIVE-171", "HIVE-173"]
  },
  {
    "name": "Tool-modules fixes",
    "reason": "Meme fichier test, corrections liees (mock + assertions)",
    "tickets": ["HIVE-411", "HIVE-416"]
  }
]
```

**Execution** : Claude lance avec un prompt court, mode `--output-format json`, pas de worktree ni branche — juste de l'analyse.

## Phase 3 : Validation + Execution

### Validation

Affichage des groupes via `@inquirer/prompts`, l'utilisateur choisit un groupe ou "tous".

```
Groupe 1 — Scheduler tests (3 taches):
  HIVE-170: Test createScheduledTask
  HIVE-171: Test listScheduledTasks
  HIVE-173: Test updateScheduledTask
  Raison: Tests du meme module scheduler-tools.ts

Groupe 2 — Tool-modules fixes (2 taches):
  HIVE-411: Fix assertions tool-modules
  HIVE-416: Fix env validation ZodError
  Raison: Meme fichier test, corrections liees

Executer quel groupe ? [1/2/tous]
```

### Execution du groupe selectionne

1. Transition de tous les tickets du groupe en "En cours"
2. Creation d'une branche unique : `feat/{PROJECT}-batch-{slug}` (slug = nom du groupe)
3. Construction d'un prompt agrege : toutes les descriptions des tickets du groupe, dans l'ordre de dependance, avec l'instruction de faire un commit par ticket (`feat(HIVE-XX): description`)
4. Une seule session Claude
5. Evaluation : verifier que chaque ticket a son commit
6. Push + creation d'une PR unique referencant tous les tickets
7. Si `--auto-close` : merge + transition de tous les tickets en "Termine"

## Gestion des cas d'erreur

- **Claude plante en milieu d'execution** : les commits deja faits sont preserves. Les tickets avec un commit sont traites comme succes, les autres comme echec.
- **Un ticket du groupe est BLOCKED** : Claude cree un `BLOCKED.md` mentionnant le ticket specifique. Les commits des autres tickets restent valides.
- **Aucun ticket eligible** : exit propre comme le mode `--next`.

## Modules impactes

| Fichier | Changement |
|---------|-----------|
| `lib/jira.mjs` | Nouvelle fonction `fetchTicketsBatch(config, keys)` — fetch en parallele avec description complete |
| `lib/claude.mjs` | Nouvelles fonctions `buildBatchAnalysisPrompt(config, tickets)` + `buildBatchPrompt(config, group)` |
| `lib/batch.mjs` | **Nouveau** — orchestrateur du mode batch (analyse, validation, execution) |
| `bin/autodev.mjs` | Ajout de l'option `--batch` + appel de l'orchestrateur |
