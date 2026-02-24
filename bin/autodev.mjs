#!/usr/bin/env node
/**
 * autodev CLI — Automate Jira ticket execution via Claude Code CLI.
 *
 * Usage:
 *   autodev HIVE-42              # Execute a specific ticket
 *   autodev --next               # Pick next unblocked ticket
 *   autodev --dry-run HIVE-42    # Analyze without executing
 *   autodev --auto-close --next  # Execute, merge PR, close ticket, loop
 */

import { program } from "commander";
import { loadConfig, projectKeyFromTicket } from "../lib/config.mjs";
import { setCurrentTicket, log, logError } from "../lib/log.mjs";
import { fetchTicket, transitionTicket, commentTicket, findNextTicket, findNextTickets, sleep, addLabel, setComponent } from "../lib/jira.mjs";
import { git, slugify, createBranch, cleanupBranch, createWorktree, removeWorktree } from "../lib/git.mjs";
import { buildPrompt, executeWithClaude, evaluateResult } from "../lib/claude.mjs";
import { createPR, mergePR } from "../lib/github.mjs";
import { checkSprintCompletion, createSprintBranch } from "../lib/sprint.mjs";
import { ensureProjectContext } from "../lib/context.mjs";
import { publishConfluenceReport } from "../lib/confluence.mjs";
import { exportDoneTasks } from "../lib/export.mjs";
import { verifyDoneTasks } from "../lib/verify.mjs";
import { performRelease } from "../lib/release.mjs";
import { closeActiveSprint } from "../lib/sprint-lifecycle.mjs";

// ─── Component detection ────────────────────────────────────────────────────

function detectComponents(config, modifiedFiles) {
  const mapping = config.components || {};
  const detected = new Set();
  for (const file of modifiedFiles) {
    for (const [pattern, component] of Object.entries(mapping)) {
      // Simple glob: "src/api/**" matches "src/api/foo/bar.js"
      const prefix = pattern.replace(/\*\*$/, "").replace(/\*$/, "");
      if (file.startsWith(prefix)) {
        detected.add(component);
      }
    }
  }
  return [...detected];
}

const MAX_NEXT_ATTEMPTS = 3;
let mergeQueue = Promise.resolve();

async function withMergeLock(fn) {
  const previous = mergeQueue;
  let release;
  mergeQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function mergeWithRetry(config, prUrl, branch, maxRetries = 2) {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    try {
      mergePR(config, prUrl);
      return;
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      logError(`Merge failed (attempt ${attempt}/${maxRetries}): ${e.message}`);
      log("Rebasing branch on origin/main and retrying merge...");
      try {
        git(config, "fetch origin main");
        git(config, `checkout ${branch}`);
        git(config, "rebase origin/main");
        git(config, "push --force-with-lease");
      } catch (rebaseErr) {
        logError(`Rebase failed: ${rebaseErr.message}`);
        try {
          git(config, "rebase --abort");
        } catch {}
        throw rebaseErr;
      }
    }
  }
}

// ─── Check dependencies (inlined) ──────────────────────────────────────────

function checkDependencies(config, ticket) {
  const blockers = ticket.links.filter(
    (l) => l.direction === "inward" && l.type === "is blocked by" && l.statusId !== config.statuses.DONE
  );

  if (blockers.length > 0) {
    log(`BLOCKED by ${blockers.length} unresolved tickets:`);
    for (const b of blockers) {
      log(`  ${b.key} "${b.summary}" (${b.status})`);
    }
    return { blocked: true, blockers };
  }

  log("No blocking dependencies");
  return { blocked: false, blockers: [] };
}

// ─── Handle success ─────────────────────────────────────────────────────────

