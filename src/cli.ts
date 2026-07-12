import { loadConfig } from "./config.js";
import {
  downloadPaper,
  downloadPapers,
  resolveToDoi,
  extractQueriesFromText,
} from "./core/download.js";
import { checkMirror } from "./core/scihub.js";
import { listPaperFiles } from "./core/storage.js";
import { openPath } from "./core/open.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function version(): string {
  try {
    return (
      (JSON.parse(
        readFileSync(join(__dirname, "..", "package.json"), "utf8"),
      ) as { version: string }).version ?? "0.2.0"
    );
  } catch {
    return "0.2.0";
  }
}

function printHelp() {
  console.log(`scipdf-mcp ${version()}

Usage:
  scipdf-mcp                     Start MCP server (stdio)
  scipdf-mcp download <query>    Download one paper (DOI/title/URL)
  scipdf-mcp download --title "..." 
  scipdf-mcp download --force <doi>
  scipdf-mcp resolve <query>     Resolve DOI only
  scipdf-mcp batch <q1> <q2>...  Batch download
  scipdf-mcp parse <file|->      Extract DOIs from bib/ris/text file (or stdin)
  scipdf-mcp list                List downloaded PDFs
  scipdf-mcp check-mirrors       Probe mirrors
  scipdf-mcp open <path>         Open PDF in system viewer
  scipdf-mcp version

Env:
  SCIPDF_DOWNLOAD_DIR   Default ~/Documents/Papers
  SCIPDF_DEBUG=1        Verbose logs
  SCIPDF_FILENAME_STYLE doi | author_year_title
`);
}

export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.length === 0) {
    // MCP mode
    const { startMcpServer } = await import("./server.js");
    await startMcpServer();
    return 0;
  }

  const cmd = args[0];
  const rest = args.slice(1);
  const config = loadConfig();

  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
    return 0;
  }
  if (cmd === "version" || cmd === "-V" || cmd === "--version") {
    console.log(version());
    return 0;
  }

  if (cmd === "download") {
    let force = false;
    let queryType: "auto" | "title" | "doi" | "url" = "auto";
    const parts: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--force") force = true;
      else if (rest[i] === "--title") {
        queryType = "title";
        if (rest[i + 1]) parts.push(rest[++i]);
      } else if (rest[i] === "--doi") {
        queryType = "doi";
        if (rest[i + 1]) parts.push(rest[++i]);
      } else parts.push(rest[i]);
    }
    const query = parts.join(" ").trim();
    if (!query) {
      console.error("Usage: scipdf-mcp download <doi|title|url>");
      return 1;
    }
    const result = await downloadPaper(
      { query, queryType, force },
      config,
    );
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  if (cmd === "resolve") {
    const query = rest.join(" ").trim();
    if (!query) {
      console.error("Usage: scipdf-mcp resolve <query>");
      return 1;
    }
    const result = await resolveToDoi(query);
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  if (cmd === "batch") {
    if (rest.length === 0) {
      console.error("Usage: scipdf-mcp batch <q1> [q2...]");
      return 1;
    }
    const result = await downloadPapers(rest, config, { writeManifest: true });
    console.log(JSON.stringify(result, null, 2));
    return result.failed === 0 ? 0 : 1;
  }

  if (cmd === "parse") {
    const target = rest[0] ?? "-";
    let text: string;
    if (target === "-") {
      text = readFileSync(0, "utf8");
    } else {
      text = readFileSync(target, "utf8");
    }
    const queries = extractQueriesFromText(text);
    console.log(JSON.stringify({ count: queries.length, queries }, null, 2));
    return 0;
  }

  if (cmd === "list") {
    const files = await listPaperFiles(config.downloadDir, 100);
    console.log(
      JSON.stringify(
        { downloadDir: config.downloadDir, count: files.length, files },
        null,
        2,
      ),
    );
    return 0;
  }

  if (cmd === "check-mirrors") {
    const statuses = await Promise.all(
      config.scihubMirrors.map(async (url) => ({
        url,
        ...(await checkMirror(
          url,
          12_000,
          config.userAgent,
          0,
        )),
      })),
    );
    console.log(JSON.stringify({ mirrors: statuses }, null, 2));
    return 0;
  }

  if (cmd === "open") {
    const path = rest[0];
    if (!path) {
      console.error("Usage: scipdf-mcp open <path>");
      return 1;
    }
    const r = await openPath(path);
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  return 1;
}
