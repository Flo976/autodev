/**
 * claude.mjs — Claude Code CLI integration.
 *
 * Functions receive `config` as first parameter and use
 * `config.repoPath`, `config.projectKey`, `config.promptContext`.
 */

import { readFileSync, existsSync } from "fs";
import { execSync, spawn } from "child_process";
import { join } from "path";
import { log, logError } from "./log.mjs";
import { git } from "./git.mjs";

// ─── Build prompt for Claude ─────────────────────────────────────────────────

export function buildPrompt(config, ticket) {
  let prompt = `Tu es un developpeur senior qui travaille sur le ${config.promptContext}.

## Ticket a implementer

**${ticket.key}: ${ticket.summary}**
- Type: ${ticket.issueType}
- Priorite: ${ticket.priority}`;

  if (ticket.epicKey) {
    prompt += `\n- Epic: ${ticket.epicKey} — ${ticket.epicSummary}`;
  }

  if (ticket.description) {
    prompt += `\n\n## Description\n\n${ticket.description}`;
  }

  if (ticket.comments.length > 0) {
    prompt += `\n\n## Commentaires recents\n`;
    for (const c of ticket.comments) {
      prompt += `\n**${c.author}** (${new Date(c.created).toLocaleDateString()}):\n${c.body}\n`;
    }
  }

  // Linked tickets context
  const related = ticket.links.filter((l) => l.direction === "outward");
  if (related.length > 0) {
    prompt += `\n\n## Tickets lies\n`;
    for (const l of related) {
      prompt += `- ${l.key}: ${l.summary} (${l.status})\n`;
    }
  }

  // Inject plan file if configured
  if (config.planFile) {
    const planPath = join(config.repoPath, config.planFile);
    if (existsSync(planPath)) {
      const planContent = readFileSync(planPath, "utf-8").trim();
      if (planContent) {
        prompt += `\n\n## Plan d'implementation global\n\nCe ticket fait partie du plan suivant. Utilise-le pour comprendre le contexte global et les decisions d'architecture.\n\n${planContent}`;
        log(`Plan file injected: ${config.planFile} (${planContent.length} chars)`);
      }
    }
  }

  prompt += `

## Instructions CRITIQUES

Tu es en mode NON-INTERACTIF. Tu ne peux PAS poser de questions. Tu DOIS agir directement.

### Etape 0 — Charger le contexte depuis la memoire (OBLIGATOIRE, AVANT TOUT)

AVANT de lire des fichiers ou d'explorer le code, tu DOIS appeler le MCP graphiti-memory pour recuperer le contexte projet :

1. Appelle \`search_nodes\` avec \`query: "${config.promptContext} architecture composants"\` et \`group_id: "${config.projectKey}"\`
2. Appelle \`search_memory_facts\` avec \`query: "${ticket.summary}"\` et \`group_id: "${config.projectKey}"\`

Utilise ces resultats comme contexte principal. Lis aussi le CLAUDE.md du projet pour les conventions exactes, chemins de fichiers et regles de codage — la memoire ne stocke pas ces details. Pour le reste, ne lis que les fichiers que tu dois modifier.

### Etape 1 — Implementer

1. Lis le CLAUDE.md pour les conventions projet.
2. Implemente le ticket MAINTENANT. Ne reflechis pas a voix haute, AGIS.
3. Prends des decisions raisonnables quand le ticket est ambigu.
4. Committe tes changements avec des messages clairs : \`feat(${ticket.key}): description\`.
5. Ne fais PAS de push, ne cree PAS de PR — le script s'en charge.

### Etape 2 — Sauvegarder en memoire (OBLIGATOIRE, APRES CHAQUE COMMIT)

Apres chaque commit, appelle \`add_memory\` avec :
- \`name\`: "${ticket.key}: ${ticket.summary}"
- \`episode_body\`: un resume structure de ce que tu as fait (fichiers modifies, decisions prises, patterns utilises)
- \`group_id\`: "${config.projectKey}"
- \`source_description\`: "autodev implementation"

### Cas speciaux

6. Si tu ne peux VRAIMENT pas (erreur bloquante, choix d'architecture critique), cree un fichier \`BLOCKED.md\` a la racine du repo avec la raison et les options possibles. Ce fichier sera utilise pour commenter le ticket Jira.
7. Si le travail decrit dans le ticket est DEJA FAIT (le code existe deja, les dependances sont installees, etc.), cree un fichier \`ALREADY_DONE.md\` a la racine du repo avec une breve explication de pourquoi c'est deja fait. NE committe PAS ce fichier.`;

  return prompt;
}

// ─── Build analysis prompt for batch grouping ───────────────────────────────

