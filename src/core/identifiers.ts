import type { PaperIdentifier } from "../types.js";
import { normalizeDoi } from "./doi.js";

const MODERN_ARXIV_RE = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;
const LEGACY_ARXIV_RE =
  /^[a-z][a-z0-9.-]*\/\d{7}(?:v\d+)?$/i;

export function normalizeArxivId(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  value = value.replace(/^arxiv:\s*/i, "");
  if (/^https?:\/\/(?:export\.)?arxiv\.org\//i.test(value)) {
    try {
      const url = new URL(value);
      value = decodeURIComponent(
        url.pathname
          .replace(/^\/(?:abs|pdf)\//i, "")
          .replace(/\.pdf$/i, ""),
      );
    } catch {
      return null;
    }
  }
  value = value.replace(/\.pdf$/i, "").replace(/^\/+|\/+$/g, "");
  return MODERN_ARXIV_RE.test(value) || LEGACY_ARXIV_RE.test(value)
    ? value
    : null;
}

export function looksLikeArxivId(input: string): boolean {
  return normalizeArxivId(input) !== null;
}

export function parsePaperIdentifier(input: string): PaperIdentifier | null {
  const doi = normalizeDoi(input);
  if (doi) return { kind: "doi", value: doi };
  const arxivId = normalizeArxivId(input);
  if (arxivId) return { kind: "arxiv", value: arxivId };
  return null;
}

export function identifierStorageKey(identifier: PaperIdentifier): string {
  return `${identifier.kind}:${identifier.value}`;
}