async function handleSuccess(config, ticket, branch, evalResult, autoClose = false) {
  log("SUCCESS — Pushing and creating PR...");

  // Push branch
  git(config, `push -u origin ${branch}`);
  log(`Pushed to origin/${branch}`);

  // Create PR
  const prTitle = `${ticket.key}: ${ticket.summary}`;
  const prBody = [
    `## Ticket`,
    `[${ticket.key}](${config.jiraBase}/browse/${ticket.key}) — ${ticket.summary}`,
    "",
    `## Changements`,
    evalResult.modifiedFiles
      ? evalResult.modifiedFiles.map((f) => `- \`${f}\``).join("\n")
      : "Voir les commits.",
    "",
    `## Commits`,
  ];

  try {
    const commits = git(config, "log main..HEAD --oneline");
    prBody.push("```", commits, "```");
  } catch {
    prBody.push("Voir la branche.");
  }

  prBody.push("", "---", `Generee par autodev`);

  const prBodyStr = prBody.join("\n");
  const prUrl = createPR(config, prTitle, prBodyStr);

  // Auto-label and component detection
  try {
    await addLabel(config, ticket.key, "autodev-processed");
    const components = detectComponents(config, evalResult.modifiedFiles || []);
    for (const comp of components) {
      await setComponent(config, ticket.key, comp);
    }
  } catch (e) {
    logError(`Auto-label failed (non-blocking): ${e.message}`);
  }

  if (autoClose) {
    await withMergeLock(async () => {
      log("Auto-closing: waiting for merge slot...");
      // Merge PR (squash) and delete remote branch
      log("Auto-closing: merging PR...");
      mergeWithRetry(config, prUrl, branch, 2);

      // Update local repo
      git(config, "checkout main");
      git(config, "pull --rebase origin main");

      // Transition to done
      await transitionTicket(config, ticket.key, config.transitions.done);

      // Comment in Jira
      await commentTicket(
        config,
        ticket.key,
        `[AutoDev] PR mergee et ticket clos : ${prUrl}\n\nBranche: ${branch}\nFichiers modifies: ${(evalResult.modifiedFiles || []).length}`
      );

      // Confluence report
      const confluenceUrl = await publishConfluenceReport(config, ticket, evalResult, prUrl);
      if (confluenceUrl) {
        await commentTicket(config, ticket.key, `[AutoDev] Rapport Confluence : ${confluenceUrl}`);
      }
    });
  } else {
    // Comment in Jira (PR only, no merge)
    await commentTicket(
      config,
      ticket.key,
      `[AutoDev] PR creee : ${prUrl}\n\nBranche: ${branch}\nFichiers modifies: ${(evalResult.modifiedFiles || []).length}`
    );

    // Confluence report
    const confluenceUrl = await publishConfluenceReport(config, ticket, evalResult, prUrl);
    if (confluenceUrl) {
      await commentTicket(config, ticket.key, `[AutoDev] Rapport Confluence : ${confluenceUrl}`);
    }
  }

  return prUrl;
}

// ─── Handle failure ─────────────────────────────────────────────────────────

async function handleFailure(config, ticket, branch, reason, { blocked = false } = {}) {
  logError(`FAILED: ${reason}`);

  // Cleanup branch
  cleanupBranch(config, branch);

  // Comment in Jira
  try {
    const prefix = blocked
      ? `[AutoDev] Decisions requises — intervention humaine necessaire`
      : `[AutoDev] Echec de l'implementation automatique`;
    await commentTicket(
      config,
      ticket.key,
      `${prefix}\n\n${reason.substring(0, 1000)}`
    );
  } catch (e) {
    logError(`Failed to comment: ${e.message}`);
  }

  // Auto-label
  try {
    const label = blocked ? "autodev-blocked" : "autodev-failed";
    await addLabel(config, ticket.key, label);
  } catch (e) {
    logError(`Auto-label failed (non-blocking): ${e.message}`);
  }

  // Transition back to TODO
  try {
    await transitionTicket(config, ticket.key, config.transitions.reopen);
  } catch (e) {
    logError(`Failed to transition back: ${e.message}`);
  }
}

// ─── Process a single ticket ────────────────────────────────────────────────

