export type FilenameStyle = "doi" | "author_year_title";

export type ErrorCode =
  | "EMPTY_QUERY"
  | "INVALID_DOI"
  | "INVALID_ARXIV_ID"
  | "DOI_NOT_FOUND"
  | "AMBIGUOUS_DOI"
  | "URL_NO_DOI"
  | "PDF_NOT_IN_DB"
  | "MIRROR_BLOCKED"
  | "ALL_SOURCES_FAILED"
  | "INVALID_PDF"
  | "IO_ERROR"
  | "UNKNOWN";

export type DownloadStatus =
  | "downloaded"
  | "cached"
  | "invalid_request"
  | "not_found"
  | "not_entitled"
  | "rate_limited"
  | "blocked"
  | "invalid_pdf"
  | "all_sources_failed"
  | "io_error"
  | "unknown_error";

export type PdfAttemptStatus =
  | "success"
  | "skipped"
  | "not_found"
  | "not_entitled"
  | "rate_limited"
  | "blocked"
  | "timeout"
  | "invalid_pdf"
  | "request_failed";

export interface OaEvidence {
  provider: string;
  hostType?: string;
  version?: string;
  license?: string;
  pdfUrl?: string;
}

/** One auditable source probe. URLs are credential-redacted before exposure. */
export interface PdfAttempt {
  source: string;
  status: PdfAttemptStatus;
  legal: boolean;
  accessMode:
    | "open_access"
    | "publisher_api"
    | "repository"
    | "legacy"
    | "cache";
  startedAt: string;
  durationMs?: number;
  url?: string;
  httpStatus?: number;
  reason?: string;
  oaEvidence?: OaEvidence;
}

/** Compact multi-source failure breakdown for agents / CLI. */
export interface SourceFailureSummary {
  attempted: number;
  absent: number;
  blocked: number;
  /** Reachable mirror temporarily unavailable (HTTP 502/503). */
  unavailable?: number;
  timeouts: number;
  other: number;
  earlyStop?: boolean;
  /** First few raw `host: message` lines */
  samples: string[];
}

export interface SciPdfConfig {
  downloadDir: string;
  scihubMirrors: string[];
  /** Direct PDF base URLs, e.g. https://sci.bban.top/pdf/ */
  pdfHosts: string[];
  timeoutMs: number;
  /** Short timeout for known-bad / blocked responses */
  fastFailTimeoutMs: number;
  concurrency: number;
  userAgent: string;
  filenameStyle: FilenameStyle;
  /** Mirror health cache TTL (ms) */
  healthCacheTtlMs: number;
  /** Global rate limit: min gap between outbound requests (ms) */
  minRequestGapMs: number;
  /**
   * How many sources (pdfHosts / mirrors) to probe in parallel.
   * Default 5 (aggressive). Env: SCIPDF_RACE_WIDTH
   */
  sourceRaceWidth: number;
  /**
   * Stop after this many independent "PDF not in Sci-Hub DB" confirmations
   * instead of draining every mirror. Default 1 (mirrors share one DB).
   * Env: SCIPDF_NOT_FOUND_CONFIRM
   */
  pdfNotFoundConfirmations: number;
  debug: boolean;
  /**
   * Optional. Unpaywall only runs when this is set AND preferOa is true.
   * Env: SCIPDF_UNPAYWALL_EMAIL (must be a real email you own)
   */
  unpaywallEmail?: string;
  /**
   * Opt-in: try free OA providers (and Unpaywall when email is set) before Sci-Hub.
   * Default false — default path is Sci-Hub / pdfHosts.
   * Env: SCIPDF_PREFER_OA=true
   */
  preferOa: boolean;
  /** Allow Sci-Hub / pdfHosts (default true) */
  allowScihub: boolean;
  /**
   * Optional authorized PDF endpoint template for Springer Nature.
   * Supports `{doi}`. API credentials are always read from env.
   */
  springerNaturePdfEndpoint?: string;
  /**
   * Optional authorized IEEE full-text endpoint template.
   * Supports `{doi}`. API credentials are always read from env.
   */
  ieeeFulltextEndpoint?: string;
}

export type QueryType =
  | "auto"
  | "doi"
  | "arxiv"
  | "url"
  | "title"
  | "citation";

export type PaperIdentifier =
  | { kind: "doi"; value: string }
  | { kind: "arxiv"; value: string };

