import type {
  DownloadResult,
  PaperIdentifier,
  PdfAttempt,
  PdfAttemptStatus,
  SciPdfConfig,
} from "../types.js";
import { fetchArxivPdf } from "./arxiv.js";
import { codeFromError, SciPdfError } from "./errors.js";
import { failureFromCaught } from "./failureSummary.js";
import { fetchPdfViaOa } from "./oa.js";
import {
  fetchPublisherPdf,
  publisherSourceConfigured,
  publisherSupportsDoi,
  PublisherPdfError,
  type PublisherSourceName,
} from "./publisherSources.js";
import { fetchPdfViaSciHub } from "./scihub.js";

export type PdfSourceName =
  | "arxiv"
  | PublisherSourceName
  | "doi-oa"
  | "legacy";

export interface PdfSourceHit {
  pdfBytes: Uint8Array;
  source: NonNullable<DownloadResult["source"]>;
  url?: string;
  titleHint?: string;
  oa?: DownloadResult["oa"];
  attempts: PdfAttempt[];
}

export interface PdfSource {
  name: PdfSourceName;
  legal: boolean;
  accessMode: PdfAttempt["accessMode"];
  identifiers: PaperIdentifier["kind"][];
  supports(identifier: PaperIdentifier, config: SciPdfConfig): boolean;
  fetch(
    identifier: PaperIdentifier,
    config: SciPdfConfig,
    report: (attempt: PdfAttempt) => void,
  ): Promise<Omit<PdfSourceHit, "attempts"> | null>;
}

function publisherSource(source: PublisherSourceName): PdfSource {
  return {
    name: source,
    legal: true,
    accessMode: "publisher_api",
    identifiers: ["doi"],
    supports: (identifier, config) =>
      identifier.kind === "doi" &&
      publisherSupportsDoi(source, identifier.value) &&
      publisherSourceConfigured(source, config),
    async fetch(identifier, config) {
      if (identifier.kind !== "doi") return null;
      return await fetchPublisherPdf(source, identifier.value, config);
    },
  };
}

const PDF_SOURCES: PdfSource[] = [
  {
    name: "arxiv",
    legal: true,
    accessMode: "repository",
    identifiers: ["arxiv"],
    supports: (identifier) => identifier.kind === "arxiv",
    async fetch(identifier, config) {
      if (identifier.kind !== "arxiv") return null;
      const result = await fetchArxivPdf(identifier.value, config);
      return {
        pdfBytes: result.pdfBytes,
        source: "arxiv",
        url: result.pdfUrl,
        oa: {
          provider: "arxiv",
          hostType: "repository",
          version: "submittedVersion",
          pdfUrl: result.pdfUrl,
        },
      };
    },
  },
  publisherSource("elsevier"),
  publisherSource("springer-nature"),
  publisherSource("ieee"),
  {
    name: "doi-oa",
    legal: true,
    accessMode: "open_access",
    identifiers: ["doi"],
    supports: (identifier, config) =>
      identifier.kind === "doi" && config.preferOa,
    async fetch(identifier, config, report) {
      if (identifier.kind !== "doi") return null;
      const result = await fetchPdfViaOa(identifier.value, config, report);
      if (!result) return null;
      return {
        pdfBytes: result.pdfBytes,
        source: result.provider,
        url: result.pdfUrl,
        titleHint: result.meta?.title,
        oa: {
          provider: result.provider,
          hostType: result.meta?.hostType,
          version: result.meta?.version,
          license: result.meta?.license,
          pdfUrl: result.pdfUrl,
        },
      };
    },
  },
  {
    name: "legacy",
    legal: false,
    accessMode: "legacy",
    identifiers: ["doi"],
    supports: (identifier, config) =>
      identifier.kind === "doi" && config.allowScihub,
    async fetch(identifier, config) {
      if (identifier.kind !== "doi") return null;
      const result = await fetchPdfViaSciHub(identifier.value, config);
      return {
        pdfBytes: result.pdfBytes,
        source: "scihub",
        url: result.mirror,
      };
    },
  },
];

export function listPdfSources(config?: SciPdfConfig): Array<{
  name: PdfSourceName;
  legal: boolean;
  identifiers: PaperIdentifier["kind"][];
  configured?: boolean;
  accessMode?: PdfAttempt["accessMode"];
}> {
  return PDF_SOURCES.map((source) => ({
    name: source.name,
    legal: source.legal,
    identifiers: [...source.identifiers],
    ...(config
      ? {
          configured:
            source.name === "arxiv" ||
            (source.name === "doi-oa" && config.preferOa) ||
            (source.name === "legacy" && config.allowScihub) ||
            (source.name !== "doi-oa" &&
              source.name !== "legacy" &&
              publisherSourceConfigured(source.name, config)),
          accessMode: source.accessMode,
        }
      : {}),
  }));
}

