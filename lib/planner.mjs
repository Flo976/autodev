/**
 * planner.mjs — Planning agent: plan.md → sprints → tasks → Jira.
 *
 * Orchestrates steps 0-4 with human validation gates between each step.
 * State is persisted in autodev/plan-state.json for resumability.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { log, logError } from "./log.mjs";
import { executeWithClaude } from "./claude.mjs";
import { git } from "./git.mjs";
import {
  createTicket, createSprint, moveToSprint, createIssueLink,
  getBoardId, updateIssueFields, addLabel,
} from "./jira.mjs";
import { buildAnalyzePrompt, buildSprintsPrompt, buildTasksPrompt } from "./planner-prompts.mjs";

// ─── State management ───────────────────────────────────────────────────────

function statePath(config) {
  return join(config.repoPath, "autodev", "plan-state.json");
}

function loadState(config) {
  const p = statePath(config);
  if (!existsSync(p)) return { currentStep: null };
  return JSON.parse(readFileSync(p, "utf-8"));
}

function saveState(config, state) {
  const dir = join(config.repoPath, "autodev");
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(config), JSON.stringify(state, null, 2), "utf-8");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTreeOutput(config) {
  try {
    return git(config, "ls-tree -r --name-only HEAD").split("\n").slice(0, 200).join("\n");
  } catch {
    return "(unable to list files)";
  }
}

function ensureAutodevDir(config) {
  mkdirSync(join(config.repoPath, "autodev"), { recursive: true });
}

// ─── Step 0: Analyze ────────────────────────────────────────────────────────

export async function stepAnalyze(config, planFile) {
  log("[PLAN] Step 0: Analyzing plan...");
  const planContent = readFileSync(planFile, "utf-8");
  const tree = getTreeOutput(config);
  const prompt = buildAnalyzePrompt(config, planContent, tree);

  ensureAutodevDir(config);
  await executeWithClaude(config, prompt);

  const analysisPath = join(config.repoPath, "autodev", "plan-analysis.md");
  if (!existsSync(analysisPath)) {
    throw new Error("Claude did not produce autodev/plan-analysis.md");
  }

  const state = loadState(config);
  state.planFile = planFile;
  state.currentStep = "analyze";
  state.analysisPath = analysisPath;
  saveState(config, state);

  log(`[PLAN] Analysis written to: ${analysisPath}`);
  log("[PLAN] Review the analysis, answer questions in autodev/plan-answers.md, then run --step sprints");
  return analysisPath;
}

// ─── Step 1: Sprints ────────────────────────────────────────────────────────

export async function stepSprints(config, planFile) {
  log("[PLAN] Step 1: Splitting into sprints...");
  const planContent = readFileSync(planFile, "utf-8");

  // Load answers if they exist
  const answersPath = join(config.repoPath, "autodev", "plan-answers.md");
  const answers = existsSync(answersPath) ? readFileSync(answersPath, "utf-8") : null;

  const prompt = buildSprintsPrompt(config, planContent, answers);
  ensureAutodevDir(config);
  await executeWithClaude(config, prompt);

  const sprintsPath = join(config.repoPath, "autodev", "plan-sprints.md");
  if (!existsSync(sprintsPath)) {
    throw new Error("Claude did not produce autodev/plan-sprints.md");
  }

  const state = loadState(config);
  state.currentStep = "sprints";
  state.sprintsPath = sprintsPath;
  saveState(config, state);

  log(`[PLAN] Sprints written to: ${sprintsPath}`);
  log("[PLAN] Review the sprints, edit if needed, then run --step tasks");
  return sprintsPath;
}

// ─── Step 2: Tasks (parallel) ───────────────────────────────────────────────

function parseSprintSections(sprintsContent) {
  const sections = [];
  let current = null;

  for (const line of sprintsContent.split("\n")) {
    const match = line.match(/^## (Sprint \d+.*)/);
    if (match) {
      if (current) sections.push(current);
      current = { title: match[1], content: line + "\n" };
    } else if (current) {
      current.content += line + "\n";
    }
  }
  if (current) sections.push(current);
  return sections;
}

export async function stepTasks(config, planFile) {
  log("[PLAN] Step 2: Detailing tasks per sprint (parallel)...");
  const planContent = readFileSync(planFile, "utf-8");
  const sprintsPath = join(config.repoPath, "autodev", "plan-sprints.md");
  if (!existsSync(sprintsPath)) {
    throw new Error("Run --step sprints first. autodev/plan-sprints.md not found.");
  }
  const sprintsContent = readFileSync(sprintsPath, "utf-8");
  const sprints = parseSprintSections(sprintsContent);

  if (sprints.length === 0) {
    throw new Error("No sprint sections found in plan-sprints.md");
  }

  const answersPath = join(config.repoPath, "autodev", "plan-answers.md");
  const answers = existsSync(answersPath) ? readFileSync(answersPath, "utf-8") : null;

  ensureAutodevDir(config);

  // Launch Claude in parallel for each sprint
  const results = await Promise.allSettled(
    sprints.map(async (sprint, idx) => {
      const previousScopes = sprints.slice(0, idx).map((s) => s.content);
      const prompt = buildTasksPrompt(config, planContent, sprint.content, previousScopes, answers)
        + `\n\nEcris le fichier: autodev/plan-sprint-${idx + 1}-tasks.json`;
      log(`[PLAN] Launching Claude for ${sprint.title}...`);
      return executeWithClaude(config, prompt);
    })
  );

  // Check results
  const taskFiles = [];
  for (let i = 0; i < sprints.length; i++) {
    const filePath = join(config.repoPath, "autodev", `plan-sprint-${i + 1}-tasks.json`);
    if (results[i].status === "fulfilled" && existsSync(filePath)) {
      taskFiles.push(filePath);
      log(`[PLAN] ${sprints[i].title}: tasks written to ${filePath}`);
    } else {
      const reason = results[i].status === "rejected" ? results[i].reason?.message : "file not produced";
      logError(`[PLAN] ${sprints[i].title}: FAILED — ${reason}`);
    }
  }

  const state = loadState(config);
  state.currentStep = "tasks";
  state.taskFiles = taskFiles;
  state.sprintCount = sprints.length;
  saveState(config, state);

  log(`[PLAN] ${taskFiles.length}/${sprints.length} sprint task files generated`);
  log("[PLAN] Review the JSON files, then run --step validate or --import");
  return taskFiles;
}

// ─── Step 3: Validate (display summary) ─────────────────────────────────────

export function stepValidate(config) {
  log("[PLAN] Step 3: Validation summary");
  const sprintsPath = join(config.repoPath, "autodev", "plan-sprints.md");
  const sprintsContent = existsSync(sprintsPath) ? readFileSync(sprintsPath, "utf-8") : "";
  const sprints = parseSprintSections(sprintsContent);

  let totalTasks = 0;
  let totalPoints = 0;

  for (let i = 0; i < sprints.length; i++) {
    const filePath = join(config.repoPath, "autodev", `plan-sprint-${i + 1}-tasks.json`);
    if (!existsSync(filePath)) {
      console.log(`\nSprint ${i + 1} — ${sprints[i].title}: NO TASK FILE`);
      continue;
    }

    const tasks = JSON.parse(readFileSync(filePath, "utf-8"));
    const sp = tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    totalTasks += tasks.length;
    totalPoints += sp;

    console.log(`\n${sprints[i].title} (${tasks.length} taches, ~${sp} SP)`);
    for (let j = 0; j < tasks.length; j++) {
      const t = tasks[j];
      const blocked = t.blockedBy?.length > 0 ? ` [blocked by: ${t.blockedBy.join(",")}]` : "";
      console.log(`  ${j + 1}. [${t.issueType}/${t.storyPoints || "?"}] ${t.summary}${blocked}`);
    }
  }

  console.log(`\nTotal: ${totalTasks} taches, ${totalPoints} SP, ${sprints.length} sprints`);
  log("[PLAN] Review above. Edit JSON files if needed, then run --import");
  return { totalTasks, totalPoints, sprintCount: sprints.length };
}

// ─── Step 4: Import to Jira ─────────────────────────────────────────────────

export async function stepImport(config, { dryRun = false } = {}) {
  log("[PLAN] Step 4: Importing to Jira...");
  const sprintsPath = join(config.repoPath, "autodev", "plan-sprints.md");
  const sprintsContent = existsSync(sprintsPath) ? readFileSync(sprintsPath, "utf-8") : "";
  const sprints = parseSprintSections(sprintsContent);

  if (sprints.length === 0) {
    throw new Error("No sprints found. Run --step sprints and --step tasks first.");
  }

  const boardId = await getBoardId(config);
  const report = { sprints: [], totalTickets: 0, totalLinks: 0 };

  for (let i = 0; i < sprints.length; i++) {
    const filePath = join(config.repoPath, "autodev", `plan-sprint-${i + 1}-tasks.json`);
    if (!existsSync(filePath)) {
      logError(`Sprint ${i + 1}: no task file, skipping`);
      continue;
    }

    const tasks = JSON.parse(readFileSync(filePath, "utf-8"));
    const sprintTitle = sprints[i].title.replace(/^Sprint \d+ — /, "").trim();
    const sprintName = `Sprint ${i + 1} — ${sprintTitle}`;

    if (dryRun) {
      log(`DRY RUN: Would create sprint "${sprintName}" with ${tasks.length} tickets`);
      report.sprints.push({ name: sprintName, taskCount: tasks.length, keys: [] });
      report.totalTickets += tasks.length;
      continue;
    }

    // Create sprint
    const jiraSprint = await createSprint(config, boardId, { name: sprintName });

    // Create tickets
    const createdKeys = [];
    for (const task of tasks) {
      const key = await createTicket(config, {
        summary: task.summary,
        description: task.description,
        issueType: task.issueType || "Task",
      });

      // Update fields (story points, labels, component)
      const fields = {};
      if (task.storyPoints) fields.story_points = task.storyPoints;
      if (Object.keys(fields).length > 0) {
        try { await updateIssueFields(config, key, fields); } catch (e) {
          logError(`Field update failed for ${key}: ${e.message}`);
        }
      }
      if (task.labels) {
        for (const label of task.labels) {
          try { await addLabel(config, key, label); } catch (e) {
            logError(`Label failed for ${key}: ${e.message}`);
          }
        }
      }

      createdKeys.push(key);
    }

    // Move to sprint
    await moveToSprint(config, jiraSprint.id, createdKeys);

    // Create dependency links
    let linkCount = 0;
    for (let j = 0; j < tasks.length; j++) {
      const blockedBy = tasks[j].blockedBy || [];
      for (const depIdx of blockedBy) {
        if (depIdx >= 0 && depIdx < createdKeys.length && depIdx !== j) {
          await createIssueLink(config, {
            inwardKey: createdKeys[j],
            outwardKey: createdKeys[depIdx],
            linkType: "Blocks",
          });
          linkCount++;
        }
      }
    }

    report.sprints.push({
      name: sprintName,
      sprintId: jiraSprint.id,
      taskCount: tasks.length,
      keys: createdKeys,
    });
    report.totalTickets += tasks.length;
    report.totalLinks += linkCount;

    log(`Sprint "${sprintName}": ${createdKeys.length} tickets (${createdKeys[0]} → ${createdKeys[createdKeys.length - 1]}), ${linkCount} links`);
  }

  // Save report
  const reportLines = [
    `# Import Report — ${config.projectKey}`,
    "",
    `> Generated ${new Date().toISOString().split("T")[0]} by autodev --plan --import`,
    "",
    `**Total:** ${report.totalTickets} tickets in ${report.sprints.length} sprints, ${report.totalLinks} dependency links`,
    "",
  ];
  for (const s of report.sprints) {
    const keyRange = s.keys.length > 0 ? `${s.keys[0]} → ${s.keys[s.keys.length - 1]}` : "N/A";
    reportLines.push(`- **${s.name}**: ${s.taskCount} tickets (${keyRange})`);
  }

  const reportPath = join(config.repoPath, "autodev", "plan-import-report.md");
  writeFileSync(reportPath, reportLines.join("\n"), "utf-8");
  log(`[PLAN] Import report: ${reportPath}`);

  // Update state
  const state = loadState(config);
  state.currentStep = "imported";
  state.report = report;
  saveState(config, state);

  return report;
}
