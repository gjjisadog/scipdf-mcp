#!/usr/bin/env node
/**
 * One-step installer for scipdf-mcp:
 *  - npm install + build
 *  - install Grok / Claude skill
 *  - register MCP server (Grok / Claude Desktop / Cursor when possible)
 *
 * Usage:
 *   node scripts/install.mjs
 *   npm run install:all
 *   bash -c "$(curl -fsSL raw...)"  # via install.sh wrapper
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const HOME = homedir();

const DOWNLOAD_DIR =
  process.env.SCIPDF_DOWNLOAD_DIR || join(HOME, "Documents", "Papers");
const UNPAYWALL_EMAIL = (process.env.SCIPDF_UNPAYWALL_EMAIL || "").trim();

function log(msg) {
  console.log(`\x1b[36m[scipdf]\x1b[0m ${msg}`);
}
function ok(msg) {
  console.log(`\x1b[32m[scipdf]\x1b[0m ${msg}`);
}
function warn(msg) {
  console.log(`\x1b[33m[scipdf]\x1b[0m ${msg}`);
}
function fail(msg) {
  console.error(`\x1b[31m[scipdf]\x1b[0m ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) {
    fail(`Command failed: ${cmd} ${args.join(" ")}`);
  }
}

function which(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
  });
  return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
}

function ensureNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    fail(`Node.js >= 20 required (found ${process.versions.node})`);
  }
  ok(`Node.js ${process.versions.node}`);
}

function build() {
  log("Installing dependencies…");
  run("npm", ["install"]);
  log("Building TypeScript…");
  run("npm", ["run", "build"]);
  const entry = join(ROOT, "dist", "index.js");
  if (!existsSync(entry)) fail("Build failed: dist/index.js missing");
  try {
    chmodSync(entry, 0o755);
  } catch {
    /* ignore */
  }
  ok(`Built ${entry}`);
  return entry;
}

function installSkill() {
  const src = join(ROOT, "skills", "scipdf", "SKILL.md");
  if (!existsSync(src)) {
    warn("skills/scipdf/SKILL.md not found, skip skill install");
    return;
  }

  const targets = [
    join(HOME, ".grok", "skills", "scipdf", "SKILL.md"),
    join(HOME, ".claude", "skills", "scipdf", "SKILL.md"),
    join(HOME, ".agents", "skills", "scipdf", "SKILL.md"),
  ];

  for (const dest of targets) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    ok(`Skill installed → ${dest}`);
  }
}

function mcpServerBlock(entry) {
  const env = {
    SCIPDF_DOWNLOAD_DIR: DOWNLOAD_DIR,
  };
  if (UNPAYWALL_EMAIL) {
    env.SCIPDF_UNPAYWALL_EMAIL = UNPAYWALL_EMAIL;
  }
  return {
    command: "node",
    args: [entry],
    env,
  };
}

