# Autodev Refactorisation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactoriser le monolithe `hive-autodev.mjs` (973 lignes) en modules ESM, ajouter config multi-projet, bootstrapping contexte, rapports Confluence, et execution parallele via worktrees.

**Architecture:** Multi-fichiers ESM plats (`bin/` + `lib/`). Chaque module exporte des fonctions qui recoivent la config en parametre. CLI via commander. Config par projet dans `projects/{KEY}.json`.

**Tech Stack:** Node.js 22, ESM modules, commander (CLI), dotenv, gh CLI, Jira REST API v3, Confluence REST API v2.

**Source actuelle:** `/mnt/c/Users/Florent Didelot/Desktop/sooatek/hive/autodev/hive-autodev.mjs`
**Design doc:** `docs/plans/2026-02-20-autodev-refactorisation-design.md`

---

## Phase 1 : Scaffolding + config multi-projet

### Task 1: Initialiser le package.json et la structure de dossiers

**Files:**
- Create: `bin/autodev.mjs`
- Create: `lib/` (directory)
- Create: `projects/` (directory)
- Create: `templates/` (directory)
- Create: `package.json`
- Create: `.env.example`

**Step 1: Creer package.json**

```json
{
  "name": "autodev",
  "version": "0.1.0",
  "type": "module",
  "bin": { "autodev": "./bin/autodev.mjs" },
  "dependencies": {
    "commander": "^13.0.0",
    "dotenv": "^16.0.0"
  }
}
```

**Step 2: Creer .env.example**

```
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-token
JIRA_BASE_URL=https://yoursite.atlassian.net
```

**Step 3: Creer les dossiers vides**

```bash
mkdir -p bin lib projects templates
```

**Step 4: npm install**

```bash
npm install
```

**Step 5: Commit**

```bash
git add package.json package-lock.json .env.example bin/ lib/ projects/ templates/
git commit -m "chore: scaffold autodev project structure"
```

---

### Task 2: Extraire lib/log.mjs

**Files:**
- Create: `lib/log.mjs`
- Source: `hive-autodev.mjs:50-60` (fonctions log/logError)

**Step 1: Creer lib/log.mjs**

```js
let currentTicketKey = "";

export function setCurrentTicket(key) {
  currentTicketKey = key;
}

export function getCurrentTicket() {
  return currentTicketKey;
}

export function log(msg) {
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.log(`${prefix} ${msg}`);
}

export function logError(msg) {
  const prefix = currentTicketKey ? `[${currentTicketKey}]` : "[AUTODEV]";
  console.error(`${prefix} ERROR: ${msg}`);
}
```

**Step 2: Commit**

```bash
git add lib/log.mjs
git commit -m "refactor: extract log module"
```

---

### Task 3: Extraire lib/config.mjs + projects/HIVE.json

**Files:**
- Create: `lib/config.mjs`
- Create: `projects/HIVE.json`
- Source: `hive-autodev.mjs:16-27,31-46` (constantes, loadEnv, env parsing)

**Step 1: Creer projects/HIVE.json**

```json
{
  "projectKey": "HIVE",
  "repoPath": "/mnt/c/Users/Florent Didelot/Documents/GitHub/hive2",
  "ghRepo": "Flo976/hive2",
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
  "promptContext": "projet Hive (agent IA multi-tenant SaaS)"
}
```

**Step 2: Creer lib/config.mjs**

Charge `.env` via dotenv, charge `projects/{key}.json`, retourne un objet config unifie.