function statusFromError(error: unknown): PdfAttemptStatus {
  if (error instanceof PublisherPdfError) return error.status;
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/i.test(message)) return "timeout";
  if (/\b401\b|\b403\b|entitlement|not entitled/i.test(message)) {
    return "not_entitled";
  }
  if (/\b429\b|rate.?limit|quota/i.test(message)) return "rate_limited";
  if (/cloudflare|challenge|blocked|ddos/i.test(message)) return "blocked";
  if (/not a valid PDF|invalid PDF|did not return a PDF/i.test(message)) {
    return "invalid_pdf";
  }
  if (/\b404\b|not found|not available|no PDF/i.test(message)) {
    return "not_found";
  }
  return "request_failed";
}

function codeFromAttempts(attempts: PdfAttempt[]) {
  const terminal = attempts.at(-1)?.status;
  if (terminal === "not_found") return "PDF_NOT_IN_DB" as const;
  if (terminal === "invalid_pdf") return "INVALID_PDF" as const;
  if (terminal === "blocked") return "MIRROR_BLOCKED" as const;
  return "ALL_SOURCES_FAILED" as const;
}

function attemptFor(
  source: PdfSource,
  status: PdfAttemptStatus,
  startedAt: string,
  started: number,
  details: {
    url?: string;
    httpStatus?: number;
    reason?: string;
    oaEvidence?: PdfAttempt["oaEvidence"];
  } = {},
): PdfAttempt {
  return {
    source: source.name,
    status,
    legal: source.legal,
    accessMode: source.accessMode,
    startedAt,
    durationMs: Date.now() - started,
    ...details,
  };
}

export async function fetchPdfFromSources(
  identifier: PaperIdentifier,
  config: SciPdfConfig,
): Promise<PdfSourceHit> {
  const attempts: PdfAttempt[] = [];
  const candidates = PDF_SOURCES.filter((source) =>
    source.supports(identifier, config),
  );
  let lastError: unknown;

  for (const source of candidates) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const attemptsBefore = attempts.length;
    try {
      const hit = await source.fetch(identifier, config, (attempt) =>
        attempts.push(attempt),
      );
      if (hit) {
        // OA providers report their own granular attempts.
        if (attempts.length === attemptsBefore) {
          attempts.push(
            attemptFor(source, "success", startedAt, started, {
              url: hit.url,
              oaEvidence: hit.oa
                ? {
                    provider: hit.oa.provider ?? source.name,
                    hostType: hit.oa.hostType,
                    version: hit.oa.version,
                    license: hit.oa.license,
                    pdfUrl: hit.oa.pdfUrl,
                  }
                : undefined,
            }),
          );
        }
        return { ...hit, attempts };
      }
      if (attempts.length === attemptsBefore) {
        attempts.push(
          attemptFor(source, "not_found", startedAt, started, {
            reason: "Source returned no usable PDF",
          }),
        );
      }
    } catch (error) {
      lastError = error;
      const publisherError =
        error instanceof PublisherPdfError ? error : undefined;
      attempts.push(
        attemptFor(source, statusFromError(error), startedAt, started, {
          url: publisherError?.url,
          httpStatus: publisherError?.httpStatus,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if (identifier.kind === "arxiv") {
    const error = new SciPdfError(
      attempts.some((attempt) => attempt.status === "invalid_pdf")
        ? "INVALID_PDF"
        : "PDF_NOT_IN_DB",
      `No valid arXiv PDF found for ${identifier.value}.`,
    );
    error.attempts = attempts;
    throw error;
  }

  if (lastError) {
    const error = new SciPdfError(
      codeFromError(lastError) === "UNKNOWN"
        ? codeFromAttempts(attempts)
        : codeFromError(lastError),
      lastError instanceof Error ? lastError.message : String(lastError),
      undefined,
      failureFromCaught(lastError),
    );
    error.attempts = attempts;
    throw error;
  }

  const error = new SciPdfError(
    "PDF_NOT_IN_DB",
    config.preferOa
      ? "No configured source returned a usable PDF."
      : "No publisher PDF source is configured, the fallback chain is disabled, and OA is not enabled.",
  );
  error.attempts = attempts;
  throw error;
}
