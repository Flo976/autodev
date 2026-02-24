/**
 * export.mjs — Export done tasks from Jira to Markdown.
 *
 * Functions receive `config` as first parameter.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { log, logError } from "./log.mjs";
import { jiraFetch, fetchTicket } from "./jira.mjs";

// ─── Fetch all done ticket keys (paginated) ─────────────────────────────────

async function fetchDoneKeys(config, { sprint } = {}) {
  const conditions = [
    `project=${config.projectKey}`,
    `status=${config.statuses.DONE}`,
    `issuetype != Epic`,
  ];
  if (sprint) {
    conditions.push(`sprint="${sprint}"`);
  }

  const jql = conditions.join(" AND ") + " ORDER BY created ASC";
  const encoded = encodeURIComponent(jql);
  const keys = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const data = await jiraFetch(
      config,
      `/rest/api/3/search/jql?jql=${encoded}&startAt=${startAt}&maxResults=${maxResults}&fields=key`
    );

    const issues = data.issues || [];
    for (const issue of issues) {
      keys.push(issue.key);
    }

    log(`Fetched ${keys.length}/${data.total} done ticket keys...`);

    if (keys.length >= data.total || issues.length === 0) break;
    startAt += issues.length;
  }

  return keys;
}

// ─── Format a single ticket as Markdown ──────────────────────────────────────

function formatTicket(ticket) {
  const lines = [];
  lines.push(`### ${ticket.key}: ${ticket.summary}`);
  lines.push(`- **Type**: ${ticket.issueType} | **Priorite**: ${ticket.priority}`);

  if (ticket.epicKey) {
    lines.push(`- **Epic**: ${ticket.epicKey} — ${ticket.epicSummary}`);
  }

  if (ticket.description) {
    const desc = ticket.description.length > 500
      ? ticket.description.substring(0, 500) + "..."
      : ticket.description;
    lines.push(`- **Description**: ${desc.replace(/\n/g, " ")}`);
  }

  if (ticket.links.length > 0) {
    const formatted = ticket.links.map((l) => `${l.type} ${l.key} (${l.status})`).join(", ");
    lines.push(`- **Dependances**: ${formatted}`);
  }

  // Extract PR info from autodev comments
  const prComment = ticket.comments.find((c) => c.body.includes("[AutoDev] PR"));
  if (prComment) {
    const prMatch = prComment.body.match(/https:\/\/github\.com\/\S+/);
    const filesMatch = prComment.body.match(/Fichiers modifies:\s*(\d+)/);
    if (prMatch) {
      const filesInfo = filesMatch ? ` (${filesMatch[1]} fichiers)` : "";
      lines.push(`- **PR**: ${prMatch[0]}${filesInfo}`);
    }
  }

  if (ticket.comments.length > 0) {
    lines.push(`- **Commentaires**:`);
    for (const c of ticket.comments) {
      const body = c.body.length > 200 ? c.body.substring(0, 200) + "..." : c.body;
      lines.push(`  - [${c.author}] ${body.replace(/\n/g, " ")}`);
    }
  }

  return lines.join("\n");
}

// ─── Export done tasks to Markdown ───────────────────────────────────────────

export async function exportDoneTasks(config, { sprint } = {}) {
  log("Exporting done tasks...");

  // 1. Fetch all done ticket keys
  const keys = await fetchDoneKeys(config, { sprint });
  if (keys.length === 0) {
    log("No done tickets found.");
    return null;
  }
  log(`Found ${keys.length} done tickets. Fetching details...`);

  // 2. Fetch full details for each ticket
  const tickets = [];
  for (const key of keys) {
    try {
      const ticket = await fetchTicket(config, key);
      tickets.push(ticket);
    } catch (e) {
      logError(`Failed to fetch ${key}: ${e.message} — skipping`);
    }
  }

  // 3. Group by sprint
  const bySprint = {};
  for (const t of tickets) {
    const sprintLabel = t.sprintName || "Sans sprint";
    if (!bySprint[sprintLabel]) bySprint[sprintLabel] = [];
    bySprint[sprintLabel].push(t);
  }

  const sprintCount = Object.keys(bySprint).length;
  const today = new Date().toISOString().split("T")[0];

  // 4. Generate Markdown
  const lines = [
    `# Taches terminees — ${config.projectKey}`,
    "",
    `> Genere le ${today} par autodev`,
    `> ${tickets.length} tickets sur ${sprintCount} sprint(s)`,
  ];

  for (const [sprintLabel, sprintTickets] of Object.entries(bySprint)) {
    lines.push("", `## ${sprintLabel}`, "");
    for (const t of sprintTickets) {
      lines.push(formatTicket(t), "");
    }
  }

  // 5. Write file
  const dir = join(config.repoPath, "autodev");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "done-tasks.md");
  writeFileSync(filePath, lines.join("\n"), "utf-8");

  log(`Wrote ${filePath} (${tickets.length} tickets)`);
  return filePath;
}
