import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { FilenameStyle, SciPdfConfig } from "./types.js";

const DEFAULT_MIRRORS = [
  "https://sci-hub.ren/",
  "https://sci-hub.red/",
  "https://sci-hub.ee/",
  "https://sci-hub.st/",
  "https://sci-hub.ru/",
  "https://sci-hub.box/",
  "https://sci-hub.se/",
];

const DEFAULT_PDF_HOSTS = ["https://sci.bban.top/pdf/"];

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function expandHome(path: string): string {
  if (path.startsWith("~/") || path === "~") {
    return join(homedir(), path.slice(2) || "");
  }
  return path;
}

function parseList(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => (u.includes("://") && !u.endsWith("/") ? `${u}/` : u));
}

function loadConfigFile(): Partial<SciPdfConfig> & Record<string, unknown> {
  const candidates = [
    process.env.SCIPDF_CONFIG,
    join(process.cwd(), "config.json"),
    join(homedir(), ".config", "scipdf-mcp", "config.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    const abs = resolve(expandHome(p));
    if (!existsSync(abs)) continue;
    try {
      return JSON.parse(readFileSync(abs, "utf-8")) as Partial<SciPdfConfig>;
    } catch {
      // ignore
    }
  }
  return {};
}

export function loadConfig(): SciPdfConfig {
  const file = loadConfigFile();

  const downloadDir = expandHome(
    process.env.SCIPDF_DOWNLOAD_DIR ??
      (file.downloadDir as string | undefined) ??
      join(homedir(), "Documents", "Papers"),
  );

  const mirrors =
    parseList(process.env.SCIPDF_MIRRORS) ??
    (file.scihubMirrors as string[] | undefined)?.map((u) =>
      u.endsWith("/") ? u : `${u}/`,
    ) ??
    DEFAULT_MIRRORS;

  const pdfHosts =
    parseList(process.env.SCIPDF_PDF_HOSTS) ??
    (file.pdfHosts as string[] | undefined)?.map((u) =>
      u.endsWith("/") ? u : `${u}/`,
    ) ??
    DEFAULT_PDF_HOSTS;

  const timeoutMs = Number(
    process.env.SCIPDF_TIMEOUT_MS ?? file.timeoutMs ?? 30_000,
  );
  const fastFailTimeoutMs = Number(
    process.env.SCIPDF_FAST_FAIL_MS ?? file.fastFailTimeoutMs ?? 8_000,
  );
  const concurrency = Number(
    process.env.SCIPDF_CONCURRENCY ?? file.concurrency ?? 2,
  );
  const healthCacheTtlMs = Number(
    process.env.SCIPDF_HEALTH_TTL_MS ?? file.healthCacheTtlMs ?? 15 * 60_000,
  );
  const minRequestGapMs = Number(
    process.env.SCIPDF_MIN_GAP_MS ?? file.minRequestGapMs ?? 200,
  );

  const filenameStyle = (process.env.SCIPDF_FILENAME_STYLE ??
    file.filenameStyle ??
    "doi") as FilenameStyle;

  const unpaywallEmail = (
    process.env.SCIPDF_UNPAYWALL_EMAIL ??
    (file.unpaywallEmail as string | undefined) ??
    ""
  ).trim() || undefined;

  // OA is opt-in: only when email is set AND preferOa is true (default false → Sci-Hub first)
  const preferOaEnv = process.env.SCIPDF_PREFER_OA;
  const preferOa =
    preferOaEnv != null
      ? preferOaEnv === "1" || preferOaEnv.toLowerCase() === "true"
      : file.preferOa === true;

  const allowScihubEnv = process.env.SCIPDF_ALLOW_SCIHUB;
  const allowScihub =
    allowScihubEnv != null
      ? allowScihubEnv !== "0" && allowScihubEnv.toLowerCase() !== "false"
      : file.allowScihub !== false;

  return {
    downloadDir,
    scihubMirrors: mirrors,
    pdfHosts,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
    fastFailTimeoutMs:
      Number.isFinite(fastFailTimeoutMs) && fastFailTimeoutMs > 0
        ? fastFailTimeoutMs
        : 8_000,
    concurrency:
      Number.isFinite(concurrency) && concurrency > 0
        ? Math.min(concurrency, 8)
        : 2,
    userAgent: process.env.SCIPDF_USER_AGENT ?? (file.userAgent as string) ?? DEFAULT_UA,
    filenameStyle:
      filenameStyle === "author_year_title" ? "author_year_title" : "doi",
    healthCacheTtlMs:
      Number.isFinite(healthCacheTtlMs) && healthCacheTtlMs > 0
        ? healthCacheTtlMs
        : 15 * 60_000,
    minRequestGapMs:
      Number.isFinite(minRequestGapMs) && minRequestGapMs >= 0
        ? minRequestGapMs
        : 200,
    debug: process.env.SCIPDF_DEBUG === "1" || Boolean(file.debug),
    unpaywallEmail,
    preferOa,
    allowScihub,
  };
}

/** Hot-reload config from env + config files (call between tool invocations). */
export function reloadConfig(): SciPdfConfig {
  return loadConfig();
}