async function processTicket(config, key, { dryRun = false, autoClose = false, branch: existingBranch = null } = {}) {
  setCurrentTicket(key);
  log("=".repeat(60));
  log(`Processing ticket${dryRun ? " (DRY RUN)" : ""}`);

  // 1. Fetch ticket
  const ticket = await fetchTicket(config, key);

  // 2. Check dependencies
  const deps = checkDependencies(config, ticket);
  if (deps.blocked) {
    if (dryRun) {
      log("DRY RUN: ticket is blocked, would skip");
      return { success: false, reason: "blocked" };
    }
    return { success: false, reason: "blocked", blockers: deps.blockers };
  }

  // 3. Check status
  if (ticket.statusId === config.statuses.DONE) {
    log("Ticket already done — skipping");
    return { success: false, reason: "already_done" };
  }

  if (dryRun) {
    log("DRY RUN: ticket is eligible");
    log(`Summary: ${ticket.summary}`);
    log(`Description (${ticket.description.length} chars)`);
    log(`Links: ${ticket.links.length}, Comments: ${ticket.comments.length}`);
    const prompt = buildPrompt(config, ticket);
    log(`Prompt length: ${prompt.length} chars`);
    console.log("\n--- PROMPT PREVIEW ---\n");
    console.log(prompt);
    console.log("\n--- END PREVIEW ---\n");
    return { success: true, reason: "dry_run" };
  }

  let branch = existingBranch;

  try {
    // 4. Transition to "En cours"
    await transitionTicket(config, key, config.transitions.start);

    // 5. Create branch (skip if already provided, e.g. worktree mode)
    if (!branch) {
      branch = createBranch(config, ticket);
    }

    // 6. Build prompt and execute
    const prompt = buildPrompt(config, ticket);
    log(`Prompt: ${prompt.length} chars`);

    const claudeOutput = await executeWithClaude(config, prompt);
    log(`Claude finished (exit code: ${claudeOutput.code})`);

    // 7. Evaluate
    const evalResult = evaluateResult(config, claudeOutput);

    if (evalResult.alreadyDone) {
      // 8a. Already done — close ticket without PR
      log("ALREADY DONE — closing ticket without PR...");
      cleanupBranch(config, branch);

      try {
        await addLabel(config, ticket.key, "autodev-already-done");
      } catch (e) {
        logError(`Auto-label failed (non-blocking): ${e.message}`);
      }

      if (autoClose) {
        await transitionTicket(config, key, config.transitions.done);
      }
      await commentTicket(
        config,
        key,
        `[AutoDev] Ticket deja implemente — fermeture automatique.\n\n${evalResult.summary}`
      );
      log("Done (already done)!");
      return { success: true, alreadyDone: true, sprintName: ticket.sprintName };
    } else if (evalResult.success) {
      // 8b. Success — create PR
      const prUrl = await handleSuccess(config, ticket, branch, evalResult, autoClose);
      log("Done!");
      return { success: true, prUrl, sprintName: ticket.sprintName };
    } else {
      // 9. Failure
      const reason = evalResult.blockedReason || evalResult.summary || "No changes produced by Claude";
      await handleFailure(config, ticket, branch, reason, { blocked: !!evalResult.blocked });
      return { success: false, reason };
    }
  } catch (error) {
    // Unexpected error
    logError(error.message);
    if (branch) await handleFailure(config, ticket, branch, error.message);
    return { success: false, reason: error.message };
  }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

program
  .name("autodev")
  .description("Automate Jira ticket execution via Claude Code CLI")
  .version("0.1.0")
  .argument("[ticket]", "Ticket key (e.g. HIVE-42)")
  .option("-p, --project <key>", "Project key override")
  .option("-n, --next", "Pick next unblocked ticket")
  .option("--auto-close", "Merge PR and close ticket")
  .option("--dry-run", "Analyze without executing")
  .option("--parallel <n>", "Max parallel workers (default: 1)", "1")
  .option("--init", "Bootstrap context files (Phase 2)")
  .option("--export-done", "Export done tasks to Markdown")
  .option("--sprint <name>", "Filter by sprint name (with --export-done)")
  .option("--verify", "Verify done tasks (functional code review)")
  .option("--release [version]", "Create a release (version name or --auto)")
  .option("--close-sprint", "Close active sprint, create next, move tickets")
  .option("--no-recap", "Skip recap generation (with --close-sprint)")
  .action(async (ticket, opts) => {
    try {
      await run(ticket, opts);
    } catch (err) {
      logError(err.message);
      process.exit(1);
    }
  });

program.parse();

// ─── Main run logic ─────────────────────────────────────────────────────────

async function run(ticket, opts) {
  const { project, next, autoClose, dryRun, init, exportDone, sprint, verify } = opts;
  const parallel = Math.min(parseInt(opts.parallel) || 1, 4);

  // Resolve project key
  let projectKey;
  if (project) {
    projectKey = project;
  } else if (ticket) {
    projectKey = projectKeyFromTicket(ticket);
  } else if (next) {
    // In --next mode without ticket, require --project
    if (!project) {
      console.error("Error: --next requires --project <key> when no ticket is given");
      process.exit(1);
    }
  } else if (init || exportDone || verify || opts.release || opts.closeSprint) {
    console.error("Error: --init/--export-done/--verify requires --project <key>");
    process.exit(1);
  } else {
    console.error("Error: provide a ticket key or use --next");
    process.exit(1);
  }

  const config = loadConfig(projectKey);

  // --init: bootstrap context files and exit
  if (init) {
    ensureProjectContext(config, { skipValidation: true });
    log("Context files initialized successfully.");
    process.exit(0);
  }

  // --export-done: export done tasks and exit
  if (exportDone) {
    const filePath = await exportDoneTasks(config, { sprint });
    if (filePath) {
      log(`Done tasks exported to ${filePath}`);
    }
    process.exit(0);
  }

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

  // --release: create a release
  if (opts.release) {
    const isAuto = opts.release === true;
    const result = await performRelease(config, {
      version: isAuto ? undefined : opts.release,
      auto: isAuto,
      dryRun,
    });
    if (result) {
      log(`Release ${result.versionName}: ${result.ticketCount} tickets`);
    }
    process.exit(result ? 0 : 1);
  }

  // --close-sprint: close active sprint
  if (opts.closeSprint) {
    const result = await closeActiveSprint(config, {
      noRecap: opts.recap === false,
      dryRun,
    });
    process.exit(result ? 0 : 1);
  }

  // Ensure context is ready (validate unless dry-run)
  ensureProjectContext(config, { skipValidation: dryRun });

  if (next) {
    // ─── Next mode: loop through tickets ──────────────────────────────
    let failures = 0;
    let successes = 0;

    if (parallel > 1 && opts.next && opts.autoClose) {
      // ─── Parallel mode ──────────────────────────────────────────────
      while (true) {
        const tickets = await findNextTickets(config, parallel);
        if (tickets.length === 0) {
          log("No eligible tickets. Exiting.");
          break;
        }

        log(`Launching ${tickets.length} parallel workers...`);

        const results = await Promise.allSettled(
          tickets.map(async (key) => {
            const ticket = await fetchTicket(config, key);
            const slug = slugify(ticket.summary);
            const number = key.replace(`${config.projectKey}-`, "");
            const branchName = `feat/${config.projectKey}-${number}-${slug}`;
            const worktreePath = createWorktree(config, key, branchName);
            const worktreeConfig = { ...config, repoPath: worktreePath };

            try {
              return await processTicket(worktreeConfig, key, { dryRun: false, autoClose: true, branch: branchName });
            } finally {
              removeWorktree(config, key);
            }
          })
        );

        let batchSuccess = 0;
        let batchFail = 0;
        for (const r of results) {
          if (r.status === "fulfilled" && r.value?.success) batchSuccess++;
          else batchFail++;
        }
        successes += batchSuccess;
        failures += batchFail;

        log(`Batch: ${batchSuccess} ok, ${batchFail} failed (total: ${successes} ok, ${failures} failed)`);

        if (batchFail > 0 && batchSuccess === 0) {
          log("Entire batch failed. Exiting.");
          break;
        }

        log("Waiting 30s for Jira index + graphiti-memory processing...");
        await sleep(30000);
      }
    } else {
      // ─── Sequential mode ────────────────────────────────────────────
      const skipKeys = new Set();
      let consecutiveFailures = 0;

      while (true) {
        log(autoClose ? `Processed: ${successes} ok, ${failures} failed` : `Attempt ${failures + 1}/${MAX_NEXT_ATTEMPTS}`);
        const key = await findNextTicket(config, skipKeys);
        if (!key) {
          log("No eligible ticket found. Exiting.");
          break;
        }

        const result = await processTicket(config, key, { dryRun, autoClose });
        if (result.success) {
          successes++;
          consecutiveFailures = 0;
          if (!autoClose) break;

          // Check sprint completion after each successful ticket
          if (result.sprintName) {
            try {
              const sprintDone = await checkSprintCompletion(config, result.sprintName);
              if (sprintDone) {
                await createSprintBranch(config, result.sprintName);
              }
            } catch (e) {
              logError(`Sprint recap failed: ${e.message}`);
            }
          }

          // Wait for Jira search index + graphiti-memory processing
          log("Waiting 30s for Jira index + graphiti-memory processing...");
          await sleep(30000);
        } else {
          failures++;
          consecutiveFailures++;
          skipKeys.add(key);
          log(`Ticket ${key} failed, skipping for this session. Trying next...`);
          if (!autoClose && failures >= MAX_NEXT_ATTEMPTS) {
            log(`Max attempts (${MAX_NEXT_ATTEMPTS}) reached. Exiting.`);
            break;
          }
          if (autoClose && consecutiveFailures >= 5) {
            log("5 consecutive failures. Exiting.");
            break;
          }
        }

        if (dryRun) break;
      }
    }

    log(`Final: ${successes} succeeded, ${failures} failed`);
    process.exit(failures > 0 && successes === 0 ? 1 : 0);
  } else {
    // ─── Specific ticket mode ─────────────────────────────────────────
    if (!ticket) {
      console.error("Error: provide a ticket key (e.g. HIVE-42)");
      process.exit(1);
    }

    const result = await processTicket(config, ticket, { dryRun, autoClose });
    process.exit(result.success ? 0 : 1);
  }
}
