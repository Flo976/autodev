/**
 * sprint.mjs — Sprint completion detection and recap generation.
 *
 * Functions receive `config` as first parameter and use
 * `config.projectKey`, `config.statuses`, `config.repoPath`, `config.ghRepo`.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { log } from "./log.mjs";
import { jiraFetch } from "./jira.mjs";
import { git } from "./git.mjs";
import { createPR, mergePR, listMergedPRs } from "./github.mjs";

// ─── Extract sprint number ───────────────────────────────────────────────────

export function extractSprintNumber(sprintName) {
  const m = sprintName.match(/(\d+)/);
  return m ? m[1] : sprintName.replace(/\s+/g, "-");
}

// ─── Check sprint completion ─────────────────────────────────────────────────

export async function checkSprintCompletion(config, sprintName) {
  log(`[SPRINT] Checking if "${sprintName}" is complete...`);
  const jql = encodeURIComponent(
    `project=${config.projectKey} AND sprint="${sprintName}" AND status!=${config.statuses.DONE}`
  );
  const data = await jiraFetch(
    config,
    `/rest/api/3/search/jql?jql=${jql}&maxResults=0&fields=key`
  );
  const remaining = data.total || 0;
  log(`[SPRINT] ${remaining} ticket(s) remaining in "${sprintName}"`);
  return remaining === 0;
}

// ─── Generate sprint recap ───────────────────────────────────────────────────

export async function generateSprintRecap(config, sprintName) {
  const sprintNum = extractSprintNumber(sprintName);
  log(`[SPRINT] Generating recap for Sprint ${sprintNum}...`);

  // Fetch all tickets in this sprint
  const jql = encodeURIComponent(
    `project=${config.projectKey} AND sprint="${sprintName}" ORDER BY created ASC`
  );
  const data = await jiraFetch(
    config,
    `/rest/api/3/search/jql?jql=${jql}&maxResults=100&fields=summary,issuetype,parent,status`
  );

  const tickets = (data.issues || []).map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    type: issue.fields.issuetype?.name || "Task",
    epicKey: issue.fields.parent?.key || null,
    epicSummary: issue.fields.parent?.fields?.summary || null,
  }));

  // Group by epic
  const byEpic = {};
  for (const t of tickets) {
    const epicLabel = t.epicKey ? `${t.epicKey}: ${t.epicSummary}` : "Sans epic";
    if (!byEpic[epicLabel]) byEpic[epicLabel] = [];
    byEpic[epicLabel].push(t);
  }

  // Fetch merged PRs matching project key
  let prs = [];
  try {
    prs = listMergedPRs(config, new RegExp(`${config.projectKey}-\\d+`));
  } catch (e) {
    log(`[SPRINT] Warning: could not fetch PRs: ${e.message}`);
  }

  // Count commits from merged PRs
  let totalCommits = 0;
  try {
    const logOutput = git(config, "log --oneline");
    totalCommits = logOutput.split("\n").filter(Boolean).length;
  } catch {
    // ignore
  }

  // Build the markdown
  const today = new Date().toISOString().split("T")[0];
  const lines = [
    `# Sprint ${sprintNum} — ${sprintName}`,
    "",
    `**Date de completion** : ${today}`,
    `**Tickets** : ${tickets.length} termines sur ${tickets.length}`,
    "",
    `## Tickets par epic`,
  ];

  for (const [epicLabel, epicTickets] of Object.entries(byEpic)) {
    lines.push("", `### ${epicLabel}`, "");
    for (const t of epicTickets) {
      const prMatch = prs.find((pr) => pr.title.includes(t.key));
      const prRef = prMatch ? ` (#${prMatch.number})` : "";
      lines.push(`- [x] ${t.key}: ${t.summary}${prRef}`);
    }
  }

  lines.push(
    "",
    "## Stats",
    `- ${tickets.length} tickets traites`,
    `- ${prs.length} PRs mergees`,
    `- ${totalCommits} commits`,
    "",
    "---",
    "Genere par hive-autodev",
  );

  return { content: lines.join("\n"), sprintNum, ticketCount: tickets.length, prCount: prs.length };
}

// ─── Create sprint recap branch, PR, and merge ──────────────────────────────

export async function createSprintBranch(config, sprintName) {
  const { content, sprintNum, ticketCount, prCount } = await generateSprintRecap(config, sprintName);

  const branch = `sprint/S${sprintNum}-recap`;
  log(`[SPRINT] Creating branch: ${branch}`);

  git(config, "checkout main");
  git(config, "pull origin main");
  git(config, `checkout -b ${branch}`);

  // Write recap file
  const dir = join(config.repoPath, "docs", "sprints");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `SPRINT-S${sprintNum}.md`);
  writeFileSync(filePath, content, "utf-8");
  log(`[SPRINT] Wrote ${filePath}`);

  // Commit, push, PR, merge
  git(config, "add docs/sprints/");
  git(config, `commit -m "docs(sprint): Sprint ${sprintNum} recap — ${ticketCount} tickets completed"`);
  git(config, `push -u origin ${branch}`);

  const prTitle = `docs(sprint): Sprint ${sprintNum} recap`;
  const prBody = `Sprint ${sprintNum} termine.\n\n- ${ticketCount} tickets\n- ${prCount} PRs mergees\n\nGenere par hive-autodev`;
  const prUrl = createPR(config, prTitle, prBody);

  mergePR(config, prUrl);

  git(config, "checkout main");
  git(config, "pull origin main");

  log(`[SPRINT] Sprint ${sprintNum} completed! Recap created.`);
  return prUrl;
}
