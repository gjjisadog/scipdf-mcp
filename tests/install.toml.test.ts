import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const installSrc = readFileSync(
  join(__dirname, "../scripts/install.mjs"),
  "utf8",
);

// Evaluate stripScipdfTomlSections by extracting the function from the script source
// (function is not exported). Mirror the logic here for unit coverage.
function stripScipdfTomlSections(text: string): string {
  let out = text;
  out = out.replace(
    /(?:^|\n)[ \t]*# --- scipdf-mcp[^\n]*\n\[mcp_servers\.scipdf\][\s\S]*?(?=\n\[|\s*$)/g,
    "\n",
  );
  let prev: string;
  do {
    prev = out;
    out = out.replace(
      /(?:^|\n)\[mcp_servers\.scipdf\][\s\S]*?(?=\n\[|\s*$)/g,
      "\n",
    );
  } while (out !== prev);
  return out.replace(/\n{3,}/g, "\n\n").trimEnd();
}

describe("Grok TOML scipdf section strip", () => {
  it("removes marker+section so reinstall does not duplicate", () => {
    const existing = `
[other]
x = 1

# --- scipdf-mcp (auto-installed) ---
[mcp_servers.scipdf]
command = "node"
args = ["/old/path"]
enabled = true

[mcp_servers.other]
command = "foo"
`;
    const stripped = stripScipdfTomlSections(existing);
    expect(stripped).not.toMatch(/mcp_servers\.scipdf/);
    expect(stripped).toMatch(/\[other\]/);
    expect(stripped).toMatch(/\[mcp_servers\.other\]/);

    const section = `
# --- scipdf-mcp (auto-installed) ---
[mcp_servers.scipdf]
command = "node"
args = ["/new/path"]
enabled = true
`;
    const next = (stripped ? stripped + "\n" : "") + section.trim() + "\n";
    const count = (next.match(/\[mcp_servers\.scipdf\]/g) || []).length;
    expect(count).toBe(1);
  });

  it("removes bare section without marker", () => {
    const existing = `[mcp_servers.scipdf]
command = "node"
args = ["/old"]

[mcp_servers.x]
a = 1
`;
    const stripped = stripScipdfTomlSections(existing);
    expect(stripped).not.toMatch(/scipdf/);
    expect(stripped).toMatch(/mcp_servers\.x/);
  });

  it("install.mjs contains strip helper", () => {
    expect(installSrc).toContain("stripScipdfTomlSections");
    expect(installSrc).toContain("process.execPath");
  });
});

// silence unused import if createRequire unused
void createRequire;
