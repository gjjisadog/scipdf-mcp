import type {
  CrossrefWork,
  PaperSearchResult,
  PaperSearchSource,
  SciPdfConfig,
  SearchPapersOptions,
  SearchPapersResult,
} from "../types.js";
import { normalizeTitle, searchByTitle } from "./crossref.js";
import { normalizeDoi } from "./doi.js";
import { searchOpenAlex } from "./openalex.js";
import { searchSemanticScholar } from "./semanticScholar.js";
import { searchArxiv } from "./arxiv.js";

const ALL_SOURCES: PaperSearchSource[] = [
  "crossref",
  "openalex",
  "semanticscholar",
  "arxiv",
];
const RRF_K = 60;

export interface PaperSourceCapabilities {
  search: boolean;
  metadata: boolean;
  citations: boolean;
  recommendations: boolean;
  pdf: boolean;
}

export interface PaperSourceContext {
  timeoutMs: number;
  minRequestGapMs: number;
  userAgent: string;
}

/** Common adapter contract for every academic metadata/search provider. */
export interface PaperSource {
  name: PaperSearchSource;
  capabilities: PaperSourceCapabilities;
  search(
    query: string,
    limit: number,
    context: PaperSourceContext,
  ): Promise<PaperSearchResult[]>;
}

function fromWork(
  work: CrossrefWork,
  source: Exclude<PaperSearchSource, "semanticscholar" | "arxiv">,
): PaperSearchResult | null {
  if (!work.title?.trim()) return null;
  return {
    title: work.title.trim(),
    authors: work.authors ?? [],
    year: work.year,
    doi: work.doi,
    identifiers: { doi: work.doi, sourceUrl: work.url },
    abstract: work.abstract,
    venue: work.container,
    citationCount: work.citationCount,
    isOpenAccess: work.isOpenAccess,
    openAccessPdf: work.pdfUrl,
    url: work.url,
    publicationType: work.publicationType,
    relevanceScore: 0,
    sources: [source],
  };
}

const PAPER_SOURCES: Record<PaperSearchSource, PaperSource> = {
  crossref: {
    name: "crossref",
    capabilities: {
      search: true,
      metadata: true,
      citations: false,
      recommendations: false,
      pdf: false,
    },
    async search(query, limit, context) {
      const works = await searchByTitle(query, context.timeoutMs, limit);
      return works
        .map((work) => fromWork(work, "crossref"))
        .filter((paper): paper is PaperSearchResult => paper !== null);
    },
  },
  openalex: {
    name: "openalex",
    capabilities: {
      search: true,
      metadata: true,
      citations: false,
      recommendations: false,
      pdf: true,
    },
    async search(query, limit, context) {
      const works = await searchOpenAlex(query, context.timeoutMs, limit);
      return works
        .map((work) => fromWork(work, "openalex"))
        .filter((paper): paper is PaperSearchResult => paper !== null);
    },
  },
  semanticscholar: {
    name: "semanticscholar",
    capabilities: {
      search: true,
      metadata: true,
      citations: true,
      recommendations: true,
      pdf: true,
    },
    search(query, limit, context) {
      return searchSemanticScholar(
        query,
        limit,
        context.timeoutMs,
        context.minRequestGapMs,
        context.userAgent,
      );
    },
  },
  arxiv: {
    name: "arxiv",
    capabilities: {
      search: true,
      metadata: true,
      citations: false,
      recommendations: false,
      pdf: true,
    },
    search(query, limit, context) {
      return searchArxiv(
        query,
        limit,
        context.timeoutMs,
        context.minRequestGapMs,
        context.userAgent,
      );
    },
  },
};

export function getPaperSource(source: PaperSearchSource): PaperSource {
  return PAPER_SOURCES[source];
}

export function listPaperSources(): Array<{
  name: PaperSearchSource;
  capabilities: PaperSourceCapabilities;
}> {
  return ALL_SOURCES.map((name) => ({
    name,
    capabilities: { ...PAPER_SOURCES[name].capabilities },
  }));
}

function titleKey(paper: Pick<PaperSearchResult, "title" | "year">): string {
  return `${normalizeTitle(paper.title)}|${paper.year ?? ""}`;
}

function doiKey(doi?: string): string | undefined {
  const normalized = doi ? normalizeDoi(doi) : null;
  return normalized?.toLowerCase();
}

function arxivKey(arxivId?: string): string | undefined {
  return arxivId?.trim().toLowerCase() || undefined;
}

