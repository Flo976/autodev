# Autodev Continuous Loop — Design

**Date:** 2026-02-23
**Status:** Approved

## Goal

Enable Claude Code to autonomously loop through Jira tickets in a target project: get next ticket, implement, PR, merge, close, repeat — all orchestrated via MCP tools and CLAUDE.md instructions.

## Decisions

- **Orchestration:** CLAUDE.md template in the target repo — Claude follows instructions naturally
- **Git/PR ops:** Exposed as new MCP tools (not Bash commands)
- **Autonomy:** Full auto — no human confirmation between tickets
- **Approach:** Atomic MCP tools + workflow instructions in CLAUDE.md

## New MCP Tools

| Tool | Description | Inputs |
|------|-------------|--------|
| `create_branch` | Create feature branch from main for a ticket | `ticket_key` (string) |
| `push_branch` | Push current branch to origin | `ticket_key` (string) |
| `create_pr` | Create a GitHub PR | `ticket_key` (string), `title` (string), `body` (string) |
| `merge_pr` | Merge a PR (squash + delete branch) | `ticket_key` (string), `pr_url` (string) |

All tools reuse existing `lib/git.mjs` and `lib/github.mjs` functions.

## CLAUDE.md Template

A `templates/CLAUDE.autodev.md` file containing the full autodev loop workflow. Copied to the target repo during `--init` (or manually).

The template instructs Claude to:
1. Call `get_next_ticket` to find next unblocked ticket
2. Transition to "En cours"
3. Create branch
4. Implement the ticket (read, code, test, commit)
5. Push, create PR, merge
6. Transition to "Terminé(e)", comment in Jira
7. Loop back to step 1

## Integration

- The `--init` command copies the CLAUDE.md template to the target repo
- The MCP server is configured in Claude Code settings
- User starts Claude Code in the target repo and says "autodev" to trigger the loop
