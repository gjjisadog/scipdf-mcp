/**
 * DOI matching — suffix may include SICI characters such as < > ( ) : ;
 * which narrower regexes truncated (e.g. …17:4<290… → …17:4).
 * @see https://www.doi.org/doi_handbook/2_Numbering.html
 */

/** Full-token DOI: non-whitespace after 10.xxxx/ */
const DOI_TOKEN_RE = /\b(10\.\d{4,9}\/\S+)/i;

/** Scan free text; stop at whitespace or common list delimiters only. */
const DOI_SCAN_RE = /\b10\.\d{4,9}\/[^\s\]}"']+/gi;

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/**
 * Strip trailing punctuation copied from prose, while preserving
 * balanced SICI angle brackets and parentheses that are part of the DOI.
 */
function trimTrailingProsePunct(doi: string): string {
  let s = doi;
  while (s.length > 0) {
    const last = s[s.length - 1];
    if (/[.,;]+/.test(last)) {
      s = s.slice(0, -1);
      continue;
    }
    if (last === ")" && countChar(s, "(") < countChar(s, ")")) {
      s = s.slice(0, -1);
      continue;
    }
    if (last === "]" && countChar(s, "[") < countChar(s, "]")) {
      s = s.slice(0, -1);
      continue;
    }
    if (last === ">" && countChar(s, "<") < countChar(s, ">")) {
      s = s.slice(0, -1);
      continue;
    }
    // Trailing colon only when not mid-SICI (rare at end)
    if (last === ":" && !/\d$/.test(s.slice(0, -1))) {
      // keep colons inside SICI; only strip if whole token ends oddly
      break;
    }
    break;
  }
  return s;
}

/** Strip common DOI URL prefixes and whitespace */
export function normalizeDoi(input: string): string | null {
  let s = input.trim();
  if (!s) return null;

  s = s
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/^DOI\s+/i, "")
    .trim();

  const m = s.match(DOI_TOKEN_RE);
  if (!m) return null;

  const doi = trimTrailingProsePunct(m[1]);
  if (!/^10\.\d{4,9}\/\S+/i.test(doi)) return null;
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
  const direct = normalizeDoi(text);
  if (direct && text.trim().length < direct.length + 40) return direct;

  DOI_SCAN_RE.lastIndex = 0;
  let best: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = DOI_SCAN_RE.exec(text)) !== null) {
    const d = normalizeDoi(m[0]);
    if (d && (!best || d.length > best.length)) best = d;
  }
  return best;
}

/**
 * Sanitize DOI for use as a filename with collision-resistant encoding.
 * Different DOIs (e.g. 10.1000/a/b vs 10.1000/a:b) must not share a path.
 */
export function doiToFilename(doi: string): string {
  const safe = doi.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    return (
      "%" +
      Buffer.from(ch, "utf8")
        .toString("hex")
        .toUpperCase()
    );
  });
  if (safe.length <= 180) return `${safe}.pdf`;
  const head = safe.slice(0, 140);
  const hash = simpleHash(doi);
  return `${head}~${hash}.pdf`;
}

function simpleHash(s: string): string {
  // FNV-1a 32-bit → hex
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Decode filename produced by doiToFilename (best-effort). */
export function filenameToDoiHint(name: string): string | null {
  const base = name.replace(/\.pdf$/i, "").replace(/~[0-9a-f]{8}$/i, "");
  if (!base.startsWith("10.")) return null;
  try {
    const decoded = base.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    return normalizeDoi(decoded);
  } catch {
    return null;
  }
}
