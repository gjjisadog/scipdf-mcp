export type FilenameStyle = "doi" | "author_year_title";

export type ErrorCode =
  | "EMPTY_QUERY"
  | "INVALID_DOI"
  | "DOI_NOT_FOUND"
  | "AMBIGUOUS_DOI"
  | "URL_NO_DOI"
  | "PDF_NOT_IN_DB"
  | "MIRROR_BLOCKED"
  | "ALL_SOURCES_FAILED"
  | "INVALID_PDF"
  | "IO_ERROR"
  | "UNKNOWN";

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
  debug: boolean;
  /**
   * Optional. Unpaywall only runs when this is set AND preferOa is true.
   * Env: SCIPDF_UNPAYWALL_EMAIL (must be a real email you own)
   */
  unpaywallEmail?: string;
  /**
   * Opt-in: try Unpaywall OA before Sci-Hub.
   * Default false — default path is Sci-Hub / pdfHosts.
   * Env: SCIPDF_PREFER_OA=true
   */
  preferOa: boolean;
  /** Allow Sci-Hub / pdfHosts (default true) */
  allowScihub: boolean;
}

export type QueryType = "auto" | "doi" | "url" | "title" | "citation";

export interface DownloadResult {
  ok: boolean;
  index?: number;
  query: string;
  doi?: string;
  title?: string;
  authors?: string[];
  year?: number;
  path?: string;
  source?: "scihub" | "unpaywall" | "cache";
  mirror?: string;
  /** OA license / version hint when source is unpaywall */
  oa?: {
    hostType?: string;
    version?: string;
    license?: string;
    pdfUrl?: string;
  };

  bytes?: number;
  cached?: boolean;
  code?: ErrorCode;
  error?: string;
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
}
