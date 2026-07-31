import { loadConfig } from "./config.js";
import {
  downloadPaper,
  downloadPapers,
  resolveToDoi,
  extractQueriesFromText,
} from "./core/download.js";
import {
  parseBatchArgs,
  parseDownloadArgs,
  parseRelationArgs,
  parseSearchArgs,
} from "./core/cliArgs.js";
import { searchPapers } from "./core/search.js";
import { discoverRelatedPapers } from "./core/discovery.js";
import { extractPaperText } from "./core/extract.js";
import { auditReferences } from "./core/audit.js";
import { checkMirror } from "./core/scihub.js";
import {
  flushHealth,
  healthFilePath,
  listHealth,
  sortByHealth,
} from "./core/health.js";
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
  scipdf-mcp search <query>      Search Crossref + OpenAlex + Semantic Scholar + arXiv
  scipdf-mcp citations <id>      Find papers citing a DOI/S2 paper ID
  scipdf-mcp references <id>     Find a paper's references
  scipdf-mcp related <id>        Find similar papers
  scipdf-mcp download <query>    Download one paper (DOI/title/URL)
  scipdf-mcp download --title "..." 
  scipdf-mcp download --arxiv 2501.01234
  scipdf-mcp download --force <doi>
  scipdf-mcp download --outdir ~/Papers <doi>
  scipdf-mcp resolve <query>     Resolve DOI only
  scipdf-mcp batch <q1> <q2>...  Batch download
  scipdf-mcp batch --outdir DIR --force <q1> <q2>
  scipdf-mcp parse <file|->      Extract DOIs from bib/ris/text file (or stdin)
  scipdf-mcp extract <pdf>       Extract a downloaded PDF to a sibling .txt
  scipdf-mcp audit <file|->      Verify and normalize a reference list
  scipdf-mcp list                List downloaded PDFs
  scipdf-mcp check-mirrors       Probe mirrors (+ pdfHosts), persist health rank
  scipdf-mcp unpaywall <doi>     Lookup Unpaywall OA (needs email)
  scipdf-mcp open <path>         Open a valid PDF from the configured download directory
  scipdf-mcp version

Download flags:
  --force / -f           Re-download even if cached
  --outdir / -o <dir>    Output directory
  --filename <name>      Output filename
  --title | --doi | --arxiv | --url <q>   Force query type
  --query / -q <q>       Explicit query token

Search flags:
  --source <name>        crossref | openalex | semanticscholar | arxiv
  --sources <a,b>        Comma-separated source list
  --limit / -n <count>   Result limit (default 20, max 50)
  --year-from <year>     Minimum publication year
  --year-to <year>       Maximum publication year
  --min-citations <n>    Minimum known citation count
  --open-access / --oa   Only results known to have an OA copy

Env:
  SCIPDF_DOWNLOAD_DIR      Default ~/Documents/Papers
  SCIPDF_UNPAYWALL_EMAIL   Optional real email (Unpaywall API)
  SCIPDF_PREFER_OA         true → OA-first (Unpaywall + free OA APIs), then Sci-Hub
  SCIPDF_ALLOW_SCIHUB      true/false, default true (main path)
  SCIPDF_RACE_WIDTH        Parallel source probes (default 5)
  SCIPDF_NOT_FOUND_CONFIRM Early-stop confirmations (default 1)
  SCIPDF_HEALTH_FILE       Override health cache path
  SCIPDF_HEALTH_PERSIST=0  Disable health disk cache
  SCIPDF_DEBUG=1           Verbose logs
  SCIPDF_FILENAME_STYLE    doi | author_year_title
