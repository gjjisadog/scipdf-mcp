import type { SciPdfConfig } from "../types.js";
import { throttle } from "./rateLimit.js";
import { debugLog } from "./debug.js";
import { isPdfBuffer } from "./storage.js";

const API = "https://api.unpaywall.org/v2";

export interface UnpaywallLocation {
  url_for_pdf?: string | null;
  url_for_landing_page?: string | null;
  host_type?: string | null;
  version?: string | null;
  license?: string | null;
  is_oa?: boolean;
}

export interface UnpaywallResult {
  doi: string;
  is_oa: boolean;
  title?: string;
  /** Best direct PDF URL if any */
  pdfUrl?: string;
  /** Landing page if no direct PDF */
  landingUrl?: string;
  hostType?: string;
  version?: string;
  license?: string;
}

interface UnpaywallResponse {
  doi?: string;
  title?: string;
  is_oa?: boolean;
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[];
}

function isValidEmail(email: string): boolean {
  const e = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  // Unpaywall rejects disposable placeholders (422)
  if (/@(example\.(com|org|net)|test\.com|localhost)$/i.test(e)) return false;
  return true;
}

export function hasUnpaywallEmail(config: SciPdfConfig): boolean {
  return Boolean(config.unpaywallEmail && isValidEmail(config.unpaywallEmail));
}

/** Mask email for logs / list_mirrors */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const u =
    user.length <= 2 ? "*".repeat(user.length) : user[0] + "***" + user.slice(-1);
  return `${u}@${domain}`;
}

/**
 * Query Unpaywall for OA PDF URL.
 * Requires a real email in config (Unpaywall API policy).
 * @see https://unpaywall.org/products/api
 */
export async function lookupUnpaywall(
  doi: string,
  config: SciPdfConfig,
): Promise<UnpaywallResult | null> {
  const email = config.unpaywallEmail?.trim();
  if (!email || !isValidEmail(email)) {
    return null;
  }

  await throttle(config.minRequestGapMs);
  const url = `${API}/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": `scipdf-mcp/0.3 (mailto:${email})`,
      },
    });
    if (res.status === 404) {
      return { doi, is_oa: false };
    }
    if (res.status === 422) {
      debugLog(
        config,
        "unpaywall 422: use your own real email (not example.com)",
      );
      return null;
    }
    if (!res.ok) {
      debugLog(config, "unpaywall HTTP", res.status, doi);
      return null;
    }
    const data = (await res.json()) as UnpaywallResponse;
    const locations = [
      data.best_oa_location,
      ...(data.oa_locations ?? []),
    ].filter(Boolean) as UnpaywallLocation[];

    let pdfUrl: string | undefined;
    let landingUrl: string | undefined;
    let hostType: string | undefined;
    let version: string | undefined;
    let license: string | undefined;

    for (const loc of locations) {
      if (loc.url_for_pdf && !pdfUrl) {
        pdfUrl = loc.url_for_pdf;
        hostType = loc.host_type ?? undefined;
        version = loc.version ?? undefined;
        license = loc.license ?? undefined;
      }
      if (loc.url_for_landing_page && !landingUrl) {
        landingUrl = loc.url_for_landing_page;
      }
    }

    return {
      doi: data.doi ?? doi,
      is_oa: Boolean(data.is_oa),
      title: data.title,
      pdfUrl,
      landingUrl,
      hostType,
      version,
      license,
    };
  } catch (e) {
    debugLog(config, "unpaywall error", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Download a direct PDF URL (OA link) */
export async function downloadOaPdf(
  pdfUrl: string,
  config: SciPdfConfig,
): Promise<Uint8Array> {
  await throttle(config.minRequestGapMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(pdfUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": config.userAgent,
        Accept: "application/pdf,*/*",
      },
    });
    if (!res.ok) {
      throw new Error(`OA PDF HTTP ${res.status}: ${pdfUrl}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!isPdfBuffer(buf)) {
      throw new Error(`OA URL did not return a PDF: ${pdfUrl}`);
    }
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try Unpaywall: lookup + download PDF if available.
 * Opt-in only — caller must check preferOa + email.
 * Returns null if not OA or no usable PDF.
 */
export async function fetchPdfViaUnpaywall(
  doi: string,
  config: SciPdfConfig,
): Promise<{ pdfBytes: Uint8Array; pdfUrl: string; meta: UnpaywallResult } | null> {
  if (!hasUnpaywallEmail(config)) {
    debugLog(config, "unpaywall skipped: no email configured");
    return null;
  }

  const meta = await lookupUnpaywall(doi, config);
  if (!meta?.is_oa || !meta.pdfUrl) {
    debugLog(config, "unpaywall no OA pdf", doi, meta?.is_oa);
    return null;
  }

  try {
    const pdfBytes = await downloadOaPdf(meta.pdfUrl, config);
    debugLog(config, "unpaywall pdf ok", meta.pdfUrl, pdfBytes.byteLength);
    return { pdfBytes, pdfUrl: meta.pdfUrl, meta };
  } catch (e) {
    debugLog(config, "unpaywall download failed", e);
    return null;
  }
}
