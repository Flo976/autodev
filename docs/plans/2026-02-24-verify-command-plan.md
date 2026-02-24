# Verify Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `--verify` CLI command that spawns Claude Code to do a functional code review of all done tasks, produces a report, and creates Jira tickets for critical problems.

**Architecture:** New `lib/verify.mjs` module with prompt builder, report parser, and Jira ticket creation. Reuses `executeWithClaude()` from `lib/claude.mjs` and `exportDoneTasks()` from `lib/export.mjs`. CLI wiring in `bin/autodev.mjs`.

**Tech Stack:** Node.js ES modules, Claude Code CLI (spawn), Jira REST API v3.

---

### Task 1: Add `createTicket()` to `lib/jira.mjs`

**Files:**
- Modify: `lib/jira.mjs` (append after `commentTicket` function, around line 165)

**Step 1: Add the createTicket function**

Append after the `commentTicket` function:

```javascript
// ─── Create ticket ──────────────────────────────────────────────────────────

export async function createTicket(config, { summary, description, issueType = "Task" }) {
  log(`Creating ticket: ${summary.substring(0, 60)}...`);
  const data = await jiraFetch(config, "/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        summary,
        description: {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description }],
            },
          ],
        },
        issuetype: { name: issueType },
      },
    }),
  });

  const key = data.key;
  log(`Created ${key}: ${summary}`);
  return key;
}
```

**Step 2: Verify syntax**

Run: `node --check lib/jira.mjs`
Expected: no output (success)

**Step 3: Commit**

```bash
git add lib/jira.mjs
git commit -m "feat: add createTicket function to jira.mjs"
```

---

### Task 2: Create `lib/verify.mjs` — prompt builder

**Files:**
- Create: `lib/verify.mjs`

**Step 1: Create the module with buildVerifyPrompt**

```javascript
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
import { createTicket } from "./jira.mjs";

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
```

**Step 2: Verify syntax**

Run: `node --check lib/verify.mjs`
Expected: no output (success)

**Step 3: Commit**

```bash
git add lib/verify.mjs
git commit -m "feat: add verify.mjs with buildVerifyPrompt"
```

---

### Task 3: Add report parser and ticket creation to `lib/verify.mjs`

**Files:**
- Modify: `lib/verify.mjs` (append after `buildVerifyPrompt`)

**Step 1: Add parseVerifyReport function**

Append after `buildVerifyPrompt`:

```javascript
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
```

**Step 2: Add createVerifyTickets function**

Append after `parseVerifyReport`:

```javascript
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
```

**Step 3: Verify syntax**

Run: `node --check lib/verify.mjs`
Expected: no output (success)

**Step 4: Commit**

```bash
git add lib/verify.mjs
git commit -m "feat: add report parser and ticket creation to verify.mjs"
```

---

### Task 4: Add main orchestrator `verifyDoneTasks` to `lib/verify.mjs`

**Files:**
- Modify: `lib/verify.mjs` (append at end, add export)

**Step 1: Add the orchestrator function**

Append at end of file:

```javascript
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
```

**Step 2: Verify syntax**

Run: `node --check lib/verify.mjs`
Expected: no output (success)

**Step 3: Commit**

```bash
git add lib/verify.mjs
git commit -m "feat: add verifyDoneTasks orchestrator to verify.mjs"
```

---

### Task 5: Wire CLI `--verify` option in `bin/autodev.mjs`

**Files:**
- Modify: `bin/autodev.mjs`

**Step 1: Add import**

After the existing import of `exportDoneTasks` (line 22), add:

```javascript
import { verifyDoneTasks } from "../lib/verify.mjs";
```

**Step 2: Add CLI option**

After `.option("--sprint <name>", ...)` (line 305), add:

```javascript
  .option("--verify", "Verify done tasks (functional code review)")
```

**Step 3: Update destructuring**

Change the destructuring in `run()` (line 320) from:

```javascript
  const { project, next, autoClose, dryRun, init, exportDone, sprint } = opts;
```

To:

```javascript
  const { project, next, autoClose, dryRun, init, exportDone, sprint, verify } = opts;
```

**Step 4: Update error guard**

Change line 335 from:

```javascript
  } else if (init || exportDone) {
```

To:

```javascript
  } else if (init || exportDone || verify) {
```

And update the error message:

```javascript
    console.error("Error: --init/--export-done/--verify requires --project <key>");
```

**Step 5: Add verify handling block**

After the `--export-done` block (after line 359), add:

```javascript
  // --verify: functional verification of done tasks
  if (verify) {
    const result = await verifyDoneTasks(config, { sprint });
    if (result?.success) {
      log(`Verification complete: ${result.reportPath}`);
      log(`${result.criticalCount} critical, ${result.warningCount} warnings`);
      if (result.createdTickets.length > 0) {
        log(`${result.createdTickets.length} Jira tickets created`);
      }
    } else {
      logError("Verification failed");
    }
    process.exit(result?.success ? 0 : 1);
  }
```

**Step 6: Verify syntax**

Run: `node --check bin/autodev.mjs`
Expected: no output (success)

**Step 7: Commit**

```bash
git add bin/autodev.mjs
git commit -m "feat: wire --verify CLI option"
```

---

### Task 6: Manual validation

**Step 1: Run the verify command**

```bash
node bin/autodev.mjs --project HIVE --verify
```

Expected: Claude spawns, explores the repo, writes `autodev/verify-report.md`, autodev parses it and potentially creates Jira tickets.

**Step 2: Check the report**

Read `{repoPath}/autodev/verify-report.md` and verify it has the expected structure.

**Step 3: Check error case**

```bash
node bin/autodev.mjs --verify
```

Expected: error about requiring `--project`.

**Step 4: Fix any issues found**

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add the verify command**

After the `--export-done` commands in the Commands section, add:

```
node bin/autodev.mjs --project HIVE --verify                     # Functional verification of done tasks
node bin/autodev.mjs --project HIVE --verify --sprint "Sprint 3"  # Verify specific sprint
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add --verify command to CLAUDE.md"
```
