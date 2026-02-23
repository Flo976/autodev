# Autodev Continuous Loop — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add git/PR MCP tools and a CLAUDE.md workflow template so Claude can autonomously loop through Jira tickets.

**Architecture:** 4 new MCP tools (`create_branch`, `push_branch`, `create_pr`, `merge_pr`) added to `bin/mcp-server.mjs`, reusing `lib/git.mjs` and `lib/github.mjs`. A workflow template `templates/CLAUDE.autodev.md` provides the loop instructions.

**Tech Stack:** `@modelcontextprotocol/sdk` v2, `zod` v4, Node.js ESM

---

### Task 1: Add `create_branch` tool

**Files:**
- Modify: `bin/mcp-server.mjs`

**Step 1: Add import for git module**

At the top of `bin/mcp-server.mjs`, add to the existing imports:

```javascript
import { createBranch, git } from "../lib/git.mjs";
```

**Step 2: Add the tool registration**

Add after the `comment_ticket` tool, before `// ─── Start server`:

```javascript
// ─── create_branch ──────────────────────────────────────────────────────────

server.tool(
  "create_branch",
  "Create a feature branch from main for a Jira ticket. Returns the branch name.",
  { ticket_key: z.string().describe("Ticket key, e.g. HIVE-42") },
  async ({ ticket_key }) => {
    const projectKey = projectKeyFromTicket(ticket_key);
    const config = loadConfig(projectKey);
    const ticket = await fetchTicket(config, ticket_key);
    const branch = createBranch(config, ticket);
    return {
      content: [{ type: "text", text: JSON.stringify({ branch, ticket_key }, null, 2) }],
    };
  }
);
```

**Step 3: Smoke test**

Run:
```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'; sleep 0.1; echo '{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}'; sleep 0.1; echo '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}') | node /home/florent-didelot/Documents/GitHub/autodev/bin/mcp-server.mjs 2>/dev/null
```
Expected: Tool list includes `create_branch`.

**Step 4: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: add create_branch MCP tool"
```

---

### Task 2: Add `push_branch` tool

**Files:**
- Modify: `bin/mcp-server.mjs`

**Step 1: Add tool registration**

Add after `create_branch` tool:

```javascript
// ─── push_branch ────────────────────────────────────────────────────────────

server.tool(
  "push_branch",
  "Push the current branch to origin for a ticket.",
  { ticket_key: z.string().describe("Ticket key, e.g. HIVE-42") },
  async ({ ticket_key }) => {
    const projectKey = projectKeyFromTicket(ticket_key);
    const config = loadConfig(projectKey);
    const currentBranch = git(config, "rev-parse --abbrev-ref HEAD");
    git(config, `push -u origin ${currentBranch}`);
    return {
      content: [{ type: "text", text: `Pushed branch ${currentBranch} to origin.` }],
    };
  }
);
```

**Step 2: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: add push_branch MCP tool"
```

---

### Task 3: Add `create_pr` tool

**Files:**
- Modify: `bin/mcp-server.mjs`

**Step 1: Add import for github module**

At the top of `bin/mcp-server.mjs`, add:

```javascript
import { createPR, mergePR } from "../lib/github.mjs";
```

**Step 2: Add tool registration**

Add after `push_branch` tool:

```javascript
// ─── create_pr ──────────────────────────────────────────────────────────────

server.tool(
  "create_pr",
  "Create a GitHub pull request for a ticket.",
  {
    ticket_key: z.string().describe("Ticket key, e.g. HIVE-42"),
    title: z.string().describe("PR title"),
    body: z.string().describe("PR body/description (markdown)"),
  },
  async ({ ticket_key, title, body }) => {
    const projectKey = projectKeyFromTicket(ticket_key);
    const config = loadConfig(projectKey);
    const prUrl = createPR(config, title, body);
    return {
      content: [{ type: "text", text: JSON.stringify({ pr_url: prUrl, ticket_key }, null, 2) }],
    };
  }
);
```

**Step 3: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: add create_pr MCP tool"
```

---

### Task 4: Add `merge_pr` tool

**Files:**
- Modify: `bin/mcp-server.mjs`

**Step 1: Add tool registration**

Add after `create_pr` tool:

```javascript
// ─── merge_pr ───────────────────────────────────────────────────────────────

