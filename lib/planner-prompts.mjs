/**
 * planner-prompts.mjs — Prompt templates for each planning step.
 *
 * Each function returns a string prompt for Claude CLI.
 */

// ─── Step 0: Analyze plan ───────────────────────────────────────────────────

export function buildAnalyzePrompt(config, planContent, treeOutput) {
  return `Tu es un architecte logiciel senior qui analyse un plan d'implementation pour le ${config.promptContext}.

## Plan a analyser

${planContent}

## Arborescence du projet

\`\`\`
${treeOutput}
\`\`\`

## Instructions CRITIQUES

Tu es en mode NON-INTERACTIF. Tu ne peux PAS poser de questions. Tu DOIS agir directement.

### Ta mission

Analyse le plan et produis le fichier \`autodev/plan-analysis.md\` avec EXACTEMENT ce format :

\`\`\`markdown
# Analyse du plan — ${config.projectKey}

> Genere le {date} par autodev --plan --step analyze

## Questions de clarification

Liste les ambiguites, choix non tranches, cas limites non couverts.
Format : une checkbox par question.

- [ ] Q1: {question precise}
- [ ] Q2: ...

## Prerequis a rassembler

Liste ce que l'humain doit preparer avant de commencer (acces, specs, decisions, assets, env).
Format : une checkbox par prerequis.

- [ ] P1: {prerequis precis}
- [ ] P2: ...

## Risques identifies

Liste les risques techniques, complexite sous-estimee, dependances fragiles.

- R1: {risque et impact potentiel}
- R2: ...
\`\`\`

### Regles
- Lis le CLAUDE.md du projet pour comprendre les conventions.
- Sois precis et actionnable. Pas de generalites.
- Ne cree PAS de branches, ne committe PAS.
- Ecris UNIQUEMENT le fichier \`autodev/plan-analysis.md\`.`;
}

// ─── Step 1: Split into sprints ─────────────────────────────────────────────

export function buildSprintsPrompt(config, planContent, analysisAnswers) {
  let context = "";
  if (analysisAnswers) {
    context = `\n\n## Reponses aux questions de l'analyse\n\n${analysisAnswers}\n`;
  }

  return `Tu es un chef de projet technique qui decoupe un plan en sprints pour le ${config.promptContext}.

## Plan d'implementation

${planContent}
${context}

## Instructions CRITIQUES

Tu es en mode NON-INTERACTIF. Tu ne peux PAS poser de questions. Tu DOIS agir directement.

### Ta mission

Decoupe le plan en sprints coherents et produis le fichier \`autodev/plan-sprints.md\` avec EXACTEMENT ce format :

\`\`\`markdown
# Decoupage en sprints — ${config.projectKey}

> Genere le {date} par autodev --plan --step sprints

## Sprint 1 — {Titre court}

- **Scope**: {description du perimetre en 2-3 phrases}
- **Prerequis reunis**: {P1, P2 ou "aucun"}
- **Depend de**: {rien ou Sprint N}
- **Charge estimee**: {S / M / L}
- **Themes**: {liste des themes couverts}

## Sprint 2 — {Titre court}
...
\`\`\`

### Regles de decoupage
- Grouper par theme et dependances (pas par type de tache).
- Un sprint = un increment fonctionnel livrable.
- Les prerequis doivent etre reunis AVANT le sprint qui en depend.
- Charge S = 3-5 taches, M = 5-10, L = 10-15.
- Lis le CLAUDE.md pour comprendre la base de code.
- Ne cree PAS de branches, ne committe PAS.
- Ecris UNIQUEMENT le fichier \`autodev/plan-sprints.md\`.`;
}

// ─── Step 2: Detail tasks for one sprint ────────────────────────────────────

export function buildTasksPrompt(config, planContent, sprintScope, previousSprints, analysisAnswers) {
  let prevContext = "";
  if (previousSprints && previousSprints.length > 0) {
    prevContext = `\n\n## Sprints precedents (deja planifies)\n\n${previousSprints.join("\n\n---\n\n")}\n`;
  }

  let answersContext = "";
  if (analysisAnswers) {
    answersContext = `\n\n## Reponses aux questions de l'analyse\n\n${analysisAnswers}\n`;
  }

  return `Tu es un developpeur senior qui detaille les taches d'un sprint pour le ${config.promptContext}.

## Plan global

${planContent}
${prevContext}
${answersContext}

## Sprint a detailler

${sprintScope}

## Instructions CRITIQUES

Tu es en mode NON-INTERACTIF. Tu ne peux PAS poser de questions. Tu DOIS agir directement.

### Ta mission

Detaille les taches du sprint et ecris le resultat en JSON dans le fichier indique en fin de prompt.

### Format de sortie OBLIGATOIRE (JSON)

\`\`\`json
[
  {
    "summary": "Titre court et actionnable",
    "description": "Description technique detaillee avec acceptance criteria",
    "issueType": "Story | Task | Bug",
    "storyPoints": 1 | 2 | 3 | 5 | 8,
    "blockedBy": [],
    "labels": ["autodev-planned"],
    "component": "Backend | Frontend | Infrastructure | ..."
  }
]
\`\`\`

### Regles
- Lis le CLAUDE.md pour comprendre les conventions et la stack.
- Chaque tache = une unite de travail implementable en une session Claude.
- Les descriptions doivent etre assez detaillees pour qu'un developpeur (ou Claude) puisse implementer sans poser de questions.
- \`blockedBy\` contient les index (0-based) des taches dont celle-ci depend dans CE sprint.
- Ne cree PAS de branches, ne committe PAS.
- Ecris UNIQUEMENT le fichier \`autodev/plan-sprint-{N}-tasks.json\` (le N est fourni ci-dessous).`;
}
