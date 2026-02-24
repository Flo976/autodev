/**
 * metrics.mjs — Sprint velocity, lead time, stale ticket detection.
 *
 * Functions receive `config` as first parameter.
 * Story points field: configurable via `config.storyPointsField` (default: "story_points").
 * Jira often uses custom fields like "customfield_10016" for story points.
 */

import { log } from "./log.mjs";
import { getBoardId, agileFetch, jiraFetch } from "./jira.mjs";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStoryPointsField(config) {
  return config.storyPointsField || "story_points";
}

// ─── Velocity ───────────────────────────────────────────────────────────────

export async function getVelocity(config, lastN = 5) {
  const boardId = await getBoardId(config);
  const spField = getStoryPointsField(config);
  const data = await agileFetch(
    config,
    `/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=${lastN}`
  );

  const sprints = (data.values || []).reverse(); // oldest first
  const results = [];

  for (const sprint of sprints) {
    const issues = await agileFetch(
      config,
      `/rest/agile/1.0/sprint/${sprint.id}/issue?maxResults=100&fields=status,${spField}`
    );
    const done = (issues.issues || []).filter(
      (i) => i.fields.status?.id === config.statuses.DONE
    );
    const points = done.reduce((sum, i) => sum + (i.fields[spField] || 0), 0);
    results.push({ name: sprint.name, id: sprint.id, tickets: done.length, points });
  }

  return results;
}

// ─── Average lead time ──────────────────────────────────────────────────────

export async function getAverageLeadTime(config, sprintName) {
  const jql = sprintName
    ? `project=${config.projectKey} AND status=${config.statuses.DONE} AND sprint="${sprintName}"`
    : `project=${config.projectKey} AND status=${config.statuses.DONE} AND sprint in closedSprints()`;
  const data = await jiraFetch(
    config,
    `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=200&fields=created,statuscategorychangedate`
  );

  const issues = data.issues || [];
  if (issues.length === 0) return { averageDays: 0, count: 0 };

  let totalMs = 0;
  let count = 0;
  for (const issue of issues) {
    const created = new Date(issue.fields.created);
    const resolved = new Date(issue.fields.statuscategorychangedate);
    if (!isNaN(created) && !isNaN(resolved)) {
      totalMs += resolved - created;
      count++;
    }
  }

  const averageDays = count > 0 ? Math.round((totalMs / count / 86400000) * 10) / 10 : 0;
  return { averageDays, count };
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