function mergeJsonFile(path, mutator) {
  let data = {};
  if (existsSync(path)) {
    try {
      data = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      warn(`Could not parse ${path}, creating backup and rewriting`);
      try {
        copyFileSync(path, `${path}.bak`);
      } catch {
        /* ignore */
      }
      data = {};
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  mutator(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  ok(`Updated ${path}`);
}

function registerClaudeAndCursor(entry) {
  const block = mcpServerBlock(entry);

  // Claude Desktop
  const claudePaths = [
    join(
      HOME,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    ),
    join(HOME, ".config", "Claude", "claude_desktop_config.json"),
    join(HOME, "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
  ];
  for (const p of claudePaths) {
    if (existsSync(dirname(p)) || process.platform === "darwin") {
      // Only write if parent exists OR macOS default path
      if (existsSync(dirname(p)) || p.includes("Application Support")) {
        try {
          mkdirSync(dirname(p), { recursive: true });
          mergeJsonFile(p, (data) => {
            data.mcpServers = data.mcpServers || {};
            data.mcpServers.scipdf = block;
          });
        } catch (e) {
          warn(`Claude config skip (${p}): ${e.message}`);
        }
        break;
      }
    }
  }

  // Cursor
  const cursorPath = join(HOME, ".cursor", "mcp.json");
  try {
    mergeJsonFile(cursorPath, (data) => {
      data.mcpServers = data.mcpServers || {};
      data.mcpServers.scipdf = block;
    });
  } catch (e) {
    warn(`Cursor config skip: ${e.message}`);
  }
}

function registerGrokToml(entry) {
  const configPath = join(HOME, ".grok", "config.toml");
  mkdirSync(dirname(configPath), { recursive: true });

  const envToml = UNPAYWALL_EMAIL
    ? `env = { SCIPDF_DOWNLOAD_DIR = ${JSON.stringify(DOWNLOAD_DIR)}, SCIPDF_UNPAYWALL_EMAIL = ${JSON.stringify(UNPAYWALL_EMAIL)} }`
    : `env = { SCIPDF_DOWNLOAD_DIR = ${JSON.stringify(DOWNLOAD_DIR)} }`;

  const section = `
# --- scipdf-mcp (auto-installed) ---
[mcp_servers.scipdf]
command = "node"
args = [${JSON.stringify(entry)}]
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 120
${envToml}
`;

  let text = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";

  if (/\[mcp_servers\.scipdf\]/.test(text)) {
    // Replace existing section roughly
    text = text.replace(
      /# --- scipdf-mcp[\s\S]*?(?=\n\[|\n*$)/,
      section.trim() + "\n",
    );
    // If marker missing but section exists, replace from [mcp_servers.scipdf] until next [
    if (!text.includes("scipdf-mcp (auto-installed)")) {
      text = text.replace(
        /\[mcp_servers\.scipdf\][\s\S]*?(?=\n\[|\n*$)/,
        section.trim() + "\n",
      );
    }
    writeFileSync(configPath, text.endsWith("\n") ? text : text + "\n");
    ok(`Updated Grok MCP in ${configPath}`);
    return;
  }

  writeFileSync(
    configPath,
    (text.trimEnd() ? text.trimEnd() + "\n" : "") + section,
  );
  ok(`Registered Grok MCP in ${configPath}`);
}

function tryGrokCli(entry) {
  const grok = which("grok");
  if (!grok) {
    warn("grok CLI not found; wrote config.toml directly if possible");
    return false;
  }
  // Prefer direct toml write for env support; CLI may not support env flags uniformly
  log(`Found grok CLI at ${grok}`);
  return true;
}

function ensureDownloadDir() {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  ok(`Download directory: ${DOWNLOAD_DIR}`);
}

function selfTest(entry) {
  if (process.env.SCIPDF_SELFTEST === "0") {
    warn("Skipping self-test (SCIPDF_SELFTEST=0)");
    return;
  }
  log("Running self-test…");
  const r = spawnSync("node", [entry, "version"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  if (r.status !== 0) {
    fail(`Self-test failed: node dist/index.js version\n${r.stderr || r.stdout}`);
  }
  ok(`CLI version: ${(r.stdout || "").trim()}`);

  // resolve a known DOI (network) — soft fail
  const r2 = spawnSync(
    "node",
    [entry, "resolve", "10.1038/nature12373"],
    { encoding: "utf8", cwd: ROOT, timeout: 25000 },
  );
  if (r2.status === 0 && /"ok":\s*true/.test(r2.stdout || "")) {
    ok("resolve DOI self-test passed");
  } else {
    warn("resolve DOI self-test skipped/failed (network?) — install still OK");
  }
}

function printSummary(entry) {
  let ver = "?";
  try {
    ver = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  } catch {
    /* ignore */
  }
  console.log(`
\x1b[1mscipdf-mcp v${ver} installed\x1b[0m

  Entry:     ${entry}
  Papers:    ${DOWNLOAD_DIR}
  Unpaywall: ${UNPAYWALL_EMAIL ? "email set (still Sci-Hub default; OA needs SCIPDF_PREFER_OA=true)" : "optional — default is Sci-Hub only"}
  Skill:     ~/.grok/skills/scipdf  (also ~/.claude / ~/.agents)
  MCP name:  scipdf
  CLI:       node ${entry} download <doi|title>

\x1b[1mNext steps\x1b[0m
  1. Restart Grok / Claude / Cursor so MCP reloads
  2. In chat:  /scipdf  download paper: <title or DOI>
  3. CLI:      node dist/index.js download 10.xxxx/yyyy

\x1b[1mUpdate later\x1b[0m
  cd ${ROOT} && bash install.sh --update

\x1b[1mFor AI agents\x1b[0m
  git clone https://github.com/gjjisadog/scipdf-mcp.git
  cd scipdf-mcp && bash install.sh
`);
}

function main() {
  console.log("\n=== scipdf-mcp one-step installer ===\n");
  ensureNode();
  const entry = build();
  ensureDownloadDir();
  installSkill();
  tryGrokCli(entry);
  registerGrokToml(entry);
  registerClaudeAndCursor(entry);
  selfTest(entry);
  printSummary(entry);
}

main();
