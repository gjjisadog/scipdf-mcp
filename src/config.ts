import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { SciPdfConfig } from "./types.js";

// Prefer mirrors that more often allow automated access; others still tried as fallback.
const DEFAULT_MIRRORS = [
  "https://sci-hub.ren/",
  "https://sci-hub.red/",
  "https://sci-hub.ee/",
  "https://sci-hub.st/",
  "https://sci-hub.ru/",
  "https://sci-hub.box/",
  "https://sci-hub.se/",
];

// Some mirrors front PDFs on separate hosts; useful when HTML pages are CF/DDoS-guarded.
const DEFAULT_PDF_HOSTS = ["https://sci.bban.top/pdf/"];

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function expandHome(path: string): string {
  if (path.startsWith("~/") || path === "~") {
    return join(homedir(), path.slice(2) || "");
  }
  return path;
}

function parseMirrors(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => (u.endsWith("/") ? u : `${u}/`));
}

function loadConfigFile(): Partial<SciPdfConfig> {
  const candidates = [
    process.env.SCIPDF_CONFIG,
    join(process.cwd(), "config.json"),
    join(homedir(), ".config", "scipdf-mcp", "config.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    const abs = resolve(expandHome(p));
    if (!existsSync(abs)) continue;
    try {
      const data = JSON.parse(readFileSync(abs, "utf-8")) as Partial<SciPdfConfig>;
      return data;
    } catch {
      // ignore invalid config files
    }
  }
  return {};
}

export function loadConfig(): SciPdfConfig {
  const file = loadConfigFile();

  const downloadDir = expandHome(
    process.env.SCIPDF_DOWNLOAD_DIR ??
      file.downloadDir ??
      join(homedir(), "Documents", "Papers"),
  );

  const mirrors =
    parseMirrors(process.env.SCIPDF_MIRRORS) ??
    file.scihubMirrors?.map((u) => (u.endsWith("/") ? u : `${u}/`)) ??
    DEFAULT_MIRRORS;

  const pdfHosts =
    parseMirrors(process.env.SCIPDF_PDF_HOSTS) ??
    (file as SciPdfConfig).pdfHosts?.map((u) =>
      u.endsWith("/") ? u : `${u}/`,
    ) ??
    DEFAULT_PDF_HOSTS;

  const timeoutMs = Number(
    process.env.SCIPDF_TIMEOUT_MS ?? file.timeoutMs ?? 30_000,
  );
  const concurrency = Number(
    process.env.SCIPDF_CONCURRENCY ?? file.concurrency ?? 2,
  );

  return {
    downloadDir,
    scihubMirrors: mirrors,
    pdfHosts,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
    concurrency:
      Number.isFinite(concurrency) && concurrency > 0
        ? Math.min(concurrency, 8)
        : 2,
    userAgent: process.env.SCIPDF_USER_AGENT ?? file.userAgent ?? DEFAULT_UA,
  };
}
