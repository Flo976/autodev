#!/usr/bin/env node
/**
 * autodev MCP server — Exposes Jira operations as MCP tools.
 * Transport: stdio
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { setSilent } from "../lib/log.mjs";
import { loadConfig, projectKeyFromTicket } from "../lib/config.mjs";
import { fetchTicket, findNextTicket, jiraFetch, transitionTicket, commentTicket } from "../lib/jira.mjs";
import { adfToText } from "../lib/adf.mjs";

// Suppress console output — stdout is the MCP transport channel
setSilent(true);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(__dirname, "..", "projects");

function listProjectConfigs() {
  const files = readdirSync(PROJECTS_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const data = JSON.parse(readFileSync(join(PROJECTS_DIR, f), "utf-8"));
    return {
      key: data.projectKey,
      repoPath: data.repoPath,
      ghRepo: data.ghRepo,
    };
  });
}

const server = new McpServer({
  name: "autodev",
  version: "0.1.0",
});

// ─── list_projects ──────────────────────────────────────────────────────────

server.tool(
  "list_projects",
  "List all configured autodev projects",
  {},
  async () => {
    const projects = listProjectConfigs();
    return {
      content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
    };
  }
);

// ─── fetch_ticket ───────────────────────────────────────────────────────────

server.tool(
  "fetch_ticket",
  "Fetch full details of a Jira ticket (summary, description, links, comments)",
  { ticket_key: z.string().describe("Ticket key, e.g. HIVE-42") },
  async ({ ticket_key }) => {
    const projectKey = projectKeyFromTicket(ticket_key);
    const config = loadConfig(projectKey);
    const ticket = await fetchTicket(config, ticket_key);
    return {
      content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
    };
  }
);

// ─── get_next_ticket ────────────────────────────────────────────────────────

server.tool(
  "get_next_ticket",
  "Find the next unblocked ticket in a project's TODO column",
  { project: z.string().describe("Project key, e.g. HIVE") },
  async ({ project }) => {
    const config = loadConfig(project);
    const ticketKey = await findNextTicket(config);
    if (!ticketKey) {
      return {
        content: [{ type: "text", text: "No eligible ticket found." }],
      };
    }
    const ticket = await fetchTicket(config, ticketKey);
    return {
      content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
    };
  }
);

// ─── search_tickets ─────────────────────────────────────────────────────────

server.tool(
  "search_tickets",
  "Search Jira tickets using JQL. If no jql is given, returns all TODO tickets for the project.",
  {
    project: z.string().describe("Project key, e.g. HIVE"),
    jql: z.string().optional().describe("Custom JQL query. If omitted, defaults to all TODO tickets."),
    max_results: z.number().optional().default(20).describe("Max results to return (default 20)"),
  },
  async ({ project, jql, max_results }) => {
    const config = loadConfig(project);
    const query = jql || `project=${config.projectKey} AND status=${config.statuses.TODO} ORDER BY created ASC`;
    const encoded = encodeURIComponent(query);
    const data = await jiraFetch(
      config,
      `/rest/api/3/search/jql?jql=${encoded}&maxResults=${max_results}&fields=summary,status,priority,issuetype,description`
    );
    const issues = (data.issues || []).map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      priority: issue.fields.priority?.name,
      type: issue.fields.issuetype?.name,
      description: adfToText(issue.fields.description).trim().substring(0, 500),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(issues, null, 2) }],
    };
  }
);

// ─── transition_ticket ──────────────────────────────────────────────────────

server.tool(
  "transition_ticket",
  "Change a ticket's status (e.g. move to 'En cours', 'Terminé(e)')",
  {
    ticket_key: z.string().describe("Ticket key, e.g. HIVE-42"),
    status: z.string().describe("Target transition name, e.g. 'En cours', 'Terminé(e)', 'À faire'"),
  },
  async ({ ticket_key, status }) => {
    const projectKey = projectKeyFromTicket(ticket_key);
    const config = loadConfig(projectKey);
    await transitionTicket(config, ticket_key, status);
    return {
      content: [{ type: "text", text: `Ticket ${ticket_key} transitioned to "${status}".` }],
    };
  }
);

// ─── comment_ticket ─────────────────────────────────────────────────────────

server.tool(
  "comment_ticket",
  "Add a comment to a Jira ticket",
  {
    ticket_key: z.string().describe("Ticket key, e.g. HIVE-42"),
    comment: z.string().describe("Comment text to add"),
  },
  async ({ ticket_key, comment }) => {
    const projectKey = projectKeyFromTicket(ticket_key);
    const config = loadConfig(projectKey);
    await commentTicket(config, ticket_key, comment);
    return {
      content: [{ type: "text", text: `Comment added to ${ticket_key}.` }],
    };
  }
);

// ─── Start server ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
