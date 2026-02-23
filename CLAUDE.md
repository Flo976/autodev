# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Autodev

Autodev automates Jira ticket execution via Claude Code CLI. It fetches unblocked tickets from Jira, creates feature branches, delegates implementation to Claude Code, creates PRs, and optionally merges and closes tickets — in a fully autonomous loop.

## Commands

```bash
npm install                                              # Install dependencies
node bin/autodev.mjs --help                              # Show CLI options
node bin/autodev.mjs --dry-run HIVE-42                   # Simulate ticket (no execution)
node bin/autodev.mjs HIVE-42                             # Execute specific ticket
node bin/autodev.mjs HIVE-42 --auto-close                # Execute, merge PR, close ticket
node bin/autodev.mjs --project HIVE --next               # Pick next unblocked ticket
node bin/autodev.mjs --project HIVE --next --auto-close  # Loop: execute, merge, close, repeat
node bin/autodev.mjs --project HIVE --next --auto-close --parallel 3  # Parallel via worktrees
node bin/autodev.mjs --project HIVE --init               # Bootstrap context files in target repo
```

No test suite — validate via `--dry-run` on representative tickets.

## Architecture

All modules are ES modules (`.mjs`, `"type": "module"`). Every lib function takes `config` as first parameter (loaded from `.env` + `projects/{KEY}.json`).

**Ticket processing pipeline** (`bin/autodev.mjs`):
1. Load config → ensure project context files exist
2. Fetch ticket from Jira API v3 (description is ADF, converted via `lib/adf.mjs`)
3. Check dependency links — skip if any "is blocked by" link points to a non-DONE ticket
4. Transition ticket to "En cours"
5. Create branch `feat/{KEY}-{N}-{slug}`
6. Build prompt with ticket context + critical non-interactive instructions
7. Spawn `claude` CLI with `--dangerously-skip-permissions --output-format stream-json`
8. Evaluate result via marker files and git state:
   - `BLOCKED.md` → failure, comment in Jira, transition back to TODO
   - `ALREADY_DONE.md` → close ticket without PR
   - New commits → push, create PR, optionally merge & close
   - No changes → failure
9. On sprint completion, auto-generate recap in `docs/sprints/`

**Key modules:**
- `lib/jira.mjs` — Jira REST API v3 with 150ms throttle. Handles ADF descriptions, issue links, transitions, comments, JQL search.
- `lib/claude.mjs` — Prompt building + CLI execution. Marker file detection (`BLOCKED.md`, `ALREADY_DONE.md`). Auto-commits uncommitted changes.
- `lib/git.mjs` — Branch creation/cleanup, worktree management for parallel mode (`/tmp/autodev-{KEY}`).
- `lib/github.mjs` — PR creation/merge via `gh` CLI.
- `lib/context.mjs` — Bootstraps `autodev/` context directory in target repos from `templates/`.
- `lib/sprint.mjs` — Detects sprint completion, generates recap markdown, creates recap PR.
- `lib/confluence.mjs` — Optional: publishes implementation reports to Confluence Cloud API v2.

## Jira API specifics

- Uses REST API **v3** (not v2). Search endpoint: `/rest/api/3/search/jql?jql=...`
- Issue link direction is inverted: `inwardIssue` on a link means outward direction and vice versa
- Status IDs and transition names are project-specific — configured in `projects/{KEY}.json`
- Auth: HTTP Basic with base64-encoded `email:api_token`

## Project config format

Each project needs `projects/{KEY}.json` with: `projectKey`, `repoPath`, `ghRepo`, `statuses` (TODO/IN_PROGRESS/DONE IDs), `transitions` (start/done/reopen names), `promptContext`. Optional: `confluence` block.

## Conventions

- Node.js 22+ (native `fetch`, ES modules)
- 2-space indentation, double quotes
- Conventional Commits: `feat:`, `fix:`, `chore:`
- Autodev-generated commits: `feat({TICKET_KEY}): description`
- Dependencies kept minimal (only `commander` + `dotenv`)
- `claude` and `gh` CLIs must be authenticated before running