server.tool(
  "merge_pr",
  "Merge a pull request (squash) and delete the remote branch. Then update local main.",
  {
    ticket_key: z.string().describe("Ticket key, e.g. HIVE-42"),
    pr_url: z.string().describe("Pull request URL"),
  },
  async ({ ticket_key, pr_url }) => {
    const projectKey = projectKeyFromTicket(ticket_key);
    const config = loadConfig(projectKey);
    mergePR(config, pr_url);
    git(config, "checkout main");
    git(config, "pull origin main");
    return {
      content: [{ type: "text", text: `PR merged and main updated. ${pr_url}` }],
    };
  }
);
```

**Step 2: Smoke test — verify all 10 tools**

Run:
```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'; sleep 0.1; echo '{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}'; sleep 0.1; echo '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}') | node /home/florent-didelot/Documents/GitHub/autodev/bin/mcp-server.mjs 2>/dev/null
```
Expected: 10 tools listed (6 original + 4 new).

**Step 3: Commit**

```bash
git add bin/mcp-server.mjs
git commit -m "feat: add merge_pr MCP tool"
```

---

### Task 5: Create CLAUDE.autodev.md template

**Files:**
- Create: `templates/CLAUDE.autodev.md`

**Step 1: Write the template**

```markdown
# AutoDev — Continuous Ticket Execution

## MCP Server Required

This project uses the `autodev` MCP server. Ensure it's configured in your Claude Code settings.

## Workflow

When the user says **"autodev"**, **"next ticket"**, or **"lance autodev"**, execute this loop:

### Loop

1. **Get next ticket:**
   Call `get_next_ticket(project: "PROJECT_KEY")`.
   If no ticket found → report "No eligible tickets" and STOP.

2. **Start work:**
   Call `transition_ticket(ticket_key, "En cours")`.

3. **Create branch:**
   Call `create_branch(ticket_key)`.

4. **Implement the ticket:**
   - Read the ticket description carefully
   - Implement the required changes (create/modify files, write tests)
   - Commit with clear messages: `feat(TICKET-KEY): description`
   - If blocked, call `comment_ticket(ticket_key, "Blocked: reason")`, call `transition_ticket(ticket_key, "À faire")`, and skip to step 1

5. **Push:**
   Call `push_branch(ticket_key)`.

6. **Create PR:**
   Call `create_pr(ticket_key, "TICKET-KEY: summary", "body with changes description")`.

7. **Merge PR:**
   Call `merge_pr(ticket_key, pr_url)`.

8. **Close ticket:**
   Call `transition_ticket(ticket_key, "Terminé(e)")`.
   Call `comment_ticket(ticket_key, "[AutoDev] Implemented and merged. PR: <pr_url>")`.

9. **Loop:** Go back to step 1.

## Rules

- You are in NON-INTERACTIVE mode. Do not ask questions. Make reasonable decisions.
- Commit messages follow: `feat(TICKET-KEY): description`
- If a ticket is ambiguous, make the best reasonable decision and document it in a comment.
- If a ticket is truly impossible (missing dependencies, architecture decisions needed), mark it blocked and move on.
```

**Step 2: Commit**

```bash
git add templates/CLAUDE.autodev.md
git commit -m "feat: add CLAUDE.autodev.md workflow template"
```

---

### Task 6: Update `--init` to copy the CLAUDE.md template

**Files:**
- Modify: `lib/context.mjs`

**Step 1: Read current context.mjs**

Read `lib/context.mjs` to understand the current init logic.

**Step 2: Add CLAUDE.md copy to init**

In `ensureProjectContext()`, after copying existing templates, add logic to copy `templates/CLAUDE.autodev.md` to the target repo's `CLAUDE.md` (appending to it if it already exists, or creating it). The exact implementation depends on the current `context.mjs` content.

**Step 3: Verify init works**

Run: `node bin/autodev.mjs --project HIVE --init`
Expected: Template content appears in the target repo.

**Step 4: Commit**

```bash
git add lib/context.mjs
git commit -m "feat: init copies CLAUDE.autodev.md workflow template"
```

---

### Task 7: Update README and package.json

**Files:**
- Modify: `README.md`

**Step 1: Update MCP tools table in README**

Add the 4 new tools to the existing MCP Server section table:

```markdown
| `create_branch` | Create feature branch from main |
| `push_branch` | Push branch to origin |
| `create_pr` | Create a GitHub PR |
| `merge_pr` | Merge PR (squash) |
```

**Step 2: Add "Continuous Mode" section to README**

After the MCP tools table, add:

```markdown
### Continuous Mode

To run autodev in continuous mode (Claude loops through tickets autonomously):

1. Configure the MCP server in Claude Code settings
2. Run `node bin/autodev.mjs --project MYPROJECT --init` to copy the workflow template
3. Open Claude Code in your target repo
4. Say "autodev" — Claude will start processing tickets
```

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add continuous mode documentation"
```
