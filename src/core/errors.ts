import type { ErrorCode, SourceFailureSummary } from "../types.js";

export class SciPdfError extends Error {
  code: ErrorCode;
  candidates?: Array<{ doi: string; title?: string; score?: number }>;
  failure?: SourceFailureSummary;

  constructor(
    code: ErrorCode,
    message: string,
    candidates?: Array<{ doi: string; title?: string; score?: number }>,
    failure?: SourceFailureSummary,
  ) {
    super(message);
    this.name = "SciPdfError";
    this.code = code;
    this.candidates = candidates;
    this.failure = failure;
  }
}

export function codeFromError(e: unknown): ErrorCode {
  if (e instanceof SciPdfError) return e.code;
  if (e && typeof e === "object" && "name" in e) {
    const name = String((e as { name: string }).name);
    if (name === "PdfNotFoundError") return "PDF_NOT_IN_DB";
    if (name === "MirrorError") {
      const msg = e instanceof Error ? e.message : "";
      if (/403|cloudflare|ddos|just a moment|challenge/i.test(msg))
        return "MIRROR_BLOCKED";
      if (/not a valid PDF|invalid pdf|claimed PDF/i.test(msg))
        return "INVALID_PDF";
      return "ALL_SOURCES_FAILED";
    }
    if (name === "BodyTooLargeError") return "INVALID_PDF";
  }

  // Node system errors (ENOSPC, EACCES, …) → IO_ERROR
  if (e && typeof e === "object" && "code" in e) {
    const sys = String((e as { code: unknown }).code);
    if (
      /^(EACCES|EPERM|ENOSPC|EROFS|EIO|ENOENT|ENOTDIR|EEXIST|EMFILE|ENFILE)$/.test(
        sys,
      )
    ) {
      return "IO_ERROR";
    }
  }

  const msg = e instanceof Error ? e.message : String(e);
  if (/Invalid DOI/i.test(msg)) return "INVALID_DOI";
  if (/Empty query/i.test(msg)) return "EMPTY_QUERY";
  if (/No confident|No match|not found/i.test(msg)) return "DOI_NOT_FOUND";
  if (/Could not extract a DOI from URL/i.test(msg)) return "URL_NO_DOI";
  if (/All Sci-Hub|All .* sources failed/i.test(msg)) {
    // Preserve more specific codes when the aggregate message still names them
    if (/cloudflare|ddos|challenge|403/i.test(msg) && /failed/i.test(msg)) {
      // only if every line looks blocked? keep ALL_SOURCES unless clearly uniform
      if (
        !/Could not find PDF|HTTP 404|HTTP 5|timeout|fetch failed|ENOTFOUND/i.test(
          msg,
        )
      ) {
        return "MIRROR_BLOCKED";
      }
    }
    if (/not a valid PDF|invalid pdf/i.test(msg) && !/HTTP|timeout|find PDF/i.test(msg)) {
      return "INVALID_PDF";
    }
    return "ALL_SOURCES_FAILED";
  }
  if (
    /EACCES|EPERM|ENOSPC|EROFS|permission denied|no space|read-only/i.test(msg)
  ) {
    return "IO_ERROR";
  }
  return "UNKNOWN";
}

/**
 * Choose the best aggregate error code from a list of per-source failures.
 */
export function aggregateSourceErrors(messages: string[]): ErrorCode {
  if (messages.length === 0) return "ALL_SOURCES_FAILED";
  const codes = messages.map((m) => {
    if (/403|cloudflare|ddos|challenge|just a moment/i.test(m))
      return "MIRROR_BLOCKED" as ErrorCode;
    if (/not a valid PDF|invalid pdf|claimed PDF/i.test(m))
      return "INVALID_PDF" as ErrorCode;
    if (
      /not found|not available|PDF not available|Could not find PDF link|no PDF link|\bHTTP 404\b/i.test(
        m,
      )
    )
      return "PDF_NOT_IN_DB" as ErrorCode;
    return "ALL_SOURCES_FAILED" as ErrorCode;
  });
  const allSame = codes.every((c) => c === codes[0]);
  if (allSame) return codes[0];
  // Prefer blocked over generic when any blocked and rest are also transport failures
  if (codes.every((c) => c === "MIRROR_BLOCKED" || c === "ALL_SOURCES_FAILED")) {
    if (codes.filter((c) => c === "MIRROR_BLOCKED").length >= codes.length / 2) {
      return "MIRROR_BLOCKED";
    }
  }
  return "ALL_SOURCES_FAILED";
}
