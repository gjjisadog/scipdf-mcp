import type { ErrorCode } from "../types.js";

export class SciPdfError extends Error {
  code: ErrorCode;
  candidates?: Array<{ doi: string; title?: string; score?: number }>;

  constructor(
    code: ErrorCode,
    message: string,
    candidates?: Array<{ doi: string; title?: string; score?: number }>,
  ) {
    super(message);
    this.name = "SciPdfError";
    this.code = code;
    this.candidates = candidates;
  }
}

export function codeFromError(e: unknown): ErrorCode {
  if (e instanceof SciPdfError) return e.code;
  if (e && typeof e === "object" && "name" in e) {
    const name = String((e as { name: string }).name);
    if (name === "PdfNotFoundError") return "PDF_NOT_IN_DB";
    if (name === "MirrorError") {
      const msg = e instanceof Error ? e.message : "";
      if (/403|cloudflare|ddos|just a moment/i.test(msg)) return "MIRROR_BLOCKED";
      if (/not a valid PDF/i.test(msg)) return "INVALID_PDF";
      return "ALL_SOURCES_FAILED";
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/Invalid DOI/i.test(msg)) return "INVALID_DOI";
  if (/Empty query/i.test(msg)) return "EMPTY_QUERY";
  if (/No confident|No match|not found/i.test(msg)) return "DOI_NOT_FOUND";
  if (/Could not extract a DOI from URL/i.test(msg)) return "URL_NO_DOI";
  if (/All Sci-Hub|All .* sources failed/i.test(msg)) return "ALL_SOURCES_FAILED";
  return "UNKNOWN";
}
