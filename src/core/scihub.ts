import * as cheerio from "cheerio";
import type { SciPdfConfig } from "../types.js";
import { SciPdfError, aggregateSourceErrors } from "./errors.js";
import { getHealth, markBad, markGood, sortByHealth } from "./health.js";
import { throttle } from "./rateLimit.js";
import { debugLog } from "./debug.js";
import { isPdfBuffer } from "./storage.js";
import { contentTypeIsPdf, fetchBuffer, fetchText } from "./http.js";
import { assertSafePublicUrl } from "./urlSafety.js";

const PDF_NOT_AVAILABLE = [
  /Please try to search again using DOI/im,
  /статья не найдена в базе/im,
  /article not found/im,
  /不存在|未找到|没有找到/im,
];

const BLOCKED_BODY = [
  /just a moment/i,
  /cf-browser-verification/i,
  /ddos-guard/i,
  /attention required/i,
  /checking your browser/i,
  /_cf_chl/i,
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

  $("iframe, embed, object").each((_, el) => {
    const src =
      $(el).attr("src") || $(el).attr("data") || $(el).attr("data-src");
    if (src && /\.pdf|pdf/i.test(src)) candidates.push(src);
  });

  $('a[href*=".pdf"], a[href*="pdf"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) candidates.push(href);
  });

  const onclickRe = /location\.href\s*=\s*['"]([^'"]+\.pdf[^'"]*)['"]/gi;
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

function bodyLooksBlocked(html: string): boolean {
  return BLOCKED_BODY.some((re) => re.test(html));
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

function cleanPdfUrl(pdfUrl: string): string {
  try {
    const u = new URL(pdfUrl);
    u.hash = "";
    return u.href;
  } catch {
    return pdfUrl.split("#")[0] ?? pdfUrl;
  }
}

function isFastFailStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 503 || status === 502;
}

async function downloadPdfBytes(
  pdfUrl: string,
  config: SciPdfConfig,
  referer: string,
): Promise<Uint8Array> {
  await throttle(config.minRequestGapMs);
  const url = assertSafePublicUrl(cleanPdfUrl(pdfUrl));
  const start = Date.now();
  const { response: res, buffer: buf } = await fetchBuffer(
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

  if (isFastFailStatus(res.status)) {
    throw new MirrorError(`PDF download blocked: HTTP ${res.status} (${url})`);
  }
  if (!res.ok) {
    throw new MirrorError(`PDF download failed: HTTP ${res.status} (${url})`);
  }

  if (!isPdfBuffer(buf)) {
    const text = Buffer.from(buf.subarray(0, 2000)).toString("utf8");
    if (bodyLooksBlocked(text)) {
      throw new MirrorError(`PDF host returned challenge page: ${url}`);
    }
    throw new MirrorError("Downloaded content is not a valid PDF");
  }
  debugLog(config, `PDF ok ${url} ${buf.byteLength}b ${Date.now() - start}ms`);
  return buf;
}

export async function fetchFromMirror(
  mirror: string,
  doi: string,
  config: SciPdfConfig,
): Promise<SciHubFetchOk> {
  const base = normalizeMirror(assertSafePublicUrl(mirror));
  const pageUrl = buildSciHubUrl(base, doi);
  await throttle(config.minRequestGapMs);
  const start = Date.now();
  const timeout = Math.min(config.timeoutMs, config.fastFailTimeoutMs + 5000);

  // Always read body under the same timeout (headers + body)
  const { response: res, buffer } = await fetchBuffer(
    pageUrl,
    {
      headers: browserHeaders(config, { Referer: base }),
      redirect: "follow",
    },
    timeout,
  );

  const latency = Date.now() - start;

  if (isFastFailStatus(res.status)) {
    markBad(base, `HTTP ${res.status}`, latency);
    throw new MirrorError(`Mirror HTTP ${res.status}: ${pageUrl}`);
  }
  if (!res.ok) {
    markBad(base, `HTTP ${res.status}`, latency);
    throw new MirrorError(`Mirror HTTP ${res.status}: ${pageUrl}`);
  }

  if (contentTypeIsPdf(res.headers.get("content-type")) || isPdfBuffer(buffer)) {
    if (!isPdfBuffer(buffer)) {
      markBad(base, "invalid pdf body", latency);
      throw new MirrorError("Direct response claimed PDF but content invalid");
    }
    markGood(base, latency);
    return { pdfBytes: buffer, mirror: base, pdfUrl: pageUrl };
  }

  const html = Buffer.from(buffer).toString("utf8");
  if (bodyLooksBlocked(html)) {
    markBad(base, "cloudflare/ddos challenge", latency);
    throw new MirrorError(`Mirror blocked (challenge page): ${pageUrl}`);
  }

  const pdfUrl = extractPdfUrlFromHtml(html, pageUrl);
  if (pdfUrl) {
    const pdfBytes = await downloadPdfBytes(pdfUrl, config, pageUrl);
    markGood(base, latency);
    return { pdfBytes, mirror: base, pdfUrl: cleanPdfUrl(pdfUrl) };
  }

  if (bodyLooksUnavailable(html)) {
    markGood(base, latency);
    throw new PdfNotFoundError(`PDF not available on Sci-Hub for DOI ${doi}`);
  }

  markBad(base, "no pdf link", latency);
  throw new MirrorError(`Could not find PDF link on page: ${pageUrl}`);
}

export async function fetchFromPdfHost(
  hostBase: string,
  doi: string,
  config: SciPdfConfig,
): Promise<SciHubFetchOk> {
  const safe = assertSafePublicUrl(hostBase);
  const base = safe.endsWith("/") ? safe : `${safe}/`;
  // Support templates that are full mirror roots vs .../pdf/
  let pdfUrl: string;
  if (base.includes("/pdf")) {
    pdfUrl = new URL(`${doi}.pdf`, base).href;
  } else {
    // treat as sci-hub style host that might redirect — try /pdf/doi.pdf pattern first
    pdfUrl = new URL(`pdf/${doi}.pdf`, base).href;
  }
  const start = Date.now();
  try {
    const pdfBytes = await downloadPdfBytes(pdfUrl, config, base);
    markGood(base, Date.now() - start);
    return { pdfBytes, mirror: base, pdfUrl: cleanPdfUrl(pdfUrl) };
  } catch (e) {
    markBad(base, e instanceof Error ? e.message : String(e), Date.now() - start);
    throw e;
  }
}

export async function fetchPdfViaSciHub(
  doi: string,
  config: SciPdfConfig,
): Promise<SciHubFetchOk> {
  const errors: string[] = [];
  let lastNotFound: PdfNotFoundError | null = null;

  const hosts = sortByHealth(config.pdfHosts ?? [], config.healthCacheTtlMs).filter(
    (h) => {
      const hth = getHealth(h, config.healthCacheTtlMs);
      // skip recently known-bad hosts unless all are bad
      return !hth || hth.ok;
    },
  );
  const hostsTry =
    hosts.length > 0
      ? hosts
      : sortByHealth(config.pdfHosts ?? [], config.healthCacheTtlMs);

  for (const host of hostsTry) {
    try {
      debugLog(config, "try pdf host", host, doi);
      return await fetchFromPdfHost(host, doi, config);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${host}: ${msg}`);
    }
  }

  const mirrors = sortByHealth(
    config.scihubMirrors,
    config.healthCacheTtlMs,
  );
  const goodFirst = mirrors.filter((m) => {
    const h = getHealth(m, config.healthCacheTtlMs);
    return !h || h.ok;
  });
  const mirrorTry = goodFirst.length > 0 ? goodFirst : mirrors;

  for (const mirror of mirrorTry) {
    try {
      debugLog(config, "try mirror", mirror, doi);
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

  const code = aggregateSourceErrors(errors);
  throw new SciPdfError(
    code,
    `All Sci-Hub sources failed for ${doi}:\n${errors.join("\n")}`,
  );
}

export async function checkMirror(
  mirror: string,
  timeoutMs = 10_000,
  userAgent?: string,
  ttlMs = 15 * 60_000,
): Promise<{ ok: boolean; latencyMs: number; error?: string; cached?: boolean }> {
  let url: string;
  try {
    url = normalizeMirror(assertSafePublicUrl(mirror));
  } catch (e) {
    return {
      ok: false,
      latencyMs: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const cached = getHealth(url, ttlMs);
  if (cached) {
    return {
      ok: cached.ok,
      latencyMs: cached.latencyMs,
      error: cached.error,
      cached: true,
    };
  }
  const start = Date.now();
  try {
    const { response: res, text } = await fetchText(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent":
            userAgent ??
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      },
      timeoutMs,
    );
    const latencyMs = Date.now() - start;
    if (!res.ok || isFastFailStatus(res.status)) {
      markBad(url, `HTTP ${res.status}`, latencyMs);
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    }
    if (bodyLooksBlocked(text)) {
      markBad(url, "challenge page", latencyMs);
      return { ok: false, latencyMs, error: "challenge page" };
    }
    markGood(url, latencyMs);
    return { ok: true, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - start;
    const error = e instanceof Error ? e.message : String(e);
    markBad(url, error, latencyMs);
    return { ok: false, latencyMs, error };
  }
}
