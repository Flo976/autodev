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

  // Determine base branch
  const baseBranch = config.sprintBranches?.enabled && ticket.sprintName
    ? createSprintBranchIfNeeded(config, ticket.sprintName)
    : "main";

  log(`Creating branch: ${branch} (from ${baseBranch})`);
  git(config, `checkout ${baseBranch}`);
  git(config, `pull --rebase origin ${baseBranch}`);

  // Delete stale local branch from a previous run if it exists
  try {
    git(config, `rev-parse --verify ${branch}`);
    git(config, `branch -D ${branch}`);
    log(`Deleted stale local branch ${branch}`);
  } catch {
    // Branch doesn't exist — normal case
  }

  // Delete stale remote branch if it exists
  try {
    git(config, `ls-remote --exit-code origin refs/heads/${branch}`);
    git(config, `push origin --delete ${branch}`);
    log(`Deleted stale remote branch ${branch}`);
  } catch {
    // Remote branch doesn't exist — normal case
  }

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

// ─── Sprint branch operations ───────────────────────────────────────────────

export function getSprintBranch(config) {
  if (!config.sprintBranches?.enabled) return null;
  try {
    const branches = git(config, "branch --list sprint/*").trim();
    if (!branches) return null;
    // Return the first (usually only) sprint branch
    return branches.split("\n").map((b) => b.replace(/^\*?\s+/, "").trim()).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

export function createSprintBranchIfNeeded(config, sprintName) {
  if (!config.sprintBranches?.enabled) return "main";
  const num = sprintName.match(/(\d+)/)?.[1] || sprintName;
  const branch = `sprint/sprint-${num}`;

  try {
    git(config, `rev-parse --verify ${branch}`);
    log(`Sprint branch exists: ${branch}`);
  } catch {
    log(`Creating sprint branch: ${branch}`);
    git(config, "checkout main");
    git(config, "pull --rebase origin main");
    git(config, `checkout -b ${branch}`);
    git(config, `push -u origin ${branch}`);
  }

  return branch;
}
