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
  log("Fetching ticket...", config);
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

  log(`"${ticket.summary}" (${ticket.issueType}, ${ticket.priority}, ${ticket.status})`, config);
  if (ticket.epicKey) log(`Epic: ${ticket.epicKey} — ${ticket.epicSummary}`, config);
  log(`${ticket.links.length} links, ${ticket.comments.length} comments`, config);

  return ticket;
}

// ─── Transition ticket ───────────────────────────────────────────────────────

export async function transitionTicket(config, key, targetStatusName) {
  log(`Transitioning to "${targetStatusName}"...`, config);
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

  log(`Transitioned to "${targetStatusName}" (id: ${transition.id})`, config);
}

// ─── Comment ticket ──────────────────────────────────────────────────────────

export async function commentTicket(config, key, text) {
  log(`Commenting: ${text.substring(0, 80)}...`, config);
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
  log(`Creating ticket: ${summary.substring(0, 60)}...`, config);
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
  log(`Created ${key}: ${summary}`, config);
  return key;
}

// ─── Find next ticket ────────────────────────────────────────────────────────

export async function findNextTicket(config, skipKeys = new Set()) {
  log("Searching for next unblocked ticket...", config);

  const jql = encodeURIComponent(
    `project=${config.projectKey} AND status=${config.statuses.TODO} AND sprint in openSprints() AND assignee is EMPTY ORDER BY created ASC`
  );
  const data = await jiraFetch(
    config,
    `/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary,status,issuelinks,issuetype,priority`
  );

  if (!data.issues || data.issues.length === 0) {
    log("No tickets found in active sprint. Have you started the sprint in Jira?", config);
    return null;
  }

  log(`Found ${data.issues.length} candidates`, config);

  for (const issue of data.issues) {
    const key = issue.key;

    // Skip epics
    if (issue.fields.issuetype?.name === "Epic") continue;

    // Skip tickets that already failed in this session
    if (skipKeys.has(key)) {
      log(`  ${key}: already failed this session — skip`, config);
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
      log(`  ${key}: blocked by ${blockerKeys} — skip`, config);
      continue;
    }

    log(`  ${key}: "${issue.fields.summary}" — available!`, config);
    return key;
  }

  log("All candidates are blocked or skipped", config);
  return null;
}

// ─── Find next N independent tickets ────────────────────────────────────────

export async function findNextTickets(config, maxCount = 1, skipKeys = new Set(), { skipEpicDedup = false, skipBlockingCheck = false, sprint = null } = {}) {
  if (maxCount === 1) {
    const key = await findNextTicket(config, skipKeys);
    return key ? [{ key, summary: "" }] : [];
  }

  log(`Searching for up to ${maxCount} ${skipEpicDedup ? "batch" : "independent"} tickets...`, config);
  const sprintClause = sprint
    ? `sprint = "${sprint}"`
    : "sprint in openSprints()";
  const jql = encodeURIComponent(
    `project=${config.projectKey} AND status=${config.statuses.TODO} AND ${sprintClause} AND assignee is EMPTY ORDER BY created ASC`
  );
  const data = await jiraFetch(config,
    `/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary,status,issuelinks,issuetype,priority,parent`
  );

  if (!data.issues || data.issues.length === 0) return [];

  const eligible = [];
  const selectedEpics = new Set();

  for (const issue of data.issues) {
    if (issue.fields.issuetype?.name === "Epic") continue;
    if (skipKeys.has(issue.key)) continue;
    if (eligible.length >= maxCount) break;

    // Check blocking links (outwardIssue = "is blocked by")
    const links = issue.fields.issuelinks || [];
    if (!skipBlockingCheck) {
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
    }

    // Heuristic: skip same epic to reduce file conflicts (parallel mode only)
    if (!skipEpicDedup) {
      const epicKey = issue.fields.parent?.key || null;
      if (epicKey && selectedEpics.has(epicKey)) continue;
      if (epicKey) selectedEpics.add(epicKey);
    }

    eligible.push({ key: issue.key, summary: issue.fields.summary });
    log(`  ${issue.key}: "${issue.fields.summary}" — selected for parallel`, config);
  }

  return eligible;
}

// ─── Fetch multiple tickets in parallel ──────────────────────────────────────

export async function fetchTicketsBatch(config, keys, { concurrency = 5 } = {}) {
  log(`Fetching ${keys.length} tickets (${concurrency} concurrent)...`, config);
  const results = [];
  for (let i = 0; i < keys.length; i += concurrency) {
    const chunk = keys.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((key) => fetchTicket(config, key))
    );
    results.push(...chunkResults);
  }
  log(`Fetched ${results.length} tickets`, config);
  return results;
}

// ─── Agile API wrapper ──────────────────────────────────────────────────────

export async function agileFetch(config, path, options = {}) {
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
    throw new Error(`Agile ${options.method || "GET"} ${path} → ${res.status}: ${body}`);
  }

  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

// ─── Board ──────────────────────────────────────────────────────────────────

export async function getBoardId(config) {
  if (config.boardId) return config.boardId;
  // Try scrum first, then any board type
  for (const type of ["scrum", ""]) {
    const query = type
      ? `/rest/agile/1.0/board?projectKeyOrId=${config.projectKey}&type=${type}`
      : `/rest/agile/1.0/board?projectKeyOrId=${config.projectKey}`;
    const data = await agileFetch(config, query);
    if (data.values && data.values.length > 0) {
      const boardId = data.values[0].id;
      log(`Board detected: ${boardId} (${data.values[0].name}, type: ${data.values[0].type})`, config);
      return boardId;
    }
  }
  throw new Error(`No board found for project ${config.projectKey}`);
}

