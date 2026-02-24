# Design : Commande `--verify`

**Date** : 2026-02-24

## Objectif

Ajouter une commande `--verify` qui vérifie la cohérence globale des tâches terminées en spawning Claude Code sur le repo cible. Claude fait une code review fonctionnelle, exécute les tests, et produit un rapport. Autodev crée des tickets Jira pour les problèmes critiques.

## CLI

```bash
node bin/autodev.mjs --project HIVE --verify                     # Toutes les tâches DONE
node bin/autodev.mjs --project HIVE --verify --sprint "Sprint 3" # Filtre par sprint
```

## Flow

1. Appel `exportDoneTasks()` pour générer/rafraîchir `done-tasks.md`
2. Lecture du fichier `done-tasks.md`
3. Injection du plan d'implémentation si `config.planFile` existe
4. Construction du prompt de review fonctionnelle
5. Spawn Claude Code (`executeWithClaude`) sur le repo cible
6. Claude explore le code, exécute les tests, écrit `autodev/verify-report.md`
7. Autodev parse le rapport et crée des tickets Jira si `TICKET_NEEDED`

## Prompt de review

Claude reçoit :
- Le contenu complet de `done-tasks.md`
- Le plan d'implémentation global (si disponible)
- Instructions :
  - Vérifier la cohérence globale du sprint
  - Exécuter `npm test`, `npm run build`, `npm run lint` si disponibles
  - Vérifier que chaque ticket est réellement implémenté dans le code
  - Détecter les incohérences inter-tickets
  - Identifier les fonctionnalités manquantes ou mal intégrées
  - Écrire le rapport dans `autodev/verify-report.md` au format structuré

## Format du rapport

```markdown
# Rapport de verification — {PROJECT_KEY}

> Genere le {date} par autodev --verify
> {N} tickets verifies

## Resume
- OK: {N} tickets
- Problemes: {N} tickets
- Non verifiables: {N} tickets

## Build & Tests
- Build: PASS / FAIL (details)
- Tests: N/N PASS / FAIL (details)
- Lint: PASS / FAIL (details)

## Problemes detectes

### [CRITICAL] {description courte}
- **Tickets concernes**: HIVE-42, HIVE-43
- **Probleme**: Explication detaillee
- **Suggestion**: Ce qu'il faudrait faire
- **Action**: TICKET_NEEDED

### [WARNING] {description courte}
- **Tickets concernes**: HIVE-23
- **Probleme**: Explication
- **Suggestion**: Correction suggeree
- **Action**: TICKET_NEEDED | MANUAL_CHECK

## Tickets verifies OK
- HIVE-1: Initialiser le repo Git
- HIVE-2: Creer le package.json racine
...
```

## Création de tickets Jira

Autodev parse le rapport en cherchant les blocs avec `**Action**: TICKET_NEEDED`. Pour chaque :
- Titre : `[Verify] {description courte}`
- Description : bloc complet du problème + suggestion
- Type : Bug (CRITICAL) ou Task (WARNING)
- Projet : `config.projectKey`

## Architecture

### Nouveau : `lib/verify.mjs`

- `buildVerifyPrompt(config, doneTasksContent, planContent)` — construit le prompt
- `parseVerifyReport(reportContent)` — parse le rapport, extrait les problèmes avec action TICKET_NEEDED
- `createVerifyTickets(config, problems)` — crée les tickets Jira pour les problèmes
- `verifyDoneTasks(config, { sprint })` — orchestrateur principal

### Modification : `bin/autodev.mjs`

- Ajout option `--verify`
- Branchement vers `verifyDoneTasks()` dans `run()`

### Réutilisation

- `executeWithClaude()` de `lib/claude.mjs` — spawne Claude Code
- `exportDoneTasks()` de `lib/export.mjs` — génère done-tasks.md
- `jiraFetch()` de `lib/jira.mjs` — crée les tickets Jira
