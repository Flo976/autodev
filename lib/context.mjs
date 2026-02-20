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

    // Copy templates — map template filename to target filename
    const templateMap = {
      "index.md": "index.md",
      "memory.md": "memory.md",
      "soul.md": "soul.md",
      "plan.md": "plan.md",
      "sprint.md": "sprint-current.md",
    };

    for (const [src, dest] of Object.entries(templateMap)) {
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
    // Check if file has real content beyond headings and placeholder comments
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
