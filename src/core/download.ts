import type {
  SciPdfConfig,
  DownloadResult,
  QueryType,
  BatchDownloadResult,
  ResolveResult,
  SourceFailureSummary,
} from "../types.js";
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
  titlesMatch,
} from "./crossref.js";
import { searchOpenAlex } from "./openalex.js";
import {
  citationToSearchQuery,
  extractQueriesFromText,
  looksLikeCitation,
} from "./citations.js";
import { buildCitations } from "./citeFormat.js";
import { fetchPdfViaSciHub } from "./scihub.js";
import { fetchPdfViaOa } from "./oa.js";
import { SciPdfError, codeFromError } from "./errors.js";
import { failureFromCaught } from "./failureSummary.js";
import {
  buildPdfPath,
  ensureDir,
  isCacheHitForDoi,
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

  // title / citation: Crossref ∥ OpenAlex in parallel
  const [crossref, oa] = await Promise.all([
    searchByTitle(q, timeoutMs),
    searchOpenAlex(q, timeoutMs),
  ]);

  let best = pickBestWork(crossref, 20, q);
  let source: ResolveResult["source"] = "crossref";
  let selectPool = crossref;

  if (!best) {
    // OpenAlex scores ≠ Crossref; only accept title match
    best = pickBestWork(oa, Number.MAX_SAFE_INTEGER, q);
    if (best) {
      source = "openalex";
      selectPool = oa;
    }
  }

  const pool = [...crossref, ...oa];
  const oaDois = new Set(oa.map((w) => w.doi));
  const crossrefDois = new Set(crossref.map((w) => w.doi));
  const candidates = pool.slice(0, 5).map((w) => ({
    doi: w.doi,
    title: w.title,
    score: w.score,
    source: oaDois.has(w.doi)
      ? crossrefDois.has(w.doi)
        ? "crossref+openalex"
        : "openalex"
      : "crossref",
  }));

  if (best && !candidates.some((c) => c.doi === best!.doi)) {
    candidates.unshift({
      doi: best.doi,
      title: best.title,
      score: best.score,
      source: oaDois.has(best.doi) ? "openalex" : "crossref",
    });
    if (candidates.length > 5) candidates.length = 5;
  }

  if (!best) {
    return {
      ok: false,
      query: q0,
      code: "DOI_NOT_FOUND",
      error: `No confident match for: "${q0}"`,
      candidates,
    };
  }

  if (isAmbiguousSelection(selectPool, best, q)) {
    return {
      ok: false,
      query: q0,
      code: "AMBIGUOUS_DOI",
      error:
        "Multiple close DOI matches; pass an explicit DOI (query_type=doi) instead of auto-picking.",
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

/** Close score rivals in the same source list — skip when title clearly matches. */
function isAmbiguousSelection(
  works: Array<{ doi: string; title?: string; score?: number }>,
  selected: { doi: string; title?: string; score?: number },
  query: string,
): boolean {
  if (titlesMatch(query, selected.title)) return false;
  if (selected.score == null) return false;
  const rivals = works
    .filter((w) => w.doi !== selected.doi && w.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (rivals.length === 0) return false;
  return Math.abs(selected.score - (rivals[0].score as number)) < 2;
}

type WorkMeta = {
  title?: string;
  authors?: string[];
  year?: number;
  container?: string;
};

/**
 * Fast path for explicit DOI: start Crossref meta and PDF fetch in parallel
 * when filename style does not need author/title for the path.
 */
export async function downloadPaper(
  options: DownloadOptions,
  config: SciPdfConfig,
): Promise<DownloadResult> {
  const query = options.query.trim();
  try {
    const type = inferType(query, options.queryType ?? "auto");
    const timeoutMs = Math.min(config.timeoutMs, 20_000);

    // DOI fast-path: parallel meta + download when path only needs DOI
    if (type === "doi" || (type === "auto" && looksLikeDoi(query))) {
      const doi = normalizeDoi(query);
      if (!doi) {
        return {
          ok: false,
          query,
          code: "INVALID_DOI",
          error: `Invalid DOI: ${query}`,
        };
      }
      return await downloadByDoi(doi, query, options, config, timeoutMs);
    }

    const resolved = await resolveToDoi(
      query,
      options.queryType ?? "auto",
      timeoutMs,
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

    return await downloadByDoi(
      resolved.doi,
      query,
      options,
      config,
      timeoutMs,
      {
        title: resolved.title,
        authors: resolved.authors,
        year: resolved.year,
        container: resolved.container,
      },
      resolved.candidates,
      /* skipMeta */ true,
    );
  } catch (e) {
    const code = codeFromError(e);
    const error = e instanceof Error ? e.message : String(e);
    const failure: SourceFailureSummary | undefined =
      (e instanceof SciPdfError ? e.failure : undefined) ??
      failureFromCaught(e);
    return {
      ok: false,
      query,
      code,
      error,
      failure,
      candidates: e instanceof SciPdfError ? e.candidates : undefined,
    };
  }
}

async function downloadByDoi(
  doi: string,
  query: string,
  options: DownloadOptions,
  config: SciPdfConfig,
  timeoutMs: number,
  knownMeta?: WorkMeta,
  candidates?: DownloadResult["candidates"],
  skipMeta = false,
): Promise<DownloadResult> {
  const metaPromise: Promise<WorkMeta | null> = skipMeta
    ? Promise.resolve(knownMeta ?? null)
    : getWorkByDoi(doi, timeoutMs).then((m) =>
        m
          ? {
              title: m.title,
              authors: m.authors,
              year: m.year,
              container: m.container,
            }
          : null,
      );

  const needsMetaForPath =
    !options.filename && config.filenameStyle === "author_year_title";

  let meta = knownMeta ?? null;
  if (needsMetaForPath && !meta) {
    meta = await metaPromise;
  }

  const downloadDir = options.outdir ?? config.downloadDir;
  await ensureDir(downloadDir);
  const path = buildPdfPath(downloadDir, doi, {
    filename: options.filename,
    style: config.filenameStyle,
    title: meta?.title,
    authors: meta?.authors,
    year: meta?.year,
  });

  // Cache hit — still await meta for citation if needed
  if (!options.force && (await isCacheHitForDoi(path, doi))) {
    if (!meta) meta = await metaPromise;
    const citation =
      options.withCitation !== false
        ? buildCitations({
            doi,
            title: meta?.title,
            authors: meta?.authors,
            year: meta?.year,
            container: meta?.container,
          })
        : undefined;
    return {
      ok: true,
      query,
      doi,
      title: meta?.title,
      authors: meta?.authors,
      year: meta?.year,
      path,
      source: "cache",
      cached: true,
      citation,
      candidates,
    };
  }

  // preferOa: multi-source OA pipeline (Unpaywall + free OA APIs)
  const tryOa = config.preferOa;

  type PdfHit = {
    pdfBytes: Uint8Array;
    source: NonNullable<DownloadResult["source"]>;
    mirror?: string;
    oa?: DownloadResult["oa"];
    titleHint?: string;
  };

  const fetchPdf = async (): Promise<PdfHit> => {
    if (tryOa) {
      const oa = await fetchPdfViaOa(doi, config);
      if (oa) {
        return {
          pdfBytes: oa.pdfBytes,
          source: oa.provider,
          mirror: oa.pdfUrl,
          titleHint: oa.meta?.title,
          oa: {
            provider: oa.provider,
            hostType: oa.meta?.hostType,
            version: oa.meta?.version,
            license: oa.meta?.license,
            pdfUrl: oa.pdfUrl,
          },
        };
      }
    }

    if (config.allowScihub) {
      const { pdfBytes, mirror } = await fetchPdfViaSciHub(doi, config);
      return { pdfBytes, source: "scihub", mirror };
    }

    throw new SciPdfError(
      "PDF_NOT_IN_DB",
      tryOa
        ? "No Open Access PDF found, and Sci-Hub is disabled (SCIPDF_ALLOW_SCIHUB=false)."
        : "Sci-Hub is disabled and OA is not enabled. Default is Sci-Hub. Optional OA: set SCIPDF_PREFER_OA=true (Unpaywall also needs SCIPDF_UNPAYWALL_EMAIL).",
    );
  };

  // Parallel: finish metadata + PDF bytes (when meta not already required for path)
  const [metaDone, hit] = await Promise.all([
    meta ? Promise.resolve(meta) : metaPromise,
    fetchPdf(),
  ]);
  meta = metaDone ?? meta;

  const bytes = await savePdf(path, hit.pdfBytes, doi);
  const citation =
    options.withCitation !== false
      ? buildCitations({
          doi,
          title: meta?.title ?? hit.titleHint,
          authors: meta?.authors,
          year: meta?.year,
          container: meta?.container,
        })
      : undefined;

  return {
    ok: true,
    query,
    doi,
    title: meta?.title ?? hit.titleHint,
    authors: meta?.authors,
    year: meta?.year,
    path,
    source: hit.source,
    mirror: hit.mirror,
    bytes,
    cached: false,
    citation,
    candidates,
    oa: hit.oa,
  };
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
  const n = Math.max(
    1,
    Math.min(Math.floor(Number(concurrency) || 1), Math.max(items.length, 1)),
  );
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
    expandText?: boolean;
  },
): Promise<BatchDownloadResult> {
  const expanded = queries.flatMap((q) => {
    if (
      extras?.expandText !== false &&
      (q.includes("\n") || /@\w+\{|^TY\s+-/m.test(q))
    ) {
      const extracted = extractQueriesFromText(q);
      return extracted.length ? extracted : [q];
    }
    return [q];
  });

  const { list, deduped } = dedupeQueries(expanded);

  if (list.length === 0) {
    return {
      results: [],
      succeeded: 0,
      failed: 0,
      total: 0,
      deduped,
    };
  }

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
      // ignore
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
