import type { CrossrefWork } from "../types.js";
import { normalizeDoi } from "./doi.js";
import { fetchJson } from "./http.js";

const OPENALEX = "https://api.openalex.org";

interface OpenAlexWork {
  doi?: string | null;
  display_name?: string;
  publication_year?: number;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string } };
  relevance_score?: number;
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
