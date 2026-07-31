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
  cpSync,
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
  const parts = process.versions.node.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  // Cheerio/Undici need >=20.18.1
  const okVer =
    major > 20 ||
    (major === 20 && minor > 18) ||
    (major === 20 && minor === 18 && patch >= 1);
  if (!okVer) {
    fail(`Node.js >= 20.18.1 required (found ${process.versions.node})`);
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
  const src = join(ROOT, "skills", "scipdf");
  if (!existsSync(join(src, "SKILL.md"))) {
    warn("skills/scipdf/SKILL.md not found, skip skill install");
    return;
  }

  const targets = [
    join(HOME, ".grok", "skills", "scipdf"),
    join(HOME, ".claude", "skills", "scipdf"),
    join(HOME, ".agents", "skills", "scipdf"),
    // Codex CLI / app skills root
    join(HOME, ".codex", "skills", "scipdf"),
  ];

  // Project-local Grok skill (this repo) so /scipdf works in-workspace
  const projectSkill = join(ROOT, ".grok", "skills", "scipdf");
  targets.push(projectSkill);

  for (const dest of targets) {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    ok(`Skill installed → ${dest}`);
  }
}

/** Absolute path to the current Node binary (GUI clients often lack PATH). */
function nodeCommand() {
  return process.execPath || "node";
}

function mcpServerBlock(entry) {
  const env = {
    SCIPDF_DOWNLOAD_DIR: DOWNLOAD_DIR,
  };
  if (UNPAYWALL_EMAIL) {
    env.SCIPDF_UNPAYWALL_EMAIL = UNPAYWALL_EMAIL;
  }
  return {
    command: nodeCommand(),
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

/**
 * Remove every existing scipdf MCP section from Grok config.toml.
 * Previous regex stopped at the first `\n[` after the comment marker, which
 * left the old `[mcp_servers.scipdf]` block and produced duplicate keys
 * (invalid TOML / unparseable config on reinstall or --update).
 */
function stripScipdfTomlSections(text) {
  let out = text;
  // Marker + table (comment may be multi-line header)
  out = out.replace(
    /(?:^|\n)[ \t]*# --- scipdf-mcp[^\n]*\n\[mcp_servers\.scipdf\][\s\S]*?(?=\n\[|\s*$)/g,
    "\n",
  );
  // Bare table without marker (repeat until gone)
  let prev;
  do {
    prev = out;
    out = out.replace(
      /(?:^|\n)\[mcp_servers\.scipdf\][\s\S]*?(?=\n\[|\s*$)/g,
      "\n",
    );
  } while (out !== prev);
  return out.replace(/\n{3,}/g, "\n\n").trimEnd();
}

function scipdfTomlSection(entry) {
  const envToml = UNPAYWALL_EMAIL
    ? `env = { SCIPDF_DOWNLOAD_DIR = ${JSON.stringify(DOWNLOAD_DIR)}, SCIPDF_UNPAYWALL_EMAIL = ${JSON.stringify(UNPAYWALL_EMAIL)} }`
    : `env = { SCIPDF_DOWNLOAD_DIR = ${JSON.stringify(DOWNLOAD_DIR)} }`;

  return `
# --- scipdf-mcp (auto-installed) ---
[mcp_servers.scipdf]
command = ${JSON.stringify(nodeCommand())}
args = [${JSON.stringify(entry)}]
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 120
${envToml}
`;
}

function registerTomlMcp(configPath, entry, label) {
  mkdirSync(dirname(configPath), { recursive: true });
  let text = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  text = stripScipdfTomlSections(text);
  writeFileSync(
    configPath,
    (text ? text + "\n" : "") + scipdfTomlSection(entry).trim() + "\n",
  );
  ok(`Registered ${label} MCP in ${configPath}`);
}

function registerGrokToml(entry) {
  registerTomlMcp(join(HOME, ".grok", "config.toml"), entry, "Grok");
}

/** Codex CLI / ChatGPT desktop — same mcp_servers.* TOML shape as Grok. */
function registerCodexToml(entry) {
  registerTomlMcp(join(HOME, ".codex", "config.toml"), entry, "Codex");
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
  const r = spawnSync(nodeCommand(), [entry, "version"], {
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
  Skill:     ~/.grok/skills/scipdf  (+ ~/.codex / ~/.claude / ~/.agents)
  MCP name:  scipdf  (Grok + Codex config.toml, Claude/Cursor JSON)
  CLI:       node ${entry} download <doi|title>

\x1b[1mNext steps\x1b[0m
  1. Restart Grok / Codex / Claude / Cursor so MCP reloads
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
  registerCodexToml(entry);
  registerClaudeAndCursor(entry);
  selfTest(entry);
  printSummary(entry);
}

main();
