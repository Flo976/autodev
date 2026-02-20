#!/usr/bin/env node
/**
 * hive-autodev.mjs — Automate Jira ticket execution via Claude Code CLI.
 *
 * Usage:
 *   node hive-autodev.mjs HIVE-42          # Execute a specific ticket
 *   node hive-autodev.mjs --next            # Pick next unblocked "À faire" ticket
 *   node hive-autodev.mjs --dry-run HIVE-42 # Analyze without executing
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync, execFileSync, spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "..", ".env");
const REPO_PATH = "/mnt/c/Users/Florent Didelot/Documents/GitHub/hive2";
const PROJECT_KEY = "HIVE";
const MAX_NEXT_ATTEMPTS = 3;

// Jira status IDs (team-managed)
const STATUS = {
  TODO: "10207",
  IN_PROGRESS: "10208",
  DONE: "10209",
};

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnv() {
  const content = readFileSync(ENV_PATH, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  if (!env.JIRA_EMAIL || !env.JIRA_API_TOKEN || !env.JIRA_BASE_URL) {
    throw new Error("Missing JIRA_EMAIL, JIRA_API_TOKEN, or JIRA_BASE_URL in .env");
  }
  return env;
}

const env = loadEnv();
const JIRA_BASE = env.JIRA_BASE_URL;
const JIRA_AUTH = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");

// ─── Logging ──────────────────────────────────────────────────────────────────

let currentTicketKey = "";

function log(msg) {
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.log(`${prefix} ${msg}`);
}

function logError(msg) {
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.error(`${prefix} ERROR: ${msg}`);
}

// ─── Jira API ─────────────────────────────────────────────────────────────────

const THROTTLE_MS = 150;
let lastReqAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jiraFetch(path, options = {}) {
  const now = Date.now();
  const wait = THROTTLE_MS - (now - lastReqAt);
  if (wait > 0) await sleep(wait);
  lastReqAt = Date.now();

  const url = `${JIRA_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${JIRA_AUTH}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira ${options.method || "GET"} ${path} → ${res.status}: ${body}`);
  }

  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

// ─── ADF to plain text ───────────────────────────────────────────────────────

function adfToText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return `@${node.attrs?.text || "user"}`;
  if (node.type === "inlineCard") return node.attrs?.url || "";

  let text = "";
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const childText = adfToText(child);
      if (node.type === "listItem") {
        text += `- ${childText}\n`;
      } else if (node.type === "heading") {
        text += `${"#".repeat(node.attrs?.level || 1)} ${childText}\n`;
      } else if (node.type === "codeBlock") {
        text += `\`\`\`\n${childText}\n\`\`\`\n`;
      } else if (node.type === "blockquote") {
        text += `> ${childText}\n`;
      } else {
        text += childText;
      }
    }
    if (["paragraph", "heading", "codeBlock", "blockquote", "rule"].includes(node.type)) {
      text += "\n";
    }
  }
  return text;
}

// ─── Fetch ticket with full context ──────────────────────────────────────────

async function fetchTicket(key) {
  log("Fetching ticket...");
  const data = await jiraFetch(
    `/rest/api/3/issue/${key}?fields=summary,description,priority,issuetype,status,parent,issuelinks,comment,sprint`
  );

  const f = data.fields;
  const ticket = {
    key: data.key,
    summary: f.summary,
    description: adfToText(f.description).trim(),
    priority: f.priority?.name || "Medium",
    issueType: f.issuetype?.name || "Task",
    status: f.status?.name || "Unknown",
    statusId: f.status?.id || "",
    epicKey: f.parent?.key || null,
    epicSummary: f.parent?.fields?.summary || null,
    sprintName: f.sprint?.name || null,
    links: [],
    comments: [],
  };

  // Issue links
  // Jira semantics: inwardIssue present → current issue is on the OUTWARD side (current "blocks" inwardIssue)
  //                 outwardIssue present → current issue is on the INWARD side (current "is blocked by" outwardIssue)
  if (f.issuelinks) {
    for (const link of f.issuelinks) {
      if (link.inwardIssue) {
        // Current issue "blocks" inwardIssue
        ticket.links.push({
          direction: "outward",
          type: link.type?.outward || "blocks",
          key: link.inwardIssue.key,
          summary: link.inwardIssue.fields?.summary || "",
          status: link.inwardIssue.fields?.status?.name || "",
          statusId: link.inwardIssue.fields?.status?.id || "",
        });
      }
      if (link.outwardIssue) {
        // Current issue "is blocked by" outwardIssue
        ticket.links.push({
          direction: "inward",
          type: link.type?.inward || "is blocked by",
          key: link.outwardIssue.key,
          summary: link.outwardIssue.fields?.summary || "",
          status: link.outwardIssue.fields?.status?.name || "",
          statusId: link.outwardIssue.fields?.status?.id || "",
        });
      }
    }
  }

  // Comments (last 5)
  if (f.comment?.comments) {
    ticket.comments = f.comment.comments
      .slice(-5)
      .map((c) => ({
        author: c.author?.displayName || "Unknown",
        body: adfToText(c.body).trim(),
        created: c.created,
      }));
  }

  log(`"${ticket.summary}" (${ticket.issueType}, ${ticket.priority}, ${ticket.status})`);
  if (ticket.epicKey) log(`Epic: ${ticket.epicKey} — ${ticket.epicSummary}`);
  log(`${ticket.links.length} links, ${ticket.comments.length} comments`);

  return ticket;
}

// ─── Check dependencies ─────────────────────────────────────────────────────

function checkDependencies(ticket) {
  const blockers = ticket.links.filter(
    (l) => l.direction === "inward" && l.type === "is blocked by" && l.statusId !== STATUS.DONE
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

// ─── Transition ticket ──────────────────────────────────────────────────────

async function transitionTicket(key, targetStatusName) {
  log(`Transitioning to "${targetStatusName}"...`);
  const data = await jiraFetch(`/rest/api/3/issue/${key}/transitions`);

  const transition = data.transitions.find(
    (t) => t.name === targetStatusName || t.to?.name === targetStatusName
  );

  if (!transition) {
    const available = data.transitions.map((t) => `"${t.name}" (→${t.to?.name})`).join(", ");
    throw new Error(`No transition to "${targetStatusName}". Available: ${available}`);
  }

  await jiraFetch(`/rest/api/3/issue/${key}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transition.id } }),
  });

  log(`Transitioned to "${targetStatusName}" (id: ${transition.id})`);
}

// ─── Comment ticket ─────────────────────────────────────────────────────────

async function commentTicket(key, text) {
  log(`Commenting: ${text.substring(0, 80)}...`);
  await jiraFetch(`/rest/api/3/issue/${key}/comment`, {
    method: "POST",
    body: JSON.stringify({
      body: {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text }],
          },
        ],
      },
    }),
  });
}

// ─── Git operations ─────────────────────────────────────────────────────────

function git(cmd) {
  const full = `git -C "${REPO_PATH}" ${cmd}`;
  return execSync(full, { encoding: "utf-8", timeout: 30000 }).trim();
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 40);
}

function createBranch(ticket) {
  const number = ticket.key.replace("HIVE-", "");
  const slug = slugify(ticket.summary);
  const branch = `feat/HIVE-${number}-${slug}`;

  log(`Creating branch: ${branch}`);
  git("checkout main");
  git("pull origin main");
  git(`checkout -b ${branch}`);

  return branch;
}

function cleanupBranch(branch) {
  try {
    git("checkout main");
    git(`branch -D ${branch}`);
    log(`Cleaned up branch ${branch}`);
  } catch (e) {
    logError(`Cleanup failed: ${e.message}`);
  }
}

// ─── Build prompt for Claude ────────────────────────────────────────────────

function buildPrompt(ticket) {
  let prompt = `Tu es un développeur senior qui travaille sur le projet Hive (agent IA multi-tenant SaaS).

## Ticket à implémenter

**${ticket.key}: ${ticket.summary}**
- Type: ${ticket.issueType}
- Priorité: ${ticket.priority}`;

  if (ticket.epicKey) {
    prompt += `\n- Epic: ${ticket.epicKey} — ${ticket.epicSummary}`;
  }

  if (ticket.description) {
    prompt += `\n\n## Description\n\n${ticket.description}`;
  }

  if (ticket.comments.length > 0) {
    prompt += `\n\n## Commentaires récents\n`;
    for (const c of ticket.comments) {
      prompt += `\n**${c.author}** (${new Date(c.created).toLocaleDateString()}):\n${c.body}\n`;
    }
  }

  // Linked tickets context
  const related = ticket.links.filter((l) => l.direction === "outward");
  if (related.length > 0) {
    prompt += `\n\n## Tickets liés\n`;
    for (const l of related) {
      prompt += `- ${l.key}: ${l.summary} (${l.status})\n`;
    }
  }

  prompt += `

## Instructions CRITIQUES

Tu es en mode NON-INTERACTIF. Tu ne peux PAS poser de questions. Tu DOIS agir directement.

1. Tu travailles dans le répertoire courant qui est le repo \`hive2\`. Lis le CLAUDE.md pour le contexte projet.
2. Implémente le ticket MAINTENANT en créant/modifiant les fichiers nécessaires. Ne réfléchis pas à voix haute, AGIS.
3. Prends des décisions raisonnables quand le ticket est ambigu. Ne demande pas de clarification.
4. Committe tes changements avec des messages clairs : \`feat(${ticket.key}): description\`.
5. Ne fais PAS de push, ne crée PAS de PR — le script s'en charge.
6. Si tu ne peux VRAIMENT pas (erreur bloquante, choix d'architecture critique), crée un fichier \`BLOCKED.md\` à la racine du repo avec la raison et les options possibles. Ce fichier sera utilisé pour commenter le ticket Jira.`;

  return prompt;
}

// ─── Execute with Claude CLI ────────────────────────────────────────────────

function executeWithClaude(prompt) {
  log("Launching Claude Code...");
  log("─".repeat(40));

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
      cwd: REPO_PATH,
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
                console.log(`  💬 ${preview}${block.text.length > 200 ? "..." : ""}`);
              }
              if (block.type === "tool_use") {
                console.log(`  🔧 ${block.name}(${JSON.stringify(block.input || {}).substring(0, 100)})`);
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
      console.log(`  ${"─".repeat(40)}`);
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

// ─── Evaluate result ────────────────────────────────────────────────────────

function evaluateResult(claudeOutput) {
  // Check if Claude created a BLOCKED.md (critical decision needed)
  let blockedReason = null;
  try {
    blockedReason = readFileSync(join(REPO_PATH, "BLOCKED.md"), "utf-8").trim();
    // Clean up the file
    execSync(`rm -f "${join(REPO_PATH, "BLOCKED.md")}"`, { timeout: 5000 });
  } catch {
    // No BLOCKED.md — normal flow
  }

  if (blockedReason) {
    log("Claude flagged ticket as BLOCKED");
    return {
      success: false,
      blocked: true,
      blockedReason,
      summary: blockedReason.substring(0, 500),
    };
  }

  // Check if git has new commits
  let hasNewCommits = false;
  try {
    const commitLog = git("log main..HEAD --oneline");
    hasNewCommits = commitLog.length > 0;
  } catch {
    // No commits yet
  }

  // Check modified files
  let modifiedFiles = [];
  try {
    const diff = git("diff --name-only main");
    modifiedFiles = diff.split("\n").filter(Boolean);
  } catch {
    // ignore
  }

  // Auto-commit if Claude modified files but forgot to commit
  if (!hasNewCommits && modifiedFiles.length > 0) {
    log(`Claude left ${modifiedFiles.length} uncommitted files — auto-committing...`);
    try {
      git("add -A");
      git(`commit -m "feat(${currentTicketKey}): implement ticket"`);
      hasNewCommits = true;
    } catch (e) {
      log(`Auto-commit failed: ${e.message}`);
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

// ─── Handle success ─────────────────────────────────────────────────────────

async function handleSuccess(ticket, branch, evalResult, autoClose = false) {
  log("SUCCESS — Pushing and creating PR...");

  // Push branch
  git(`push -u origin ${branch}`);
  log(`Pushed to origin/${branch}`);

  // Create PR
  const prTitle = `${ticket.key}: ${ticket.summary}`;
  const prBody = [
    `## Ticket`,
    `[${ticket.key}](${JIRA_BASE}/browse/${ticket.key}) — ${ticket.summary}`,
    "",
    `## Changements`,
    evalResult.modifiedFiles
      ? evalResult.modifiedFiles.map((f) => `- \`${f}\``).join("\n")
      : "Voir les commits.",
    "",
    `## Commits`,
  ];

  try {
    const commits = git("log main..HEAD --oneline");
    prBody.push("```", commits, "```");
  } catch {
    prBody.push("Voir la branche.");
  }

  prBody.push("", "---", `Generee par hive-autodev`);

  const prBodyStr = prBody.join("\n");
  const prUrl = execFileSync(
    "gh", ["pr", "create", "--repo", "Flo976/hive2", "--title", prTitle, "--body-file", "-"],
    { cwd: REPO_PATH, encoding: "utf-8", input: prBodyStr, timeout: 30000 }
  ).trim();

  log(`PR created: ${prUrl}`);

  if (autoClose) {
    // Merge PR (squash) and delete remote branch
    log("Auto-closing: merging PR...");
    execFileSync(
      "gh", ["pr", "merge", "--repo", "Flo976/hive2", "--squash", "--delete-branch", prUrl],
      { cwd: REPO_PATH, encoding: "utf-8", timeout: 30000 }
    );
    log("PR merged");

    // Update local repo
    git("checkout main");
    git("pull origin main");

    // Transition to "Terminé(e)"
    await transitionTicket(ticket.key, "Terminé(e)");

    // Comment in Jira
    await commentTicket(
      ticket.key,
      `[AutoDev] PR mergee et ticket clos : ${prUrl}\n\nBranche: ${branch}\nFichiers modifies: ${(evalResult.modifiedFiles || []).length}`
    );
  } else {
    // Comment in Jira (PR only, no merge)
    await commentTicket(
      ticket.key,
      `[AutoDev] PR creee : ${prUrl}\n\nBranche: ${branch}\nFichiers modifies: ${(evalResult.modifiedFiles || []).length}`
    );
  }

  return prUrl;
}

// ─── Handle failure ─────────────────────────────────────────────────────────

async function handleFailure(ticket, branch, reason, { blocked = false } = {}) {
  logError(`FAILED: ${reason}`);

  // Cleanup branch
  cleanupBranch(branch);

  // Comment in Jira
  try {
    const prefix = blocked
      ? `[AutoDev] Decisions requises — intervention humaine necessaire`
      : `[AutoDev] Echec de l'implementation automatique`;
    await commentTicket(
      ticket.key,
      `${prefix}\n\n${reason.substring(0, 1000)}`
    );
  } catch (e) {
    logError(`Failed to comment: ${e.message}`);
  }

  // Transition back to "À faire"
  try {
    await transitionTicket(ticket.key, "À faire");
  } catch (e) {
    logError(`Failed to transition back: ${e.message}`);
  }
}

// ─── Find next ticket ───────────────────────────────────────────────────────

async function findNextTicket() {
  log("Searching for next unblocked ticket...");

  const jql = encodeURIComponent(
    `project=${PROJECT_KEY} AND status=${STATUS.TODO} ORDER BY created ASC`
  );
  const data = await jiraFetch(
    `/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary,status,issuelinks,issuetype,priority`
  );

  if (!data.issues || data.issues.length === 0) {
    log("No tickets in 'À faire'");
    return null;
  }

  log(`Found ${data.issues.length} candidates`);

  for (const issue of data.issues) {
    const key = issue.key;

    // Skip epics
    if (issue.fields.issuetype?.name === "Epic") continue;

    // Check blocking links
    // outwardIssue present → current issue "is blocked by" outwardIssue
    const links = issue.fields.issuelinks || [];
    const blockers = links.filter((l) => {
      if (!l.outwardIssue) return false;
      const linkType = l.type?.inward || "";
      if (linkType !== "is blocked by") return false;
      const status = l.outwardIssue.fields?.status?.id || "";
      return status !== STATUS.DONE;
    });

    if (blockers.length > 0) {
      const blockerKeys = blockers.map((b) => b.outwardIssue.key).join(", ");
      log(`  ${key}: blocked by ${blockerKeys} — skip`);
      continue;
    }

    log(`  ${key}: "${issue.fields.summary}" — available!`);
    return key;
  }

  log("All candidates are blocked");
  return null;
}

// ─── Process a single ticket ────────────────────────────────────────────────

async function processTicket(key, { dryRun = false, autoClose = false } = {}) {
  currentTicketKey = key;
  log("=".repeat(60));
  log(`Processing ticket${dryRun ? " (DRY RUN)" : ""}`);

  // 1. Fetch ticket
  const ticket = await fetchTicket(key);

  // 2. Check dependencies
  const deps = checkDependencies(ticket);
  if (deps.blocked) {
    if (dryRun) {
      log("DRY RUN: ticket is blocked, would skip");
      return { success: false, reason: "blocked" };
    }
    return { success: false, reason: "blocked", blockers: deps.blockers };
  }

  // 3. Check status
  if (ticket.statusId === STATUS.DONE) {
    log("Ticket already done — skipping");
    return { success: false, reason: "already_done" };
  }

  if (dryRun) {
    log("DRY RUN: ticket is eligible");
    log(`Summary: ${ticket.summary}`);
    log(`Description (${ticket.description.length} chars)`);
    log(`Links: ${ticket.links.length}, Comments: ${ticket.comments.length}`);
    const prompt = buildPrompt(ticket);
    log(`Prompt length: ${prompt.length} chars`);
    console.log("\n--- PROMPT PREVIEW ---\n");
    console.log(prompt);
    console.log("\n--- END PREVIEW ---\n");
    return { success: true, reason: "dry_run" };
  }

  let branch = null;

  try {
    // 3. Transition to "En cours"
    await transitionTicket(key, "En cours");

    // 4. Create branch
    branch = createBranch(ticket);

    // 5. Build prompt and execute
    const prompt = buildPrompt(ticket);
    log(`Prompt: ${prompt.length} chars`);

    const claudeOutput = await executeWithClaude(prompt);
    log(`Claude finished (exit code: ${claudeOutput.code})`);

    // 6. Evaluate
    const evalResult = evaluateResult(claudeOutput);

    if (evalResult.success) {
      // 7. Success
      const prUrl = await handleSuccess(ticket, branch, evalResult, autoClose);
      log("Done!");
      return { success: true, prUrl, sprintName: ticket.sprintName };
    } else {
      // 8. Failure
      const reason = evalResult.blockedReason || evalResult.summary || "No changes produced by Claude";
      await handleFailure(ticket, branch, reason, { blocked: !!evalResult.blocked });
      return { success: false, reason };
    }
  } catch (error) {
    // Unexpected error
    logError(error.message);
    if (branch) await handleFailure(ticket, branch, error.message);
    return { success: false, reason: error.message };
  }
}

// ─── Sprint recap ────────────────────────────────────────────────────────────

function extractSprintNumber(sprintName) {
  const m = sprintName.match(/(\d+)/);
  return m ? m[1] : sprintName.replace(/\s+/g, "-");
}

async function checkSprintCompletion(sprintName) {
  log(`[SPRINT] Checking if "${sprintName}" is complete...`);
  const jql = encodeURIComponent(
    `project=${PROJECT_KEY} AND sprint="${sprintName}" AND status!=${STATUS.DONE}`
  );
  const data = await jiraFetch(
    `/rest/api/3/search/jql?jql=${jql}&maxResults=0&fields=key`
  );
  const remaining = data.total || 0;
  log(`[SPRINT] ${remaining} ticket(s) remaining in "${sprintName}"`);
  return remaining === 0;
}

async function generateSprintRecap(sprintName) {
  const sprintNum = extractSprintNumber(sprintName);
  log(`[SPRINT] Generating recap for Sprint ${sprintNum}...`);

  // Fetch all tickets in this sprint
  const jql = encodeURIComponent(
    `project=${PROJECT_KEY} AND sprint="${sprintName}" ORDER BY created ASC`
  );
  const data = await jiraFetch(
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

  // Fetch merged PRs matching HIVE-
  let prs = [];
  try {
    const prJson = execFileSync(
      "gh",
      ["pr", "list", "--repo", "Flo976/hive2", "--state", "merged", "--limit", "200", "--json", "number,title,mergeCommit"],
      { cwd: REPO_PATH, encoding: "utf-8", timeout: 30000 }
    );
    prs = JSON.parse(prJson).filter((pr) => pr.title.match(/HIVE-\d+/));
  } catch (e) {
    log(`[SPRINT] Warning: could not fetch PRs: ${e.message}`);
  }

  // Count commits from merged PRs
  let totalCommits = 0;
  try {
    const logOutput = git("log --oneline");
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
    `**Tickets** : ${tickets.length} terminés sur ${tickets.length}`,
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
    `- ${tickets.length} tickets traités`,
    `- ${prs.length} PRs mergées`,
    `- ${totalCommits} commits`,
    "",
    "---",
    "Généré par hive-autodev",
  );

  return { content: lines.join("\n"), sprintNum, ticketCount: tickets.length, prCount: prs.length };
}

async function createSprintBranch(sprintName) {
  const { content, sprintNum, ticketCount, prCount } = await generateSprintRecap(sprintName);

  const branch = `sprint/S${sprintNum}-recap`;
  log(`[SPRINT] Creating branch: ${branch}`);

  git("checkout main");
  git("pull origin main");
  git(`checkout -b ${branch}`);

  // Write recap file
  const dir = join(REPO_PATH, "docs", "sprints");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `SPRINT-S${sprintNum}.md`);
  writeFileSync(filePath, content, "utf-8");
  log(`[SPRINT] Wrote ${filePath}`);

  // Commit, push, PR, merge
  git("add docs/sprints/");
  git(`commit -m "docs(sprint): Sprint ${sprintNum} recap — ${ticketCount} tickets completed"`);
  git(`push -u origin ${branch}`);

  const prTitle = `docs(sprint): Sprint ${sprintNum} recap`;
  const prBody = `Sprint ${sprintNum} terminé.\n\n- ${ticketCount} tickets\n- ${prCount} PRs mergées\n\nGénéré par hive-autodev`;
  const prUrl = execFileSync(
    "gh",
    ["pr", "create", "--repo", "Flo976/hive2", "--title", prTitle, "--body", prBody],
    { cwd: REPO_PATH, encoding: "utf-8", timeout: 30000 }
  ).trim();
  log(`[SPRINT] PR created: ${prUrl}`);

  execFileSync(
    "gh",
    ["pr", "merge", "--repo", "Flo976/hive2", "--squash", "--delete-branch", prUrl],
    { cwd: REPO_PATH, encoding: "utf-8", timeout: 30000 }
  );
  log(`[SPRINT] PR merged`);

  git("checkout main");
  git("pull origin main");

  log(`[SPRINT] Sprint ${sprintNum} completed! Recap created.`);
  return prUrl;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage:");
    console.log("  node hive-autodev.mjs HIVE-42              # Execute a specific ticket");
    console.log("  node hive-autodev.mjs --next               # Pick next unblocked ticket");
    console.log("  node hive-autodev.mjs --dry-run HIVE-42    # Analyze without executing");
    console.log("  node hive-autodev.mjs --auto-close --next  # Execute, merge PR, close ticket");
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const autoClose = args.includes("--auto-close");
  const nextMode = args.includes("--next");

  if (nextMode) {
    let failures = 0;
    let successes = 0;

    // --next + --auto-close: loop through all available tickets
    // --next alone: process one ticket (retry up to MAX_NEXT_ATTEMPTS on failure)
    while (true) {
      log(autoClose ? `Processed: ${successes} ok, ${failures} failed` : `Attempt ${failures + 1}/${MAX_NEXT_ATTEMPTS}`);
      const key = await findNextTicket();
      if (!key) {
        log("No eligible ticket found. Exiting.");
        break;
      }

      const result = await processTicket(key, { dryRun, autoClose });
      if (result.success) {
        successes++;
        if (!autoClose) break;

        // Check sprint completion after each successful ticket
        if (result.sprintName) {
          try {
            const sprintDone = await checkSprintCompletion(result.sprintName);
            if (sprintDone) {
              await createSprintBranch(result.sprintName);
            }
          } catch (e) {
            logError(`Sprint recap failed: ${e.message}`);
          }
        }

        // Wait for Jira search index to update after status change
        log("Waiting 15s for Jira index refresh...");
        await sleep(15000);
      } else {
        failures++;
        log(`Ticket failed, trying next...`);
        if (!autoClose && failures >= MAX_NEXT_ATTEMPTS) {
          log(`Max attempts (${MAX_NEXT_ATTEMPTS}) reached. Exiting.`);
          break;
        }
        if (autoClose && failures >= 5) {
          log("Too many consecutive failures. Exiting.");
          break;
        }
      }

      if (dryRun) break;
    }

    log(`Final: ${successes} succeeded, ${failures} failed`);
    process.exit(failures > 0 && successes === 0 ? 1 : 0);
  } else {
    // Specific ticket mode
    const ticketKey = args.find((a) => a.startsWith("HIVE-") || (!a.startsWith("--") && a.match(/^\d+$/)));
    if (!ticketKey) {
      console.error("Please provide a ticket key (e.g., HIVE-42)");
      process.exit(1);
    }

    const key = ticketKey.startsWith("HIVE-") ? ticketKey : `HIVE-${ticketKey}`;
    const result = await processTicket(key, { dryRun, autoClose });
    process.exit(result.success ? 0 : 1);
  }
}

main().catch((err) => {
  logError(err.message);
  process.exit(1);
});