```js
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export function loadConfig(projectKey) {
  // Load .env from autodev root's parent (sooatek/.env) or from autodev root
  // Try multiple locations
  const envPaths = [
    join(ROOT, ".env"),
    join(ROOT, "..", ".env"),
    join(ROOT, "..", "..", ".env"),
  ];
  let envLoaded = false;
  for (const p of envPaths) {
    const result = dotenvConfig({ path: p });
    if (!result.error) { envLoaded = true; break; }
  }

  if (!process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN || !process.env.JIRA_BASE_URL) {
    throw new Error("Missing JIRA_EMAIL, JIRA_API_TOKEN, or JIRA_BASE_URL in .env");
  }

  // Load project config
  const projectPath = join(ROOT, "projects", `${projectKey}.json`);
  let project;
  try {
    project = JSON.parse(readFileSync(projectPath, "utf-8"));
  } catch (e) {
    throw new Error(`Project config not found: ${projectPath}. Create it or use --project with a valid key.`);
  }

  return {
    ...project,
    jiraBase: process.env.JIRA_BASE_URL,
    jiraAuth: Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64"),
    jiraEmail: process.env.JIRA_EMAIL,
  };
}

// Deduce project key from a ticket key like "HIVE-42" → "HIVE"
export function projectKeyFromTicket(ticketKey) {
  const m = ticketKey.match(/^([A-Z]+)-\d+$/);
  if (!m) throw new Error(`Invalid ticket key format: ${ticketKey}`);
  return m[1];
}
```

**Step 3: Commit**

```bash
git add lib/config.mjs projects/HIVE.json
git commit -m "refactor: extract config module + HIVE project config"
```

---

### Task 4: Extraire lib/adf.mjs

**Files:**
- Create: `lib/adf.mjs`
- Source: `hive-autodev.mjs:98-127`

**Step 1: Creer lib/adf.mjs**

Copier la fonction `adfToText` telle quelle, l'exporter.

```js
export function adfToText(node) {
  // ... copie exacte des lignes 98-127 de hive-autodev.mjs
}
```

**Step 2: Commit**

```bash
git add lib/adf.mjs
git commit -m "refactor: extract ADF-to-text module"
```

---

### Task 5: Extraire lib/jira.mjs

**Files:**
- Create: `lib/jira.mjs`
- Source: `hive-autodev.mjs:64-94` (jiraFetch), `:131-198` (fetchTicket), `:222-261` (transition, comment), `:611-656` (findNextTicket)

**Step 1: Creer lib/jira.mjs**

Toutes les fonctions recoivent `config` en premier parametre au lieu de lire des globales.

