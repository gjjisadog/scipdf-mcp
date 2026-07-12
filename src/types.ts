export interface SciPdfConfig {
  downloadDir: string;
  scihubMirrors: string[];
  /** Direct PDF base URLs tried when HTML mirrors fail, e.g. https://sci.bban.top/pdf/ */
  pdfHosts: string[];
  timeoutMs: number;
  concurrency: number;
  userAgent: string;
}

export type QueryType = "auto" | "doi" | "url" | "title";

export interface DownloadResult {
  ok: boolean;
  query: string;
  doi?: string;
  title?: string;
  path?: string;
  source?: "scihub";
  mirror?: string;
  bytes?: number;
  error?: string;
}

export interface MirrorStatus {
  url: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface CrossrefWork {
  doi: string;
  title?: string;
  authors?: string[];
  year?: number;
  container?: string;
  score?: number;
}
