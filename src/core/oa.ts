/**
 * Optional Open Access PDF fetchers (preferOa path).
 * Unpaywall (email) + free APIs: OpenAlex OA, Europe PMC, Semantic Scholar.
 */

import type { PdfAttempt, SciPdfConfig } from "../types.js";
import { debugLog } from "./debug.js";
import { fetchJson, fetchSafePublicBuffer } from "./http.js";
import { throttle } from "./rateLimit.js";
import { isPdfBuffer } from "./storage.js";
import { assertSafePublicUrl } from "./urlSafety.js";
import {
  fetchPdfViaUnpaywall,
  hasUnpaywallEmail,
  type UnpaywallResult,
} from "./unpaywall.js";

export type OaProvider =
  | "unpaywall"
  | "openalex"
  | "europepmc"
  | "semanticscholar";

export interface OaFetchOk {
  pdfBytes: Uint8Array;
  pdfUrl: string;
  provider: OaProvider;
  meta?: {
    title?: string;
    hostType?: string;
    version?: string;
    license?: string;
  };
}

export type OaAttemptReporter = (attempt: PdfAttempt) => void;

async function runOaAttempt(
  provider: OaProvider,
  task: () => Promise<OaFetchOk | null>,
  report?: OaAttemptReporter,
): Promise<OaFetchOk | null> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const result = await task();
    report?.({
      source: provider,
      status: result ? "success" : "not_found",
      legal: true,
      accessMode: "open_access",
      startedAt,
      durationMs: Date.now() - started,
      url: result?.pdfUrl,
      reason: result ? undefined : "No usable Open Access PDF found",
      oaEvidence: result
        ? {
            provider,
            hostType: result.meta?.hostType,
            version: result.meta?.version,
            license: result.meta?.license,
            pdfUrl: result.pdfUrl,
          }
        : undefined,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: PdfAttempt["status"] =
      /\b401\b|\b403\b|not entitled|entitlement/i.test(message)
        ? "not_entitled"
        : /\b429\b|rate.?limit|quota/i.test(message)
          ? "rate_limited"
          : /\b404\b|not found/i.test(message)
            ? "not_found"
            : /not a valid PDF|did not return a PDF/i.test(message)
              ? "invalid_pdf"
              : /abort|timeout/i.test(message)
                ? "timeout"
                : "request_failed";
    report?.({
      source: provider,
      status,
      legal: true,
      accessMode: "open_access",
      startedAt,
      durationMs: Date.now() - started,
      reason: message,
    });
    return null;
  }
}

async function downloadPdfUrl(
  pdfUrl: string,
  config: SciPdfConfig,
): Promise<Uint8Array> {
  await throttle(config.minRequestGapMs, pdfUrl);
  const url = assertSafePublicUrl(pdfUrl);
  const { response: res, buffer: buf } = await fetchSafePublicBuffer(
    url,
    {
      redirect: "follow",
      headers: {
        "User-Agent": config.userAgent,
        Accept: "application/pdf,*/*",
      },
    },
    config.timeoutMs,
  );
  if (!res.ok) {
    throw new Error(`OA PDF HTTP ${res.status}: ${pdfUrl}`);
  }
  if (!isPdfBuffer(buf)) {
    throw new Error(`OA URL did not return a PDF: ${pdfUrl}`);
  }
  return buf;
}