// ─── Sprints (Agile API) ────────────────────────────────────────────────────

export async function getActiveSprint(config, boardId) {
  const data = await agileFetch(
    config,
    `/rest/agile/1.0/board/${boardId}/sprint?state=active`
  );
  if (!data.values || data.values.length === 0) return null;
  const sprint = data.values[0];
  log(`Active sprint: ${sprint.name} (id: ${sprint.id})`, config);
  return sprint;
}

export async function createSprint(config, boardId, { name, startDate, endDate }) {
  log(`Creating sprint: ${name}...`, config);
  const body = { name, originBoardId: boardId };
  if (startDate) body.startDate = startDate;
  if (endDate) body.endDate = endDate;
  const data = await agileFetch(config, `/rest/agile/1.0/sprint`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  log(`Created sprint ${data.id}: ${data.name}`, config);
  return data;
}

export async function closeSprint(config, sprintId) {
  log(`Closing sprint ${sprintId}...`, config);
  await agileFetch(config, `/rest/agile/1.0/sprint/${sprintId}`, {
    method: "PUT",
    body: JSON.stringify({ state: "closed" }),
  });
  log(`Sprint ${sprintId} closed`, config);
}

export async function moveToSprint(config, sprintId, issueKeys) {
  if (issueKeys.length === 0) return;
  log(`Moving ${issueKeys.length} issues to sprint ${sprintId}...`, config);
  await agileFetch(config, `/rest/agile/1.0/sprint/${sprintId}/issue`, {
    method: "POST",
    body: JSON.stringify({ issues: issueKeys }),
  });
}

export async function findSprintByName(config, boardId, name) {
  const data = await agileFetch(
    config,
    `/rest/agile/1.0/board/${boardId}/sprint?state=active,future&maxResults=50`
  );
  const sprint = (data.values || []).find((s) => s.name === name);
  if (sprint) {
    log(`Found sprint "${name}" (id: ${sprint.id}, state: ${sprint.state})`, config);
  }
  return sprint || null;
}

export async function startSprint(config, sprintId) {
  log(`Starting sprint ${sprintId}...`, config);
  const now = new Date().toISOString();
  await agileFetch(config, `/rest/agile/1.0/sprint/${sprintId}`, {
    method: "PUT",
    body: JSON.stringify({ state: "active", startDate: now }),
  });
  log(`Sprint ${sprintId} started`, config);
}

export async function getSprintIssues(config, sprintId) {
  const data = await agileFetch(
    config,
    `/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=100&fields=summary,status,issuetype`
  );
  return data.issues || [];
}

// ─── Versions (Releases) ────────────────────────────────────────────────────

export async function listVersions(config) {
  const data = await jiraFetch(
    config,
    `/rest/api/3/project/${config.projectKey}/versions`
  );
  return data || [];
}

export async function createVersion(config, { name, description, startDate, releaseDate }) {
  log(`Creating version: ${name}...`, config);
  const body = {
    name,
    projectKey: config.projectKey,
    released: false,
  };
  if (description) body.description = description;
  if (startDate) body.startDate = startDate;
  if (releaseDate) body.releaseDate = releaseDate;
  const data = await jiraFetch(config, `/rest/api/3/version`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  log(`Created version ${data.id}: ${data.name}`, config);
  return data;
}

export async function releaseVersion(config, versionId, releaseDate) {
  const date = releaseDate || new Date().toISOString().split("T")[0];
  log(`Releasing version ${versionId} (${date})...`, config);
  await jiraFetch(config, `/rest/api/3/version/${versionId}`, {
    method: "PUT",
    body: JSON.stringify({ released: true, releaseDate: date }),
  });
  log(`Version ${versionId} released`, config);
}

export async function setFixVersion(config, issueKey, versionName) {
  log(`Setting fixVersion "${versionName}" on ${issueKey}...`, config);
  await jiraFetch(config, `/rest/api/3/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({
      update: {
        fixVersions: [{ add: { name: versionName } }],
      },
    }),
  });
}

// ─── Issue field updates ────────────────────────────────────────────────────

export async function updateIssueFields(config, key, fields) {
  log(`Updating fields on ${key}...`, config);
  await jiraFetch(config, `/rest/api/3/issue/${key}`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
}

export async function addLabel(config, key, label) {
  await jiraFetch(config, `/rest/api/3/issue/${key}`, {
    method: "PUT",
    body: JSON.stringify({
      update: { labels: [{ add: label }] },
    }),
  });
  log(`Added label "${label}" to ${key}`, config);
}

export async function setComponent(config, key, componentName) {
  await jiraFetch(config, `/rest/api/3/issue/${key}`, {
    method: "PUT",
    body: JSON.stringify({
      update: { components: [{ add: { name: componentName } }] },
    }),
  });
  log(`Set component "${componentName}" on ${key}`, config);
}

// ─── Issue links ────────────────────────────────────────────────────────────

export async function createIssueLink(config, { inwardKey, outwardKey, linkType = "Blocks" }) {
  log(`Linking ${outwardKey} ${linkType} ${inwardKey}...`, config);
  await jiraFetch(config, `/rest/api/3/issueLink`, {
    method: "POST",
    body: JSON.stringify({
      type: { name: linkType },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    }),
  });
}
