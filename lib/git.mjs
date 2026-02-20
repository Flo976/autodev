/**
 * git.mjs — Git operations.
 *
 * Functions receive `config` as first parameter and use `config.repoPath`, `config.projectKey`.
 */

import { execSync } from "child_process";
import { log, logError } from "./log.mjs";

// ─── Git command runner ──────────────────────────────────────────────────────

export function git(config, cmd) {
  const full = `git -C "${config.repoPath}" ${cmd}`;
  return execSync(full, { encoding: "utf-8", timeout: 30000 }).trim();
}

// ─── Slugify ─────────────────────────────────────────────────────────────────

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 40);
}

// ─── Create feature branch ──────────────────────────────────────────────────

export function createBranch(config, ticket) {
  const number = ticket.key.replace(`${config.projectKey}-`, "");
  const slug = slugify(ticket.summary);
  const branch = `feat/${config.projectKey}-${number}-${slug}`;

  log(`Creating branch: ${branch}`);
  git(config, "checkout main");
  git(config, "pull origin main");
  git(config, `checkout -b ${branch}`);

  return branch;
}

// ─── Cleanup branch ─────────────────────────────────────────────────────────

export function cleanupBranch(config, branch) {
  try {
    git(config, "checkout main");
    git(config, `branch -D ${branch}`);
    log(`Cleaned up branch ${branch}`);
  } catch (e) {
    logError(`Cleanup failed: ${e.message}`);
  }
}

// ─── Worktree operations ────────────────────────────────────────────────────

export function createWorktree(config, ticketKey, branchName) {
  const worktreePath = `/tmp/autodev-${ticketKey}`;
  git(config, `worktree add "${worktreePath}" -b ${branchName} main`);
  log(`Worktree created: ${worktreePath}`);
  return worktreePath;
}

export function removeWorktree(config, ticketKey) {
  const worktreePath = `/tmp/autodev-${ticketKey}`;
  try {
    git(config, `worktree remove "${worktreePath}" --force`);
    log(`Worktree removed: ${worktreePath}`);
  } catch (e) {
    logError(`Worktree cleanup failed: ${e.message}`);
  }
}