`);
}

export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.length === 0) {
    const { startMcpServer } = await import("./server.js");
    await startMcpServer();
    return 0;
  }

  const cmd = args[0];
  const rest = args.slice(1);
  try {
    // Keep discovery commands usable when an explicit config file is broken.
    if (cmd === "help" || cmd === "-h" || cmd === "--help") {
      printHelp();
      return 0;
    }
    if (cmd === "version" || cmd === "-V" || cmd === "--version") {
      console.log(version());
      return 0;
    }

    const config = loadConfig();

  if (cmd === "search") {
    let parsed;
    try {
      parsed = parseSearchArgs(rest);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      console.error(
        "Usage: scipdf-mcp search [--sources openalex,semanticscholar] [filters] <query>",
      );
      return 1;
    }
    if (!parsed.query) {
      console.error(
        "Usage: scipdf-mcp search [--sources openalex,semanticscholar] [filters] <query>",
      );
      return 1;
    }
    const result = await searchPapers(parsed.query, config, {
      sources: parsed.sources,
      limit: parsed.limit,
      yearFrom: parsed.yearFrom,
      yearTo: parsed.yearTo,
      minCitations: parsed.minCitations,
      openAccessOnly: parsed.openAccessOnly,
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return 0;
  }

  if (
    cmd === "citations" ||
    cmd === "references" ||
    cmd === "related"
  ) {
    let parsed;
    try {
      parsed = parseRelationArgs(rest);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
    if (!parsed.paperId) {
      console.error(`Usage: scipdf-mcp ${cmd} [--limit N] <doi|paper-id>`);
      return 1;
    }
    const result = await discoverRelatedPapers(
      parsed.paperId,
      cmd,
      config,
      parsed.limit,
    );
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return 0;
  }

  if (cmd === "download") {
    let parsed;
    try {
      parsed = parseDownloadArgs(rest);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      console.error(
        "Usage: scipdf-mcp download [--force] [--outdir DIR] <doi|title|url>",
      );
      return 1;
    }
    if (!parsed.query) {
      console.error(
        "Usage: scipdf-mcp download [--force] [--outdir DIR] <doi|title|url>",
      );
      return 1;
    }
    const result = await downloadPaper(
      {
        query: parsed.query,
        queryType: parsed.queryType,
        force: parsed.force,
        outdir: parsed.outdir,
        filename: parsed.filename,
      },
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
    const result = await resolveToDoi(query, "auto", config.timeoutMs);
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  if (cmd === "batch") {
    let parsed;
    try {
      parsed = parseBatchArgs(rest);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
    if (parsed.queries.length === 0) {
      console.error(
        "Usage: scipdf-mcp batch [--force] [--outdir DIR] <q1> [q2...]",
      );
      return 1;
    }
    const result = await downloadPapers(parsed.queries, config, {
      writeManifest: true,
      force: parsed.force,
      outdir: parsed.outdir,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.total === 0) return 1;
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

  if (cmd === "extract") {
    const path = rest.find((token) => !token.startsWith("-"));
    if (!path) {
      console.error("Usage: scipdf-mcp extract <absolute-pdf-path>");
      return 1;
    }
    const result = await extractPaperText(path, config.downloadDir);
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  if (cmd === "audit") {
    const target = rest[0] ?? "-";
    const text =
      target === "-" ? readFileSync(0, "utf8") : readFileSync(target, "utf8");
    const result = await auditReferences(
      text,
      Math.min(config.timeoutMs, 20_000),
      Math.min(config.concurrency, 4),
    );
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return result.failed === 0 ? 0 : 1;
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
    const forceRefresh = rest.includes("--force") || rest.includes("-f");
    const ttl = forceRefresh ? 0 : config.healthCacheTtlMs;

    const probe = async (url: string) => ({
      url,
      ...(await checkMirror(url, 12_000, config.userAgent, ttl)),
    });

    const [mirrorStatuses, hostStatuses] = await Promise.all([
      Promise.all(config.scihubMirrors.map(probe)),
      Promise.all((config.pdfHosts ?? []).map(probe)),
    ]);

    // Persist ranking snapshot
    flushHealth();

    const recommendedMirrors = sortByHealth(
      config.scihubMirrors,
      config.healthCacheTtlMs,
    );
    const recommendedHosts = sortByHealth(
      config.pdfHosts ?? [],
      config.healthCacheTtlMs,
    );
    const demoted = listHealth(config.healthCacheTtlMs).filter(
      (h) => !h.ok && (h.failStreak ?? 0) >= 2,
    );

    console.log(
      JSON.stringify(
        {
          mirrors: mirrorStatuses,
          pdfHosts: hostStatuses,
          recommendedOrder: {
            pdfHosts: recommendedHosts,
            scihubMirrors: recommendedMirrors,
          },
          demoted: demoted.map((d) => ({
            url: d.url,
            failStreak: d.failStreak,
            error: d.error,
            latencyMs: d.latencyMs,
          })),
          healthFile:
            process.env.SCIPDF_HEALTH_PERSIST === "0"
              ? null
              : healthFilePath(),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (cmd === "unpaywall") {
    const doi = rest.join(" ").trim();
    if (!doi) {
      console.error("Usage: scipdf-mcp unpaywall <doi>");
      console.error("Requires SCIPDF_UNPAYWALL_EMAIL=you@example.com");
      return 1;
    }
    const { lookupUnpaywall, hasUnpaywallEmail } = await import(
      "./core/unpaywall.js"
    );
    if (!hasUnpaywallEmail(config)) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            error:
              "Set SCIPDF_UNPAYWALL_EMAIL to a real email you own (Unpaywall API requirement).",
          },
          null,
          2,
        ),
      );
      return 1;
    }
    const meta = await lookupUnpaywall(doi, config);
    console.log(JSON.stringify({ ok: Boolean(meta), ...meta }, null, 2));
    return meta ? 0 : 1;
  }

  if (cmd === "open") {
    const path = rest[0];
    if (!path) {
      console.error("Usage: scipdf-mcp open <path>");
      return 1;
    }
    const r = await openPath(path, config.downloadDir);
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  return 1;
  } finally {
    // The deferred cache write uses an unref'ed timer. CLI startup exits before
    // it fires, so persist synchronously once the command has finished.
    flushHealth();
  }
}