```js
import { log } from "./log.mjs";
import { adfToText } from "./adf.mjs";

const THROTTLE_MS = 150;
let lastReqAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function jiraFetch(config, path, options = {}) {
  const now = Date.now();
  const wait = THROTTLE_MS - (now - lastReqAt);
  if (wait > 0) await sleep(wait);
  lastReqAt = Date.now();

  const url = `${config.jiraBase}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${config.jiraAuth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira ${options.method || "GET"} ${path} → ${res.status}: ${body}`);
  }

  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

export async function fetchTicket(config, key) { /* ... config.statuses, config.projectKey */ }
export async function transitionTicket(config, key, targetStatusName) { /* ... */ }
export async function commentTicket(config, key, text) { /* ... */ }
export async function findNextTicket(config) { /* ... uses config.projectKey, config.statuses */ }
export { sleep };
```

Chaque fonction utilise `config.jiraBase`, `config.jiraAuth`, `config.projectKey`, `config.statuses` au lieu des constantes globales.

**Step 2: Commit**

```bash
git add lib/jira.mjs
git commit -m "refactor: extract Jira API module"
```

---

### Task 6: Extraire lib/git.mjs

**Files:**
- Create: `lib/git.mjs`
- Source: `hive-autodev.mjs:264-301`

**Step 1: Creer lib/git.mjs**

```js
import { execSync } from "child_process";
import { log, logError } from "./log.mjs";

export function git(config, cmd) {
  const full = `git -C "${config.repoPath}" ${cmd}`;
  return execSync(full, { encoding: "utf-8", timeout: 30000 }).trim();
}

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 40);
}

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

export function cleanupBranch(config, branch) {
  try {
    git(config, "checkout main");
    git(config, `branch -D ${branch}`);
    log(`Cleaned up branch ${branch}`);
  } catch (e) {
    logError(`Cleanup failed: ${e.message}`);
  }
}
```

**Step 2: Commit**

```bash
git add lib/git.mjs
git commit -m "refactor: extract git operations module"
```

---

### Task 7: Extraire lib/claude.mjs

**Files:**
- Create: `lib/claude.mjs`
- Source: `hive-autodev.mjs:304-505` (buildPrompt, executeWithClaude, evaluateResult)

**Step 1: Creer lib/claude.mjs**

```js
import { readFileSync } from "fs";
import { join } from "path";
import { execSync, spawn } from "child_process";
import { log, getCurrentTicket } from "./log.mjs";
import { git } from "./git.mjs";

export function buildPrompt(config, ticket) {
  // Utilise config.promptContext au lieu de "projet Hive (agent IA multi-tenant SaaS)"
  // Utilise config.projectKey au lieu de "hive2"
  let prompt = `Tu es un développeur senior qui travaille sur le ${config.promptContext}.
  ...`;
  // ... reste identique sauf les references hardcodees
}

export function executeWithClaude(config, prompt) {
  // Identique sauf cwd = config.repoPath
}

export function evaluateResult(config, claudeOutput) {
  // Identique sauf join(config.repoPath, "BLOCKED.md") et config.repoPath pour git
}
```

**Step 2: Commit**

```bash
git add lib/claude.mjs
git commit -m "refactor: extract Claude execution module"
```

---

### Task 8: Extraire lib/github.mjs

**Files:**
- Create: `lib/github.mjs`
- Source: `hive-autodev.mjs:510-577` (handleSuccess — la partie PR)

**Step 1: Creer lib/github.mjs**

```js
import { execFileSync } from "child_process";
import { log } from "./log.mjs";
import { git } from "./git.mjs";

export function createPR(config, title, body) {
  const prUrl = execFileSync(
    "gh",
    ["pr", "create", "--repo", config.ghRepo, "--title", title, "--body-file", "-"],
    { cwd: config.repoPath, encoding: "utf-8", input: body, timeout: 30000 }
  ).trim();
  log(`PR created: ${prUrl}`);
  return prUrl;
}

export function mergePR(config, prUrl) {
  execFileSync(
    "gh",
    ["pr", "merge", "--repo", config.ghRepo, "--squash", "--delete-branch", prUrl],
    { cwd: config.repoPath, encoding: "utf-8", timeout: 30000 }
  );
  log("PR merged");
}

export function listMergedPRs(config, pattern) {
  const prJson = execFileSync(
    "gh",
    ["pr", "list", "--repo", config.ghRepo, "--state", "merged", "--limit", "200", "--json", "number,title,mergeCommit"],
    { cwd: config.repoPath, encoding: "utf-8", timeout: 30000 }
  );
  const prs = JSON.parse(prJson);
  return pattern ? prs.filter((pr) => pr.title.match(pattern)) : prs;
}
```

**Step 2: Commit**

```bash
git add lib/github.mjs
git commit -m "refactor: extract GitHub PR module"
```

---

### Task 9: Extraire lib/sprint.mjs

**Files:**
- Create: `lib/sprint.mjs`
- Source: `hive-autodev.mjs:736-883`

**Step 1: Creer lib/sprint.mjs**

Identique aux fonctions actuelles mais utilise `config` au lieu des globales, et appelle `createPR`/`mergePR` de `github.mjs`.

```js
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { log, logError } from "./log.mjs";
import { jiraFetch } from "./jira.mjs";
import { git } from "./git.mjs";
import { createPR, mergePR, listMergedPRs } from "./github.mjs";

export function extractSprintNumber(sprintName) { /* ... */ }
export async function checkSprintCompletion(config, sprintName) { /* ... */ }
export async function generateSprintRecap(config, sprintName) { /* ... */ }
export async function createSprintBranch(config, sprintName) { /* ... */ }
```

**Step 2: Commit**

```bash
git add lib/sprint.mjs
git commit -m "refactor: extract sprint recap module"
```

---

### Task 10: Assembler bin/autodev.mjs avec commander

**Files:**
- Create: `bin/autodev.mjs`
- Source: `hive-autodev.mjs:660-972` (processTicket, main)

**Step 1: Creer bin/autodev.mjs**

```js
#!/usr/bin/env node
import { program } from "commander";
import { loadConfig, projectKeyFromTicket } from "../lib/config.mjs";
import { setCurrentTicket, log, logError } from "../lib/log.mjs";
import { fetchTicket, transitionTicket, commentTicket, findNextTicket, sleep } from "../lib/jira.mjs";
import { git, createBranch, cleanupBranch } from "../lib/git.mjs";
import { buildPrompt, executeWithClaude, evaluateResult } from "../lib/claude.mjs";
import { createPR, mergePR } from "../lib/github.mjs";
import { checkSprintCompletion, createSprintBranch } from "../lib/sprint.mjs";

program
  .name("autodev")
  .description("Automate Jira ticket execution via Claude Code CLI")
  .argument("[ticket]", "Ticket key (e.g. HIVE-42)")
  .option("-p, --project <key>", "Project key (deduced from ticket if not specified)")
  .option("-n, --next", "Pick next unblocked ticket")
  .option("--auto-close", "Merge PR and close ticket after success")
  .option("--dry-run", "Analyze without executing")
  .option("--init", "Bootstrap project context files")
  .action(async (ticket, opts) => {
    // Resolve project key
    let projectKey = opts.project;
    if (!projectKey && ticket) {
      projectKey = projectKeyFromTicket(ticket);
    }
    if (!projectKey) {
      console.error("Specify a ticket key or --project");
      process.exit(1);
    }

    const config = loadConfig(projectKey);
    // ... rest of orchestration (processTicket, next loop, etc.)
  });

program.parse();
```

`processTicket`, `handleSuccess`, `handleFailure` deviennent des fonctions locales dans ce fichier (ou dans un `lib/pipeline.mjs` si ca grossit). Elles recoivent `config` en parametre.

**Step 2: Tester manuellement**

```bash
node bin/autodev.mjs --dry-run HIVE-42
```

Attendu : meme comportement que l'ancien `node hive-autodev.mjs --dry-run HIVE-42`.

**Step 3: Commit**

```bash
git add bin/autodev.mjs
git commit -m "refactor: assemble CLI entry point with commander"
```

---

### Task 11: Verifier que le monolithe est entierement remplace

**Step 1: Tester les modes principaux**

```bash
node bin/autodev.mjs --help
node bin/autodev.mjs --dry-run HIVE-42
```

**Step 2: Renommer l'ancien fichier**

```bash
mv hive-autodev.mjs hive-autodev.mjs.bak
```

**Step 3: Commit**

```bash
git add hive-autodev.mjs.bak
git commit -m "refactor: archive monolith, migration complete"
```

---

## Phase 2 : Bootstrapping contexte projet

### Task 12: Creer les templates

**Files:**
- Create: `templates/index.md`
- Create: `templates/memory.md`
- Create: `templates/soul.md`
- Create: `templates/plan.md`
- Create: `templates/sprint.md`

**Step 1: Creer templates/index.md**

```markdown
# Autodev — Contexte projet

Ce dossier contient les fichiers de contexte utilises par autodev pour donner du contexte a Claude lors de l'implementation des tickets.

| Fichier | Role |
|---|---|
| `memory.md` | Conventions, decisions techniques, patterns recurrents du projet |
| `soul.md` | Identite du projet : vision, objectifs, contraintes, stack, architecture |
| `plan.md` | Plan courant : roadmap, priorites, prochaines etapes |
| `sprint-current.md` | Contexte du sprint en cours : objectifs, scope, tickets cles |

## Comment remplir ces fichiers

Chaque fichier contient des sections avec des placeholders `<!-- A REMPLIR -->`.
Remplacez-les par le contenu reel du projet. Autodev refusera de se lancer tant que les fichiers sont vides.
```

**Step 2: Creer templates/memory.md**

```markdown
# Memory — {PROJECT_KEY}

## Conventions de code

<!-- A REMPLIR : style de code, linter, formatter, conventions de nommage -->

## Decisions techniques

<!-- A REMPLIR : choix techniques importants et leur justification -->

## Patterns recurrents

<!-- A REMPLIR : patterns utilises dans le projet, structures communes -->
```

**Step 3: Creer templates/soul.md**

```markdown
# Soul — {PROJECT_KEY}

## Vision

<!-- A REMPLIR : vision du projet, objectif a long terme -->

## Stack technique

<!-- A REMPLIR : langages, frameworks, base de donnees, infra -->

## Architecture

<!-- A REMPLIR : architecture globale, composants principaux -->

## Contraintes

<!-- A REMPLIR : contraintes techniques, business, reglementaires -->
```

**Step 4: Creer templates/plan.md**

```markdown
# Plan — {PROJECT_KEY}

## Roadmap

<!-- A REMPLIR : grandes etapes du projet -->

## Priorites actuelles

<!-- A REMPLIR : ce qui est important maintenant -->

## Prochaines etapes

<!-- A REMPLIR : les prochaines taches a realiser -->
```

**Step 5: Creer templates/sprint.md**

```markdown
# Sprint courant — {PROJECT_KEY}

## Objectifs du sprint

<!-- A REMPLIR : objectifs principaux de ce sprint -->

## Scope

<!-- A REMPLIR : tickets inclus, perimetre -->

## Notes

<!-- A REMPLIR : contexte supplementaire, risques, decisions -->
```

**Step 6: Commit**

```bash
git add templates/
git commit -m "feat: add project context templates"
```

---

### Task 13: Creer lib/context.mjs

**Files:**
- Create: `lib/context.mjs`

**Step 1: Creer lib/context.mjs**

```js
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { log, logError } from "./log.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "templates");

const CONTEXT_FILES = ["memory.md", "soul.md", "plan.md", "sprint-current.md"];
const CLAUDE_MD_SECTION = `
## Contexte autodev

Ce projet utilise autodev pour l'automatisation des tickets Jira.
Consultez les fichiers suivants pour le contexte projet :

- Memoire projet : \`autodev/memory.md\`
- Identite projet : \`autodev/soul.md\`
- Plan courant : \`autodev/plan.md\`
- Sprint en cours : \`autodev/sprint-current.md\`
- Index : \`autodev/index.md\`
`;

export function ensureProjectContext(config, { skipValidation = false } = {}) {
  const autodevDir = join(config.repoPath, "autodev");
  const claudeMdPath = join(config.repoPath, "CLAUDE.md");

  // 1. Create autodev/ if missing
  if (!existsSync(autodevDir)) {
    log("Creating autodev/ context directory...");
    mkdirSync(autodevDir, { recursive: true });

    // Copy templates
    const templateFiles = {
      "index.md": "index.md",
      "memory.md": "memory.md",
      "soul.md": "soul.md",
      "plan.md": "plan.md",
      "sprint.md": "sprint-current.md",
    };

    for (const [src, dest] of Object.entries(templateFiles)) {
      const content = readFileSync(join(TEMPLATES_DIR, src), "utf-8")
        .replace(/\{PROJECT_KEY\}/g, config.projectKey);
      writeFileSync(join(autodevDir, dest), content, "utf-8");
    }
    log("Context files created from templates.");
  }

  // 2. Check CLAUDE.md
  if (!existsSync(claudeMdPath)) {
    log("CLAUDE.md not found, running claude /init...");
    try {
      execSync("claude /init", { cwd: config.repoPath, encoding: "utf-8", timeout: 30000 });
    } catch (e) {
      log(`claude /init failed (${e.message}), creating minimal CLAUDE.md`);
      writeFileSync(claudeMdPath, `# ${config.projectKey}\n`, "utf-8");
    }
    appendFileSync(claudeMdPath, CLAUDE_MD_SECTION, "utf-8");
    log("Injected autodev section into CLAUDE.md");
  } else {
    const claudeMd = readFileSync(claudeMdPath, "utf-8");
    if (!claudeMd.includes("Contexte autodev")) {
      appendFileSync(claudeMdPath, CLAUDE_MD_SECTION, "utf-8");
      log("Appended autodev section to existing CLAUDE.md");
    }
  }

  // 3. Validate completeness
  if (!skipValidation) {
    const incomplete = validateCompleteness(config);
    if (incomplete.length > 0) {
      logError("Contexte projet incomplet. Remplissez les fichiers suivants :");
      for (const f of incomplete) {
        console.error(`  - autodev/${f}`);
      }
      console.error("\nUtilisez --init pour recreer les templates ou remplissez les fichiers manuellement.");
      process.exit(1);
    }
  }
}

export function validateCompleteness(config) {
  const autodevDir = join(config.repoPath, "autodev");
  const incomplete = [];

  for (const file of CONTEXT_FILES) {
    const filePath = join(autodevDir, file);
    if (!existsSync(filePath)) {
      incomplete.push(file);
      continue;
    }
    const content = readFileSync(filePath, "utf-8");
    // Check if file has any real content (not just headings, placeholders, empty lines)
    const lines = content.split("\n").filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("#")) return false;
      if (trimmed.startsWith("<!--") && trimmed.endsWith("-->")) return false;
      return true;
    });
    if (lines.length === 0) {
      incomplete.push(file);
    }
  }

  return incomplete;
}
```

**Step 2: Commit**

```bash
git add lib/context.mjs
git commit -m "feat: add project context bootstrapping module"
```

---

### Task 14: Integrer context.mjs dans bin/autodev.mjs

**Files:**
- Modify: `bin/autodev.mjs`

**Step 1: Ajouter l'import et l'appel**

Dans `bin/autodev.mjs`, apres `const config = loadConfig(projectKey)` :

```js
import { ensureProjectContext } from "../lib/context.mjs";

