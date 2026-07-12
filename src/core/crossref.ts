import type { CrossrefWork } from "../types.js";
import { normalizeDoi } from "./doi.js";
import { fetchJson } from "./http.js";

const CROSSREF_BASE = "https://api.crossref.org";

interface CrossrefMessage {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string }>;
  published?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  score?: number;
}

function mapWork(item: CrossrefMessage): CrossrefWork | null {
  const doi = item.DOI ? normalizeDoi(item.DOI) : null;
  if (!doi) return null;

  const year = item.published?.["date-parts"]?.[0]?.[0];
  const authors =
    item.author?.map((a) =>
      [a.given, a.family].filter(Boolean).join(" ").trim(),
    ) ?? [];

  return {
    doi,
    title: item.title?.[0],
    authors: authors.filter(Boolean),
    year,
    container: item["container-title"]?.[0],
    score: item.score,
  };
}

const headers = {
  Accept: "application/json",
  "User-Agent": "scipdf-mcp/0.3 (mailto:research@localhost)",
};

export async function getWorkByDoi(
  doi: string,
  timeoutMs = 15_000,
): Promise<CrossrefWork | null> {
  const url = `${CROSSREF_BASE}/works/${encodeURIComponent(doi)}`;
  try {
    const { response, data } = await fetchJson<{ message?: CrossrefMessage }>(
      url,
      { headers },
      timeoutMs,
    );
    if (!response.ok || !data?.message) return null;
    return mapWork(data.message);
  } catch {
    return null;
  }
}

export async function searchByTitle(
  title: string,
  timeoutMs = 15_000,
  rows = 5,
): Promise<CrossrefWork[]> {
  const params = new URLSearchParams({
    query: title,
    rows: String(rows),
    select: "DOI,title,author,published,container-title,score",
  });
  const url = `${CROSSREF_BASE}/works?${params}`;
  try {
    const { response, data } = await fetchJson<{
      message?: { items?: CrossrefMessage[] };
    }>(url, { headers }, timeoutMs);
    if (!response.ok) return [];
    const items = data?.message?.items ?? [];
    return items
      .map(mapWork)
      .filter((w): w is CrossrefWork => w !== null);
  } catch {
    return [];
  }
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pick best Crossref hit for a title query */
export function pickBestWork(
  works: CrossrefWork[],
  minScore = 20,
  queryTitle?: string,
): CrossrefWork | null {
  if (works.length === 0) return null;
  const best = works[0];

  if (queryTitle && best.title) {
    const q = normalizeTitle(queryTitle);
    const t = normalizeTitle(best.title);
    if (q === t || t.includes(q) || q.includes(t)) {
      return best;
    }
  }

  if (best.score !== undefined && best.score < minScore) return null;
  return best;
}
