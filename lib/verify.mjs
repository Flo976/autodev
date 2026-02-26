/**
 * verify.mjs — Functional verification of done tasks via Claude Code.
 *
 * Functions receive `config` as first parameter.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { log, logError } from "./log.mjs";
import { exportDoneTasks } from "./export.mjs";
import { executeWithClaude } from "./claude.mjs";
import { createTicket, getBoardId, findSprintByName, createSprint, moveToSprint, startSprint } from "./jira.mjs";

// ─── Build verification prompt ──────────────────────────────────────────────

function buildVerifyPrompt(config, doneTasksContent, planContent) {
  let prompt = `Tu es un auditeur technique senior qui verifie la coherence globale du projet ${config.promptContext}.

## Taches terminees

Voici la liste des taches qui ont ete implementees :

${doneTasksContent}`;

  if (planContent) {
    prompt += `

## Plan d'implementation global

Compare l'etat actuel du code avec ce plan pour verifier la coherence :

${planContent}`;
  }

  prompt += `

## Instructions CRITIQUES

Tu es en mode NON-INTERACTIF. Tu ne peux PAS poser de questions. Tu DOIS agir directement.

### Ta mission

Effectue une verification fonctionnelle globale du projet :

1. **Lis le CLAUDE.md** du projet pour comprendre les conventions.
2. **Execute les commandes de validation** si disponibles :
   - \`npm run build\` ou \`npm run typecheck\` (compilation)
   - \`npm test\` (tests unitaires)
   - \`npm run lint\` (lint)
   Capture le resultat (PASS/FAIL + details si erreur).
3. **Verifie la coherence globale** :
   - Chaque ticket est-il reellement implemente dans le code ?
   - Y a-t-il des incoherences entre tickets (modules en double, imports casses, etc.) ?
   - Les dependances entre tickets sont-elles respectees ?
   - Le code compile-t-il et les tests passent-ils ?
4. **Identifie les problemes** :
   - CRITICAL : bugs bloquants, code qui ne compile pas, fonctionnalites manquantes
   - WARNING : incoherences mineures, code mort, conventions non respectees

### Format de sortie OBLIGATOIRE

Tu DOIS ecrire le fichier \`autodev/verify-report.md\` avec EXACTEMENT ce format :

\`\`\`markdown
# Rapport de verification — ${config.projectKey}

> Genere le {date} par autodev --verify
> {N} tickets verifies

## Resume
- OK: {N} tickets
- Problemes: {N} tickets
- Non verifiables: {N} tickets

## Build & Tests
- Build: PASS ou FAIL (details si echec)
- Tests: N/N PASS ou details des echecs
- Lint: PASS ou FAIL (details si echec)

## Problemes detectes

### [CRITICAL] {description courte}
- **Tickets concernes**: HIVE-XX, HIVE-YY
- **Probleme**: Explication detaillee
- **Suggestion**: Ce qu'il faudrait faire
- **Action**: TICKET_NEEDED

### [WARNING] {description courte}
- **Tickets concernes**: HIVE-XX
- **Probleme**: Explication
- **Suggestion**: Correction suggeree
- **Action**: TICKET_NEEDED ou MANUAL_CHECK

## Tickets verifies OK
- HIVE-1: Titre du ticket
- HIVE-2: Titre du ticket
\`\`\`

### Regles
- Ne cree PAS de branches, ne committe PAS, ne push PAS.
- Ecris UNIQUEMENT le fichier \`autodev/verify-report.md\`.
- Sois factuel et precis. Cite les fichiers et lignes concernes.
- Marque \`TICKET_NEEDED\` uniquement pour les problemes qui necessitent une correction.`;

  return prompt;
}

// ─── Parse verification report ──────────────────────────────────────────────

function parseVerifyReport(reportContent) {
  const problems = [];
  const lines = reportContent.split("\n");

  let currentProblem = null;

  for (const line of lines) {
    // Match problem headers: ### [CRITICAL] or ### [WARNING]
    const headerMatch = line.match(/^### \[(CRITICAL|WARNING)\]\s+(.+)$/);
    if (headerMatch) {
      if (currentProblem) problems.push(currentProblem);
      currentProblem = {
        severity: headerMatch[1],
        title: headerMatch[2],
        tickets: "",
        problem: "",
        suggestion: "",
        action: "",
        raw: line + "\n",
      };
      continue;
    }

    if (currentProblem) {
      currentProblem.raw += line + "\n";

      const ticketsMatch = line.match(/^\- \*\*Tickets concernes\*\*:\s*(.+)$/);
      if (ticketsMatch) {
        currentProblem.tickets = ticketsMatch[1].trim();
        continue;
      }

      const problemMatch = line.match(/^\- \*\*Probleme\*\*:\s*(.+)$/);
      if (problemMatch) {
        currentProblem.problem = problemMatch[1].trim();
        continue;
      }

      const suggestionMatch = line.match(/^\- \*\*Suggestion\*\*:\s*(.+)$/);
      if (suggestionMatch) {
        currentProblem.suggestion = suggestionMatch[1].trim();
        continue;
      }

      const actionMatch = line.match(/^\- \*\*Action\*\*:\s*(.+)$/);
      if (actionMatch) {
        currentProblem.action = actionMatch[1].trim();
        continue;
      }

      // New section = end of current problem
      if (line.startsWith("## ")) {
        problems.push(currentProblem);
        currentProblem = null;
      }
    }
  }

  if (currentProblem) problems.push(currentProblem);

  return problems;
}

// ─── Create Jira tickets for problems ───────────────────────────────────────

async function createVerifyTickets(config, problems) {
  const ticketNeeded = problems.filter((p) => p.action === "TICKET_NEEDED");
  if (ticketNeeded.length === 0) {
    log("No tickets to create.");
    return [];
  }

  log(`Creating ${ticketNeeded.length} tickets for detected problems...`);
  const created = [];

  for (const p of ticketNeeded) {
    const issueType = p.severity === "CRITICAL" ? "Bug" : "Task";
    const summary = `[Verify] ${p.title}`.substring(0, 255);
    const description = [
      `Detecte par autodev --verify`,
      "",
      `Severite: ${p.severity}`,
      `Tickets concernes: ${p.tickets}`,
      "",
      `Probleme: ${p.problem}`,
      "",
      `Suggestion: ${p.suggestion}`,
    ].join("\n");

    try {
      const key = await createTicket(config, { summary, description, issueType });
      created.push({ key, summary, severity: p.severity });
    } catch (e) {
      logError(`Failed to create ticket for "${p.title}": ${e.message}`);
    }
  }

  return created;
}

// ─── Ensure "Recette Autodev" sprint exists and is active ────────────────────

const VERIFY_SPRINT_NAME = "Recette Autodev";

async function ensureVerifySprint(config, ticketKeys) {
  const boardId = await getBoardId(config);
  let sprint = await findSprintByName(config, boardId, VERIFY_SPRINT_NAME);

  if (!sprint) {
    sprint = await createSprint(config, boardId, { name: VERIFY_SPRINT_NAME });
  }

  await moveToSprint(config, sprint.id, ticketKeys);
  log(`Moved ${ticketKeys.length} tickets to sprint "${VERIFY_SPRINT_NAME}"`);

  if (sprint.state !== "active") {
    await startSprint(config, sprint.id);
  }
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

export async function verifyDoneTasks(config, { sprint } = {}) {
  log("Starting verification of done tasks...");

  // 1. Export done tasks (refresh the file)
  const doneTasksPath = await exportDoneTasks(config, { sprint });
  if (!doneTasksPath) {
    log("No done tasks to verify.");
    return null;
  }

  // 2. Read done tasks content
  const doneTasksContent = readFileSync(doneTasksPath, "utf-8");

  // 3. Read plan file if configured
  let planContent = null;
  if (config.planFile) {
    const planPath = join(config.repoPath, config.planFile);
    if (existsSync(planPath)) {
      planContent = readFileSync(planPath, "utf-8").trim();
      log(`Plan file loaded: ${config.planFile} (${planContent.length} chars)`);
    }
  }

  // 4. Build prompt and execute with Claude
  const prompt = buildVerifyPrompt(config, doneTasksContent, planContent);
  log(`Verify prompt: ${prompt.length} chars`);

  const claudeOutput = await executeWithClaude(config, prompt);
  log(`Claude finished (exit code: ${claudeOutput.code})`);

  // 5. Read the report
  const reportPath = join(config.repoPath, "autodev", "verify-report.md");
  if (!existsSync(reportPath)) {
    logError("Claude did not produce a verify-report.md");
    return { success: false, reason: "no report" };
  }

  const reportContent = readFileSync(reportPath, "utf-8");
  log(`Report generated: ${reportPath} (${reportContent.length} chars)`);

  // 6. Parse problems and create tickets
  const problems = parseVerifyReport(reportContent);
  const criticalCount = problems.filter((p) => p.severity === "CRITICAL").length;
  const warningCount = problems.filter((p) => p.severity === "WARNING").length;
  log(`Found ${criticalCount} critical, ${warningCount} warning problems`);

  const createdTickets = await createVerifyTickets(config, problems);
  if (createdTickets.length > 0) {
    log(`Created ${createdTickets.length} Jira tickets:`);
    for (const t of createdTickets) {
      log(`  ${t.key}: ${t.summary}`);
    }

    // 7. Move tickets to "Recette Autodev" sprint
    try {
      await ensureVerifySprint(config, createdTickets.map((t) => t.key));
    } catch (e) {
      logError(`Failed to setup verify sprint: ${e.message}`);
    }
  }

  return {
    success: true,
    reportPath,
    problemCount: problems.length,
    criticalCount,
    warningCount,
    createdTickets,
  };
}