// In the action handler, after loadConfig:
if (opts.init) {
  ensureProjectContext(config, { skipValidation: true });
  log("Project context initialized. Fill the files in autodev/ then re-run.");
  process.exit(0);
}

ensureProjectContext(config, { skipValidation: opts.dryRun });
```

**Step 2: Tester**

```bash
# Should create autodev/ in the target repo and exit
node bin/autodev.mjs --project HIVE --init

# Should fail if context files are still templates
node bin/autodev.mjs --dry-run HIVE-42
```

**Step 3: Commit**

```bash
git add bin/autodev.mjs
git commit -m "feat: integrate context bootstrapping into CLI startup"
```

---

## Phase 3 : Rapport Confluence automatique

### Task 15: Creer lib/confluence.mjs

**Files:**
- Create: `lib/confluence.mjs`

**Step 1: Creer lib/confluence.mjs**

```js
import { log } from "./log.mjs";

// Confluence REST API v2 uses same Atlassian Cloud auth as Jira
async function confluenceFetch(config, path, options = {}) {
  const base = config.jiraBase.replace(/\/+$/, "");
  const url = `${base}/wiki/api/v2${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${config.jiraAuth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Confluence ${options.method || "GET"} ${path} → ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function extractConfluenceLink(description) {
  const m = description.match(/https?:\/\/[^\s]*\.atlassian\.net\/wiki\/[^\s)>]*/);
  return m ? m[0] : null;
}

// Extract page ID from Confluence URL
function pageIdFromUrl(url) {
  // /wiki/spaces/SPACE/pages/123456/title or /wiki/x/SHORTCODE
  const m = url.match(/\/pages\/(\d+)/);
  return m ? m[1] : null;
}

export function buildReportBody(ticket, evalResult, prUrl) {
  const today = new Date().toISOString().split("T")[0];
  const files = (evalResult.modifiedFiles || []).map((f) => `- \`${f}\``).join("\n");
  const summary = (evalResult.summary || "").substring(0, 500);

  return `## Implementation — ${ticket.key}

**Date** : ${today}
**PR** : ${prUrl}

### Fichiers modifies
${files || "Aucun"}

### Resume
${summary || "N/A"}
`;
}

