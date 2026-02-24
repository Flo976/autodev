#!/usr/bin/env node
/**
 * autodev-interactive.mjs — Interactive CLI for AUTODEV by Sooatek.
 *
 * Launched when `autodev` is called with no arguments.
 * Provides menu-driven access to all autodev features.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { select, input, confirm, number } from "@inquirer/prompts";
import { ExitPromptError } from "@inquirer/core";
import { execFileSync } from "child_process";
import { loadConfig } from "../lib/config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

// ─── ANSI color helpers ──────────────────────────────────────────────────────

const c = {
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  magenta: "\x1b[35m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  reset:   "\x1b[0m",
};

// ─── ASCII banner ────────────────────────────────────────────────────────────

function printBanner(projectKey, projectDesc) {
  const banner = `
   ___       ___       ___       ___       ___       ___       ___
  /\\  \\     /\\__\\     /\\  \\     /\\  \\     /\\  \\     /\\  \\     /\\__\\
 /::\\  \\   /:/ _/_    \\:\\  \\   /::\\  \\   /::\\  \\   /::\\  \\   /:/ _/_
/::\\:\\__\\ /:/_/\\__\\   /::\\__\\ /:/\\:\\__\\ /:/\\:\\__\\ /::\\:\\__\\ |::L/\\__\\
\\/\\::/  / \\:\\/:/  /  /:/\\/__/ \\:\\/:/  / \\:\\/:/  / \\:\\:\\/  / |::::/  /
  /:/  /   \\::/  /   \\/__/     \\::/  /   \\::/  /   \\:\\/  /   L;;/__/
  \\/__/     \\/__/               \\/__/     \\/__/     \\/__/
`;
  console.log(`${c.cyan}${banner}${c.reset}`);
  console.log(`                    ${c.dim}--- by Sooatek ---${c.reset}`);
  console.log(`                       ${c.dim}v${pkg.version}${c.reset}`);
  console.log();
  const desc = projectDesc ? `  ${c.dim}(${projectDesc})${c.reset}` : "";
  console.log(`  ${c.bold}${c.green}Projet : ${projectKey}${c.reset}${desc}`);
  console.log();
}

// ─── Project selector ────────────────────────────────────────────────────────

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
    return projects[0];
  }

  return select({
    message: "Choisir un projet",
    choices: projects.map((p) => ({ name: p, value: p })),
  });
}

// ─── runAutodev helper ──────────────────────────────────────────────────────

function runAutodev(args) {
  console.log(`\n${c.dim}> node ${args.join(" ")}${c.reset}\n`);
  try {
    execFileSync("node", args, {
      stdio: "inherit",
      cwd: ROOT,
    });
  } catch (err) {
    if (err.killed) {
      console.error(`${c.red}Commande interrompue (timeout)${c.reset}`);
    } else {
      const code = err.status ?? err.code ?? "unknown";
      console.error(`${c.red}Commande terminee avec code ${code}${c.reset}`);
    }
  }
}

// ─── Sub-menu handlers ──────────────────────────────────────────────────────

async function handleTicket(config) {
  const mode = await select({
    message: "Mode d'execution",
    choices: [
      { name: "Ticket specifique", value: "specific" },
      { name: "Prochain disponible (--next)", value: "next" },
    ],
  });

  const args = ["bin/autodev.mjs", "--project", config.projectKey];

  if (mode === "specific") {
    const ticketKey = await input({
      message: "Cle du ticket (ex: HIVE-42)",
      validate: (val) => /^[A-Z]+-\d+$/.test(val) || "Format invalide (ex: HIVE-42)",
    });
    args.push(ticketKey);
  } else {
    args.push("--next");
  }

  const autoClose = await confirm({
    message: "Auto-close (merge + fermer) ?",
    default: false,
  });

  const dryRun = await confirm({
    message: "Dry-run ?",
    default: false,
  });

  if (autoClose) args.push("--auto-close");
  if (dryRun) args.push("--dry-run");

  if (mode === "next" && autoClose) {
    const workers = await number({
      message: "Workers paralleles (1-4)",
      default: 1,
      min: 1,
      max: 4,
      validate: (val) => (val !== undefined && val >= 1 && val <= 4) || "Entrer un nombre entre 1 et 4",
    });
    if ((workers ?? 1) > 1) {
      args.push("--parallel", String(workers));
    }
  }

  runAutodev(args);
}

async function handleRelease(config) {
  const mode = await select({
    message: "Version de release",
    choices: [
      { name: "Auto-detect (depuis le dernier tag git)", value: "auto" },
      { name: "Version manuelle", value: "manual" },
    ],
  });

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

  const dryRun = await confirm({
    message: "Dry-run ?",
    default: false,
  });

  if (dryRun) args.push("--dry-run");

  runAutodev(args);
}

async function handleSprint(config) {
  const action = await select({
    message: "Action sprint",
    choices: [
      { name: "Fermer le sprint actif", value: "close" },
      { name: "Velocite", value: "velocity" },
      { name: "Tickets stale", value: "stale" },
    ],
  });

  const args = ["bin/autodev.mjs", "--project", config.projectKey];

  if (action === "close") {
    const dryRun = await confirm({
      message: "Dry-run ?",
      default: false,
    });

    const recap = await confirm({
      message: "Generer recap ?",
      default: true,
    });

    args.push("--close-sprint");
    if (dryRun) args.push("--dry-run");
    if (!recap) args.push("--no-recap");
  } else if (action === "velocity") {
    args.push("--velocity");
  } else if (action === "stale") {
    const days = await number({
      message: "Seuil en jours",
      default: 7,
      min: 1,
      validate: (val) => (val !== undefined && val >= 1) || "Entrer un nombre >= 1",
    });
    args.push("--stale", "--days", String(days ?? 7));
  }

  runAutodev(args);
}

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
    args.push("--import");
    const dryRun = await confirm({ message: "Dry-run ?", default: false });
    if (dryRun) args.push("--dry-run");
  } else if (step !== "full") {
    args.push("--step", step);
  }

  runAutodev(args);
}

async function handleVerify(config) {
  const sprint = await input({
    message: "Sprint name (vide = tous)",
    default: "",
  });

  const args = ["bin/autodev.mjs", "--project", config.projectKey, "--verify"];
  if (sprint) args.push("--sprint", sprint);

  runAutodev(args);
}

async function handleExport(config) {
  const sprint = await input({
    message: "Sprint name (vide = tous)",
    default: "",
  });

  const args = ["bin/autodev.mjs", "--project", config.projectKey, "--export-done"];
  if (sprint) args.push("--sprint", sprint);

  runAutodev(args);
}

async function handleInit(config) {
  runAutodev(["bin/autodev.mjs", "--project", config.projectKey, "--init"]);
}

// ─── Action handler ─────────────────────────────────────────────────────────

async function handleAction(action, config) {
  try {
    switch (action) {
      case "ticket":  return await handleTicket(config);
      case "release": return await handleRelease(config);
      case "sprint":  return await handleSprint(config);
      case "planning": return await handlePlanning(config);
      case "verify":  return await handleVerify(config);
      case "export":  return await handleExport(config);
      case "init":    return await handleInit(config);
    }
  } catch (err) {
    if (err instanceof ExitPromptError) {
      console.log(`\n${c.dim}Annule.${c.reset}`);
      return;
    }
    throw err;
  }
}

// ─── Main menu ───────────────────────────────────────────────────────────────

async function mainMenu(projectKey, config) {
  while (true) {
    const action = await select({
      message: `${projectKey} >`,
      choices: [
        { name: "Executer un ticket", value: "ticket" },
        { name: "Release",            value: "release" },
        { name: "Sprint",             value: "sprint" },
        { name: "Planning",           value: "planning" },
        { name: "Verification",       value: "verify" },
        { name: "Export",             value: "export" },
        { name: "Init projet",        value: "init" },
        { name: "Changer de projet",  value: "switch" },
        { name: "Quitter",            value: "quit" },
      ],
    });

    if (action === "quit") {
      console.log(`\n${c.dim}A bientot !${c.reset}\n`);
      return "quit";
    }

    if (action === "switch") {
      return "switch";
    }

    await handleAction(action, config);
    console.log();
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function startInteractive() {
  try {
    while (true) {
      const projectKey = await selectProject();

      let config;
      try {
        config = loadConfig(projectKey);
      } catch (err) {
        console.error(`${c.red}${err.message}${c.reset}`);
        continue;
      }

      printBanner(projectKey, config.promptContext || "");

      const result = await mainMenu(projectKey, config);
      if (result === "quit") break;
      // "switch" → loop restarts with selectProject()
    }
  } catch (err) {
    if (err instanceof ExitPromptError) {
      console.log(`\n${c.dim}Bye!${c.reset}\n`);
      return;
    }
    throw err;
  }
}
