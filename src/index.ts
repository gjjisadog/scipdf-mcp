#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { downloadPaper, downloadPapers, resolveToDoi } from "./core/download.js";
import { checkMirror } from "./core/scihub.js";
import type { QueryType } from "./types.js";

const config = loadConfig();

const server = new McpServer({
  name: "scipdf-mcp",
  version: "0.1.0",
});

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
  .enum(["auto", "doi", "url", "title"])
  .optional()
  .describe("How to interpret query: auto (default), doi, url, or title");

server.tool(
  "download_paper",
  "Download an academic paper PDF via Sci-Hub. Accepts DOI, publisher/doi.org URL, or paper title.",
  {
    query: z
      .string()
      .describe("DOI (e.g. 10.1038/nature12373), URL, or paper title"),
    query_type: queryTypeSchema,
    outdir: z
      .string()
      .optional()
      .describe("Override download directory (default from config)"),
    filename: z
      .string()
      .optional()
      .describe("Override output filename (with or without .pdf)"),
    force: z
      .boolean()
      .optional()
      .describe("Re-download even if file already exists (default false)"),
  },
  async ({ query, query_type, outdir, filename, force }) => {
    const result = await downloadPaper(
      {
        query,
        queryType: (query_type as QueryType | undefined) ?? "auto",
        outdir,
        filename,
        force: force ?? false,
      },
      config,
    );
    return jsonResult(result);
  },
);

server.tool(
  "download_papers",
  "Batch-download multiple papers via Sci-Hub. Each query can be a DOI, URL, or title.",
  {
    queries: z
      .array(z.string())
      .min(1)
      .describe("List of DOIs, URLs, or titles"),
    query_type: queryTypeSchema,
    outdir: z.string().optional().describe("Override download directory"),
    force: z
      .boolean()
      .optional()
      .describe("Re-download even if files already exist"),
  },
  async ({ queries, query_type, outdir, force }) => {
    const results = await downloadPapers(queries, config, {
      queryType: (query_type as QueryType | undefined) ?? "auto",
      outdir,
      force: force ?? false,
    });
    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;
    return jsonResult({ results, succeeded, failed, total: results.length });
  },
);

server.tool(
  "resolve_doi",
  "Resolve a title or URL to a DOI (and optional metadata) without downloading the PDF.",
  {
    query: z.string().describe("Title, URL, or partial DOI text"),
    query_type: queryTypeSchema,
  },
  async ({ query, query_type }) => {
    try {
      const resolved = await resolveToDoi(
        query,
        (query_type as QueryType | undefined) ?? "auto",
        Math.min(config.timeoutMs, 20_000),
      );
      return jsonResult({ ok: true, ...resolved });
    } catch (e) {
      return jsonResult({
        ok: false,
        query,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

server.tool(
  "list_mirrors",
  "List configured Sci-Hub mirror base URLs and current download settings.",
  {},
  async () => {
    return jsonResult({
      mirrors: config.scihubMirrors,
      pdfHosts: config.pdfHosts,
      downloadDir: config.downloadDir,
      timeoutMs: config.timeoutMs,
      concurrency: config.concurrency,
    });
  },
);


server.tool(
  "check_mirrors",
  "Probe Sci-Hub mirrors for availability and latency.",
  {
    urls: z
      .array(z.string())
      .optional()
      .describe("Optional subset of mirror URLs; defaults to all configured"),
  },
  async ({ urls }) => {
    const list = urls?.length ? urls : config.scihubMirrors;
    const statuses = await Promise.all(
      list.map(async (url) => {
        const r = await checkMirror(url, Math.min(config.timeoutMs, 12_000), config.userAgent);
        return { url, ...r };
      }),
    );
    return jsonResult({ mirrors: statuses });
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("scipdf-mcp failed to start:", err);
  process.exit(1);
});
