import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, reloadConfig } from "./config.js";
import {
  downloadPaper,
  downloadPapers,
  resolveToDoi,
  extractQueriesFromText,
} from "./core/download.js";
import { checkMirror } from "./core/scihub.js";
import { listPaperFiles } from "./core/storage.js";
import { openPath } from "./core/open.js";
import { buildCitations } from "./core/citeFormat.js";
import {
  hasUnpaywallEmail,
  lookupUnpaywall,
  maskEmail,
} from "./core/unpaywall.js";
import type { QueryType, SciPdfConfig } from "./types.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.2.0";
  } catch {
    return "0.2.0";
  }
}

let config: SciPdfConfig = loadConfig();

function refreshConfig() {
  config = reloadConfig();
  return config;
}

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

const queryTypeSchema = z
  .enum(["auto", "doi", "url", "title", "citation"])
  .optional()
  .describe(
    "How to interpret query: auto (default), doi, url, title, or citation",
  );

export function createServer(): McpServer {
  const version = packageVersion();
  const server = new McpServer({
    name: "scipdf-mcp",
    version,
  });

  server.tool(
    "download_paper",
    "Download an academic paper PDF by DOI, title, URL, or citation. Default: Sci-Hub/pdfHosts. Optional Unpaywall OA only if SCIPDF_UNPAYWALL_EMAIL is set AND SCIPDF_PREFER_OA=true. Returns path, source (scihub|unpaywall|cache), citations. Use force=true to re-download.",
    {

      query: z
        .string()
        .describe("DOI (10.xxxx/...), title, publisher URL, or citation string"),
      query_type: queryTypeSchema,
      outdir: z.string().optional().describe("Override download directory"),
      filename: z.string().optional().describe("Override output filename"),
      force: z
        .boolean()
        .optional()
        .describe("Re-download even if file exists (default false)"),
      with_citation: z
        .boolean()
        .optional()
        .describe("Include APA/GB/T/BibTeX (default true)"),
    },
    async ({ query, query_type, outdir, filename, force, with_citation }) => {
      refreshConfig();
      const result = await downloadPaper(
        {
          query,
          queryType: (query_type as QueryType | undefined) ?? "auto",
          outdir,
          filename,
          force: force ?? false,
          withCitation: with_citation ?? true,
        },
        config,
      );
      return jsonResult(result);
    },
  );

  server.tool(
    "download_papers",
    "Batch-download papers. Accepts list of DOIs/titles/URLs, or a single bib/ris/pasted bibliography blob. Dedupes DOIs, writes scipdf-manifest.json, returns indexed results.",
    {
      queries: z
        .array(z.string())
        .min(1)
        .describe("List of DOIs, titles, URLs, or one multi-line bib/ris text"),
      query_type: queryTypeSchema,
      outdir: z.string().optional(),
      force: z.boolean().optional(),
      write_manifest: z
        .boolean()
        .optional()
        .describe("Write scipdf-manifest.json (default true)"),
    },
    async ({ queries, query_type, outdir, force, write_manifest }) => {
      refreshConfig();
      const result = await downloadPapers(queries, config, {
        queryType: (query_type as QueryType | undefined) ?? "auto",
        outdir,
        force: force ?? false,
        writeManifest: write_manifest ?? true,
        expandText: true,
      });
      return jsonResult(result);
    },
  );

  server.tool(
    "resolve_doi",
    "Resolve title/URL/citation to DOI via Crossref + OpenAlex. Returns candidates when ambiguous (code AMBIGUOUS_DOI).",
    {
      query: z.string().describe("Title, URL, citation, or DOI"),
      query_type: queryTypeSchema,
    },
    async ({ query, query_type }) => {
      refreshConfig();
      const resolved = await resolveToDoi(
        query,
        (query_type as QueryType | undefined) ?? "auto",
        Math.min(config.timeoutMs, 20_000),
      );
      return jsonResult(resolved);
    },
  );

  server.tool(
    "parse_references",
    "Extract DOIs/queries from BibTeX, RIS, or pasted reference list text.",
    {
      text: z.string().describe("Bibliography text (bib/ris/plain)"),
    },
    async ({ text }) => {
      const queries = extractQueriesFromText(text);
      return jsonResult({ count: queries.length, queries });
    },
  );

  server.tool(
    "list_mirrors",
    "List configured Sci-Hub mirrors, PDF hosts, Unpaywall status, and settings (hot-reloads config).",
    {},
    async () => {
      refreshConfig();
      return jsonResult({
        version,
        mirrors: config.scihubMirrors,
        pdfHosts: config.pdfHosts,
        downloadDir: config.downloadDir,
        filenameStyle: config.filenameStyle,
        timeoutMs: config.timeoutMs,
        concurrency: config.concurrency,
        healthCacheTtlMs: config.healthCacheTtlMs,
        unpaywall: {
          configured: hasUnpaywallEmail(config),
          email: config.unpaywallEmail
            ? maskEmail(config.unpaywallEmail)
            : null,
          preferOa: config.preferOa,
          allowScihub: config.allowScihub,
          active: hasUnpaywallEmail(config) && config.preferOa,
          hint:
            hasUnpaywallEmail(config) && config.preferOa
              ? "OA-first, then Sci-Hub"
              : "Default is Sci-Hub. Optional OA: set SCIPDF_UNPAYWALL_EMAIL + SCIPDF_PREFER_OA=true",
        },
      });
    },
  );

  server.tool(
    "lookup_unpaywall",
    "Query Unpaywall for Open Access status and PDF URL (does not download). Requires SCIPDF_UNPAYWALL_EMAIL.",
    {
      doi: z.string().describe("DOI e.g. 10.1038/nature12373"),
    },
    async ({ doi }) => {
      refreshConfig();
      if (!hasUnpaywallEmail(config)) {
        return jsonResult({
          ok: false,
          error:
            "Unpaywall email not configured. Set env SCIPDF_UNPAYWALL_EMAIL or config.json unpaywallEmail to a real email you own (required by Unpaywall API).",
        });
      }
      const meta = await lookupUnpaywall(doi, config);
      if (!meta) {
        return jsonResult({
          ok: false,
          error: "Unpaywall request failed or returned nothing",
          doi,
        });
      }
      return jsonResult({ ok: true, ...meta });
    },
  );

  server.tool(
    "check_mirrors",
    "Probe Sci-Hub mirrors for availability (uses health cache; force_refresh ignores cache).",
    {
      urls: z.array(z.string()).optional(),
      force_refresh: z.boolean().optional(),
    },
    async ({ urls, force_refresh }) => {
      refreshConfig();
      const list = urls?.length ? urls : config.scihubMirrors;
      const ttl = force_refresh ? 0 : config.healthCacheTtlMs;
      const statuses = await Promise.all(
        list.map(async (url) => {
          const r = await checkMirror(
            url,
            Math.min(config.timeoutMs, 12_000),
            config.userAgent,
            ttl,
          );
          return { url, ...r };
        }),
      );
      return jsonResult({ mirrors: statuses });
    },
  );

  server.tool(
    "list_papers",
    "List PDF files already in the download directory (most recent first).",
    {
      limit: z.number().optional().describe("Max files (default 50)"),
      outdir: z.string().optional(),
    },
    async ({ limit, outdir }) => {
      refreshConfig();
      const dir = outdir ?? config.downloadDir;
      const files = await listPaperFiles(dir, limit ?? 50);
      return jsonResult({ downloadDir: dir, count: files.length, files });
    },
  );

  server.tool(
    "open_paper",
    "Open a local PDF path with the system default viewer (macOS open / Windows start / xdg-open).",
    {
      path: z.string().describe("Absolute path to a local PDF"),
    },
    async ({ path }) => {
      const r = await openPath(path);
      return jsonResult(r);
    },
  );

  server.tool(
    "format_citation",
    "Format APA / GB/T 7714 / BibTeX from DOI (fetches Crossref metadata).",
    {
      doi: z.string().describe("DOI"),
    },
    async ({ doi }) => {
      refreshConfig();
      const r = await resolveToDoi(doi, "doi");
      if (!r.ok || !r.doi) return jsonResult(r);
      return jsonResult({
        ok: true,
        doi: r.doi,
        title: r.title,
        citation: buildCitations({
          doi: r.doi,
          title: r.title,
          authors: r.authors,
          year: r.year,
          container: r.container,
        }),
      });
    },
  );

  server.tool(
    "reload_config",
    "Hot-reload scipdf config from environment variables and config.json without restarting the process.",
    {},
    async () => {
      const c = refreshConfig();
      return jsonResult({ ok: true, config: c });
    },
  );

  // Resource: recent papers
  server.resource(
    "papers-list",
    "papers://list",
    { description: "Recently downloaded PDFs in the configured download directory" },
    async (uri) => {
      refreshConfig();
      const files = await listPaperFiles(config.downloadDir, 100);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              { downloadDir: config.downloadDir, files },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.prompt(
    "download_papers_batch",
    {
      papers: z
        .string()
        .describe("Paper list: DOIs, titles, or pasted bibliography"),
    },
    ({ papers }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Use the scipdf MCP tools to download these papers.\n` +
              `1) parse_references or resolve_doi as needed\n` +
              `2) download_papers\n` +
              `3) Report a table of DOI + local path for successes and code/error for failures.\n\n` +
              `Papers:\n${papers}`,
          },
        },
      ],
    }),
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