export function buildBatchAnalysisPrompt(config, tickets) {
  const ticketList = tickets.map((t) => {
    let entry = `### ${t.key}: ${t.summary}\n- Type: ${t.issueType}, Priorite: ${t.priority}`;
    if (t.epicKey) entry += `\n- Epic: ${t.epicKey} — ${t.epicSummary}`;
    if (t.description) entry += `\n- Description: ${t.description.substring(0, 500)}`;
    const related = t.links.filter((l) => l.direction === "outward");
    if (related.length > 0) {
      entry += `\n- Liens: ${related.map((l) => `${l.key} (${l.status})`).join(", ")}`;
    }
    return entry;
  }).join("\n\n");

  let prompt = `Tu es un analyste technique. Analyse ces ${tickets.length} tickets et regroupe-les en lots coherents pour une implementation groupee.

## Contexte projet

${config.promptContext}`;

  // Inject plan file if configured
  if (config.planFile) {
    const planPath = join(config.repoPath, config.planFile);
    if (existsSync(planPath)) {
      const planContent = readFileSync(planPath, "utf-8").trim();
      if (planContent) {
        prompt += `\n\n## Plan d'implementation\n\n${planContent}`;
      }
    }
  }

  prompt += `

## Tickets eligibles

${ticketList}

## Instructions

Regroupe ces tickets en lots coherents. Criteres :
1. **Dependances** : tickets qui se bloquent mutuellement ou qui doivent etre faits dans un ordre precis
2. **Fichiers/modules impactes** : tickets qui touchent les memes fichiers ou le meme module
3. **Logique fonctionnelle** : tickets qui font partie de la meme feature ou du meme flux

Chaque groupe doit rester sous ~80K tokens de contexte (environ 5-8 tickets max).
Un ticket peut rester seul si aucun regroupement n'a de sens.

Retourne UNIQUEMENT un JSON valide (pas de markdown, pas de commentaire) :

[
  {
    "name": "Nom court du groupe",
    "reason": "Justification du regroupement",
    "tickets": ["KEY-1", "KEY-2"]
  }
]`;

  return prompt;
}

// ─── Build prompt for batch execution ───────────────────────────────────────

export function buildBatchPrompt(config, tickets) {
  let prompt = `Tu es un developpeur senior qui travaille sur le ${config.promptContext}.

## Lot de tickets a implementer

Tu dois implementer les ${tickets.length} tickets suivants dans l'ordre. Fais UN COMMIT PAR TICKET avec le format \`feat(KEY): description\`.

`;

  for (const ticket of tickets) {
    prompt += `### ${ticket.key}: ${ticket.summary}
- Type: ${ticket.issueType}
- Priorite: ${ticket.priority}`;

    if (ticket.epicKey) {
      prompt += `\n- Epic: ${ticket.epicKey} — ${ticket.epicSummary}`;
    }

    if (ticket.description) {
      prompt += `\n\nDescription:\n${ticket.description}`;
    }

    if (ticket.comments.length > 0) {
      prompt += `\n\nCommentaires recents:`;
      for (const cm of ticket.comments) {
        prompt += `\n**${cm.author}** (${new Date(cm.created).toLocaleDateString()}): ${cm.body}`;
      }
    }

    const related = ticket.links.filter((l) => l.direction === "outward");
    if (related.length > 0) {
      prompt += `\n\nTickets lies: ${related.map((l) => `${l.key}: ${l.summary} (${l.status})`).join(", ")}`;
    }

    prompt += `\n\n---\n\n`;
  }

  // Inject plan file if configured
  if (config.planFile) {
    const planPath = join(config.repoPath, config.planFile);
    if (existsSync(planPath)) {
      const planContent = readFileSync(planPath, "utf-8").trim();
      if (planContent) {
        prompt += `## Plan d'implementation global\n\nCe lot fait partie du plan suivant.\n\n${planContent}\n\n`;
      }
    }
  }

  prompt += `## Instructions CRITIQUES

Tu es en mode NON-INTERACTIF. Tu ne peux PAS poser de questions. Tu DOIS agir directement.

### Etape 0 — Charger le contexte depuis la memoire (OBLIGATOIRE, AVANT TOUT)

AVANT de lire des fichiers ou d'explorer le code, tu DOIS appeler le MCP graphiti-memory pour recuperer le contexte projet :

1. Appelle \`search_nodes\` avec \`query: "${config.promptContext} architecture composants"\` et \`group_id: "${config.projectKey}"\`
2. Appelle \`search_memory_facts\` avec \`query: "${tickets.map((t) => t.summary).join(", ")}"\` et \`group_id: "${config.projectKey}"\`

Utilise ces resultats comme contexte principal. Lis aussi le CLAUDE.md du projet pour les conventions exactes.

### Etape 1 — Implementer chaque ticket

Pour CHAQUE ticket du lot, dans l'ordre :
1. Implemente le ticket.
2. Committe avec \`feat(TICKET_KEY): description\`.
3. Passe au ticket suivant.

Prends des decisions raisonnables quand un ticket est ambigu.
Ne fais PAS de push, ne cree PAS de PR — le script s'en charge.

### Etape 2 — Sauvegarder en memoire (OBLIGATOIRE, APRES CHAQUE COMMIT)

Apres chaque commit, appelle \`add_memory\` avec :
- \`name\`: "TICKET_KEY: summary"
- \`episode_body\`: un resume structure de ce que tu as fait
- \`group_id\`: "${config.projectKey}"
- \`source_description\`: "autodev batch implementation"

### Cas speciaux

- Si tu ne peux VRAIMENT pas implementer un ticket specifique (erreur bloquante, choix d'architecture critique), cree un fichier \`BLOCKED.md\` a la racine avec la raison et le ticket concerne. Continue avec les autres tickets.
- Si un ticket est DEJA FAIT, cree un fichier \`ALREADY_DONE.md\` avec le ticket concerne. Continue avec les autres.`;

  return prompt;
}