function preferText(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function mergePaper(
  target: PaperSearchResult,
  incoming: PaperSearchResult,
  rank: number,
): void {
  target.relevanceScore += 1 / (RRF_K + rank + 1);
  target.title = preferText(target.title, incoming.title) ?? target.title;
  if (incoming.authors.length > target.authors.length) {
    target.authors = incoming.authors;
  }
  target.year ??= incoming.year;
  target.doi ??= incoming.doi;
  target.arxivId ??= incoming.arxivId;
  target.identifiers = {
    ...incoming.identifiers,
    ...target.identifiers,
    ...(target.doi ? { doi: target.doi } : {}),
    ...(target.arxivId ? { arxivId: target.arxivId } : {}),
  };
  target.abstract = preferText(target.abstract, incoming.abstract);
  target.venue = preferText(target.venue, incoming.venue);
  if (
    incoming.citationCount !== undefined &&
    (target.citationCount === undefined ||
      incoming.citationCount > target.citationCount)
  ) {
    target.citationCount = incoming.citationCount;
  }
  target.isOpenAccess =
    target.isOpenAccess === true || incoming.isOpenAccess === true;
  target.openAccessPdf ??= incoming.openAccessPdf;
  target.url ??= incoming.url;
  target.publicationType ??= incoming.publicationType;
  for (const source of incoming.sources) {
    if (!target.sources.includes(source)) target.sources.push(source);
  }
}

function applyFilters(
  paper: PaperSearchResult,
  options: SearchPapersOptions,
): boolean {
  if (
    options.yearFrom !== undefined &&
    (paper.year === undefined || paper.year < options.yearFrom)
  ) {
    return false;
  }
  if (
    options.yearTo !== undefined &&
    (paper.year === undefined || paper.year > options.yearTo)
  ) {
    return false;
  }
  if (
    options.minCitations !== undefined &&
    (paper.citationCount === undefined ||
      paper.citationCount < options.minCitations)
  ) {
    return false;
  }
  if (
    options.openAccessOnly &&
    paper.isOpenAccess !== true &&
    !paper.openAccessPdf
  ) {
    return false;
  }
  return true;
}

/** Pure merge/rank stage, exported for deterministic unit testing. */
export function mergeAndRankSearchResults(
  sourceResults: PaperSearchResult[][],
  options: SearchPapersOptions,
  limit: number,
): PaperSearchResult[] {
  const byDoi = new Map<string, PaperSearchResult>();
  const byArxiv = new Map<string, PaperSearchResult>();
  const byTitle = new Map<string, PaperSearchResult>();
  const merged: PaperSearchResult[] = [];

  for (const papers of sourceResults) {
    for (let rank = 0; rank < papers.length; rank++) {
      const incoming = papers[rank];
      const dk = doiKey(incoming.doi);
      const ak = arxivKey(incoming.arxivId);
      const tk = titleKey(incoming);
      let target =
        (dk && byDoi.get(dk)) ||
        (ak && byArxiv.get(ak)) ||
        byTitle.get(tk);
      if (!target) {
        target = {
          ...incoming,
          authors: [...incoming.authors],
          sources: [...incoming.sources],
          relevanceScore: 0,
        };
        merged.push(target);
      }
      mergePaper(target, incoming, rank);
      const mergedDoi = doiKey(target.doi);
      const mergedArxiv = arxivKey(target.arxivId);
      if (mergedDoi) byDoi.set(mergedDoi, target);
      if (mergedArxiv) byArxiv.set(mergedArxiv, target);
      byTitle.set(titleKey(target), target);
      byTitle.set(tk, target);
    }
  }

  return merged
    .filter((paper) => applyFilters(paper, options))
    .sort(
      (a, b) =>
        b.relevanceScore - a.relevanceScore ||
        (b.citationCount ?? -1) - (a.citationCount ?? -1) ||
        (b.year ?? 0) - (a.year ?? 0),
    )
    .slice(0, limit)
    .map((paper) => ({
      ...paper,
      relevanceScore: Number(paper.relevanceScore.toFixed(6)),
    }));
}

export async function searchPapers(
  query: string,
  config: SciPdfConfig,
  options: SearchPapersOptions = {},
): Promise<SearchPapersResult> {
  const cleanedQuery = query.trim();
  if (!cleanedQuery) throw new Error("Search query must not be empty");

  const sources = options.sources?.length
    ? ALL_SOURCES.filter((source) => options.sources?.includes(source))
    : [...ALL_SOURCES];
  if (sources.length === 0) {
    throw new Error("At least one supported search source is required");
  }

  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 20), 50));
  const perSource = Math.max(5, Math.min(limit * 2, 100));
  const timeoutMs = Math.min(
    options.timeoutMs ?? config.timeoutMs,
    config.timeoutMs,
  );

  const context: PaperSourceContext = {
    timeoutMs,
    minRequestGapMs: config.minRequestGapMs,
    userAgent: config.userAgent,
  };
  const tasks = sources.map((source) =>
    getPaperSource(source).search(cleanedQuery, perSource, context),
  );

  const sourceResults = await Promise.all(tasks);
  const results = mergeAndRankSearchResults(sourceResults, options, limit);

  return {
    query: cleanedQuery,
    total: results.length,
    sources,
    results,
  };
}
