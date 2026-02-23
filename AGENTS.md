# Repository Guidelines

## Project Structure & Module Organization
- `bin/autodev.mjs` is the CLI entry point (Commander-based) that dispatches all agent flows.
- `lib/` hosts integration modules (Jira, Git/GitHub, Claude, Confluence, config, logging, helper utilities).
- `projects/*.json` stores per-project runtime configs (e.g., `projects/HIVE.json`).
- `templates/` contains context templates copied into target repos during `--init`.
- `docs/` is home for design notes and planning artifacts.

## Build, Test, and Development Commands
- `npm install` - install dependencies.
- `node bin/autodev.mjs --help` - inspect CLI options quickly.
- `node bin/autodev.mjs --project HIVE --init` - scaffold `autodev/` context files in a target repo.
- `node bin/autodev.mjs --dry-run HIVE-42` - simulate a ticket run safely.
- `node bin/autodev.mjs --project HIVE --next --auto-close --parallel 3` - process queued tickets in batches.

## Coding Style & Naming Conventions
- JavaScript/Node with `"type": "module"`, 2-space indentation, double quotes (see `lib/config.mjs`), and descriptive function names (e.g., `projectKeyFromTicket`).
- Filenames are lowercase with `.mjs` extensions; configs remain JSON.
- Keep agent scripts deterministic; prefer explicit async flows over implicit globals.

## Testing Guidelines
- No automated suite yet; validate via targeted `--dry-run` executions for representative tickets.
- Document manual checks alongside the ticket key you exercised.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `chore:`) matching existing history.
- PRs include: concise summary, validation steps (commands run), linked Jira issues/tickets, and screenshots/logs only when clarifying behavior.

## Security & Configuration Tips
- Copy `.env.example` to `.env`; supply `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_BASE_URL`.
- Confluence reporting is optional - omit the `confluence` block in project configs to disable it.
- Ensure `claude` CLI and `gh` CLI are authenticated before running automation.
