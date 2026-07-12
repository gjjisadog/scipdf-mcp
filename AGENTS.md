# AGENTS.md — install scipdf-mcp for the user

You are installing **scipdf-mcp**: a local MCP server + skill that downloads academic paper PDFs by DOI/title and returns a local file path.

## One-step install (run this)

```bash
git clone https://github.com/gjjisadog/scipdf-mcp.git
cd scipdf-mcp
bash install.sh
```

Optional download directory:

```bash
SCIPDF_DOWNLOAD_DIR="$HOME/Documents/Papers" bash install.sh
```

Requirements: **Node.js ≥ 20**, npm, network.

## What the installer does

1. `npm install` + `npm run build`
2. Installs skill to:
   - `~/.grok/skills/scipdf/SKILL.md`
   - `~/.claude/skills/scipdf/SKILL.md`
   - `~/.agents/skills/scipdf/SKILL.md`
3. Registers MCP server `scipdf`:
   - Grok: `~/.grok/config.toml` → `[mcp_servers.scipdf]`
   - Claude Desktop: `claude_desktop_config.json`
   - Cursor: `~/.cursor/mcp.json`
4. Creates default download dir `~/Documents/Papers` (or `SCIPDF_DOWNLOAD_DIR`)

## After install — tell the user

1. Restart the AI client (Grok / Claude / Cursor).
2. Try: `/scipdf 下载 DOI 10.1038/nature12373` or paste a paper title.
3. Success means a local path like `~/Documents/Papers/10.xxxx_yyyy.pdf`.

## Do not

- Do not reimplement Sci-Hub download with curl/browser if MCP is available.
- Do not skip `bash install.sh` and only copy files without build.
- Do not claim success without a real `path` from `download_paper`.

## Verify

```bash
node dist/index.js &  # should start MCP on stdio (Ctrl+C to stop)
test -f ~/.grok/skills/scipdf/SKILL.md && echo skill_ok
grep -q 'mcp_servers.scipdf' ~/.grok/config.toml && echo grok_mcp_ok
```

## Workflow (after install)

```
user asks for papers
  → resolve DOI (title/URL/DOI)
  → MCP download_paper / download_papers
  → report local path
```

See `skills/scipdf/SKILL.md` for the full agent skill.
