import type {
  DownloadResult,
  PdfAttemptStatus,
  SciPdfConfig,
} from "../types.js";
import { fetchSafePublicBuffer } from "./http.js";
import { isPdfBuffer } from "./storage.js";
import { throttle } from "./rateLimit.js";
import { assertSafePublicUrl } from "./urlSafety.js";

export type PublisherSourceName = "elsevier" | "springer-nature" | "ieee";

export class PublisherPdfError extends Error {
  constructor(
    public readonly status: PdfAttemptStatus,
    message: string,
    public readonly httpStatus?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "PublisherPdfError";
  }
}

export interface PublisherPdfHit {
  pdfBytes: Uint8Array;
  source: Extract<
    NonNullable<DownloadResult["source"]>,
    PublisherSourceName
  >;
  url: string;
}

interface PublisherCredentials {
  apiKey?: string;
  instToken?: string;
  authToken?: string;
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function credentialsFor(source: PublisherSourceName): PublisherCredentials {
  if (source === "elsevier") {
    return {
      apiKey: env("SCIPDF_ELSEVIER_API_KEY"),
      instToken: env("SCIPDF_ELSEVIER_INSTTOKEN"),
      authToken: env("SCIPDF_ELSEVIER_AUTHTOKEN"),
    };
  }
  if (source === "springer-nature") {
    return { apiKey: env("SCIPDF_SPRINGER_NATURE_API_KEY") };
  }
  return { apiKey: env("SCIPDF_IEEE_API_KEY") };
}

export function publisherSourceConfigured(
  source: PublisherSourceName,
  config: SciPdfConfig,
): boolean {
  const creds = credentialsFor(source);
  if (!creds.apiKey) return false;
  if (source === "springer-nature") {
    return Boolean(config.springerNaturePdfEndpoint);
  }
  if (source === "ieee") return Boolean(config.ieeeFulltextEndpoint);
  return true;
}

export function publisherSupportsDoi(
  source: PublisherSourceName,
  doi: string,
): boolean {
  const normalized = doi.toLowerCase();
  if (source === "elsevier") {
    return /^(?:10\.1016|10\.1006|10\.1053|10\.1054|10\.1078|10\.1523|10\.1533|10\.1594|10\.3182)\//.test(
      normalized,
    );
  }
  if (source === "springer-nature") {
    return /^(?:10\.1007|10\.1038|10\.1057|10\.1186|10\.1365|10\.1385)\//.test(
      normalized,
    );
  }
  return normalized.startsWith("10.1109/");
}

/** Remove credentials before a URL is exposed in attempts or manifests. */
export function redactCredentialUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (
        /^(?:api[-_]?key|apikey|key|token|insttoken|authtoken|authorization)$/i.test(
          key,
        )
      ) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.href;
  } catch {
    return raw.replace(
      /([?&](?:api[-_]?key|apikey|key|token|insttoken|authtoken)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    );
  }
}

function redactPublisherSecrets(value: string): string {
  let redacted = redactCredentialUrl(value);
  for (const secret of [
    env("SCIPDF_ELSEVIER_API_KEY"),
    env("SCIPDF_ELSEVIER_INSTTOKEN"),
    env("SCIPDF_ELSEVIER_AUTHTOKEN"),
    env("SCIPDF_SPRINGER_NATURE_API_KEY"),
    env("SCIPDF_IEEE_API_KEY"),
  ]) {
    if (secret) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}

function configuredEndpoint(
  template: string,
  doi: string,
  apiKey: string,
  keyParameter: "api_key" | "apikey",
): string {
  const hadKeyTemplate = template.includes("{api_key}");
  let raw = template
    .replaceAll("{doi}", encodeURIComponent(doi))
    .replaceAll("{api_key}", encodeURIComponent(apiKey));
  const url = new URL(assertSafePublicUrl(raw));
  if (!template.includes("{doi}")) url.searchParams.set("doi", doi);
  if (!hadKeyTemplate) url.searchParams.set(keyParameter, apiKey);
  return url.href;
}

function statusForHttp(httpStatus: number): PdfAttemptStatus {
  if (httpStatus === 401 || httpStatus === 403) return "not_entitled";
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 429) return "rate_limited";
  return "request_failed";
}

async function requestPdf(
  source: PublisherSourceName,
  url: string,
  headers: Record<string, string>,
  config: SciPdfConfig,
): Promise<PublisherPdfHit> {
  let safeUrl: string;
  try {
    safeUrl = assertSafePublicUrl(url);
  } catch (error) {
    throw new PublisherPdfError(
      "request_failed",
      redactPublisherSecrets(
        error instanceof Error ? error.message : String(error),
      ),
      undefined,
      redactCredentialUrl(url),
    );
  }
  await throttle(config.minRequestGapMs, safeUrl);
  let response: Response;
  let buffer: Uint8Array;
  try {
    ({ response, buffer } = await fetchSafePublicBuffer(
      safeUrl,
      {
        redirect: "follow",
        headers: {
          Accept: "application/pdf",
          "User-Agent": config.userAgent,
          ...headers,
        },
      },
      config.timeoutMs,
    ));
  } catch (error) {
    const message = redactPublisherSecrets(
      error instanceof Error ? error.message : String(error),
    );
    throw new PublisherPdfError(
      error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "request_failed",
      `${source} request failed: ${message}`,
      undefined,
      redactCredentialUrl(safeUrl),
    );
  }
  if (!response.ok) {
    throw new PublisherPdfError(
      statusForHttp(response.status),
      `${source} PDF API returned HTTP ${response.status}`,
      response.status,
      redactCredentialUrl(safeUrl),
    );
  }
  if (!isPdfBuffer(buffer)) {
    throw new PublisherPdfError(
      "invalid_pdf",
      `${source} full-text endpoint did not return a valid PDF`,
      response.status,
      redactCredentialUrl(safeUrl),
    );
  }
  return {
    pdfBytes: buffer,
    source,
    url: redactCredentialUrl(response.url || safeUrl),
  };
}

export async function fetchPublisherPdf(
  source: PublisherSourceName,
  doi: string,
  config: SciPdfConfig,
): Promise<PublisherPdfHit> {
  const creds = credentialsFor(source);
  if (!creds.apiKey) {
    throw new PublisherPdfError(
      "skipped",
      `${source} API key is not configured`,
    );
  }

  if (source === "elsevier") {
    const url =
      `https://api.elsevier.com/content/article/doi/${encodeURIComponent(doi)}` +
      "?httpAccept=application%2Fpdf";
    const headers: Record<string, string> = {
      "X-ELS-APIKey": creds.apiKey,
    };
    if (creds.instToken) headers["X-ELS-Insttoken"] = creds.instToken;
    if (creds.authToken) headers["X-ELS-Authtoken"] = creds.authToken;
    return requestPdf(source, url, headers, config);
  }

  const template =
    source === "springer-nature"
      ? config.springerNaturePdfEndpoint
      : config.ieeeFulltextEndpoint;
  if (!template) {
    throw new PublisherPdfError(
      "skipped",
      `${source} authorized PDF endpoint is not configured`,
    );
  }
  let url: string;
  try {
    url = configuredEndpoint(
      template,
      doi,
      creds.apiKey,
      source === "ieee" ? "apikey" : "api_key",
    );
  } catch (error) {
    throw new PublisherPdfError(
      "request_failed",
      redactPublisherSecrets(
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  return requestPdf(source, url, {}, config);
}