async function tryOpenAlexOa(
  doi: string,
  config: SciPdfConfig,
): Promise<OaFetchOk | null> {
  const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`;
  await throttle(config.minRequestGapMs, url);
  const { response, data } = await fetchJson<{
      display_name?: string;
      open_access?: { is_oa?: boolean; oa_url?: string | null };
      primary_location?: { pdf_url?: string | null };
      best_oa_location?: { pdf_url?: string | null; license?: string | null };
    }>(
      url,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "scipdf-mcp/0.3 (mailto:research@localhost)",
        },
      },
      Math.min(config.timeoutMs, 15_000),
  );
  if (!response.ok) throw new Error(`OpenAlex OA HTTP ${response.status}`);
  if (!data) return null;
  const pdfUrl =
    data.best_oa_location?.pdf_url ||
    data.primary_location?.pdf_url ||
    data.open_access?.oa_url ||
    undefined;
  if (!pdfUrl || !/^https?:\/\//i.test(pdfUrl)) return null;
  // oa_url is sometimes a landing page — only accept obvious PDFs or try download
  const pdfBytes = await downloadPdfUrl(pdfUrl, config);
  return {
    pdfBytes,
    pdfUrl,
    provider: "openalex",
    meta: {
      title: data.display_name,
      license: data.best_oa_location?.license ?? undefined,
      hostType: "openalex",
    },
  };
}

async function tryEuropePmc(
  doi: string,
  config: SciPdfConfig,
): Promise<OaFetchOk | null> {
  const q = `DOI:"${doi}"`;
  const url =
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?` +
    new URLSearchParams({
      query: q,
      format: "json",
      resultType: "core",
      pageSize: "1",
    }).toString();
  await throttle(config.minRequestGapMs, url);
  const { response, data } = await fetchJson<{
      resultList?: {
        result?: Array<{
          title?: string;
          fullTextUrlList?: {
            fullTextUrl?: Array<{
              url?: string;
              documentStyle?: string;
              availability?: string;
            }>;
          };
        }>;
      };
    }>(
      url,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": config.userAgent,
        },
      },
      Math.min(config.timeoutMs, 15_000),
  );
  if (!response.ok) throw new Error(`Europe PMC OA HTTP ${response.status}`);
  if (!data) return null;
  const hit = data.resultList?.result?.[0];
  const urls = hit?.fullTextUrlList?.fullTextUrl ?? [];
  const pdfEntry =
    urls.find(
      (u) =>
        u.documentStyle?.toLowerCase() === "pdf" ||
        /\.pdf(\?|$)/i.test(u.url ?? ""),
    ) ?? urls.find((u) => u.url);
  if (!pdfEntry?.url) return null;
  const pdfBytes = await downloadPdfUrl(pdfEntry.url, config);
  return {
    pdfBytes,
    pdfUrl: pdfEntry.url,
    provider: "europepmc",
    meta: { title: hit?.title, hostType: "europepmc" },
  };
}

async function trySemanticScholar(
  doi: string,
  config: SciPdfConfig,
): Promise<OaFetchOk | null> {
  const url =
    `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}` +
    `?fields=title,openAccessPdf`;
  await throttle(config.minRequestGapMs, url);
  const { response, data } = await fetchJson<{
      title?: string;
      openAccessPdf?: { url?: string | null; status?: string | null } | null;
    }>(
      url,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "scipdf-mcp/0.3 (mailto:research@localhost)",
        },
      },
      Math.min(config.timeoutMs, 15_000),
  );
  if (!response.ok) {
    throw new Error(`Semantic Scholar OA HTTP ${response.status}`);
  }
  if (!data?.openAccessPdf?.url) return null;
  const pdfUrl = data.openAccessPdf.url;
  const pdfBytes = await downloadPdfUrl(pdfUrl, config);
  return {
    pdfBytes,
    pdfUrl,
    provider: "semanticscholar",
    meta: { title: data.title, hostType: "semanticscholar" },
  };
}

/**
 * Prefer-OA pipeline: Unpaywall (if email) → OpenAlex → Europe PMC → Semantic Scholar.
 * Returns null if none yield a valid PDF.
 */
export async function fetchPdfViaOa(
  doi: string,
  config: SciPdfConfig,
  report?: OaAttemptReporter,
): Promise<OaFetchOk | null> {
  if (hasUnpaywallEmail(config)) {
    const result = await runOaAttempt(
      "unpaywall",
      async () => {
        const u = await fetchPdfViaUnpaywall(doi, config);
        return u
          ? {
              pdfBytes: u.pdfBytes,
              pdfUrl: u.pdfUrl,
              provider: "unpaywall",
              meta: {
                title: u.meta.title,
                hostType: u.meta.hostType,
                version: u.meta.version,
                license: u.meta.license,
              },
            }
          : null;
      },
      report,
    );
    if (result) return result;
  } else {
    debugLog(config, "unpaywall skipped in OA pipeline (no email)");
    report?.({
      source: "unpaywall",
      status: "skipped",
      legal: true,
      accessMode: "open_access",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      reason: "SCIPDF_UNPAYWALL_EMAIL is not configured",
    });
  }

  // Run in a stable order so the returned audit history is complete and
  // deterministic. Stop after the first valid PDF.
  const providers: Array<[OaProvider, () => Promise<OaFetchOk | null>]> = [
    ["openalex", () => tryOpenAlexOa(doi, config)],
    ["europepmc", () => tryEuropePmc(doi, config)],
    ["semanticscholar", () => trySemanticScholar(doi, config)],
  ];
  for (const [provider, task] of providers) {
    const result = await runOaAttempt(provider, task, report);
    if (result) {
      debugLog(config, "OA win", provider, doi, result.pdfUrl);
      return result;
    }
  }
  return null;
}

export type { UnpaywallResult };
