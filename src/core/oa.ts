/**
 * Optional Open Access PDF fetchers (preferOa path).
 * Unpaywall (email) + free APIs: OpenAlex OA, Europe PMC, Semantic Scholar.
 */

import type { SciPdfConfig } from "../types.js";
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
  try {
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
    if (!response.ok || !data) return null;
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
  } catch (e) {
    debugLog(config, "openalex OA failed", doi, e);
    return null;
  }
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
  try {
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
    if (!response.ok || !data) return null;
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
  } catch (e) {
    debugLog(config, "europepmc OA failed", doi, e);
    return null;
  }
}

async function trySemanticScholar(
  doi: string,
  config: SciPdfConfig,
): Promise<OaFetchOk | null> {
  const url =
    `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}` +
    `?fields=title,openAccessPdf`;
  try {
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
    if (!response.ok || !data?.openAccessPdf?.url) return null;
    const pdfUrl = data.openAccessPdf.url;
    const pdfBytes = await downloadPdfUrl(pdfUrl, config);
    return {
      pdfBytes,
      pdfUrl,
      provider: "semanticscholar",
      meta: { title: data.title, hostType: "semanticscholar" },
    };
  } catch (e) {
    debugLog(config, "semanticscholar OA failed", doi, e);
    return null;
  }
}

/**
 * Prefer-OA pipeline: Unpaywall (if email) → OpenAlex → Europe PMC → Semantic Scholar.
 * Returns null if none yield a valid PDF.
 */
export async function fetchPdfViaOa(
  doi: string,
  config: SciPdfConfig,
): Promise<OaFetchOk | null> {
  if (hasUnpaywallEmail(config)) {
    const u = await fetchPdfViaUnpaywall(doi, config);
    if (u) {
      return {
        pdfBytes: u.pdfBytes,
        pdfUrl: u.pdfUrl,
        provider: "unpaywall",
        meta: {
          title: u.meta.title,
          hostType: u.meta.hostType,
          version: u.meta.version,
          license: u.meta.license,
        },
      };
    }
  } else {
    debugLog(config, "unpaywall skipped in OA pipeline (no email)");
  }

  // Free OA APIs in parallel — first valid PDF wins
  const racers: Array<Promise<OaFetchOk | null>> = [
    tryOpenAlexOa(doi, config),
    tryEuropePmc(doi, config),
    trySemanticScholar(doi, config),
  ];

  return await firstOaWin(racers, config, doi);
}

async function firstOaWin(
  tasks: Array<Promise<OaFetchOk | null>>,
  config: SciPdfConfig,
  doi: string,
): Promise<OaFetchOk | null> {
  return new Promise((resolve) => {
    let pending = tasks.length;
    let done = false;
    if (pending === 0) {
      resolve(null);
      return;
    }
    for (const t of tasks) {
      t.then(
        (r) => {
          pending--;
          if (done) return;
          if (r) {
            done = true;
            debugLog(config, "OA win", r.provider, doi, r.pdfUrl);
            resolve(r);
            return;
          }
          if (pending === 0) resolve(null);
        },
        () => {
          pending--;
          if (!done && pending === 0) resolve(null);
        },
      );
    }
  });
}

export type { UnpaywallResult };
