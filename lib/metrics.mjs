/**
 * metrics.mjs — Sprint velocity, lead time, stale ticket detection.
 *
 * Functions receive `config` as first parameter.
 */

import { log } from "./log.mjs";
import { getBoardId, agileFetch, jiraFetch } from "./jira.mjs";

// ─── Velocity ───────────────────────────────────────────────────────────────

export async function getVelocity(config, lastN = 5) {
  const boardId = await getBoardId(config);
  const data = await agileFetch(
    config,
    `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=${lastN}`
  );

  const sprints = (data.values || []).reverse(); // oldest first
  const results = [];

  for (const sprint of sprints) {
    const issues = await agileFetch(
      config,
      `/rest/agile/1.0/sprint/${sprint.id}/issue?maxResults=100&fields=status,story_points`
    );
    const done = (issues.issues || []).filter(
      (i) => i.fields.status?.id === config.statuses.DONE
    );
    const points = done.reduce((sum, i) => sum + (i.fields.story_points || 0), 0);
    results.push({ name: sprint.name, id: sprint.id, tickets: done.length, points });
  }

  return results;
}

// ─── Stale tickets ──────────────────────────────────────────────────────────

export async function getStaleTickets(config, daysThreshold = 7) {
  const jql = encodeURIComponent(
    `project=${config.projectKey} AND status=${config.statuses.IN_PROGRESS} AND updated <= -${daysThreshold}d ORDER BY updated ASC`
  );
  const data = await jiraFetch(
    config,
    `/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary,status,assignee,updated`
  );
  return (data.issues || []).map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    assignee: i.fields.assignee?.displayName || "Unassigned",
    updated: i.fields.updated,
  }));
}
