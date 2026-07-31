import { extractDoiFromText, normalizeDoi } from "./doi.js";
import { normalizeArxivId } from "./identifiers.js";

/** Extract DOIs and loose queries from bib / ris / pasted reference lists */
export function extractQueriesFromText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (q: string) => {
    const t = q.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };

  // BibTeX doi fields (suffix may contain < > for SICI)
  for (const m of text.matchAll(/doi\s*=\s*[{"]([^}"\n]+)[}"]/gi)) {
    const d = normalizeDoi(m[1]);
    if (d) add(d);
  }

  // RIS DO lines
  for (const m of text.matchAll(/^DO\s+-\s+(.+)$/gim)) {
    const d = normalizeDoi(m[1]);
    if (d) add(d);
  }

  // BibTeX arXiv eprint fields and common textual arXiv identifiers.
  for (const m of text.matchAll(/eprint\s*=\s*[{"]([^}"\n]+)[}"]/gi)) {
    const id = normalizeArxivId(m[1]);
    if (id) add(`arXiv:${id}`);
  }
  for (const m of text.matchAll(
    /(?:arxiv:\s*|https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\/)([a-z0-9.-]+\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/gi,
  )) {
    const id = normalizeArxivId(m[1]);
    if (id) add(`arXiv:${id}`);
  }

  // All bare DOIs in text (allow <> in SICI)
  for (const m of text.matchAll(/\b10\.\d{4,9}\/[^\s\]}"']+/gi)) {
    const d = normalizeDoi(m[0]);
    if (d) add(d);
  }

  // BibTeX entries without DOI → use title as query
  for (const block of text.matchAll(/@\w+\s*\{[^,]+,([\s\S]*?)\n\s*\}/g)) {
    const body = block[1];
    if (/doi\s*=/i.test(body)) continue;
    const titleM = body.match(
      /title\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]+)")/i,
    );
    const title = (titleM?.[1] ?? titleM?.[2] ?? "").trim();
    if (title.length >= 8) add(title);
  }

  // RIS records without DO → use TI title
  const risRecords = text.split(/(?=^TY\s+-\s+)/m);
  for (const rec of risRecords) {
    if (!/^TY\s+-/m.test(rec)) continue;
    if (/^DO\s+-/m.test(rec)) continue;
    const ti = rec.match(/^TI\s+-\s+(.+)$/m)?.[1]?.trim();
    if (ti && ti.length >= 8) add(ti);
  }

  // Always also collect citation-like lines WITHOUT a DOI
  for (const line of text.split(/\n+/)) {
    const L = line.trim();
    if (L.length < 12) continue;
    if (/^(author|title|journal|year|volume|@|TY\s+-|ER\s+-|DO\s+-|TI\s+-|AU\s+-)/i.test(L)) {
      continue;
    }
    // Skip lines that are only a DOI (already added)
    if (normalizeDoi(L) && L.replace(/\s/g, "") === normalizeDoi(L)) continue;
    if (
      extractDoiFromText(L) &&
      !looksLikeCitation(L.replace(/\b10\.\d{4,9}\/\S+/gi, "").trim())
    ) {
      // Line is DOI-heavy with little citation text — skip as separate query
      if (L.length < 40) continue;
    }
    // author year title-ish lines without requiring empty DOI list
    if (/\b(19|20)\d{2}\b/.test(L) && /[\p{L}]{3,}/u.test(L)) {
      const d = extractDoiFromText(L);
      if (d) {
        add(d);
      } else {
        add(L);
      }
    }
  }

  return out;
}

/**
 * Normalize loose citation strings into a search query.
 * e.g. "Kucsko et al. 2013 Nature thermometry" → usable title/search string
 */
export function citationToSearchQuery(citation: string): string {
  let s = citation.trim();
  // strip leading numbering
  s = s.replace(/^\s*\[\d+\]\s*/, "").replace(/^\s*\d+[\.)]\s*/, "");
  // if DOI present, return DOI only
  const doi = extractDoiFromText(s);
  if (doi) return doi;
  return s;
}

/** Detect if string looks like a bibliographic citation rather than pure title */
export function looksLikeCitation(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (extractDoiFromText(t) && t.length < 40) return false;
  // year + author-ish
  if (/\b(19|20)\d{2}\b/.test(t) && /[A-Za-z\u4e00-\u9fff]{2,}/.test(t)) {
    return true;
  }
  if (/et\s+al/i.test(t) || /\(\d{4}\)/.test(t)) return true;
  if (t.includes(",") && t.length > 30 && /\b(19|20)\d{2}\b/.test(t)) return true;
  return false;
}
