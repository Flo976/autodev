# Autodev MCP Server — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose autodev's Jira capabilities as an MCP server (stdio transport) with full CRUD tools.

**Architecture:** New `bin/mcp-server.mjs` entry point using `@modelcontextprotocol/sdk` v2 with stdio transport. Reuses existing `lib/jira.mjs` and `lib/config.mjs`. The `lib/log.mjs` module gets a silent mode so MCP server doesn't pollute stdout (which is the MCP transport channel).

**Tech Stack:** `@modelcontextprotocol/sdk` v2, `zod` v4, Node.js ESM

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install MCP SDK and zod**

Run: `cd /home/florent-didelot/Documents/GitHub/autodev && npm install @modelcontextprotocol/sdk zod`

**Step 2: Verify package.json has new deps**

Run: `node -e "import('@modelcontextprotocol/sdk').then(() => console.log('OK'))"`
Expected: `OK`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @modelcontextprotocol/sdk and zod dependencies"
```

---

### Task 2: Make log.mjs MCP-safe

The MCP stdio transport uses stdout for protocol messages. `lib/log.mjs` currently writes to `console.log` (stdout), which would corrupt the MCP stream. Add a silent mode that suppresses all output.

**Files:**
- Modify: `lib/log.mjs`

**Step 1: Add silent mode to log.mjs**

Replace the entire file with:

```javascript
let currentTicketKey = "";
let silent = false;

export function setCurrentTicket(key) {
  currentTicketKey = key;
}

export function getCurrentTicket() {
  return currentTicketKey;
}

export function setSilent(value) {
  silent = value;
}

export function log(msg) {
  if (silent) return;
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.log(`${prefix} ${msg}`);
}

export function logError(msg) {
  if (silent) return;
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.error(`${prefix} ERROR: ${msg}`);
}
```

**Step 2: Verify CLI still works**

Run: `node bin/autodev.mjs --help`
Expected: Help output (no regression — silent defaults to false)

**Step 3: Commit**

```bash
git add lib/log.mjs
git commit -m "feat: add silent mode to log.mjs for MCP transport compatibility"
```

---

### Task 3: Create the MCP server with `list_projects` tool

Start with the simplest tool to validate the MCP server skeleton works end-to-end.

**Files:**
- Create: `bin/mcp-server.mjs`

**Step 1: Create bin/mcp-server.mjs with list_projects tool**

```javascript
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

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Step 2: Make it executable**

Run: `chmod +x /home/florent-didelot/Documents/GitHub/autodev/bin/mcp-server.mjs`

**Step 3: Smoke test — list tools via stdio**

Run:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | node /home/florent-didelot/Documents/GitHub/autodev/bin/mcp-server.mjs 2>/dev/null | head -1
```
Expected: JSON response containing `"serverInfo":{"name":"autodev"}`

**Step 4: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: create MCP server skeleton with list_projects tool"
```

---

### Task 4: Add `fetch_ticket` tool

**Files:**
- Modify: `bin/mcp-server.mjs`

**Step 1: Add fetch_ticket tool**

Add after the `list_projects` tool registration, before the transport connection:

```javascript
import { loadConfig, projectKeyFromTicket } from "../lib/config.mjs";
import { fetchTicket } from "../lib/jira.mjs";

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
```

Note: The `loadConfig` and `projectKeyFromTicket` imports and the `fetchTicket` import should be at the top of the file alongside the other imports.

**Step 2: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: add fetch_ticket MCP tool"
```

---

### Task 5: Add `get_next_ticket` tool

**Files:**
- Modify: `bin/mcp-server.mjs`

**Step 1: Add get_next_ticket tool**

Add after fetch_ticket, before transport connection:

```javascript
import { findNextTicket } from "../lib/jira.mjs";

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
    // Fetch full details for the found ticket
    const ticket = await fetchTicket(config, ticketKey);
    return {
      content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
    };
  }
);
```

Note: `findNextTicket` should be added to the existing jira.mjs import.

**Step 2: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: add get_next_ticket MCP tool"
```

---

### Task 6: Add `search_tickets` tool

**Files:**
- Modify: `bin/mcp-server.mjs`

**Step 1: Add search_tickets tool**

This uses `jiraFetch` directly for a flexible JQL search:

```javascript
import { jiraFetch } from "../lib/jira.mjs";
import { adfToText } from "../lib/adf.mjs";

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
```

Note: `jiraFetch` should be added to the existing jira.mjs import. `adfToText` is a new import from `../lib/adf.mjs`.

**Step 2: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: add search_tickets MCP tool"
```

---

### Task 7: Add `transition_ticket` tool

**Files:**
- Modify: `bin/mcp-server.mjs`

**Step 1: Add transition_ticket tool**

```javascript
import { transitionTicket } from "../lib/jira.mjs";

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
```

Note: `transitionTicket` should be added to the existing jira.mjs import.

**Step 2: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: add transition_ticket MCP tool"
```

---

### Task 8: Add `comment_ticket` tool

**Files:**
- Modify: `bin/mcp-server.mjs`

**Step 1: Add comment_ticket tool**

```javascript
import { commentTicket } from "../lib/jira.mjs";

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
```

Note: `commentTicket` should be added to the existing jira.mjs import.

**Step 2: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: add comment_ticket MCP tool"
```

---

### Task 9: Add bin entry to package.json and update README

**Files:**
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Add mcp-server bin entry**

In `package.json`, update the `bin` field:

```json
"bin": {
  "autodev": "./bin/autodev.mjs",
  "autodev-mcp": "./bin/mcp-server.mjs"
}
```

**Step 2: Add MCP section to README.md**

Add after the "Usage" section:

```markdown
## MCP Server

Autodev can also run as an MCP server, exposing Jira tools to Claude Code or any MCP client.

### Setup

Add to your Claude Code settings (`.claude/settings.json`):

\```json
{
  "mcpServers": {
    "autodev": {
      "command": "node",
      "args": ["/path/to/autodev/bin/mcp-server.mjs"]
    }
  }
}
\```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_projects` | List configured projects |
| `get_next_ticket` | Next unblocked ticket for a project |
| `fetch_ticket` | Full ticket details |
| `search_tickets` | JQL search |
| `transition_ticket` | Change ticket status |
| `comment_ticket` | Add a comment |
```

**Step 3: Commit**

```bash
git add package.json README.md
git commit -m "docs: add MCP server documentation and bin entry"
```

---

### Task 10: End-to-end integration test

**Step 1: Test the full server manually**

Run the MCP server and send an initialize + tools/list request:

```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'; echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}') | node /home/florent-didelot/Documents/GitHub/autodev/bin/mcp-server.mjs 2>/dev/null
```

Expected: JSON response listing all 6 tools.

**Step 2: Test with Claude Code (if desired)**

Add the MCP server config to Claude Code settings and verify the tools appear with `/mcp`.

**Step 3: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "feat: autodev MCP server complete"
```
