/** DOI pattern: 10.xxxx/... */
const DOI_RE =
  /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i;

/** Strip common DOI URL prefixes and whitespace */
export function normalizeDoi(input: string): string | null {
  let s = input.trim();
  if (!s) return null;

  s = s
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/^DOI\s+/i, "")
    .trim();

  const m = s.match(DOI_RE);
  if (!m) return null;

  // Trim trailing punctuation often copied from text
  let doi = m[1].replace(/[.,;:]+$/, "");
  return doi;
}

export function looksLikeDoi(input: string): boolean {
  return normalizeDoi(input) !== null;
}

export function looksLikeUrl(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Extract DOI from free text or URL path/query */
export function extractDoiFromText(text: string): string | null {
  return normalizeDoi(text);
}

/** Sanitize DOI for use as a filename */
export function doiToFilename(doi: string): string {
  return doi.replace(/[/\\?%*:|"<>]/g, "_") + ".pdf";
}
