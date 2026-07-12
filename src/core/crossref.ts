import type { CrossrefWork } from "../types.js";
import { normalizeDoi } from "./doi.js";

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

export async function getWorkByDoi(
  doi: string,
  timeoutMs = 15_000,
): Promise<CrossrefWork | null> {
  const url = `${CROSSREF_BASE}/works/${encodeURIComponent(doi)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "scipdf-mcp/0.1 (mailto:research@localhost)",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { message?: CrossrefMessage };
    if (!json.message) return null;
    return mapWork(json.message);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "scipdf-mcp/0.1 (mailto:research@localhost)",
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      message?: { items?: CrossrefMessage[] };
    };
    const items = json.message?.items ?? [];
    return items
      .map(mapWork)
      .filter((w): w is CrossrefWork => w !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
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

  // Exact / near-exact title match: accept even if Crossref score is modest
  if (queryTitle && best.title) {
    const q = normalizeTitle(queryTitle);
    const t = normalizeTitle(best.title);
    if (q === t || t.includes(q) || q.includes(t)) {
      return best;
    }
  }

  // Crossref relevance scores for full titles often sit in the 20–45 range
  if (best.score !== undefined && best.score < minScore) return null;
  return best;
}
