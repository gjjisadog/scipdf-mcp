import * as cheerio from "cheerio";
import type { SciPdfConfig } from "../types.js";
import { isPdfBuffer } from "./storage.js";

const PDF_NOT_AVAILABLE = [
  /Please try to search again using DOI/im,
  /статья не найдена в базе/im,
  /article not found/im,
  /不存在|未找到|没有找到/im,
];

export class PdfNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfNotFoundError";
  }
}

export class MirrorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MirrorError";
  }
}

export interface SciHubFetchOk {
  pdfBytes: Uint8Array;
  mirror: string;
  pdfUrl: string;
}

function normalizeMirror(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

function buildSciHubUrl(mirror: string, doi: string): string {
  return new URL(doi, normalizeMirror(mirror)).href;
}

/** Extract PDF URL from Sci-Hub HTML (aligned with zotero-scipdf + current mirrors) */
export function extractPdfUrlFromHtml(
  html: string,
  pageUrl: string,
): string | null {
  const $ = cheerio.load(html);

  const candidates: string[] = [];

  const pdfEl = $("#pdf");
  if (pdfEl.length) {
    const src = pdfEl.attr("src") || pdfEl.attr("data-src");
    if (src) candidates.push(src);
  }

  // iframe / embed fallbacks
  $("iframe, embed, object").each((_, el) => {
    const src =
      $(el).attr("src") ||
      $(el).attr("data") ||
      $(el).attr("data-src");
    if (src && /\.pdf|pdf/i.test(src)) candidates.push(src);
  });

  // direct links
  $('a[href*=".pdf"], a[href*="pdf"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) candidates.push(href);
  });

  // onclick="location.href='https://...pdf...'"
  const onclickRe =
    /location\.href\s*=\s*['"]([^'"]+\.pdf[^'"]*)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = onclickRe.exec(html)) !== null) {
    candidates.push(m[1].replace(/\\\//g, "/"));
  }

  for (const raw of candidates) {
    try {
      const u = new URL(raw, pageUrl);
      if (u.protocol === "http:") u.protocol = "https:";
      return u.href;
    } catch {
      // skip
    }
  }
  return null;
}

function bodyLooksUnavailable(html: string): boolean {
  const text = html.replace(/\s+/g, " ").trim();
  if (!text || text.length < 20) return true;
  return PDF_NOT_AVAILABLE.some((re) => re.test(html));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function browserHeaders(
  config: SciPdfConfig,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    "User-Agent": config.userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    ...extra,
  };
}

/** Strip fragment (#view=FitH) before downloading */
function cleanPdfUrl(pdfUrl: string): string {
  try {
    const u = new URL(pdfUrl);
    u.hash = "";
    return u.href;
  } catch {
    return pdfUrl.split("#")[0] ?? pdfUrl;
  }
}

async function downloadPdfBytes(
  pdfUrl: string,
  config: SciPdfConfig,
  referer: string,
): Promise<Uint8Array> {
  const url = cleanPdfUrl(pdfUrl);
  const res = await fetchWithTimeout(
    url,
    {
      headers: browserHeaders(config, {
        Accept: "application/pdf,*/*",
        Referer: referer,
      }),
      redirect: "follow",
    },
    config.timeoutMs,
  );

  if (!res.ok) {
    throw new MirrorError(`PDF download failed: HTTP ${res.status} (${url})`);
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (!isPdfBuffer(buf)) {
    throw new MirrorError("Downloaded content is not a valid PDF");
  }
  return buf;
}

/** Try a single Sci-Hub mirror for a DOI */
export async function fetchFromMirror(
  mirror: string,
  doi: string,
  config: SciPdfConfig,
): Promise<SciHubFetchOk> {
  const base = normalizeMirror(mirror);
  const pageUrl = buildSciHubUrl(mirror, doi);
  const res = await fetchWithTimeout(
    pageUrl,
    {
      headers: browserHeaders(config, { Referer: base }),
      redirect: "follow",
    },
    config.timeoutMs,
  );

  if (!res.ok) {
    throw new MirrorError(`Mirror HTTP ${res.status}: ${pageUrl}`);
  }

  const contentType = res.headers.get("content-type") ?? "";

  // Some mirrors redirect straight to PDF
  if (contentType.includes("application/pdf")) {
    const pdfBytes = new Uint8Array(await res.arrayBuffer());
    if (!isPdfBuffer(pdfBytes)) {
      throw new MirrorError("Direct response claimed PDF but content invalid");
    }
    return { pdfBytes, mirror: base, pdfUrl: pageUrl };
  }

  const html = await res.text();
  const pdfUrl = extractPdfUrlFromHtml(html, pageUrl);

  if (pdfUrl) {
    const pdfBytes = await downloadPdfBytes(pdfUrl, config, pageUrl);
    return { pdfBytes, mirror: base, pdfUrl: cleanPdfUrl(pdfUrl) };
  }

  if (bodyLooksUnavailable(html)) {
    throw new PdfNotFoundError(`PDF not available on Sci-Hub for DOI ${doi}`);
  }

  throw new MirrorError(`Could not find PDF link on page: ${pageUrl}`);
}

/** Try known direct PDF hosts (bypass HTML / CF when possible) */
export async function fetchFromPdfHost(
  hostBase: string,
  doi: string,
  config: SciPdfConfig,
): Promise<SciHubFetchOk> {
  const base = hostBase.endsWith("/") ? hostBase : `${hostBase}/`;
  const pdfUrl = new URL(`${doi}.pdf`, base).href;
  const pdfBytes = await downloadPdfBytes(pdfUrl, config, base);
  return { pdfBytes, mirror: base, pdfUrl: cleanPdfUrl(pdfUrl) };
}

/** Try direct PDF hosts first (more automation-friendly), then HTML mirrors */
export async function fetchPdfViaSciHub(
  doi: string,
  config: SciPdfConfig,
): Promise<SciHubFetchOk> {
  const errors: string[] = [];
  let lastNotFound: PdfNotFoundError | null = null;

  // 1) Direct PDF CDNs — often reachable when sci-hub HTML is CF-blocked
  for (const host of config.pdfHosts ?? []) {
    try {
      return await fetchFromPdfHost(host, doi, config);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${host}: ${msg}`);
    }
  }

  // 2) Classic Sci-Hub HTML pages (#pdf)
  for (const mirror of config.scihubMirrors) {
    try {
      return await fetchFromMirror(mirror, doi, config);
    } catch (e) {
      if (e instanceof PdfNotFoundError) {
        lastNotFound = e;
        errors.push(`${mirror}: ${e.message}`);
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${mirror}: ${msg}`);
    }
  }

  if (lastNotFound) {
    throw lastNotFound;
  }

  throw new Error(
    `All Sci-Hub sources failed for ${doi}:\n${errors.join("\n")}`,
  );
}

export async function checkMirror(
  mirror: string,
  timeoutMs = 10_000,
  userAgent?: string,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const url = normalizeMirror(mirror);
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent":
            userAgent ??
            "Mozilla/5.0 (iPhone; CPU iPhone OS 11_3_1 like Mac OS X) AppleWebKit/603.1.30",
        },
      },
      timeoutMs,
    );
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    }
    return { ok: true, latencyMs };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
