import type { CrossrefWork } from "../types.js";

function firstAuthorLast(authors?: string[]): string {
  if (!authors?.length) return "Unknown";
  const a = authors[0];
  const parts = a.trim().split(/\s+/);
  return parts[parts.length - 1] || a;
}

function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

function bibtexKey(work: CrossrefWork & { doi: string }): string {
  const author = firstAuthorLast(work.authors)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]/g, "");
  const year = work.year ?? "nd";

  // Classic BibTeX keys are safest as ASCII. For CJK and other non-Latin
  // author names, retain a deterministic DOI-derived suffix instead of
  // silently collapsing every entry to just its year.
  return author ? `${author}${year}` : `ref${year}${shortHash(work.doi)}`;
}

export function formatApa(work: {
  title?: string;
  authors?: string[];
  year?: number;
  container?: string;
  doi?: string;
}): string {
  const authors =
    work.authors && work.authors.length
      ? work.authors.length <= 2
        ? work.authors.join(" & ")
        : `${work.authors[0]} et al.`
      : "Unknown";
  const year = work.year ?? "n.d.";
  const title = work.title ?? "Untitled";
  const container = work.container ? ` ${work.container}.` : "";
  const doi = work.doi ? ` https://doi.org/${work.doi}` : "";
  return `${authors} (${year}). ${title}.${container}${doi}`;
}

export function formatGbt(work: {
  title?: string;
  authors?: string[];
  year?: number;
  container?: string;
  doi?: string;
}): string {
  const authors =
    work.authors && work.authors.length
      ? work.authors.slice(0, 3).join(", ") +
        (work.authors.length > 3 ? ", et al" : "")
      : "Unknown";
  const year = work.year ?? "n.d.";
  const title = work.title ?? "Untitled";
  const container = work.container ? `// ${work.container}` : "";
  const doi = work.doi ? `. DOI: ${work.doi}` : "";
  return `${authors}. ${title}${container}[J]. ${year}${doi}.`;
}

export function formatBibtex(work: CrossrefWork & { doi: string }): string {
  const key = bibtexKey(work);
  const authors = (work.authors ?? []).join(" and ") || "Unknown";
  const lines = [
    `@article{${key},`,
    `  title = {${work.title ?? "Untitled"}},`,
    `  author = {${authors}},`,
    work.year != null ? `  year = {${work.year}},` : null,
    work.container ? `  journal = {${work.container}},` : null,
    `  doi = {${work.doi}},`,
    `  url = {https://doi.org/${work.doi}}`,
    `}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildCitations(work: {
  doi: string;
  title?: string;
  authors?: string[];
  year?: number;
  container?: string;
}) {
  return {
    apa: formatApa(work),
    gbt: formatGbt(work),
    bibtex: formatBibtex({ ...work, doi: work.doi }),
  };
}

export function buildArxivCitations(work: {
  arxivId: string;
  title?: string;
  authors?: string[];
  year?: number;
}) {
  const authors = work.authors?.length
    ? work.authors.length <= 2
      ? work.authors.join(" & ")
      : `${work.authors[0]} et al.`
    : "Unknown";
  const year = work.year ?? "n.d.";
  const title = work.title ?? "Untitled";
  const key = `arxiv${work.arxivId.replace(/[^A-Za-z0-9]/g, "")}`;
  return {
    apa: `${authors} (${year}). ${title}. arXiv:${work.arxivId}. https://arxiv.org/abs/${work.arxivId}`,
    gbt: `${authors}. ${title}[EB/OL]. arXiv:${work.arxivId}, ${year}.`,
    bibtex: [
      `@misc{${key},`,
      `  title = {${title}},`,
      `  author = {${(work.authors ?? []).join(" and ") || "Unknown"}},`,
      work.year != null ? `  year = {${work.year}},` : null,
      `  eprint = {${work.arxivId}},`,
      `  archivePrefix = {arXiv},`,
      `  url = {https://arxiv.org/abs/${work.arxivId}}`,
      `}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
