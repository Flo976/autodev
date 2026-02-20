/**
 * github.mjs — GitHub CLI (gh) interactions.
 *
 * Functions receive `config` as first parameter and use `config.ghRepo`, `config.repoPath`.
 */

import { execFileSync } from "child_process";
import { log } from "./log.mjs";

// ─── Create Pull Request ─────────────────────────────────────────────────────

export function createPR(config, title, body) {
  const prUrl = execFileSync(
    "gh",
    ["pr", "create", "--repo", config.ghRepo, "--title", title, "--body-file", "-"],
    { cwd: config.repoPath, encoding: "utf-8", input: body, timeout: 30000 }
  ).trim();

  log(`PR created: ${prUrl}`);
  return prUrl;
}

// ─── Merge Pull Request (squash) ─────────────────────────────────────────────

export function mergePR(config, prUrl) {
  execFileSync(
    "gh",
    ["pr", "merge", "--repo", config.ghRepo, "--squash", "--delete-branch", prUrl],
    { cwd: config.repoPath, encoding: "utf-8", timeout: 30000 }
  );
  log("PR merged");
}

// ─── List merged PRs matching a pattern ──────────────────────────────────────

export function listMergedPRs(config, pattern) {
  const prJson = execFileSync(
    "gh",
    ["pr", "list", "--repo", config.ghRepo, "--state", "merged", "--limit", "200", "--json", "number,title,mergeCommit"],
    { cwd: config.repoPath, encoding: "utf-8", timeout: 30000 }
  );
  return JSON.parse(prJson).filter((pr) => pr.title.match(pattern));
}
