# Autodev MCP Server — Design

**Date:** 2026-02-23
**Status:** Approved

## Goal

Expose autodev's Jira capabilities as an MCP server so Claude Code (or any MCP client) can call tools like `get_next_ticket`, `fetch_ticket`, `transition_ticket`, etc.

## Decisions

- **SDK:** `@modelcontextprotocol/sdk` v2 (official)
- **Transport:** stdio
- **Language:** JavaScript ESM (.mjs), consistent with the rest of the project
- **Coexistence:** The MCP server is a new entry point alongside the existing CLI

## Architecture

```
bin/mcp-server.mjs     ← new MCP entry point
bin/autodev.mjs        ← existing CLI (unchanged)
lib/
  jira.mjs             ← reused as-is
  config.mjs           ← reused as-is
  adf.mjs              ← reused as-is
  log.mjs              ← minor adaptation (suppress console output in MCP mode)
```

## Tools

| Tool | Description | Inputs |
|------|-------------|--------|
| `get_next_ticket` | Next unblocked ticket for a project | `project` (string, required) |
| `fetch_ticket` | Full ticket details | `ticket_key` (string, e.g. "HIVE-42") |
| `search_tickets` | JQL search | `project` (string), `jql` (string, optional), `max_results` (number, default 20) |
| `transition_ticket` | Change ticket status | `ticket_key` (string), `status` (string, transition name) |
| `comment_ticket` | Add a comment | `ticket_key` (string), `comment` (string) |
| `list_projects` | List configured projects | none |

## Dependencies Added

- `@modelcontextprotocol/sdk` (v2)
- `zod` (v4, peer dep of SDK)

## Configuration

In Claude Code settings (`.claude/settings.json` or project-level):

```json
{
  "mcpServers": {
    "autodev": {
      "command": "node",
      "args": ["/path/to/autodev/bin/mcp-server.mjs"]
    }
  }
}
```

Jira credentials are read from autodev's `.env` via `lib/config.mjs`.
