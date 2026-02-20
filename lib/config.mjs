import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export function loadConfig(projectKey) {
  // Load .env - try multiple locations
  const envPaths = [
    join(ROOT, ".env"),
    join(ROOT, "..", ".env"),
    join(ROOT, "..", "..", ".env"),
  ];
  for (const p of envPaths) {
    dotenvConfig({ path: p });
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

export function projectKeyFromTicket(ticketKey) {
  const m = ticketKey.match(/^([A-Z]+)-\d+$/);
  if (!m) throw new Error(`Invalid ticket key format: ${ticketKey}`);
  return m[1];
}
