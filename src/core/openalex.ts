import type { CrossrefWork } from "../types.js";
import { normalizeDoi } from "./doi.js";
import { fetchJson } from "./http.js";

const OPENALEX = "https://api.openalex.org";

interface OpenAlexWork {
  doi?: string | null;
  display_name?: string;
  publication_year?: number;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: {
    source?: { display_name?: string };
    pdf_url?: string | null;
    landing_page_url?: string | null;
    is_oa?: boolean;
  };
  best_oa_location?: {
    pdf_url?: string | null;
    landing_page_url?: string | null;
  } | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  cited_by_count?: number;
  type?: string;
  abstract_inverted_index?: Record<string, number[]> | null;
  relevance_score?: number;
}

function restoreAbstract(
  index?: Record<string, number[]> | null,
): string | undefined {
  if (!index) return undefined;
  const positioned: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) positioned.push([position, word]);
  }
  positioned.sort((a, b) => a[0] - b[0]);
  return positioned.map(([, word]) => word).join(" ") || undefined;
}

function mapWork(w: OpenAlexWork): CrossrefWork | null {
  const doi = w.doi ? normalizeDoi(w.doi) : null;
  if (!doi) return null;
  return {
    doi,
    title: w.display_name,
    year: w.publication_year,
    authors:
      w.authorships
        ?.map((a) => a.author?.display_name)
        .filter((x): x is string => Boolean(x)) ?? [],
    container: w.primary_location?.source?.display_name,
    score: w.relevance_score,
    abstract: restoreAbstract(w.abstract_inverted_index),
    citationCount: w.cited_by_count,
    isOpenAccess:
      w.open_access?.is_oa === true || w.primary_location?.is_oa === true,
    pdfUrl:
      w.best_oa_location?.pdf_url ??
      w.primary_location?.pdf_url ??
      undefined,
    url:
      w.best_oa_location?.landing_page_url ??
      w.primary_location?.landing_page_url ??
      w.open_access?.oa_url ??
      undefined,
    publicationType: w.type,
  };
}

export async function searchOpenAlex(
  query: string,
  timeoutMs = 15_000,
  perPage = 5,
): Promise<CrossrefWork[]> {
  const params = new URLSearchParams({
    search: query,
    per_page: String(perPage),
  });
  const url = `${OPENALEX}/works?${params}`;
  try {
    const { response, data } = await fetchJson<{ results?: OpenAlexWork[] }>(
      url,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "scipdf-mcp/0.3 (mailto:research@localhost)",
        },
      },
      timeoutMs,
    );
    if (!response.ok) return [];
    return (data?.results ?? [])
      .map(mapWork)
      .filter((w): w is CrossrefWork => w !== null);
  } catch {
    return [];
  }
}
