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
  abstract?: string;
  "is-referenced-by-count"?: number;
  URL?: string;
  type?: string;
  score?: number;
}

function plainText(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
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
    abstract: plainText(item.abstract),
    citationCount: item["is-referenced-by-count"],
    url: item.URL,
    publicationType: item.type,
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
    select:
      "DOI,title,author,published,container-title,abstract,is-referenced-by-count,URL,type,score",
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

/**
 * Normalize titles for comparison. Keeps all Unicode letters/numbers
 * (CJK included). Stripping non-ASCII used to collapse Chinese titles to ""
 * so that includes("") always matched and silently accepted wrong DOIs.
 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when query and work title clearly match. */
export function titlesMatch(queryTitle: string, workTitle?: string): boolean {
  if (!workTitle) return false;
  const q = normalizeTitle(queryTitle);
  const t = normalizeTitle(workTitle);
  if (q.length < 2 || t.length < 2) return false;
  if (q === t) return true;

  const [shorter, longer] = q.length < t.length ? [q, t] : [t, q];
  if (!longer.includes(shorter)) return false;

  const compactShorter = shorter.replace(/\s/g, "");
  const compactLonger = longer.replace(/\s/g, "");
  if (compactShorter.length / compactLonger.length < 0.6) return false;

  // A single short Latin word (for example, "Introduction") is too generic
  // to override Crossref's score ranking. CJK titles have no word boundaries,
  // so use their compact character length instead.
  if (/\p{Script=Han}/u.test(compactShorter)) return compactShorter.length >= 6;
  const words = shorter.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length >= 2 && compactShorter.length >= 12;
}

/**
 * Pick best API hit for a title query.
 * Prefers any title match in the list; otherwise top result if score >= minScore.
 */
export function pickBestWork(
  works: CrossrefWork[],
  minScore = 20,
  queryTitle?: string,
): CrossrefWork | null {
  if (works.length === 0) return null;

  // Prefer title match anywhere in results (not only index 0)
  if (queryTitle) {
    for (const w of works) {
      if (titlesMatch(queryTitle, w.title)) return w;
    }
  }

  const best = works[0];
  if (best.score !== undefined && best.score < minScore) return null;
  // Without a score or title match, only accept if score meets threshold
  // (undefined score + no title match → reject when minScore > 0)
  if (best.score === undefined && minScore > 0 && queryTitle) {
    return null;
  }
  // minScore === 0 with a query and no title match used to auto-accept wrong OA hits
  if (queryTitle && minScore <= 0) return null;
  return best;
}
