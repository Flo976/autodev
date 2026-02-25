/**
 * batch.mjs — Batch mode orchestrator.
 *
 * Collects eligible tickets, asks Claude to group them,
 * lets the user pick a group, then executes in a single Claude session.
 */

import { select } from "@inquirer/prompts";
import { execFileSync } from "child_process";
import { log, logError } from "./log.mjs";
import { findNextTickets, fetchTicketsBatch, transitionTicket, commentTicket, addLabel } from "./jira.mjs";
import { buildBatchAnalysisPrompt, buildBatchPrompt, executeWithClaude } from "./claude.mjs";
import { git, slugify } from "./git.mjs";
import { createPR, mergePR } from "./github.mjs";

// ─── Phase 1: Collect eligible tickets ──────────────────────────────────────

async function collectTickets(config) {
  log("Phase 1: Collecting eligible tickets...");
  const candidates = await findNextTickets(config, 50);

  if (candidates.length === 0) {
    log("No eligible tickets found.");
    return [];
  }

  log(`Found ${candidates.length} eligible tickets. Fetching details...`);
  const keys = candidates.map((c) => c.key);
  const tickets = await fetchTicketsBatch(config, keys);
  log(`Collected ${tickets.length} tickets with full details.`);
  return tickets;
}

// ─── Phase 2: Analyse and group via Claude ──────────────────────────────────

