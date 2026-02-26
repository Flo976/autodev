# Autodev

Automate Jira ticket execution via Claude Code CLI. Autodev fetches tickets from Jira, creates feature branches, delegates implementation to Claude Code, creates PRs, and closes tickets — fully automated.

## Features

- **Autonomous ticket execution** — Fetches unblocked tickets, creates branches, delegates to Claude Code, creates PRs
- **Interactive menu** — Run without arguments for a menu-driven experience
- **Batch mode** — Group related tickets, execute them together with one PR per group
- **Parallel execution** — Process multiple independent tickets in parallel via git worktrees
- **Planning agent** — Turn a plan document into sprints and Jira tickets (`--plan`)
- **Release management** — Create Jira versions, tag releases, publish changelogs (`--release`)
- **Sprint lifecycle** — Close sprints, create the next one, move carryover tickets (`--close-sprint`)
- **Verification** — Functional review of done tasks, auto-creates bug tickets (`--verify`)
- **Export** — Export done tasks to Markdown (`--export-done`)
- **Metrics** — Sprint velocity and stale ticket detection (`--velocity`, `--stale`)
- **Sprint recaps** — Auto-generates recap when all tickets in a sprint are done
- **Confluence integration** — Implementation reports and release changelogs (opt-in)
- **Multi-project support** — One config file per Jira project (`projects/{KEY}.json`)
- **Context bootstrapping** — Creates `autodev/` context files in your repo so Claude has project context

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
  },
  "release": {
    "tagPrefix": "v",
    "confluenceChangelogPageId": "789012"
  },
  "boardId": 1,
  "storyPointsField": "customfield_10016",
  "sprintBranches": {
    "enabled": false,
    "mergeStrategy": "squash"
  },
  "components": {
    "src/api/**": "Backend",
    "src/ui/**": "Frontend"
  }
}
```

**Notes:**
- `statuses` IDs vary between Jira projects. Use the Jira API to find yours: `GET /rest/api/3/issue/{key}/transitions`
- `confluence`, `release`, `boardId`, `sprintBranches`, `components`, `storyPointsField` are all optional

### 3. Initialize project context

```bash
node bin/autodev.mjs --project MYPROJECT --init
```

This creates an `autodev/` directory in your target repo with context files for Claude. **Fill them in before running autodev.**

## Usage

```bash
# Interactive mode (menu-driven)
node bin/autodev.mjs

# Execute a specific ticket
node bin/autodev.mjs HIVE-42

# Dry run (analyze without executing)
node bin/autodev.mjs --dry-run HIVE-42

# Pick next unblocked ticket
node bin/autodev.mjs --project HIVE --next

# Execute, merge PR, and close ticket
node bin/autodev.mjs HIVE-42 --auto-close

# Loop: execute, merge, close, pick next
node bin/autodev.mjs --project HIVE --next --auto-close

# Process 3 tickets in parallel via worktrees
node bin/autodev.mjs --project HIVE --next --auto-close --parallel 3

# Batch mode: group related tickets, one PR per group
node bin/autodev.mjs --project HIVE --batch
node bin/autodev.mjs --project HIVE --batch --auto-close
node bin/autodev.mjs --project HIVE --batch --dry-run
```

### Export & verification

```bash
# Export done tasks to Markdown
node bin/autodev.mjs --project HIVE --export-done
node bin/autodev.mjs --project HIVE --export-done --sprint "Sprint 3"

# Functional verification of done tasks
node bin/autodev.mjs --project HIVE --verify
node bin/autodev.mjs --project HIVE --verify --sprint "Sprint 3"
```

### Release & sprint lifecycle

```bash
# Create release (explicit or auto-detected version)
node bin/autodev.mjs --project HIVE --release "v1.0.0"
node bin/autodev.mjs --project HIVE --release --dry-run

# Close active sprint, create next, move carryover tickets
node bin/autodev.mjs --project HIVE --close-sprint
node bin/autodev.mjs --project HIVE --close-sprint --dry-run
```

### Planning agent

```bash
# Full planning flow (analyze → sprints → tasks → validate)
node bin/autodev.mjs --project HIVE --plan docs/plan.md

# Run individual steps
node bin/autodev.mjs --project HIVE --plan docs/plan.md --step analyze
node bin/autodev.mjs --project HIVE --plan docs/plan.md --step sprints
node bin/autodev.mjs --project HIVE --plan docs/plan.md --step tasks
node bin/autodev.mjs --project HIVE --plan docs/plan.md --step validate

# Import planned tasks to Jira
node bin/autodev.mjs --project HIVE --plan docs/plan.md --import
node bin/autodev.mjs --project HIVE --plan docs/plan.md --import --dry-run
```

### Metrics

```bash
# Sprint velocity (last 5 sprints)
node bin/autodev.mjs --project HIVE --velocity

# Stale tickets (in progress > 7 days)
node bin/autodev.mjs --project HIVE --stale
node bin/autodev.mjs --project HIVE --stale --days 14
```

**Project key** is deduced from the ticket prefix (`HIVE-42` → `HIVE`) or specified via `--project`.

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
bin/
  autodev.mjs              # CLI entry point (commander)
  autodev-interactive.mjs  # Interactive menu (inquirer)
  mcp-server.mjs           # MCP server (stdio)
lib/
  config.mjs               # Project config + .env loading
  log.mjs                  # Logging with ticket prefix
  jira.mjs                 # Jira REST API v3 + Agile API v1
  git.mjs                  # Git operations (branches, worktrees)
  claude.mjs               # Claude Code CLI execution + marker detection
  github.mjs               # GitHub PR operations via gh CLI
  sprint.mjs               # Sprint completion detection + recap
  sprint-lifecycle.mjs     # Sprint close/create/carryover
  context.mjs              # Project context bootstrapping
  confluence.mjs           # Confluence report generation
  release.mjs              # Release management (versions, tags, changelogs)
  planner.mjs              # Planning agent orchestrator
  planner-prompts.mjs      # Prompt templates for planning steps
  batch.mjs                # Batch mode orchestrator
  verify.mjs               # Functional verification of done tasks
  export.mjs               # Export done tasks to Markdown
  metrics.mjs              # Sprint velocity + stale ticket detection
  adf.mjs                  # Atlassian Document Format to text
projects/                  # Per-project JSON configs
templates/                 # Context file templates
```

## Adding a new project

1. Create `projects/NEWPROJECT.json` (copy from an existing config)
2. Update all fields for your project
3. Run `node bin/autodev.mjs --project NEWPROJECT --init`
4. Fill in the context files in your target repo's `autodev/` directory
5. Run `node bin/autodev.mjs --project NEWPROJECT --next --dry-run` to verify
