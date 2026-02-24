/**
 * sprint-lifecycle.mjs — Sprint close, create next, move tickets.
 *
 * Functions receive `config` as first parameter.
 */

import { log, logError } from "./log.mjs";
import {
  getBoardId, getActiveSprint, createSprint, closeSprint,
  moveToSprint, getSprintIssues,
} from "./jira.mjs";
import { extractSprintNumber, createSprintBranch } from "./sprint.mjs";
import { createSprintPR } from "./github.mjs";

// ─── Detect next sprint name ────────────────────────────────────────────────

function nextSprintName(currentName) {
  const num = parseInt(extractSprintNumber(currentName), 10);
  if (isNaN(num)) return currentName + " (next)";
  // Replace the number in the name
  return currentName.replace(/\d+/, String(num + 1));
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

export async function closeActiveSprint(config, { noRecap = false, dryRun = false } = {}) {
  // 1. Get board and active sprint
  const boardId = await getBoardId(config);
  const sprint = await getActiveSprint(config, boardId);

  if (!sprint) {
    log("No active sprint found. Nothing to close.");
    return null;
  }

  log(`Active sprint: ${sprint.name} (id: ${sprint.id})`);

  // 2. List issues and separate done vs not-done
  const issues = await getSprintIssues(config, sprint.id);
  const notDone = issues.filter(
    (i) => i.fields.status?.id !== config.statuses.DONE
  );
  const done = issues.filter(
    (i) => i.fields.status?.id === config.statuses.DONE
  );

  log(`${done.length} done, ${notDone.length} not done`);

  if (dryRun) {
    log("DRY RUN — Sprint close preview:");
    log(`  Would close: ${sprint.name}`);
    log(`  Would create: ${nextSprintName(sprint.name)}`);
    if (notDone.length > 0) {
      log(`  Would move ${notDone.length} tickets:`);
      for (const i of notDone) {
        log(`    ${i.key}: ${i.fields.summary} (${i.fields.status?.name})`);
      }
    }
    return { sprint, done, notDone, dryRun: true };
  }

  // 3. Create next sprint
  const newName = nextSprintName(sprint.name);
  const newSprint = await createSprint(config, boardId, { name: newName });

  // 4. Move not-done tickets to next sprint
  if (notDone.length > 0) {
    const keys = notDone.map((i) => i.key);
    await moveToSprint(config, newSprint.id, keys);
    log(`Moved ${keys.length} tickets to ${newName}`);
  }

  // 5. Close current sprint
  await closeSprint(config, sprint.id);

  // 6. Create sprint → main PR (if sprint branches enabled)
  let sprintPrUrl = null;
  if (config.sprintBranches?.enabled) {
    try {
      const num = sprint.name.match(/(\d+)/)?.[1] || sprint.name;
      const sprintBranch = `sprint/sprint-${num}`;
      sprintPrUrl = createSprintPR(config, sprintBranch);
      log(`Sprint PR created: ${sprintPrUrl}`);
    } catch (e) {
      logError(`Sprint PR creation failed (non-blocking): ${e.message}`);
    }
  }

  // 7. Generate recap
  if (!noRecap) {
    try {
      await createSprintBranch(config, sprint.name);
    } catch (e) {
      log(`Sprint recap failed (non-blocking): ${e.message}`);
    }
  }

  log(`Sprint ${sprint.name} closed. ${newName} created with ${notDone.length} carryover tickets.`);
  return { sprint, newSprint, done, notDone, sprintPrUrl };
}