async function analyseAndGroup(config, tickets) {
  log("Phase 2: Asking Claude to propose groups...");
  const prompt = buildBatchAnalysisPrompt(config, tickets);
  log(`Analysis prompt: ${prompt.length} chars`);

  // Use Claude in JSON output mode (short task, no stream needed)
  const spawnEnv = { ...process.env };
  delete spawnEnv.CLAUDECODE;

  const result = execFileSync(
    "claude",
    ["-p", prompt, "--output-format", "json", "--max-turns", "1"],
    {
      cwd: config.repoPath,
      encoding: "utf-8",
      env: spawnEnv,
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  // Parse Claude JSON output — extract the result text
  let analysisText;
  try {
    const parsed = JSON.parse(result);
    analysisText = parsed.result || parsed.content || result;
  } catch {
    analysisText = result;
  }

  // Extract JSON array from the response (may be wrapped in markdown code blocks)
  const jsonMatch = analysisText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Claude did not return a valid JSON array. Response:\n${analysisText.substring(0, 500)}`);
  }

  const groups = JSON.parse(jsonMatch[0]);
  log(`Claude proposed ${groups.length} groups.`);
  return groups;
}

// ─── Phase 3a: Validate with user ──────────────────────────────────────────

async function validateGroups(config, groups, tickets) {
  log("\nPhase 3: Validation\n");

  // Build ticket lookup for display
  const ticketMap = new Map(tickets.map((t) => [t.key, t]));

  // Display groups
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    console.log(`  Groupe ${i + 1} — ${g.name} (${g.tickets.length} taches):`);
    for (const key of g.tickets) {
      const t = ticketMap.get(key);
      console.log(`    ${key}: ${t ? t.summary : "(unknown)"}`);
    }
    console.log(`    Raison: ${g.reason}\n`);
  }

  // Build choices
  const choices = groups.map((g, i) => ({
    name: `${i + 1}. ${g.name} (${g.tickets.length} taches)`,
    value: i,
  }));
  choices.push({ name: "Tous les groupes (sequentiellement)", value: -1 });
  choices.push({ name: "Annuler", value: -2 });

  const answer = await select({
    message: "Executer quel groupe ?",
    choices,
  });

  if (answer === -2) {
    log("Cancelled by user.");
    return [];
  }

  if (answer === -1) {
    return groups;
  }

  return [groups[answer]];
}

// ─── Phase 3b: Execute a single group ───────────────────────────────────────

async function executeGroup(config, group, tickets, { autoClose = false, dryRun = false }) {
  const ticketMap = new Map(tickets.map((t) => [t.key, t]));
  const groupTickets = group.tickets
    .map((key) => ticketMap.get(key))
    .filter(Boolean);

  if (groupTickets.length === 0) {
    logError(`Group "${group.name}" has no valid tickets.`);
    return { success: false };
  }

  log(`\nExecuting group: ${group.name} (${groupTickets.length} tickets)`);
  log(`Tickets: ${groupTickets.map((t) => t.key).join(", ")}`);

  if (dryRun) {
    const prompt = buildBatchPrompt(config, groupTickets);
    log(`DRY RUN — prompt: ${prompt.length} chars`);
    console.log("\n--- PROMPT PREVIEW ---\n");
    console.log(prompt);
    console.log("\n--- END PREVIEW ---\n");
    return { success: true, dryRun: true };
  }

  // 1. Transition all tickets to "En cours"
  for (const t of groupTickets) {
    try {
      await transitionTicket(config, t.key, config.transitions.start);
    } catch (e) {
      logError(`Failed to transition ${t.key}: ${e.message}`);
    }
  }

  // 2. Create branch
  const slug = slugify(group.name);
  const branchName = `feat/${config.projectKey}-batch-${slug}`;
  try {
    git(config, `checkout -b ${branchName}`);
    log(`Created branch: ${branchName}`);
  } catch (e) {
    // Branch may already exist from a previous attempt
    try {
      git(config, `checkout ${branchName}`);
      log(`Switched to existing branch: ${branchName}`);
    } catch {
      logError(`Failed to create branch: ${e.message}`);
      // Transition tickets back
      for (const t of groupTickets) {
        try { await transitionTicket(config, t.key, config.transitions.reopen); } catch {}
      }
      return { success: false, reason: e.message };
    }
  }

  try {
    // 3. Build prompt and execute
    const prompt = buildBatchPrompt(config, groupTickets);
    log(`Batch prompt: ${prompt.length} chars`);

    const claudeOutput = await executeWithClaude(config, prompt);
    log(`Claude finished (exit code: ${claudeOutput.code})`);

    // 4. Evaluate: check which tickets got commits
    const commitLog = getCommitLog(config);
    const ticketResults = evaluateBatchResult(config, groupTickets, commitLog);

    const succeeded = ticketResults.filter((r) => r.hasCommit);
    const failed = ticketResults.filter((r) => !r.hasCommit);

    log(`Results: ${succeeded.length} succeeded, ${failed.length} failed`);

    if (succeeded.length === 0) {
      logError("No tickets produced commits. Batch failed.");
      // Cleanup branch and transition back
      git(config, "checkout main");
      git(config, `branch -D ${branchName}`);
      for (const t of groupTickets) {
        try { await transitionTicket(config, t.key, config.transitions.reopen); } catch {}
      }
      return { success: false, reason: "No commits" };
    }

    // 5. Push + create PR
    git(config, `push --force-with-lease -u origin ${branchName}`);
    log(`Pushed to origin/${branchName}`);

    const prTitle = `batch(${config.projectKey}): ${group.name}`;
    const prBody = buildBatchPRBody(config, group, ticketResults);
    const prUrl = createPR(config, prTitle, prBody);
    log(`PR created: ${prUrl}`);

    // 6. Comment on each successful ticket
    for (const r of succeeded) {
      try {
        await commentTicket(
          config,
          r.key,
          `[AutoDev Batch] Implemente dans ${prUrl}\n\nGroupe: ${group.name}\nBranche: ${branchName}`
        );
        await addLabel(config, r.key, "autodev-processed");
      } catch (e) {
        logError(`Failed to comment ${r.key}: ${e.message}`);
      }
    }

    // 7. Comment on failed tickets and transition back
    for (const r of failed) {
      try {
        await commentTicket(
          config,
          r.key,
          `[AutoDev Batch] Pas de commit produit pour ce ticket dans le batch "${group.name}". Intervention manuelle requise.`
        );
        await transitionTicket(config, r.key, config.transitions.reopen);
      } catch (e) {
        logError(`Failed to handle failed ticket ${r.key}: ${e.message}`);
      }
    }

    // 8. Auto-close if requested
    if (autoClose && succeeded.length > 0) {
      log("Auto-closing: merging PR...");
      try {
        mergePR(config, prUrl);
        log("PR merged.");

        git(config, "checkout main");
        git(config, "pull --rebase origin main");

        for (const r of succeeded) {
          try {
            await transitionTicket(config, r.key, config.transitions.done);
          } catch (e) {
            logError(`Failed to close ${r.key}: ${e.message}`);
          }
        }
      } catch (e) {
        logError(`Merge failed: ${e.message}. PR left open.`);
      }
    }

    return { success: true, prUrl, succeeded: succeeded.length, failed: failed.length };

  } catch (error) {
    logError(`Batch execution error: ${error.message}`);
    // Cleanup: go back to main
    try { git(config, "checkout main"); } catch {}
    // Transition all tickets back
    for (const t of groupTickets) {
      try { await transitionTicket(config, t.key, config.transitions.reopen); } catch {}
    }
    return { success: false, reason: error.message };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCommitLog(config) {
  try {
    return git(config, "log main..HEAD --oneline");
  } catch {
    return "";
  }
}

function evaluateBatchResult(config, tickets, commitLog) {
  return tickets.map((t) => {
    const pattern = new RegExp(`feat\\(${t.key}\\)`, "i");
    const hasCommit = pattern.test(commitLog);
    if (hasCommit) {
      log(`  ${t.key}: commit found`, config);
    } else {
      logError(`  ${t.key}: no commit found`, config);
    }
    return { key: t.key, summary: t.summary, hasCommit };
  });
}

function buildBatchPRBody(config, group, ticketResults) {
  const lines = [
    `## Batch: ${group.name}`,
    "",
    `**Raison du regroupement:** ${group.reason}`,
    "",
    "## Tickets",
    "",
  ];

  for (const r of ticketResults) {
    const status = r.hasCommit ? "OK" : "ECHEC";
    const link = `[${r.key}](${config.jiraBase}/browse/${r.key})`;
    lines.push(`- ${status} — ${link}: ${r.summary}`);
  }

  lines.push("", "---", "Generee par autodev --batch");
  return lines.join("\n");
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function runBatch(config, { autoClose = false, dryRun = false } = {}) {
  // Phase 1: Collect
  const tickets = await collectTickets(config);
  if (tickets.length === 0) return;

  // Phase 2: Analyse
  const groups = await analyseAndGroup(config, tickets);
  if (groups.length === 0) {
    log("No groups proposed by Claude.");
    return;
  }

  // Phase 3a: Validate
  const selectedGroups = await validateGroups(config, groups, tickets);
  if (selectedGroups.length === 0) return;

  // Phase 3b: Execute selected groups sequentially
  const results = [];
  for (const group of selectedGroups) {
    const result = await executeGroup(config, group, tickets, { autoClose, dryRun });
    results.push({ group: group.name, ...result });

    // Return to main between groups
    if (!dryRun) {
      try { git(config, "checkout main"); } catch {}
      try { git(config, "pull --rebase origin main"); } catch {}
    }
  }

  // Summary
  log("\n=== Batch Summary ===");
  for (const r of results) {
    if (r.dryRun) {
      log(`  ${r.group}: dry run`);
    } else if (r.success) {
      log(`  ${r.group}: ${r.succeeded} OK, ${r.failed} failed — ${r.prUrl}`);
    } else {
      logError(`  ${r.group}: FAILED — ${r.reason}`);
    }
  }
}