// ─── Execute with Claude CLI ─────────────────────────────────────────────────

export function executeWithClaude(config, prompt) {
  log("Launching Claude Code...", config);
  log("\u2500".repeat(40), config);

  return new Promise((resolve, reject) => {
    const args = [
      "--dangerously-skip-permissions",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    // Unset CLAUDECODE to avoid "nested session" detection
    const spawnEnv = { ...process.env };
    delete spawnEnv.CLAUDECODE;

    const proc = spawn("claude", args, {
      cwd: config.repoPath,
      env: spawnEnv,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600000, // 10 min max
    });

    let stdout = "";
    let stderr = "";
    let lastResult = "";

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // Parse stream-json: one JSON object per line
      for (const line of chunk.split("\n").filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                // Show Claude's reasoning (truncated)
                const preview = block.text.substring(0, 200).replace(/\n/g, " ");
                log(`  [text] ${preview}${block.text.length > 200 ? "..." : ""}`, config);
              }
              if (block.type === "tool_use") {
                log(`  [tool] ${block.name}(${JSON.stringify(block.input || {}).substring(0, 100)})`, config);
              }
            }
          }
          if (event.type === "result") {
            lastResult = JSON.stringify(event);
          }
        } catch {
          // Not valid JSON line, skip
        }
      }
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      log(`  ${"\u2500".repeat(40)}`, config);
      if (code !== 0 && !stdout) {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        return;
      }
      // For stream-json, the result is the last "result" event
      resolve({ stdout: lastResult || stdout, stderr, code });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

// ─── Evaluate result ─────────────────────────────────────────────────────────

export function evaluateResult(config, claudeOutput) {
  // Check if Claude created a BLOCKED.md (critical decision needed)
  let blockedReason = null;
  try {
    blockedReason = readFileSync(join(config.repoPath, "BLOCKED.md"), "utf-8").trim();
    // Clean up the file
    execSync(`rm -f "${join(config.repoPath, "BLOCKED.md")}"`, { timeout: 5000 });
  } catch {
    // No BLOCKED.md — normal flow
  }

  if (blockedReason) {
    log("Claude flagged ticket as BLOCKED", config);
    return {
      success: false,
      blocked: true,
      blockedReason,
      summary: blockedReason.substring(0, 500),
    };
  }

  // Check if Claude flagged the ticket as already done
  let alreadyDoneReason = null;
  try {
    alreadyDoneReason = readFileSync(join(config.repoPath, "ALREADY_DONE.md"), "utf-8").trim();
    execSync(`rm -f "${join(config.repoPath, "ALREADY_DONE.md")}"`, { timeout: 5000 });
  } catch {
    // No ALREADY_DONE.md — normal flow
  }

  if (alreadyDoneReason) {
    log("Claude flagged ticket as ALREADY DONE", config);
    return {
      success: true,
      alreadyDone: true,
      summary: alreadyDoneReason.substring(0, 500),
    };
  }

  // Check if git has new commits
  let hasNewCommits = false;
  try {
    const commitLog = git(config, "log main..HEAD --oneline");
    hasNewCommits = commitLog.length > 0;
  } catch {
    // No commits yet
  }

  // Check modified files
  let modifiedFiles = [];
  try {
    const diff = git(config, "diff --name-only main");
    modifiedFiles = diff.split("\n").filter(Boolean);
  } catch {
    // ignore
  }

  // Auto-commit if Claude modified files but forgot to commit
  if (!hasNewCommits && modifiedFiles.length > 0) {
    log(`Claude left ${modifiedFiles.length} uncommitted files — auto-committing...`, config);
    try {
      git(config, "add -A");
      git(config, `commit -m "feat(${config.ticketKey}): implement ticket"`);
      hasNewCommits = true;
    } catch (e) {
      log(`Auto-commit failed: ${e.message}`, config);
    }
  }

  const success = hasNewCommits || modifiedFiles.length > 0;

  // Extract summary from Claude output
  let summary = "";
  try {
    const result = JSON.parse(claudeOutput.stdout);
    summary = result.result || result.message || result.content || JSON.stringify(result);
  } catch {
    summary = claudeOutput.stdout || "";
  }

  return {
    success,
    hasNewCommits,
    modifiedFiles,
    summary: summary.substring(0, 500),
    raw: summary,
  };
}
