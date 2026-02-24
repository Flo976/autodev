# Interactive CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an interactive menu-driven mode to autodev that launches when no CLI arguments are provided.

**Architecture:** A single new file `bin/autodev-interactive.mjs` contains the banner, project selector, main menu loop, and all sub-menus. Each sub-menu collects options via `@inquirer/prompts` then calls existing lib functions. `bin/autodev.mjs` is modified minimally to detect "no args" and delegate to the interactive module. No lib files are modified.

**Tech Stack:** `@inquirer/prompts` (menus/inputs), ANSI escape codes (colors), existing lib modules (business logic).

---

### Task 1: Install dependency and scaffold empty module

**Files:**
- Modify: `package.json:9-14`
- Create: `bin/autodev-interactive.mjs`

**Step 1: Install @inquirer/prompts**

Run:
```bash
cd /home/florent-didelot/Documents/GitHub/autodev && npm install @inquirer/prompts
```

Expected: package.json updated with `@inquirer/prompts` in dependencies, `node_modules` updated.

**Step 2: Create the empty interactive module**

Create `bin/autodev-interactive.mjs`:

```javascript
#!/usr/bin/env node
/**
 * autodev-interactive.mjs — Interactive CLI for AUTODEV by Sooatek.
 *
 * Launched when `autodev` is called with no arguments.
 * Provides menu-driven access to all autodev features.
 */

export async function startInteractive() {
  console.log("Interactive mode — coming soon");
}
```

**Step 3: Verify module imports**

Run:
```bash
node -e "import('./bin/autodev-interactive.mjs').then(m => { console.log(typeof m.startInteractive); })"
```

Expected: `function`

**Step 4: Commit**

```bash
git add package.json package-lock.json bin/autodev-interactive.mjs
git commit -m "chore: add @inquirer/prompts and scaffold interactive module"
```

---

### Task 2: Wire interactive mode into autodev.mjs

**Files:**
- Modify: `bin/autodev.mjs:345-379` (the CLI/program section)

**Step 1: Add early detection before commander parsing**

In `bin/autodev.mjs`, add this block **before** `program.parse()` (before line 379):

```javascript
// ─── Interactive mode (no arguments) ─────────────────────────────────────
if (process.argv.length <= 2) {
  const { startInteractive } = await import("./autodev-interactive.mjs");
  await startInteractive();
  process.exit(0);
}
```

This must be placed between the `program.action(...)` block (ends line 372 with `});`) and `program.parse();` (line 379).

**Step 2: Verify interactive mode triggers**

Run:
```bash
node bin/autodev.mjs
```

Expected: prints `Interactive mode — coming soon` and exits.

**Step 3: Verify CLI mode still works**

Run:
```bash
node bin/autodev.mjs --help
```

Expected: normal commander help output (all options listed).

**Step 4: Commit**

```bash
git add bin/autodev.mjs
git commit -m "feat: launch interactive mode when no arguments given"
```

---

### Task 3: ANSI color helpers and banner

**Files:**
- Modify: `bin/autodev-interactive.mjs`

**Step 1: Implement color helpers and banner**

Replace the content of `bin/autodev-interactive.mjs` with:

```javascript
#!/usr/bin/env node
/**
 * autodev-interactive.mjs — Interactive CLI for AUTODEV by Sooatek.
 *
 * Launched when `autodev` is called with no arguments.
 * Provides menu-driven access to all autodev features.
 */

// ─── ANSI color helpers ──────────────────────────────────────────────────────

const ESC = "\x1b[";
const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  cyan: `${ESC}36m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  red: `${ESC}31m`,
  magenta: `${ESC}35m`,
};

// ─── Banner ──────────────────────────────────────────────────────────────────

