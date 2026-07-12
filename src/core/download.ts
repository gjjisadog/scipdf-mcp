import type {
  SciPdfConfig,
  DownloadResult,
  QueryType,
  BatchDownloadResult,
  ResolveResult,
} from "../types.js";
import {
  extractDoiFromText,
  looksLikeDoi,
  looksLikeUrl,
  normalizeDoi,
} from "./doi.js";
import { getWorkByDoi, pickBestWork, searchByTitle } from "./crossref.js";
import { searchOpenAlex } from "./openalex.js";
import {
  citationToSearchQuery,
  extractQueriesFromText,
  looksLikeCitation,
} from "./citations.js";
import { buildCitations } from "./citeFormat.js";
import { fetchPdfViaSciHub } from "./scihub.js";
import { SciPdfError, codeFromError } from "./errors.js";
import {
  buildPdfPath,
  ensureDir,
  fileExists,
  savePdf,
  writeManifest,
} from "./storage.js";

export interface DownloadOptions {
  query: string;
  queryType?: QueryType;
  outdir?: string;
  filename?: string;
  force?: boolean;
  withCitation?: boolean;
}

function inferType(q: string, queryType: QueryType = "auto"): QueryType {
  if (queryType !== "auto") return queryType;
  if (looksLikeDoi(q)) return "doi";
  if (looksLikeUrl(q)) return "url";
  if (looksLikeCitation(q)) return "citation";
  return "title";
}

export async function resolveToDoi(
  query: string,
  queryType: QueryType = "auto",
  timeoutMs = 15_000,
): Promise<ResolveResult> {
  const q0 = query.trim();
  if (!q0) {
    return { ok: false, query: q0, code: "EMPTY_QUERY", error: "Empty query" };
  }

  const type = inferType(q0, queryType);
  const q = type === "citation" ? citationToSearchQuery(q0) : q0;

  if (type === "doi" || looksLikeDoi(q)) {
    const doi = normalizeDoi(q);
    if (!doi) {
      return {
        ok: false,
        query: q0,
        code: "INVALID_DOI",
        error: `Invalid DOI: ${q}`,
      };
    }
    const meta = await getWorkByDoi(doi, timeoutMs);
    return {
      ok: true,
      query: q0,
      doi,
      title: meta?.title,
      authors: meta?.authors,
      year: meta?.year,
      container: meta?.container,
      source: "doi",
    };
  }

  if (type === "url") {
    const fromUrl = extractDoiFromText(q);
    if (fromUrl) {
      const meta = await getWorkByDoi(fromUrl, timeoutMs);
      return {
        ok: true,
        query: q0,
        doi: fromUrl,
        title: meta?.title,
        authors: meta?.authors,
        year: meta?.year,
        container: meta?.container,
        source: "url",
      };
    }
    return {
      ok: false,
      query: q0,
      code: "URL_NO_DOI",
      error: `Could not extract a DOI from URL: ${q}`,
    };
  }

  // title / citation search: Crossref then OpenAlex
  const crossref = await searchByTitle(q, timeoutMs);
  let best = pickBestWork(crossref, 20, q);
  let source: ResolveResult["source"] = "crossref";
  let pool = crossref;

  if (!best) {
    const oa = await searchOpenAlex(q, timeoutMs);
    pool = [...crossref, ...oa];
    best = pickBestWork(oa, 0, q) ?? pickBestWork(pool, 0, q);
    if (best && oa.some((w) => w.doi === best!.doi)) source = "openalex";
  }

  const candidates = pool.slice(0, 5).map((w) => ({
    doi: w.doi,
    title: w.title,
    score: w.score,
    source,
  }));

  if (!best) {
    return {
      ok: false,
      query: q0,
      code: "DOI_NOT_FOUND",
      error: `No confident match for: "${q0}"`,
      candidates,
    };
  }

  // Ambiguous: top two very close scores and different DOIs
  if (
    pool.length >= 2 &&
    pool[0].doi !== pool[1].doi &&
    pool[0].score != null &&
    pool[1].score != null &&
    Math.abs(pool[0].score - pool[1].score) < 2 &&
    !(
      q &&
      pool[0].title &&
      pool[0].title.toLowerCase().includes(q.toLowerCase().slice(0, 20))
    )
  ) {
    // still return best but flag candidates for agent confirmation
    return {
      ok: true,
      query: q0,
      doi: best.doi,
      title: best.title,
      authors: best.authors,
      year: best.year,
      container: best.container,
      source,
      code: "AMBIGUOUS_DOI",
      candidates,
    };
  }

  return {
    ok: true,
    query: q0,
    doi: best.doi,
    title: best.title,
    authors: best.authors,
    year: best.year,
    container: best.container,
    source,
    candidates,
  };
}