export async function publishConfluenceReport(config, ticket, evalResult, prUrl) {
  if (!config.confluence?.spaceKey) {
    return null; // Confluence not configured, silently skip
  }

  const reportBody = buildReportBody(ticket, evalResult, prUrl);
  const confluenceLink = extractConfluenceLink(ticket.description || "");

  try {
    if (confluenceLink) {
      // Update existing page
      const pageId = pageIdFromUrl(confluenceLink);
      if (pageId) {
        const page = await confluenceFetch(config, `/pages/${pageId}`);
        const currentBody = page.body?.storage?.value || "";
        await confluenceFetch(config, `/pages/${pageId}`, {
          method: "PUT",
          body: JSON.stringify({
            id: pageId,
            status: "current",
            title: page.title,
            body: {
              representation: "storage",
              value: currentBody + "\n\n" + reportBody,
            },
            version: { number: (page.version?.number || 1) + 1 },
          }),
        });
        log(`[CONFLUENCE] Updated page: ${confluenceLink}`);
        return confluenceLink;
      }
    }

    // Create new page
    const newPage = await confluenceFetch(config, `/pages`, {
      method: "POST",
      body: JSON.stringify({
        spaceId: config.confluence.spaceKey,
        status: "current",
        title: `${ticket.key}: ${ticket.summary}`,
        parentId: config.confluence.parentPageId || undefined,
        body: {
          representation: "storage",
          value: reportBody,
        },
      }),
    });

    const pageUrl = newPage._links?.webui
      ? `${config.jiraBase.replace(/\/+$/, "")}/wiki${newPage._links.webui}`
      : `Created page ${newPage.id}`;
    log(`[CONFLUENCE] Created page: ${pageUrl}`);
    return pageUrl;
  } catch (e) {
    log(`[CONFLUENCE] Warning: report failed: ${e.message}`);
    return null;
  }
}
```

**Step 2: Commit**

```bash
git add lib/confluence.mjs
git commit -m "feat: add Confluence report module"
```

---

### Task 16: Integrer Confluence dans handleSuccess

**Files:**
- Modify: `bin/autodev.mjs` (handleSuccess function)

**Step 1: Appeler publishConfluenceReport apres la PR**

Dans `handleSuccess`, apres le commentaire Jira :

```js
import { publishConfluenceReport } from "../lib/confluence.mjs";

