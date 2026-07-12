import type { CrossrefWork } from "../types.js";
import { normalizeDoi } from "./doi.js";

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "scipdf-mcp/0.2 (mailto:research@localhost)",
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: OpenAlexWork[] };
    return (json.results ?? [])
      .map(mapWork)
      .filter((w): w is CrossrefWork => w !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
