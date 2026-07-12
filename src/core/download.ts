import type { SciPdfConfig, DownloadResult, QueryType } from "../types.js";
import {
  extractDoiFromText,
  looksLikeDoi,
  looksLikeUrl,
  normalizeDoi,
} from "./doi.js";
import {
  getWorkByDoi,
  pickBestWork,
  searchByTitle,
} from "./crossref.js";
import { fetchPdfViaSciHub, PdfNotFoundError } from "./scihub.js";
import {
  buildPdfPath,
  ensureDir,
  fileExists,
  savePdf,
} from "./storage.js";

export interface DownloadOptions {
  query: string;
  queryType?: QueryType;
  outdir?: string;
  filename?: string;
  force?: boolean;
}

export async function resolveToDoi(
  query: string,
  queryType: QueryType = "auto",
  timeoutMs = 15_000,
): Promise<{ doi: string; title?: string }> {
  const q = query.trim();
  if (!q) throw new Error("Empty query");

  const type =
    queryType === "auto"
      ? looksLikeDoi(q)
        ? "doi"
        : looksLikeUrl(q)
          ? "url"
          : "title"
      : queryType;

  if (type === "doi") {
    const doi = normalizeDoi(q);
    if (!doi) throw new Error(`Invalid DOI: ${q}`);
    const meta = await getWorkByDoi(doi, timeoutMs);
    return { doi, title: meta?.title };
  }

  if (type === "url") {
    const fromUrl = extractDoiFromText(q);
    if (fromUrl) {
      const meta = await getWorkByDoi(fromUrl, timeoutMs);
      return { doi: fromUrl, title: meta?.title };
    }
    // Some Sci-Hub mirrors accept the full URL as path; still need a DOI for naming.
    // Try Crossref reverse lookup is not available without Unpaywall; fail clearly.
    throw new Error(
      `Could not extract a DOI from URL. Paste a DOI or a doi.org link. URL: ${q}`,
    );
  }

  // title search
  const works = await searchByTitle(q, timeoutMs);
  const best = pickBestWork(works, 20, q);
  if (!best) {
    const hint =
      works[0] != null
        ? ` Top candidate was ${works[0].doi} (score=${works[0].score}, title=${works[0].title}).`
        : "";
    throw new Error(
      `No confident Crossref match for title: "${q}". Try providing a DOI instead.${hint}`,
    );
  }
  return { doi: best.doi, title: best.title };
}

export async function downloadPaper(
  options: DownloadOptions,
  config: SciPdfConfig,
): Promise<DownloadResult> {
  const query = options.query.trim();
  try {
    const { doi, title } = await resolveToDoi(
      query,
      options.queryType ?? "auto",
      Math.min(config.timeoutMs, 20_000),
    );

    const downloadDir = options.outdir ?? config.downloadDir;
    await ensureDir(downloadDir);
    const path = buildPdfPath(downloadDir, doi, options.filename);

    if (!options.force && (await fileExists(path))) {
      return {
        ok: true,
        query,
        doi,
        title,
        path,
        source: "scihub",
        error: "already_exists (use force=true to re-download)",
      };
    }

    const { pdfBytes, mirror } = await fetchPdfViaSciHub(doi, config);
    const bytes = await savePdf(path, pdfBytes);

    return {
      ok: true,
      query,
      doi,
      title,
      path,
      source: "scihub",
      mirror,
      bytes,
    };
  } catch (e) {
    const error =
      e instanceof PdfNotFoundError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    return {
      ok: false,
      query,
      error,
    };
  }
}

/** Simple concurrency pool */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export async function downloadPapers(
  queries: string[],
  config: SciPdfConfig,
  extras?: Omit<DownloadOptions, "query">,
): Promise<DownloadResult[]> {
  return mapPool(queries, config.concurrency, (query) =>
    downloadPaper({ query, ...extras }, config),
  );
}