// After PR merge and Jira comment:
const confluenceUrl = await publishConfluenceReport(config, ticket, evalResult, prUrl);
if (confluenceUrl) {
  await commentTicket(config, ticket.key, `[AutoDev] Rapport Confluence : ${confluenceUrl}`);
}
```

**Step 2: Commit**

```bash
git add bin/autodev.mjs
git commit -m "feat: integrate Confluence reports into ticket pipeline"
```

---

## Phase 4 : Execution parallele via worktrees

### Task 17: Ajouter les operations worktree dans lib/git.mjs

**Files:**
- Modify: `lib/git.mjs`

**Step 1: Ajouter createWorktree et removeWorktree**

```js
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
```

**Step 2: Commit**

```bash
git add lib/git.mjs
git commit -m "feat: add git worktree operations"
```

---

### Task 18: Ajouter findNextTickets (multi-ticket) dans lib/jira.mjs

**Files:**
- Modify: `lib/jira.mjs`

**Step 1: Creer findNextTickets**

```js
export async function findNextTickets(config, maxCount = 1) {
  if (maxCount === 1) {
    const key = await findNextTicket(config);
    return key ? [key] : [];
  }

  log(`Searching for up to ${maxCount} independent tickets...`);
  const jql = encodeURIComponent(
    `project=${config.projectKey} AND status=${config.statuses.TODO} ORDER BY created ASC`
  );
  const data = await jiraFetch(config,
    `/rest/api/3/search/jql?jql=${jql}&maxResults=50&fields=summary,status,issuelinks,issuetype,priority,parent`
  );

  if (!data.issues || data.issues.length === 0) return [];

  const eligible = [];
  const selectedEpics = new Set();

  for (const issue of data.issues) {
    if (issue.fields.issuetype?.name === "Epic") continue;
    if (eligible.length >= maxCount) break;

    // Check blocking links
    const links = issue.fields.issuelinks || [];
    const isBlocked = links.some((l) => {
      if (!l.outwardIssue) return false;
      return l.type?.inward === "is blocked by" && l.outwardIssue.fields?.status?.id !== config.statuses.DONE;
    });
    if (isBlocked) continue;

    // Check no mutual blocking with already selected tickets
    const blocksSelected = links.some((l) =>
      l.inwardIssue && eligible.some((e) => e.key === l.inwardIssue.key)
    );
    if (blocksSelected) continue;

    // Heuristic: different epics to avoid file conflicts
    const epicKey = issue.fields.parent?.key || null;
    if (epicKey && selectedEpics.has(epicKey)) continue;

    eligible.push({ key: issue.key, summary: issue.fields.summary });
    if (epicKey) selectedEpics.add(epicKey);
    log(`  ${issue.key}: "${issue.fields.summary}" — selected`);
  }

  return eligible.map((e) => e.key);
}
```

**Step 2: Commit**

```bash
git add lib/jira.mjs
git commit -m "feat: add multi-ticket selection for parallel mode"
```

---

### Task 19: Ajouter le mode parallele dans bin/autodev.mjs

**Files:**
- Modify: `bin/autodev.mjs`

**Step 1: Ajouter l'option --parallel**

```js
.option("--parallel <n>", "Max parallel workers (default: 1)", "1")
```

**Step 2: Implementer la boucle parallele**

Quand `parallel > 1` et `nextMode` et `autoClose` :

```js
const parallel = parseInt(opts.parallel) || 1;
const MAX_PARALLEL = 4;
const workerCount = Math.min(parallel, MAX_PARALLEL);

