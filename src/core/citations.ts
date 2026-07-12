import { extractDoiFromText, normalizeDoi } from "./doi.js";

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

  // BibTeX doi fields
  for (const m of text.matchAll(/doi\s*=\s*[{"]([^}"\s]+)[}"]/gi)) {
    const d = normalizeDoi(m[1]);
    if (d) add(d);
  }

  // RIS DO lines
  for (const m of text.matchAll(/^DO\s+-\s+(.+)$/gim)) {
    const d = normalizeDoi(m[1]);
    if (d) add(d);
  }

  // All bare DOIs in text
  for (const m of text.matchAll(/\b10\.\d{4,9}\/[^\s\]}>"',;]+/gi)) {
    const d = normalizeDoi(m[0]);
    if (d) add(d);
  }

  // Always also collect citation-like lines WITHOUT a DOI
  // (previously skipped entirely when any DOI was found — dropped mixed lists)
  for (const line of text.split(/\n+/)) {
    const L = line.trim();
    if (L.length < 12) continue;
    if (/^(author|title|journal|year|volume|@|TY\s+-|ER\s+-|DO\s+-)/i.test(L)) {
      continue;
    }
    // Skip lines that are only a DOI (already added)
    if (normalizeDoi(L) && L.replace(/\s/g, "") === normalizeDoi(L)) continue;
    if (extractDoiFromText(L) && !looksLikeCitation(L.replace(/\b10\.\d{4,9}\/[^\s]+/gi, "").trim())) {
      // Line is DOI-heavy with little citation text — skip as separate query
      if (L.length < 40) continue;
    }
    // author year title-ish lines without requiring empty DOI list
    if (/\b(19|20)\d{2}\b/.test(L) && /[A-Za-z\u4e00-\u9fff]{3,}/.test(L)) {
      // Prefer DOI if present on the same line
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
  // author et al year / 作者 (2020)
  if (/\bet\s+al\.?\b/i.test(t) && /\b(19|20)\d{2}\b/.test(t)) return true;
  if (/[A-Z][a-z]+,\s*[A-Z]/.test(t) && /\b(19|20)\d{2}\b/.test(t)) return true;
  if (/[\u4e00-\u9fff].*[（(]?(19|20)\d{2}[）)]?/.test(t)) return true;
  if ((t.match(/\./g) || []).length >= 2 && /\b(19|20)\d{2}\b/.test(t)) return true;
  return false;
}
