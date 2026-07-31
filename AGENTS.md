# AGENTS.md — install & use scipdf-mcp

## One-step install

```bash
git clone https://github.com/gjjisadog/scipdf-mcp.git
cd scipdf-mcp
bash install.sh
```

Update later:

```bash
cd scipdf-mcp && bash install.sh --update
```

Requirements: **Node.js ≥ 20**.

## What install does

1. `npm install` + `npm run build`
2. Skill → `~/.grok/skills/scipdf` (+ `~/.codex` / Claude / agents)
3. MCP `scipdf` → Grok + Codex (`config.toml`) / Claude Desktop / Cursor
4. Self-test: `node dist/index.js version` (+ soft resolve check)
5. Download dir default `~/Documents/Papers`

## After install

1. Restart Grok / Codex / other AI clients.
2. `/scipdf` or ask to download by title/DOI.
3. CLI fallback: `node dist/index.js download 10.xxxx/yyyy`

## Workflow

```
user needs papers
  → resolve_doi / parse_references
  → download_paper(s)
  → report path + code on failure
```

On `DOI_NOT_FOUND`: use `candidates` or web → retry with explicit DOI.  
On `AMBIGUOUS_DOI`: ask user to pick.  
Never invent a local path.

## Sources (default)

Download order: optional Unpaywall OA → **pdfHosts** → **scihubMirrors**.

- pdfHosts: `https://sci.bban.top/pdf/`
- Mirrors: 15 built-in (ren/red/ee/st/ru/box/se, sidesgame, vg, usualwant, hkvisa, al, mksa.top, pismin, sci-hub.in) — see `src/config.ts` / README
- Override: `SCIPDF_MIRRORS`, `SCIPDF_PDF_HOSTS`, or `config.json`
- Probe: `node dist/index.js check-mirrors` or MCP `check_mirrors`

See `skills/scipdf/SKILL.md`.
