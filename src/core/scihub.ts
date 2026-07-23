import * as cheerio from "cheerio";
import type { SciPdfConfig } from "../types.js";
import { SciPdfError, aggregateSourceErrors } from "./errors.js";
import {
  shortFailureMessage,
  summarizeSourceErrors,
} from "./failureSummary.js";
import { getHealth, markBad, markGood, sortByHealth } from "./health.js";
import { throttle } from "./rateLimit.js";
import { debugLog } from "./debug.js";
import { isPdfBuffer } from "./storage.js";
import {
  contentTypeIsPdf,
  fetchSafePublicBuffer,
  fetchSafePublicText,
} from "./http.js";
import { assertSafePublicUrl } from "./urlSafety.js";
import type { SourceFailureSummary } from "../types.js";

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

/**
 * True when a source strongly indicates the PDF is absent from Sci-Hub
 * (not a transport/block failure). Used for early-stop racing.
 */
export function isPdfAbsentError(err: unknown): boolean {
  if (err instanceof PdfNotFoundError) return true;
  if (!(err instanceof Error)) return false;
  const m = err.message;
  // Explicit absence signals (legacy MirrorError wording kept for safety)
  if (/PDF not available on Sci-Hub/i.test(m)) return true;
  if (/Could not find PDF link on page/i.test(m)) return true;
  if (/no PDF link/i.test(m)) return true;
  // Direct-host / mirror HTTP 404 for this DOI
  if (/\bHTTP 404\b/i.test(m)) return true;
  return false;
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
  const url = assertSafePublicUrl(cleanPdfUrl(pdfUrl));
  await throttle(config.minRequestGapMs, url);
  const start = Date.now();
  const { response: res, buffer: buf } = await fetchSafePublicBuffer(
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
  await throttle(config.minRequestGapMs, pageUrl);
  const start = Date.now();
  const timeout = Math.min(config.timeoutMs, config.fastFailTimeoutMs + 5000);

  // Always read body under the same timeout (headers + body)
  const { response: res, buffer } = await fetchSafePublicBuffer(
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
  // 404 on a live mirror almost always means "not in Sci-Hub DB"
  if (res.status === 404) {
    markGood(base, latency);
    throw new PdfNotFoundError(
      `PDF not available on Sci-Hub for DOI ${doi} (HTTP 404)`,
    );
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

  // Reachable HTML (not challenge) but no embed / no classic "not found" copy.
  // In practice this is the common missing-DOI response across current mirrors.
  // Count as absence (not broken mirror) so race early-stop can fire.
  markGood(base, latency);
  throw new PdfNotFoundError(
    bodyLooksUnavailable(html)
      ? `PDF not available on Sci-Hub for DOI ${doi}`
      : `PDF not available on Sci-Hub for DOI ${doi} (no PDF link on page)`,
  );
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
    const msg = e instanceof Error ? e.message : String(e);
    const latency = Date.now() - start;
    // Direct /pdf/{doi}.pdf 404 → paper absent at this host (not a dead host)
    if (/\bHTTP 404\b/i.test(msg)) {
      markGood(base, latency);
      throw new PdfNotFoundError(
        `PDF not available via pdf host for DOI ${doi} (HTTP 404)`,
      );
    }
    markBad(base, msg, latency);
    throw e;
  }
}

export type RaceSourcesResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      errors: string[];
      notFound: PdfNotFoundError | null;
      /** Stopped early after enough independent not-in-DB confirmations */
      earlyNotFound: boolean;
      /** How many sources were actually attempted */
      attempted: number;
    };

/**
 * Probe sources with up to `width` concurrent attempts. First success wins.
 * When `isNotFound` hits `notFoundConfirmations` times, stop without draining
 * the remaining queue (avoids scanning every Sci-Hub mirror for missing DOIs).
 *
 * In-flight attempts after a decision are left to settle (errors swallowed) so
 * we never leave unhandled rejections; new work is not scheduled.
 */
export async function raceSources<T>(
  sources: readonly string[],
  width: number,
  trySource: (source: string) => Promise<T>,
  opts?: {
    isNotFound?: (err: unknown) => boolean;
    notFoundConfirmations?: number;
  },
): Promise<RaceSourcesResult<T>> {
  if (sources.length === 0) {
    return {
      ok: false,
      errors: [],
      notFound: null,
      earlyNotFound: false,
      attempted: 0,
    };
  }

  const w = Math.max(
    1,
    Math.min(Math.floor(Number(width) || 1), sources.length),
  );
  const notFoundLimit = Math.max(
    1,
    Math.floor(Number(opts?.notFoundConfirmations) || 1),
  );
  const isNotFound = opts?.isNotFound ?? (() => false);

  return new Promise<RaceSourcesResult<T>>((resolve) => {
    const errors: string[] = [];
    let notFound: PdfNotFoundError | null = null;
    let notFoundCount = 0;
    let earlyNotFound = false;
    let nextIndex = 0;
    let attempted = 0;
    let running = 0;
    let done = false;

    const finish = (result: RaceSourcesResult<T>) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const pump = () => {
      if (done) return;

      while (running < w && nextIndex < sources.length) {
        const source = sources[nextIndex++];
        attempted++;
        running++;

        Promise.resolve()
          .then(() => trySource(source))
          .then(
            (value) => {
              running--;
              if (!done) {
                finish({ ok: true, value });
              }
            },
            (err: unknown) => {
              running--;
              if (done) return;

              const msg = err instanceof Error ? err.message : String(err);
              errors.push(`${source}: ${msg}`);

              if (isNotFound(err)) {
                notFoundCount++;
                if (err instanceof PdfNotFoundError) {
                  notFound = err;
                } else if (!notFound) {
                  notFound = new PdfNotFoundError(msg);
                }
                if (notFoundCount >= notFoundLimit) {
                  earlyNotFound = true;
                  finish({
                    ok: false,
                    errors: errors.slice(),
                    notFound,
                    earlyNotFound,
                    attempted,
                  });
                  return;
                }
              }

              if (nextIndex >= sources.length && running === 0) {
                finish({
                  ok: false,
                  errors: errors.slice(),
                  notFound,
                  earlyNotFound,
                  attempted,
                });
                return;
              }
              pump();
            },
          );
      }

      if (!done && running === 0 && nextIndex >= sources.length) {
        finish({
          ok: false,
          errors: errors.slice(),
          notFound,
          earlyNotFound,
          attempted,
        });
      }
    };

    pump();
  });
}

function preferHealthy(urls: string[], ttlMs: number): string[] {
  const sorted = sortByHealth(urls, ttlMs);
  const good = sorted.filter((u) => {
    const h = getHealth(u, ttlMs);
    return !h || h.ok;
  });
  return good.length > 0 ? good : sorted;
}

export async function fetchPdfViaSciHub(
  doi: string,
  config: SciPdfConfig,
): Promise<SciHubFetchOk> {
  const errors: string[] = [];
  const raceWidth = config.sourceRaceWidth ?? 5;
  const notFoundConfirm = config.pdfNotFoundConfirmations ?? 1;

  const hostsTry = preferHealthy(
    config.pdfHosts ?? [],
    config.healthCacheTtlMs,
  );

  if (hostsTry.length > 0) {
    debugLog(
      config,
      `race pdfHosts width=${Math.min(raceWidth, hostsTry.length)} n=${hostsTry.length}`,
      doi,
    );
    const hostRace = await raceSources(
      hostsTry,
      raceWidth,
      (host) => {
        debugLog(config, "try pdf host", host, doi);
        return fetchFromPdfHost(host, doi, config);
      },
      {
        isNotFound: isPdfAbsentError,
        // Hosts are few; still allow early bail so we move on to mirrors faster
        // when every host reports absence (not required to stop the whole download).
        notFoundConfirmations: Math.max(notFoundConfirm, hostsTry.length),
      },
    );
    if (hostRace.ok) return hostRace.value;
    errors.push(...hostRace.errors);
    // Do not throw on host-only notFound — fall through to Sci-Hub mirrors
  }

  const mirrorTry = preferHealthy(
    config.scihubMirrors,
    config.healthCacheTtlMs,
  );

  if (mirrorTry.length > 0) {
    debugLog(
      config,
      `race mirrors width=${Math.min(raceWidth, mirrorTry.length)} n=${mirrorTry.length} notFoundConfirm=${notFoundConfirm}`,
      doi,
    );
    const mirrorRace = await raceSources(
      mirrorTry,
      raceWidth,
      (mirror) => {
        debugLog(config, "try mirror", mirror, doi);
        return fetchFromMirror(mirror, doi, config);
      },
      {
        isNotFound: isPdfAbsentError,
        notFoundConfirmations: notFoundConfirm,
      },
    );
    if (mirrorRace.ok) return mirrorRace.value;
    errors.push(...mirrorRace.errors);

    if (mirrorRace.notFound) {
      if (mirrorRace.earlyNotFound) {
        debugLog(
          config,
          `early stop: PDF absent confirmed ${notFoundConfirm}× after ${mirrorRace.attempted}/${mirrorTry.length} mirrors`,
          doi,
        );
      }
      const failure = summarizeSourceErrors(errors, {
        earlyStop: mirrorRace.earlyNotFound,
      });
      const err = mirrorRace.notFound;
      (err as Error & { failure?: SourceFailureSummary }).failure = failure;
      throw err;
    }
  }

  if (errors.length === 0) {
    throw new SciPdfError(
      "ALL_SOURCES_FAILED",
      `No Sci-Hub sources configured for ${doi}`,
    );
  }

  const code = aggregateSourceErrors(errors);
  const failure = summarizeSourceErrors(errors);
  throw new SciPdfError(
    code,
    shortFailureMessage(code, doi, failure) +
      (failure.samples.length
        ? `\n` + failure.samples.join("\n")
        : ""),
    undefined,
    failure,
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
    const { response: res, text } = await fetchSafePublicText(
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
