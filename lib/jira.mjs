/**
 * jira.mjs — Jira REST API interactions.
 *
 * All functions that hit the Jira API receive `config` as first parameter
 * and read `config.jiraBase`, `config.jiraAuth`, `config.projectKey`, `config.statuses`.
 */

import { log, logError } from "./log.mjs";
import { adfToText } from "./adf.mjs";

// ─── Throttle state ──────────────────────────────────────────────────────────

const THROTTLE_MS = 150;
let lastReqAt = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Jira API wrapper ────────────────────────────────────────────────────────

export async function jiraFetch(config, path, options = {}) {
  const now = Date.now();
  const wait = THROTTLE_MS - (now - lastReqAt);
  if (wait > 0) await sleep(wait);
  lastReqAt = Date.now();

  const url = `${config.jiraBase}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${config.jiraAuth}`,
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

// ─── Fetch ticket with full context ──────────────────────────────────────────

export async function fetchTicket(config, key) {
  log("Fetching ticket...");
  const data = await jiraFetch(
    config,
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

// ─── Transition ticket ───────────────────────────────────────────────────────

export async function transitionTicket(config, key, targetStatusName) {
  log(`Transitioning to "${targetStatusName}"...`);
  const data = await jiraFetch(config, `/rest/api/3/issue/${key}/transitions`);

  const transition = data.transitions.find(
    (t) => t.name === targetStatusName || t.to?.name === targetStatusName
  );

  if (!transition) {
    const available = data.transitions.map((t) => `"${t.name}" (→${t.to?.name})`).join(", ");
    throw new Error(`No transition to "${targetStatusName}". Available: ${available}`);
  }

  await jiraFetch(config, `/rest/api/3/issue/${key}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transition.id } }),
  });

  log(`Transitioned to "${targetStatusName}" (id: ${transition.id})`);
}

// ─── Comment ticket ──────────────────────────────────────────────────────────

export async function commentTicket(config, key, text) {
  log(`Commenting: ${text.substring(0, 80)}...`);
  await jiraFetch(config, `/rest/api/3/issue/${key}/comment`, {
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

// ─── Find next ticket ────────────────────────────────────────────────────────

export async function findNextTicket(config, skipKeys = new Set()) {
  log("Searching for next unblocked ticket...");

  const jql = encodeURIComponent(
    `project=${config.projectKey} AND status=${config.statuses.TODO} ORDER BY created ASC`
  );
  const data = await jiraFetch(
    config,
    `/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary,status,issuelinks,issuetype,priority`
  );

  if (!data.issues || data.issues.length === 0) {
    log("No tickets in 'A faire'");
    return null;
  }

  log(`Found ${data.issues.length} candidates`);

  for (const issue of data.issues) {
    const key = issue.key;

    // Skip epics
    if (issue.fields.issuetype?.name === "Epic") continue;

    // Skip tickets that already failed in this session
    if (skipKeys.has(key)) {
      log(`  ${key}: already failed this session — skip`);
      continue;
    }

    // Check blocking links
    // outwardIssue present → current issue "is blocked by" outwardIssue
    const links = issue.fields.issuelinks || [];
    const blockers = links.filter((l) => {
      if (!l.outwardIssue) return false;
      const linkType = l.type?.inward || "";
      if (linkType !== "is blocked by") return false;
      const status = l.outwardIssue.fields?.status?.id || "";
      return status !== config.statuses.DONE;
    });

    if (blockers.length > 0) {
      const blockerKeys = blockers.map((b) => b.outwardIssue.key).join(", ");
      log(`  ${key}: blocked by ${blockerKeys} — skip`);
      continue;
    }

    log(`  ${key}: "${issue.fields.summary}" — available!`);
    return key;
  }

  log("All candidates are blocked or skipped");
  return null;
}

// ─── Find next N independent tickets ────────────────────────────────────────

export async function findNextTickets(config, maxCount = 1) {
  if (maxCount === 1) {
    const key = await findNextTicket(config);
    return key ? [key] : [];
  }

  log(`Searching for up to ${maxCount} independent tickets...`);
  const jql = encodeURIComponent(
    `project=${config.projectKey} AND status=${config.statuses.TODO} ORDER BY created ASC`
  );
  const data = await jiraFetch(config,
    `/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary,status,issuelinks,issuetype,priority,parent`
  );

  if (!data.issues || data.issues.length === 0) return [];

  const eligible = [];
  const selectedEpics = new Set();

  for (const issue of data.issues) {
    if (issue.fields.issuetype?.name === "Epic") continue;
    if (eligible.length >= maxCount) break;

    // Check blocking links (outwardIssue = "is blocked by")
    const links = issue.fields.issuelinks || [];
    const isBlocked = links.some((l) => {
      if (!l.outwardIssue) return false;
      return l.type?.inward === "is blocked by" &&
        l.outwardIssue.fields?.status?.id !== config.statuses.DONE;
    });
    if (isBlocked) continue;

    // Check no mutual blocking with already-selected tickets
    const blocksSelected = links.some((l) =>
      l.inwardIssue && eligible.some((e) => e.key === l.inwardIssue.key)
    );
    if (blocksSelected) continue;

    // Heuristic: skip same epic to reduce file conflicts
    const epicKey = issue.fields.parent?.key || null;
    if (epicKey && selectedEpics.has(epicKey)) continue;

    eligible.push({ key: issue.key, summary: issue.fields.summary });
    if (epicKey) selectedEpics.add(epicKey);
    log(`  ${issue.key}: "${issue.fields.summary}" — selected for parallel`);
  }

  return eligible.map((e) => e.key);
}
