import type { PaperSearchResult } from "../types.js";
import { fetchJson } from "./http.js";
import { normalizeDoi } from "./doi.js";
import { throttle } from "./rateLimit.js";

const SEMANTIC_SCHOLAR_API =
  "https://api.semanticscholar.org/graph/v1/paper/search";
const SEMANTIC_SCHOLAR_GRAPH =
  "https://api.semanticscholar.org/graph/v1";
const SEMANTIC_SCHOLAR_RECOMMENDATIONS =
  "https://api.semanticscholar.org/recommendations/v1";
const PAPER_FIELDS =
  "title,abstract,year,authors,venue,citationCount,externalIds,openAccessPdf,url,publicationTypes";

interface SemanticScholarPaper {
  title?: string;
  abstract?: string | null;
  year?: number | null;
  authors?: Array<{ name?: string }>;
  venue?: string | null;
  citationCount?: number | null;
  externalIds?: { DOI?: string | null };
  openAccessPdf?: { url?: string | null } | null;
  url?: string | null;
  publicationTypes?: string[] | null;
}

function requestHeaders(userAgent: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": userAgent,
  };
  const apiKey = process.env.SCIPDF_SEMANTIC_SCHOLAR_API_KEY?.trim();
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

function mapPaper(paper: SemanticScholarPaper): PaperSearchResult | null {
  if (!paper.title?.trim()) return null;
  return {
    title: paper.title.trim(),
    authors:
      paper.authors
        ?.map((author) => author.name?.trim())
        .filter((name): name is string => Boolean(name)) ?? [],
    year: paper.year ?? undefined,
    doi: paper.externalIds?.DOI
      ? normalizeDoi(paper.externalIds.DOI) ?? undefined
      : undefined,
    identifiers: {
      ...(paper.externalIds?.DOI
        ? { doi: normalizeDoi(paper.externalIds.DOI) ?? undefined }
        : {}),
      sourceUrl: paper.url ?? undefined,
    },
    abstract: paper.abstract?.trim() || undefined,
    venue: paper.venue?.trim() || undefined,
    citationCount: paper.citationCount ?? undefined,
    isOpenAccess: Boolean(paper.openAccessPdf?.url),
    openAccessPdf: paper.openAccessPdf?.url ?? undefined,
    url: paper.url ?? undefined,
    publicationType: paper.publicationTypes?.join(", "),
    relevanceScore: 0,
    sources: ["semanticscholar"],
  };
}

function paperId(input: string): string {
  const doi = normalizeDoi(input);
  return doi ? `DOI:${doi}` : input.trim();
}

/**
 * Search Semantic Scholar's Academic Graph and normalize the response.
 * An API key is optional; SCIPDF_SEMANTIC_SCHOLAR_API_KEY enables a
 * dedicated quota when available.
 */
export async function searchSemanticScholar(
  query: string,
  limit: number,
  timeoutMs: number,
  minGapMs: number,
  userAgent: string,
): Promise<PaperSearchResult[]> {
  const params = new URLSearchParams({
    query,
    limit: String(Math.max(1, Math.min(Math.floor(limit), 100))),
    fields: PAPER_FIELDS,
  });
  const url = `${SEMANTIC_SCHOLAR_API}?${params}`;

  try {
    await throttle(minGapMs, url);
    const { response, data } = await fetchJson<{
      data?: SemanticScholarPaper[];
    }>(url, { headers: requestHeaders(userAgent) }, timeoutMs);
    if (!response.ok) return [];

    return (data?.data ?? [])
      .map(mapPaper)
      .filter((paper): paper is PaperSearchResult => paper !== null);
  } catch {
    return [];
  }
}

export async function getSemanticScholarRelations(
  input: string,
  relation: "citations" | "references",
  limit: number,
  timeoutMs: number,
  minGapMs: number,
  userAgent: string,
): Promise<PaperSearchResult[]> {
  const id = paperId(input);
  if (!id) return [];
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(Math.floor(limit), 100))),
    fields: PAPER_FIELDS,
  });
  const url =
    `${SEMANTIC_SCHOLAR_GRAPH}/paper/${encodeURIComponent(id)}/${relation}?` +
    params;
  try {
    await throttle(minGapMs, url);
    const { response, data } = await fetchJson<{
      data?: Array<{
        citingPaper?: SemanticScholarPaper | null;
        citedPaper?: SemanticScholarPaper | null;
      }>;
    }>(url, { headers: requestHeaders(userAgent) }, timeoutMs);
    if (!response.ok) return [];
    return (data?.data ?? [])
      .map((entry) =>
        mapPaper(
          relation === "citations"
            ? entry.citingPaper ?? {}
            : entry.citedPaper ?? {},
        ),
      )
      .filter((paper): paper is PaperSearchResult => paper !== null);
  } catch {
    return [];
  }
}

export async function getSemanticScholarRecommendations(
  input: string,
  limit: number,
  timeoutMs: number,
  minGapMs: number,
  userAgent: string,
): Promise<PaperSearchResult[]> {
  const id = paperId(input);
  if (!id) return [];
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(Math.floor(limit), 100))),
    fields: PAPER_FIELDS,
  });
  const url =
    `${SEMANTIC_SCHOLAR_RECOMMENDATIONS}/papers/forpaper/${encodeURIComponent(id)}?` +
    params;
  try {
    await throttle(minGapMs, url);
    const { response, data } = await fetchJson<{
      recommendedPapers?: SemanticScholarPaper[];
    }>(url, { headers: requestHeaders(userAgent) }, timeoutMs);
    if (!response.ok) return [];
    return (data?.recommendedPapers ?? [])
      .map(mapPaper)
      .filter((paper): paper is PaperSearchResult => paper !== null);
  } catch {
    return [];
  }
}