export interface PaperIdentifiers {
  doi?: string;
  arxivId?: string;
  semanticScholarId?: string;
  openAlexId?: string;
  sourceUrl?: string;
}

export interface DownloadResult {
  ok: boolean;
  status?: DownloadStatus;
  index?: number;
  query: string;
  doi?: string;
  arxivId?: string;
  title?: string;
  authors?: string[];
  year?: number;
  path?: string;
  source?:
    | "scihub"
    | "unpaywall"
    | "openalex"
    | "europepmc"
    | "semanticscholar"
    | "arxiv"
    | "elsevier"
    | "springer-nature"
    | "ieee"
    | "cache";
  mirror?: string;
  /** OA license / version hint when source is an OA provider */
  oa?: {
    provider?: string;
    hostType?: string;
    version?: string;
    license?: string;
    pdfUrl?: string;
  };

  bytes?: number;
  /** SHA-256 of the saved or cached PDF, lowercase hexadecimal. */
  sha256?: string;
  cached?: boolean;
  /** Ordered source history for this download. */
  attempts?: PdfAttempt[];
  code?: ErrorCode;
  error?: string;
  /** Structured multi-source failure stats (when download fails) */
  failure?: SourceFailureSummary;
  candidates?: Array<{ doi: string; title?: string; score?: number }>;
  citation?: {
    apa?: string;
    gbt?: string;
    bibtex?: string;
  };
}

export interface BatchDownloadResult {
  results: DownloadResult[];
  succeeded: number;
  failed: number;
  total: number;
  deduped: number;
  manifestPath?: string;
}

export interface ResolveResult {
  ok: boolean;
  query: string;
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  container?: string;
  source?: "doi" | "crossref" | "openalex" | "url";
  code?: ErrorCode;
  error?: string;
  candidates?: Array<{
    doi: string;
    title?: string;
    score?: number;
    source?: string;
  }>;
}

export interface MirrorStatus {
  url: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
  cached?: boolean;
}

export interface CrossrefWork {
  doi: string;
  title?: string;
  authors?: string[];
  year?: number;
  container?: string;
  score?: number;
  abstract?: string;
  citationCount?: number;
  isOpenAccess?: boolean;
  pdfUrl?: string;
  url?: string;
  publicationType?: string;
}

export type PaperSearchSource =
  | "crossref"
  | "openalex"
  | "semanticscholar"
  | "arxiv";

export interface PaperSearchResult {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  identifiers?: PaperIdentifiers;
  abstract?: string;
  venue?: string;
  citationCount?: number;
  isOpenAccess?: boolean;
  openAccessPdf?: string;
  url?: string;
  publicationType?: string;
  /** Reciprocal-rank-fusion score across all contributing sources. */
  relevanceScore: number;
  /** Sources that contributed metadata for this deduplicated result. */
  sources: PaperSearchSource[];
}

export interface SearchPapersOptions {
  sources?: PaperSearchSource[];
  limit?: number;
  yearFrom?: number;
  yearTo?: number;
  minCitations?: number;
  openAccessOnly?: boolean;
  timeoutMs?: number;
}

export interface SearchPapersResult {
  query: string;
  total: number;
  sources: PaperSearchSource[];
  results: PaperSearchResult[];
}

export type PaperRelation = "citations" | "references" | "related";

export interface PaperRelationResult {
  paperId: string;
  relation: PaperRelation;
  total: number;
  results: PaperSearchResult[];
}

export interface ExtractPaperTextResult {
  ok: boolean;
  path: string;
  textPath?: string;
  pages?: number;
  totalPages?: number;
  chars?: number;
  preview?: string;
  error?: string;
}

export type ReferenceAuditStatus =
  | "verified"
  | "resolved"
  | "unverified"
  | "ambiguous"
  | "not_found";

export interface ReferenceAuditEntry {
  input: string;
  status: ReferenceAuditStatus;
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  container?: string;
  source?: ResolveResult["source"];
  code?: ErrorCode;
  error?: string;
  citation?: {
    apa: string;
    gbt: string;
    bibtex: string;
  };
}

export interface AuditReferencesResult {
  total: number;
  verified: number;
  resolved: number;
  unverified: number;
  failed: number;
  results: ReferenceAuditEntry[];
}