if (workerCount > 1 && nextMode && autoClose) {
  // Parallel mode
  const tickets = await findNextTickets(config, workerCount);
  if (tickets.length === 0) { log("No tickets."); process.exit(0); }

  log(`Launching ${tickets.length} parallel workers...`);

  // Create worktrees and process in parallel
  const results = await Promise.allSettled(
    tickets.map(async (key) => {
      const slug = slugify(key);
      const branch = `feat/${config.projectKey}-${key.split("-")[1]}-parallel`;
      const worktreePath = createWorktree(config, key, branch);
      const worktreeConfig = { ...config, repoPath: worktreePath };

      try {
        return await processTicket(worktreeConfig, key, { dryRun, autoClose });
      } finally {
        removeWorktree(config, key);
      }
    })
  );

  // Sequential merge for successes
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled" && result.value.success) {
      git(config, "checkout main");
      git(config, "pull origin main");
      // PR was already created by processTicket
      log(`${tickets[i]} merged.`);
    }
  }
} else {
  // Existing sequential loop
}
```

**Step 3: Commit**

```bash
git add bin/autodev.mjs
git commit -m "feat: add parallel execution via git worktrees"
```

---

## Phase 5 : README

### Task 20: Ecrire le README

**Files:**
- Create: `README.md`

**Step 1: Ecrire le README complet**

Contenu :
- Presentation (what/why)
- Prerequis : Node 22+, Claude CLI, gh CLI, acces Jira
- Installation : `git clone`, `npm install`, `.env`
- Configuration : `projects/{KEY}.json` (exemple complet)
- Usage : tous les modes avec exemples
  - `autodev HIVE-42`
  - `autodev --project HIVE --next`
  - `autodev --project HIVE --auto-close --next`
  - `autodev --project HIVE --init`
  - `autodev --project HIVE --parallel 3 --auto-close --next`
  - `autodev --dry-run HIVE-42`
- Contexte projet : explication du dossier `autodev/` et de chaque fichier
- Architecture : description des modules `lib/`
- Fonctionnalites : sprint recap, Confluence, parallel
- Ajouter un nouveau projet : copier `projects/HIVE.json`, adapter

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README"
```

---

### Task 21: Nettoyage final

**Step 1: Supprimer l'ancien monolithe**

```bash
rm hive-autodev.mjs.bak
```

**Step 2: Verifier que tout fonctionne**

```bash
node bin/autodev.mjs --help
node bin/autodev.mjs --dry-run HIVE-42
```

**Step 3: Commit final**

```bash
git add -A
git commit -m "chore: cleanup, remove legacy monolith"
```
