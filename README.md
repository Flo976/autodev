# Autodev

Automate Jira ticket execution via Claude Code CLI. Autodev fetches tickets from Jira, creates feature branches, delegates implementation to Claude Code, creates PRs, and closes tickets — fully automated.

## Features

- **Multi-project support** — One config file per Jira project (`projects/{KEY}.json`)
- **Context bootstrapping** — Creates `autodev/` context files in your repo so Claude has project context
- **Sprint recaps** — Auto-generates sprint recap when all tickets in a sprint are done
- **Confluence reports** — Auto-creates/updates Confluence pages with implementation reports (opt-in)
- **Parallel execution** — Process multiple independent tickets in parallel via git worktrees

## Prerequisites

- Node.js 22+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command)
- [GitHub CLI](https://cli.github.com/) (`gh` command, authenticated)
- Jira Cloud access with API token

## Installation

```bash
git clone <repo-url>
cd autodev
npm install
```

## Configuration

### 1. Environment variables

Copy `.env.example` and fill in your Jira credentials:

```bash
cp .env.example .env
```

```
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-api-token
JIRA_BASE_URL=https://yoursite.atlassian.net
```

### 2. Project config

Create a config file for each Jira project in `projects/`:

```json
// projects/MYPROJECT.json
{
  "projectKey": "MYPROJECT",
  "repoPath": "/path/to/your/repo",
  "ghRepo": "owner/repo",
  "statuses": {
    "TODO": "10207",
    "IN_PROGRESS": "10208",
    "DONE": "10209"
  },
  "transitions": {
    "start": "En cours",
    "done": "Terminé(e)",
    "reopen": "À faire"
  },
  "promptContext": "your project description for Claude",
  "confluence": {
    "spaceKey": "MYSPACE",
    "parentPageId": "123456"
  }
}
```

**Notes:**
- `statuses` IDs vary between Jira projects. Use the Jira API to find yours: `GET /rest/api/3/issue/{key}/transitions`
- `confluence` is optional. Omit it to disable Confluence reports.

### 3. Initialize project context

```bash
node bin/autodev.mjs --project MYPROJECT --init
```

This creates an `autodev/` directory in your target repo with context files for Claude. **Fill them in before running autodev.**

## Usage

```bash
# Execute a specific ticket
node bin/autodev.mjs HIVE-42

# Pick next unblocked ticket
node bin/autodev.mjs --project HIVE --next

# Execute, merge PR, and close ticket
node bin/autodev.mjs --project HIVE --auto-close --next

# Process all tickets in the sprint
node bin/autodev.mjs --project HIVE --auto-close --next

# Analyze without executing (dry run)
node bin/autodev.mjs --dry-run HIVE-42

# Initialize project context files
node bin/autodev.mjs --project HIVE --init

# Process 3 tickets in parallel
node bin/autodev.mjs --project HIVE --auto-close --next --parallel 3
```

**Project key** is deduced from the ticket prefix (`HIVE-42` -> `HIVE`) or specified via `--project`.

## MCP Server

Autodev can also run as an MCP server, exposing Jira tools to Claude Code or any MCP client.

### Setup

Add to your Claude Code settings (`.claude/settings.json`):

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

### Available Tools

| Tool | Description |
|------|-------------|
| `list_projects` | List configured projects |
| `get_next_ticket` | Next unblocked ticket for a project |
| `fetch_ticket` | Full ticket details |
| `search_tickets` | JQL search |
| `transition_ticket` | Change ticket status |
| `comment_ticket` | Add a comment |

## Architecture

```
autodev/
  bin/autodev.mjs        # CLI entry point (commander)
  bin/mcp-server.mjs     # MCP server entry point (stdio)
  lib/
    config.mjs           # Project config + .env loading
    log.mjs              # Logging with ticket prefix
    jira.mjs             # Jira REST API (fetch, transitions, comments, search)
    git.mjs              # Git operations (branches, worktrees)
    claude.mjs           # Claude Code CLI execution
    github.mjs           # GitHub PR operations via gh CLI
    sprint.mjs           # Sprint completion detection + recap generation
    context.mjs          # Project context bootstrapping
    confluence.mjs       # Confluence report generation
    adf.mjs              # Atlassian Document Format to text
  projects/              # Per-project JSON configs
  templates/             # Context file templates
```

## Adding a new project

1. Create `projects/NEWPROJECT.json` (copy from `projects/HIVE.json`)
2. Update all fields for your project
3. Run `node bin/autodev.mjs --project NEWPROJECT --init`
4. Fill in the context files in your target repo's `autodev/` directory
5. Run `node bin/autodev.mjs --project NEWPROJECT --next --dry-run` to verify