function printBanner(projectKey, projectDesc) {
  const banner = `
${c.cyan}   ___       ___       ___       ___       ___       ___       ___
  /\\  \\     /\\__\\     /\\  \\     /\\  \\     /\\  \\     /\\  \\     /\\__\\
 /::\\  \\   /:/ _/_    \\:\\  \\   /::\\  \\   /::\\  \\   /::\\  \\   /:/ _/_
/::\\:\\__\\ /:/_/\\__\\   /::\\__\\ /:/\\:\\__\\ /:/\\:\\__\\ /::\\:\\__\\ |::L/\\__\\
\\/\\::/  / \\:\\/:/  /  /:/\\/__/ \\:\\/:/  / \\:\\/:/  / \\:\\:\\/  / |::::/  /
  /:/  /   \\::/  /   \\/__/     \\::/  /   \\::/  /   \\:\\/  /   L;;/__/
  \\/__/     \\/__/               \\/__/     \\/__/     \\/__/${c.reset}

${c.dim}                    --- by Sooatek ---${c.reset}
${c.dim}                       v0.1.0${c.reset}

  ${c.bold}Projet : ${c.green}${projectKey}${c.reset}${projectDesc ? ` ${c.dim}(${projectDesc})${c.reset}` : ""}
`;
  console.log(banner);
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function startInteractive() {
  printBanner("DEMO", "test");
}
```

**Step 2: Verify banner renders**

Run:
```bash
node bin/autodev.mjs
```

Expected: Colored ASCII art banner with "AUTODEV" in cyan, "by Sooatek" dimmed, "Projet : DEMO (test)" in green/bold.

**Step 3: Commit**

```bash
git add bin/autodev-interactive.mjs
git commit -m "feat: add ANSI color helpers and ASCII banner"
```

---

### Task 4: Project selector

**Files:**
- Modify: `bin/autodev-interactive.mjs`

**Step 1: Implement project discovery and selection**

Add these imports at the top of the file (after the comment header):

```javascript
import { readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { select } from "@inquirer/prompts";
import { loadConfig } from "../lib/config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
```

Add this function before `startInteractive`:

```javascript
// ─── Project discovery ───────────────────────────────────────────────────────

function listProjects() {
  const projectsDir = join(ROOT, "projects");
  const files = readdirSync(projectsDir).filter((f) => f.endsWith(".json"));
  return files.map((f) => basename(f, ".json"));
}

async function selectProject() {
  const projects = listProjects();

  if (projects.length === 0) {
    console.error(`${c.red}Aucun projet trouve dans projects/*.json${c.reset}`);
    process.exit(1);
  }

  if (projects.length === 1) {
    console.log(`${c.dim}Projet auto-selectionne : ${c.green}${projects[0]}${c.reset}`);
    return projects[0];
  }

  return select({
    message: "Quel projet ?",
    choices: projects.map((p) => ({ name: p, value: p })),
  });
}
```

Update `startInteractive` to:

```javascript
export async function startInteractive() {
  const projectKey = await selectProject();
  const config = loadConfig(projectKey);
  printBanner(projectKey, config.promptContext || "");
}
```

**Step 2: Verify auto-selection (single project)**

Run:
```bash
node bin/autodev.mjs
```

Expected: auto-selects HIVE (only project), prints banner with "Projet : HIVE (projet Hive...)" from HIVE.json's `promptContext`.

**Step 3: Commit**

```bash
git add bin/autodev-interactive.mjs
git commit -m "feat: add project discovery and auto-selection"
```

---

### Task 5: Main menu loop

**Files:**
- Modify: `bin/autodev-interactive.mjs`

**Step 1: Implement main menu**

Add this function before `startInteractive`:

```javascript
// ─── Main menu ───────────────────────────────────────────────────────────────

async function mainMenu(config, projectKey) {
  while (true) {
    console.log("");
    const action = await select({
      message: `${projectKey} >`,
      choices: [
        { name: "Executer un ticket", value: "ticket" },
        { name: "Release", value: "release" },
        { name: "Sprint", value: "sprint" },
        { name: "Planning", value: "planning" },
        { name: "Verification", value: "verify" },
        { name: "Export", value: "export" },
        { name: "Init projet", value: "init" },
        { name: "Changer de projet", value: "switch" },
        { name: "Quitter", value: "quit" },
      ],
    });

    if (action === "quit") {
      console.log(`${c.dim}A bientot !${c.reset}`);
      break;
    }

    if (action === "switch") {
      return "switch";
    }

    try {
      await handleAction(config, action);
    } catch (e) {
      console.error(`${c.red}Erreur: ${e.message}${c.reset}`);
    }
  }

  return "quit";
}

async function handleAction(config, action) {
  console.log(`${c.dim}[${action}] — pas encore implemente${c.reset}`);
}
```

Update `startInteractive` to handle the menu loop and project switching:

```javascript
export async function startInteractive() {
  let projectKey = await selectProject();
  let config = loadConfig(projectKey);
  printBanner(projectKey, config.promptContext || "");

  while (true) {
    const result = await mainMenu(config, projectKey);
    if (result === "quit") break;
    if (result === "switch") {
      projectKey = await selectProject();
      config = loadConfig(projectKey);
      printBanner(projectKey, config.promptContext || "");
    }
  }
}
```

**Step 2: Verify menu loop**

Run:
```bash
node bin/autodev.mjs
```

Expected: Banner shown, then menu with 9 options. Selecting any action shows "[action] — pas encore implemente". "Quitter" exits. "Changer de projet" re-shows project selector (auto-selects HIVE since only one).

**Step 3: Commit**

```bash
git add bin/autodev-interactive.mjs
git commit -m "feat: add main menu loop with project switching"
```

---

### Task 6: Sub-menu — Executer un ticket

**Files:**
- Modify: `bin/autodev-interactive.mjs`

**Step 1: Add inquirer imports**

Update the `@inquirer/prompts` import to include all needed prompt types:

```javascript
import { select, input, confirm, number } from "@inquirer/prompts";
```

**Step 2: Implement ticket sub-menu**

Add this function (and the needed imports at the top of the file):

```javascript
import { loadConfig, projectKeyFromTicket } from "../lib/config.mjs";
import { ensureProjectContext } from "../lib/context.mjs";
```

Note: `processTicket` is defined in `bin/autodev.mjs` and is NOT exported. We need to import the individual lib functions. However, to avoid duplicating the entire `processTicket` pipeline, the simplest approach is to **export `processTicket` from autodev.mjs** — BUT that file has side effects (commander parse). Instead, we call the existing CLI by building the equivalent command.

The cleanest solution: extract `processTicket` into a lib module. But per YAGNI, the simpler approach is to call the functions directly in the sub-menu.

Actually, the simplest correct approach: import the needed functions and replicate the essential flow. But `processTicket` is complex (40+ lines). Let's take the pragmatic path: **call `autodev.mjs` as a child process with the right flags**.

Add at top:

```javascript
import { execFileSync, execFile } from "child_process";
```

Add the ticket handler:

```javascript
// ─── Sub-menu: Executer un ticket ─────────────────────────────────────────

async function handleTicket(config) {
  const mode = await select({
    message: "Mode d'execution",
    choices: [
      { name: "Ticket specifique", value: "specific" },
      { name: "Prochain disponible (--next)", value: "next" },
    ],
  });

  const dryRun = await confirm({ message: "Dry-run ?", default: false });
  const autoClose = dryRun ? false : await confirm({ message: "Auto-close (merge + fermer) ?", default: false });

  const args = ["bin/autodev.mjs", "--project", config.projectKey];

  if (mode === "specific") {
    const ticketKey = await input({
      message: "Ticket key (ex: HIVE-42)",
      validate: (v) => /^[A-Z]+-\d+$/.test(v) || "Format invalide (ex: HIVE-42)",
    });
    args.push(ticketKey);
  } else {
    args.push("--next");
    if (autoClose) {
      const workers = await number({
        message: "Nombre de workers paralleles (1-4)",
        default: 1,
        min: 1,
        max: 4,
      });
      if (workers > 1) args.push("--parallel", String(workers));
    }
  }

  if (autoClose) args.push("--auto-close");
  if (dryRun) args.push("--dry-run");

  console.log(`\n${c.dim}> node ${args.join(" ")}${c.reset}\n`);
  runAutodev(args);
}

function runAutodev(args) {
  try {
    execFileSync("node", args, {
      cwd: ROOT,
      stdio: "inherit",
      timeout: 600000,
    });
  } catch (e) {
    if (e.status) {
      console.error(`${c.red}Commande terminee avec le code ${e.status}${c.reset}`);
    } else {
      throw e;
    }
  }
}
```

**Step 3: Wire into handleAction**

Update `handleAction`:

```javascript
async function handleAction(config, action) {
  switch (action) {
    case "ticket": return handleTicket(config);
    default:
      console.log(`${c.dim}[${action}] — pas encore implemente${c.reset}`);
  }
}
```

**Step 4: Verify**

Run:
```bash
node bin/autodev.mjs
```

Select "Executer un ticket" > "Ticket specifique" > type "HIVE-42" > Dry-run: yes > should execute `node bin/autodev.mjs --project HIVE HIVE-42 --dry-run` and show the prompt preview.

**Step 5: Commit**

```bash
git add bin/autodev-interactive.mjs
git commit -m "feat: add ticket execution sub-menu"
```

---

### Task 7: Sub-menu — Release

**Files:**
- Modify: `bin/autodev-interactive.mjs`

**Step 1: Implement release sub-menu**

```javascript
// ─── Sub-menu: Release ────────────────────────────────────────────────────

async function handleRelease(config) {
  const mode = await select({
    message: "Version",
    choices: [
      { name: "Auto-detect (depuis le dernier tag git)", value: "auto" },
      { name: "Version manuelle", value: "manual" },
    ],
  });

  const dryRun = await confirm({ message: "Dry-run ?", default: false });

  const args = ["bin/autodev.mjs", "--project", config.projectKey];

  if (mode === "auto") {
    args.push("--release");
  } else {
    const version = await input({
      message: "Nom de la version (ex: v1.2.0)",
      validate: (v) => v.length > 0 || "Version requise",
    });
    args.push("--release", version);
  }

  if (dryRun) args.push("--dry-run");

  console.log(`\n${c.dim}> node ${args.join(" ")}${c.reset}\n`);
  runAutodev(args);
}
```

**Step 2: Wire into handleAction**

Add case in `handleAction`:

```javascript
    case "release": return handleRelease(config);
```

**Step 3: Commit**

```bash
git add bin/autodev-interactive.mjs
git commit -m "feat: add release sub-menu"
```

---

### Task 8: Sub-menu — Sprint

**Files:**
- Modify: `bin/autodev-interactive.mjs`

**Step 1: Implement sprint sub-menu**

```javascript
// ─── Sub-menu: Sprint ─────────────────────────────────────────────────────

async function handleSprint(config) {
  const action = await select({
    message: "Action sprint",
    choices: [
      { name: "Fermer le sprint actif", value: "close" },
      { name: "Velocite (derniers sprints)", value: "velocity" },
      { name: "Tickets stale", value: "stale" },
    ],
  });

  const args = ["bin/autodev.mjs", "--project", config.projectKey];

  if (action === "close") {
    const dryRun = await confirm({ message: "Dry-run ?", default: false });
    const recap = await confirm({ message: "Generer le recap ?", default: true });
    args.push("--close-sprint");
    if (!recap) args.push("--no-recap");
    if (dryRun) args.push("--dry-run");
  } else if (action === "velocity") {
    args.push("--velocity");
  } else if (action === "stale") {
    const days = await number({
      message: "Seuil en jours",
      default: 7,
      min: 1,
    });
    args.push("--stale", "--days", String(days));
  }

  console.log(`\n${c.dim}> node ${args.join(" ")}${c.reset}\n`);
  runAutodev(args);
}
```

**Step 2: Wire into handleAction**

```javascript
    case "sprint": return handleSprint(config);
```

**Step 3: Commit**

```bash
git add bin/autodev-interactive.mjs
git commit -m "feat: add sprint sub-menu (close, velocity, stale)"
```

---

### Task 9: Sub-menu — Planning

**Files:**
- Modify: `bin/autodev-interactive.mjs`

**Step 1: Implement planning sub-menu**

```javascript
// ─── Sub-menu: Planning ───────────────────────────────────────────────────

async function handlePlanning(config) {
  const planFile = await input({
    message: "Chemin du fichier plan (relatif au repo)",
    validate: (v) => v.length > 0 || "Chemin requis",
  });

  const step = await select({
    message: "Etape",
    choices: [
      { name: "Flow complet (commence par analyze)", value: "full" },
      { name: "Analyze (etape 0)", value: "analyze" },
      { name: "Sprints (etape 1)", value: "sprints" },
      { name: "Tasks (etape 2)", value: "tasks" },
      { name: "Validate (etape 3)", value: "validate" },
      { name: "Import Jira (etape 4)", value: "import" },
    ],
  });

  const args = ["bin/autodev.mjs", "--project", config.projectKey, "--plan", planFile];

  if (step === "import") {
    const dryRun = await confirm({ message: "Dry-run ?", default: false });
    args.push("--import");
    if (dryRun) args.push("--dry-run");
  } else if (step !== "full") {
    args.push("--step", step);
  }

  console.log(`\n${c.dim}> node ${args.join(" ")}${c.reset}\n`);
  runAutodev(args);
}
```

**Step 2: Wire into handleAction**

```javascript
    case "planning": return handlePlanning(config);
```

**Step 3: Commit**

```bash
git add bin/autodev-interactive.mjs
git commit -m "feat: add planning sub-menu"
```

---

### Task 10: Sub-menus — Verification, Export, Init

**Files:**
- Modify: `bin/autodev-interactive.mjs`

**Step 1: Implement the three remaining sub-menus**

```javascript
// ─── Sub-menu: Verification ───────────────────────────────────────────────

async function handleVerify(config) {
  const sprint = await input({
    message: "Sprint name (vide = tous les sprints)",
    default: "",
  });

  const args = ["bin/autodev.mjs", "--project", config.projectKey, "--verify"];
  if (sprint) args.push("--sprint", sprint);

  console.log(`\n${c.dim}> node ${args.join(" ")}${c.reset}\n`);
  runAutodev(args);
}

// ─── Sub-menu: Export ─────────────────────────────────────────────────────

async function handleExport(config) {
  const sprint = await input({
    message: "Sprint name (vide = tous les sprints)",
    default: "",
  });

  const args = ["bin/autodev.mjs", "--project", config.projectKey, "--export-done"];
  if (sprint) args.push("--sprint", sprint);

  console.log(`\n${c.dim}> node ${args.join(" ")}${c.reset}\n`);
  runAutodev(args);
}

// ─── Sub-menu: Init ───────────────────────────────────────────────────────

async function handleInit(config) {
  const args = ["bin/autodev.mjs", "--project", config.projectKey, "--init"];

  console.log(`\n${c.dim}> node ${args.join(" ")}${c.reset}\n`);
  runAutodev(args);
}
```

**Step 2: Wire all three into handleAction**

Complete the switch:

```javascript
async function handleAction(config, action) {
  switch (action) {
    case "ticket": return handleTicket(config);
    case "release": return handleRelease(config);
    case "sprint": return handleSprint(config);
    case "planning": return handlePlanning(config);
    case "verify": return handleVerify(config);
    case "export": return handleExport(config);
    case "init": return handleInit(config);
  }
}
```

**Step 3: Verify all menus work**

Run:
```bash
node bin/autodev.mjs
```

Navigate through each menu option. All should either execute the corresponding autodev command or prompt for inputs.

**Step 4: Commit**

```bash
git add bin/autodev-interactive.mjs
git commit -m "feat: add verify, export, and init sub-menus"
```

---

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add interactive mode to Commands section**

Add this line at the top of the Commands section (after `npm install`):

```bash
node bin/autodev.mjs                                     # Interactive mode (menu-driven)
```

**Step 2: Add to Architecture section**

In the Key modules list, add:

```
- `bin/autodev-interactive.mjs` — Interactive menu-driven CLI. Launched when no arguments given. Uses `@inquirer/prompts` for menus, delegates to existing lib functions via child process.
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add interactive CLI mode to CLAUDE.md"
```