export async function downloadPaper(
  options: DownloadOptions,
  config: SciPdfConfig,
): Promise<DownloadResult> {
  const query = options.query.trim();
  try {
    const resolved = await resolveToDoi(
      query,
      options.queryType ?? "auto",
      Math.min(config.timeoutMs, 20_000),
    );

    if (!resolved.ok || !resolved.doi) {
      return {
        ok: false,
        query,
        code: resolved.code ?? "DOI_NOT_FOUND",
        error: resolved.error,
        candidates: resolved.candidates,
      };
    }

    const doi = resolved.doi;
    const title = resolved.title;
    const authors = resolved.authors;
    const year = resolved.year;

    const downloadDir = options.outdir ?? config.downloadDir;
    await ensureDir(downloadDir);
    const path = buildPdfPath(downloadDir, doi, {
      filename: options.filename,
      style: config.filenameStyle,
      title,
      authors,
      year,
    });

    const citation =
      options.withCitation !== false
        ? buildCitations({
            doi,
            title,
            authors,
            year,
            container: resolved.container,
          })
        : undefined;

    if (!options.force && (await fileExists(path))) {
      return {
        ok: true,
        query,
        doi,
        title,
        authors,
        year,
        path,
        source: "cache",
        cached: true,
        citation,
      };
    }

    const { pdfBytes, mirror } = await fetchPdfViaSciHub(doi, config);
    const bytes = await savePdf(path, pdfBytes);

    return {
      ok: true,
      query,
      doi,
      title,
      authors,
      year,
      path,
      source: "scihub",
      mirror,
      bytes,
      cached: false,
      citation,
      candidates: resolved.candidates,
    };
  } catch (e) {
    const code = codeFromError(e);
    const error = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      query,
      code,
      error,
      candidates: e instanceof SciPdfError ? e.candidates : undefined,
    };
  }
}

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
  const n = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function dedupeQueries(queries: string[]): { list: string[]; deduped: number } {
  const seen = new Set<string>();
  const list: string[] = [];
  let deduped = 0;
  for (const q of queries) {
    const key = normalizeDoi(q)?.toLowerCase() ?? q.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) {
      deduped++;
      continue;
    }
    seen.add(key);
    list.push(q.trim());
  }
  return { list, deduped };
}

export async function downloadPapers(
  queries: string[],
  config: SciPdfConfig,
  extras?: Omit<DownloadOptions, "query"> & {
    writeManifest?: boolean;
    /** If true, expand bib/ris/multiline blobs */
    expandText?: boolean;
  },
): Promise<BatchDownloadResult> {
  let expanded = queries.flatMap((q) => {
    if (extras?.expandText !== false && (q.includes("\n") || /@\w+\{|^TY\s+-/m.test(q))) {
      const extracted = extractQueriesFromText(q);
      return extracted.length ? extracted : [q];
    }
    return [q];
  });

  const { list, deduped } = dedupeQueries(expanded);
  const results = await mapPool(list, config.concurrency, async (query, index) => {
    const r = await downloadPaper({ query, ...extras }, config);
    return { ...r, index };
  });

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  let manifestPath: string | undefined;
  if (extras?.writeManifest !== false) {
    try {
      manifestPath = await writeManifest(
        extras?.outdir ?? config.downloadDir,
        results,
      );
    } catch {
      // ignore manifest IO errors
    }
  }

  return {
    results,
    succeeded,
    failed,
    total: results.length,
    deduped,
    manifestPath,
  };
}

export { extractQueriesFromText };
