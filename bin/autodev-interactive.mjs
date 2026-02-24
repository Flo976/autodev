#!/usr/bin/env node
/**
 * autodev-interactive.mjs — Interactive CLI for AUTODEV by Sooatek.
 *
 * Launched when `autodev` is called with no arguments.
 * Provides menu-driven access to all autodev features.
 */

import { readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { select } from "@inquirer/prompts";
import { loadConfig } from "../lib/config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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
  console.log(`  ${c.dim}--- by Sooatek ---${c.reset}`);
  console.log(`  ${c.dim}v0.1.0${c.reset}`);
  console.log();
  const desc = projectDesc ? `  ${c.dim}${projectDesc}${c.reset}` : "";
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

  const choice = await select({
    message: "Choisir un projet",
    choices: projects.map((p) => ({ name: p, value: p })),
  });

  return choice;
}

// ─── Action handler (stub) ───────────────────────────────────────────────────

async function handleAction(action, config) {
  console.log(`${c.dim}[${action}] — pas encore implemente${c.reset}`);
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
      return { quit: true };
    }

    if (action === "switch") {
      return { quit: false, switchProject: true };
    }

    await handleAction(action, config);
    console.log();
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function startInteractive() {
  let quit = false;

  while (!quit) {
    const projectKey = await selectProject();
    const config = loadConfig(projectKey);
    const projectDesc = config.promptContext || "";

    printBanner(projectKey, projectDesc);

    const result = await mainMenu(projectKey, config);

    if (result.quit) {
      quit = true;
    }
    // If switchProject, the while loop restarts with selectProject()
  }
}
