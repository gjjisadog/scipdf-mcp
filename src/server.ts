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
import { listPaperSources, searchPapers } from "./core/search.js";
import { discoverRelatedPapers } from "./core/discovery.js";
import { extractPaperText } from "./core/extract.js";
import { auditReferences } from "./core/audit.js";
import { listPdfSources } from "./core/pdfSources.js";
import { checkMirror } from "./core/scihub.js";
import { listPaperFiles } from "./core/storage.js";
import { openPath } from "./core/open.js";
import { buildCitations } from "./core/citeFormat.js";
import {
  hasUnpaywallEmail,
  lookupUnpaywall,
  maskEmail,
} from "./core/unpaywall.js";
import type {
  PaperSearchSource,
  QueryType,
  SciPdfConfig,
} from "./types.js";
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
  .enum(["auto", "doi", "arxiv", "url", "title", "citation"])
  .optional()
  .describe(
    "How to interpret query: auto (default), doi, arxiv, url, title, or citation",
  );

const resolveQueryTypeSchema = z
  .enum(["auto", "doi", "url", "title", "citation"])
  .optional();

export function createServer(): McpServer {
  const version = packageVersion();
  const server = new McpServer({
    name: "scipdf-mcp",
    version,
  });

  server.tool(
    "search_papers",
    "Search academic papers across Crossref, OpenAlex, Semantic Scholar, and arXiv. Results are normalized, deduplicated, and ranked with reciprocal rank fusion. Supports year, citation-count, and open-access filters.",
    {
      query: z.string().min(1).describe("Keywords, title, author, or topic"),
      sources: z
        .array(z.enum(["crossref", "openalex", "semanticscholar", "arxiv"]))
        .min(1)
        .optional()
        .describe("Sources to query (default: all three)"),
      limit: z.number().int().min(1).max(50).optional(),
      year_from: z.number().int().min(1000).max(3000).optional(),
      year_to: z.number().int().min(1000).max(3000).optional(),
      min_citations: z.number().int().min(0).optional(),
      open_access_only: z.boolean().optional(),
    },
    async ({
      query,
      sources,
      limit,
      year_from,
      year_to,
      min_citations,
      open_access_only,
    }) => {
      refreshConfig();
      if (
        year_from !== undefined &&
        year_to !== undefined &&
        year_from > year_to
      ) {
        return jsonResult({
          ok: false,
          code: "INVALID_SEARCH_FILTER",
          error: "year_from must be less than or equal to year_to",
        });
      }
      const result = await searchPapers(query, config, {
        sources: sources as PaperSearchSource[] | undefined,
        limit,
        yearFrom: year_from,
        yearTo: year_to,
        minCitations: min_citations,
        openAccessOnly: open_access_only,
      });
      return jsonResult({ ok: true, ...result });
    },
  );

  server.tool(
    "list_search_sources",
    "List academic search providers and their supported capabilities.",
    {},
    async () => jsonResult({ sources: listPaperSources() }),
  );

  server.tool(
    "list_pdf_sources",
    "List PDF source adapters, configuration state, access mode, legal status, and supported identifier kinds.",
    {},
    async () => {
      refreshConfig();
      return jsonResult({ sources: listPdfSources(config) });
    },
  );

  for (const tool of [
    {
      name: "get_citations",
      relation: "citations" as const,
      description:
        "Find papers that cite a DOI or Semantic Scholar paper ID.",
    },
    {
      name: "get_references",
      relation: "references" as const,
      description:
        "Find papers referenced by a DOI or Semantic Scholar paper ID.",
    },
    {
      name: "find_related_papers",
      relation: "related" as const,
      description:
        "Find papers similar to a DOI or Semantic Scholar paper ID.",
    },
  ]) {
    server.tool(
      tool.name,
      `${tool.description} Uses Semantic Scholar and returns normalized paper records.`,
      {
        paper_id: z.string().min(1).describe("DOI or Semantic Scholar paper ID"),
        limit: z.number().int().min(1).max(100).optional(),
      },
      async ({ paper_id, limit }) => {
        refreshConfig();
        const result = await discoverRelatedPapers(
          paper_id,
          tool.relation,
          config,
          limit,
        );
        return jsonResult({ ok: true, ...result });
      },
    );
  }

  server.tool(
    "download_paper",
    "Download an academic paper PDF by DOI, arXiv ID/URL, title, publisher URL, or citation. arXiv IDs download directly from arXiv. DOI downloads use optional OA-first then the existing fallback chain. Returns path, source, citations, and structured failures.",
    {

      query: z
        .string()
        .describe("DOI, arXiv ID/URL, title, publisher URL, or citation string"),
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
      query_type: resolveQueryTypeSchema,
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
    "extract_paper_text",
    "Extract text from a local downloaded PDF and save a sibling .txt file. The PDF must be inside the configured download directory.",
    {
      path: z.string().describe("Absolute path to a downloaded PDF"),
      page_from: z.number().int().min(1).optional(),
      page_to: z.number().int().min(1).optional(),
      preview_chars: z.number().int().min(0).max(20_000).optional(),
    },
    async ({ path, page_from, page_to, preview_chars }) => {
      refreshConfig();
      if (
        page_from !== undefined &&
        page_to !== undefined &&
        page_from > page_to
      ) {
        return jsonResult({
          ok: false,
          error: "page_from must be less than or equal to page_to",
        });
      }
      return jsonResult(
        await extractPaperText(path, config.downloadDir, {
          pageFrom: page_from,
          pageTo: page_to,
          previewChars: preview_chars,
        }),
      );
    },
  );

  server.tool(
    "audit_references",
    "Resolve and verify a BibTeX, RIS, or plain-text reference list. Returns DOI metadata, formatted citations, and ambiguous/not-found entries.",
    {
      text: z.string().min(1).describe("Bibliography or reference-list text"),
      concurrency: z.number().int().min(1).max(8).optional(),
    },
    async ({ text, concurrency }) => {
      refreshConfig();
      const result = await auditReferences(
        text,
        Math.min(config.timeoutMs, 20_000),
        concurrency ?? Math.min(config.concurrency, 4),
      );
      return jsonResult({ ok: true, ...result });
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
        sourceRaceWidth: config.sourceRaceWidth,
        pdfNotFoundConfirmations: config.pdfNotFoundConfirmations,
        healthCacheTtlMs: config.healthCacheTtlMs,
        unpaywall: {
          configured: hasUnpaywallEmail(config),
          email: config.unpaywallEmail
            ? maskEmail(config.unpaywallEmail)
            : null,
          preferOa: config.preferOa,
          allowScihub: config.allowScihub,
          active: config.preferOa,
          freeOaProviders: ["openalex", "europepmc", "semanticscholar"],
          hint: config.preferOa
            ? hasUnpaywallEmail(config)
              ? "OA-first: Unpaywall + free OA APIs, then Sci-Hub"
              : "OA-first: free OA APIs (no Unpaywall email), then Sci-Hub"
            : "Default is Sci-Hub. Optional OA: SCIPDF_PREFER_OA=true (+ email for Unpaywall)",
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
    "Probe Sci-Hub mirrors for availability (uses health cache; force_refresh ignores cache). Only configured public mirrors (or allowlisted public https hosts) are probed — private/localhost URLs are rejected.",
    {
      urls: z.array(z.string()).optional(),
      force_refresh: z.boolean().optional(),
    },
    async ({ urls, force_refresh }) => {
      refreshConfig();
      const { assertSafePublicUrl } = await import("./core/urlSafety.js");
      const allowed = new Set(
        [...config.scihubMirrors, ...config.pdfHosts].map((u) =>
          u.replace(/\/+$/, ""),
        ),
      );
      const rawList = urls?.length ? urls : config.scihubMirrors;
      const list: string[] = [];
      const rejected: Array<{ url: string; error: string }> = [];
      for (const url of rawList) {
        try {
          const safe = assertSafePublicUrl(url);
          const base = safe.replace(/\/+$/, "");
          // Custom URLs must still be public http(s); configured list is always ok if public.
          if (urls?.length && !allowed.has(base) && !allowed.has(safe)) {
            // Still allow probing additional public hosts (not private/SSRF).
            assertSafePublicUrl(safe);
          }
          list.push(safe.endsWith("/") ? safe : `${safe}/`);
        } catch (e) {
          rejected.push({
            url,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
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
      return jsonResult({
        mirrors: statuses,
        ...(rejected.length ? { rejected } : {}),
      });
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
      refreshConfig();
      const r = await openPath(path, config.downloadDir);
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
      // Never return the raw Unpaywall email to the model / tool logs.
      const safe = {
        ...c,
        unpaywallEmail: c.unpaywallEmail
          ? maskEmail(c.unpaywallEmail)
          : undefined,
      };
      return jsonResult({ ok: true, config: safe });
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
  // Keep the process alive until stdin closes or a terminate signal arrives.
  // Returning immediately would let the CLI entrypoint exit the process.
  await new Promise<void>((resolve) => {
    const finish = () => {
      process.stdin.off("end", finish);
      process.stdin.off("close", finish);
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolve();
    };
    process.stdin.on("end", finish);
    process.stdin.on("close", finish);
    process.on("SIGINT", finish);
    process.on("SIGTERM", finish);
    // Ensure stdin is flowing so 'end' can fire when the client disconnects.
    if (process.stdin.isPaused()) process.stdin.resume();
  });
}
