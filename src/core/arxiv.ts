import type { PaperSearchResult, SciPdfConfig } from "../types.js";
import { fetchSafePublicBuffer, fetchText } from "./http.js";
import { normalizeArxivId } from "./identifiers.js";
import { throttle } from "./rateLimit.js";
import { isPdfBuffer } from "./storage.js";
import { assertSafePublicUrl } from "./urlSafety.js";
import { normalizeDoi } from "./doi.js";

const ARXIV_API = "https://export.arxiv.org/api/query";

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCodePoint(Number(n)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tag(block: string, name: string): string | undefined {
  const match = block.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"),
  );
  return match ? decodeXml(match[1]).replace(/\s+/g, " ").trim() : undefined;
}

function attr(block: string, tagName: string, name: string): string | undefined {
  const match = block.match(
    new RegExp(`<${tagName}\\b[^>]*\\b${name}=["']([^"']+)["'][^>]*>`, "i"),
  );
  return match ? decodeXml(match[1]).trim() : undefined;
}

function entryToPaper(entry: string): PaperSearchResult | null {
  const idUrl = tag(entry, "id");
  const arxivId = idUrl ? normalizeArxivId(idUrl) : null;
  const title = tag(entry, "title");
  if (!arxivId || !title) return null;
  const authors = Array.from(
    entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/gi),
  )
    .map((match) => tag(match[1], "name"))
    .filter((name): name is string => Boolean(name));
  const published = tag(entry, "published");
  const doiValue = tag(entry, "arxiv:doi");
  const doi = doiValue ? normalizeDoi(doiValue) ?? undefined : undefined;
  const pdfUrl =
    Array.from(entry.matchAll(/<link\b[^>]*>/gi))
      .map((match) => match[0])
      .find((link) => /\btype=["']application\/pdf["']/i.test(link))
      ?.match(/\bhref=["']([^"']+)["']/i)?.[1] ??
    `https://arxiv.org/pdf/${arxivId}`;
  const category = attr(entry, "arxiv:primary_category", "term");
  return {
    title,
    authors,
    year: published ? Number(published.slice(0, 4)) || undefined : undefined,
    doi,
    arxivId,
    identifiers: {
      ...(doi ? { doi } : {}),
      arxivId,
      sourceUrl: idUrl,
    },
    abstract: tag(entry, "summary"),
    venue: "arXiv",
    isOpenAccess: true,
    openAccessPdf: pdfUrl,
    url: idUrl,
    publicationType: category ? `preprint:${category}` : "preprint",
    relevanceScore: 0,
    sources: ["arxiv"],
  };
}

export function parseArxivFeed(xml: string): PaperSearchResult[] {
  return Array.from(xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi))
    .map((match) => entryToPaper(match[1]))
    .filter((paper): paper is PaperSearchResult => paper !== null);
}

async function queryArxiv(
  params: URLSearchParams,
  timeoutMs: number,
  minGapMs: number,
  userAgent: string,
): Promise<PaperSearchResult[]> {
  const url = `${ARXIV_API}?${params}`;
  try {
    await throttle(minGapMs, url);
    const { response, text } = await fetchText(
      url,
      {
        headers: {
          Accept: "application/atom+xml",
          "User-Agent": userAgent,
        },
      },
      timeoutMs,
    );
    return response.ok ? parseArxivFeed(text) : [];
  } catch {
    return [];
  }
}

export function searchArxiv(
  query: string,
  limit: number,
  timeoutMs: number,
  minGapMs: number,
  userAgent: string,
): Promise<PaperSearchResult[]> {
  return queryArxiv(
    new URLSearchParams({
      search_query: `all:${query}`,
      start: "0",
      max_results: String(Math.max(1, Math.min(Math.floor(limit), 100))),
      sortBy: "relevance",
      sortOrder: "descending",
    }),
    timeoutMs,
    minGapMs,
    userAgent,
  );
}

export async function getArxivPaper(
  input: string,
  config: SciPdfConfig,
): Promise<PaperSearchResult | null> {
  const arxivId = normalizeArxivId(input);
  if (!arxivId) return null;
  const results = await queryArxiv(
    new URLSearchParams({ id_list: arxivId, max_results: "1" }),
    Math.min(config.timeoutMs, 20_000),
    config.minRequestGapMs,
    config.userAgent,
  );
  return results[0] ?? null;
}

export async function fetchArxivPdf(
  input: string,
  config: SciPdfConfig,
): Promise<{ pdfBytes: Uint8Array; pdfUrl: string }> {
  const arxivId = normalizeArxivId(input);
  if (!arxivId) throw new Error(`Invalid arXiv ID: ${input}`);
  const path = arxivId
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const pdfUrl = assertSafePublicUrl(`https://arxiv.org/pdf/${path}`);
  await throttle(config.minRequestGapMs, pdfUrl);
  const { response, buffer } = await fetchSafePublicBuffer(
    pdfUrl,
    {
      headers: {
        Accept: "application/pdf,*/*",
        "User-Agent": config.userAgent,
      },
    },
    config.timeoutMs,
  );
  if (!response.ok) throw new Error(`arXiv PDF HTTP ${response.status}`);
  if (!isPdfBuffer(buffer)) {
    throw new Error(`arXiv URL did not return a valid PDF: ${pdfUrl}`);
  }
  return { pdfBytes: buffer, pdfUrl };
}
