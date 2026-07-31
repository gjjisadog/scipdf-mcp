/**
 * Shared CLI flag parsing so options like --outdir are not swallowed into the query.
 */

export type DownloadCliOpts = {
  force: boolean;
  queryType: "auto" | "title" | "doi" | "arxiv" | "url" | "citation";
  outdir?: string;
  filename?: string;
  query: string;
  /** Remaining non-flag positional tokens (for batch) */
  positionals: string[];
};

/**
 * Parse flags from argv tokens (after the subcommand).
 * Supports:
 *   --force / -f
 *   --title <q> | --doi <q> | --url <q>
 *   --arxiv <id>
 *   --outdir <path> | -o <path>
 *   --filename <name>
 *   --query <q> | -q <q>
 *   -- <rest...>  (everything after is positional query)
 */
export function parseDownloadArgs(tokens: string[]): DownloadCliOpts {
  let force = false;
  let queryType: DownloadCliOpts["queryType"] = "auto";
  let outdir: string | undefined;
  let filename: string | undefined;
  const positionals: string[] = [];
  const queryParts: string[] = [];

  const takeValue = (i: number, flag: string): { value: string; next: number } => {
    const v = tokens[i + 1];
    if (!v || v.startsWith("-")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return { value: v, next: i + 1 };
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t === "--") {
      positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (t === "--force" || t === "-f") {
      force = true;
      continue;
    }
    if (t === "--title") {
      queryType = "title";
      const { value, next } = takeValue(i, t);
      queryParts.push(value);
      i = next;
      continue;
    }
    if (t === "--doi") {
      queryType = "doi";
      const { value, next } = takeValue(i, t);
      queryParts.push(value);
      i = next;
      continue;
    }
    if (t === "--arxiv") {
      queryType = "arxiv";
      const { value, next } = takeValue(i, t);
      queryParts.push(value);
      i = next;
      continue;
    }
    if (t === "--url") {
      queryType = "url";
      const { value, next } = takeValue(i, t);
      queryParts.push(value);
      i = next;
      continue;
    }
    if (t === "--outdir" || t === "-o") {
      const { value, next } = takeValue(i, t);
      outdir = value;
      i = next;
      continue;
    }
    if (t === "--filename") {
      const { value, next } = takeValue(i, t);
      filename = value;
      i = next;
      continue;
    }
    if (t === "--query" || t === "-q") {
      const { value, next } = takeValue(i, t);
      queryParts.push(value);
      i = next;
      continue;
    }
    if (t.startsWith("-")) {
      throw new Error(`Unknown option: ${t}`);
    }
    positionals.push(t);
  }

  const query = [...queryParts, ...positionals].join(" ").trim();
  return { force, queryType, outdir, filename, query, positionals };
}

/** Batch: flags + one positional query per remaining arg (not joined). */
export function parseBatchArgs(tokens: string[]): {
  force: boolean;
  outdir?: string;
  queries: string[];
} {
  let force = false;
  let outdir: string | undefined;
  const queries: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--force" || t === "-f") {
      force = true;
      continue;
    }
    if (t === "--outdir" || t === "-o") {
      const v = tokens[i + 1];
      if (!v || v.startsWith("-")) throw new Error(`Missing value for ${t}`);
      outdir = v;
      i++;
      continue;
    }
    if (t === "--") {
      queries.push(...tokens.slice(i + 1));
      break;
    }
    if (t.startsWith("-")) {
      throw new Error(`Unknown option: ${t}`);
    }
    queries.push(t);
  }
  return { force, outdir, queries };
}

export type SearchCliOpts = {
  query: string;
  sources?: Array<"crossref" | "openalex" | "semanticscholar" | "arxiv">;
  limit?: number;
  yearFrom?: number;
  yearTo?: number;
  minCitations?: number;
  openAccessOnly: boolean;
};

export type RelationCliOpts = {
  paperId: string;
  limit?: number;
};

const SEARCH_SOURCES = new Set([
  "crossref",
  "openalex",
  "semanticscholar",
  "arxiv",
]);

function positiveInt(value: string, flag: string, allowZero = false): number {
  const n = Number(value);
  if (
    !Number.isInteger(n) ||
    (allowZero ? n < 0 : n < 1)
  ) {
    throw new Error(`Invalid integer for ${flag}: ${value}`);
  }
  return n;
}

/** Parse flags for `scipdf-mcp search`. */
export function parseSearchArgs(tokens: string[]): SearchCliOpts {
  const queryParts: string[] = [];
  const sources: SearchCliOpts["sources"] = [];
  let limit: number | undefined;
  let yearFrom: number | undefined;
  let yearTo: number | undefined;
  let minCitations: number | undefined;
  let openAccessOnly = false;

  const takeValue = (i: number, flag: string) => {
    const value = tokens[i + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") {
      queryParts.push(...tokens.slice(i + 1));
      break;
    }
    if (token === "--query" || token === "-q") {
      queryParts.push(takeValue(i, token));
      i++;
      continue;
    }
    if (token === "--source" || token === "--sources") {
      const values = takeValue(i, token)
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      for (const value of values) {
        if (!SEARCH_SOURCES.has(value)) {
          throw new Error(`Unsupported search source: ${value}`);
        }
        const source = value as NonNullable<SearchCliOpts["sources"]>[number];
        if (!sources.includes(source)) sources.push(source);
      }
      i++;
      continue;
    }
    if (token === "--limit" || token === "-n") {
      limit = positiveInt(takeValue(i, token), token);
      i++;
      continue;
    }
    if (token === "--year-from") {
      yearFrom = positiveInt(takeValue(i, token), token);
      i++;
      continue;
    }
    if (token === "--year-to") {
      yearTo = positiveInt(takeValue(i, token), token);
      i++;
      continue;
    }
    if (token === "--min-citations") {
      minCitations = positiveInt(takeValue(i, token), token, true);
      i++;
      continue;
    }
    if (token === "--open-access" || token === "--oa") {
      openAccessOnly = true;
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`Unknown option: ${token}`);
    }
    queryParts.push(token);
  }

  if (
    yearFrom !== undefined &&
    yearTo !== undefined &&
    yearFrom > yearTo
  ) {
    throw new Error("--year-from must be less than or equal to --year-to");
  }

  return {
    query: queryParts.join(" ").trim(),
    sources: sources.length ? sources : undefined,
    limit,
    yearFrom,
    yearTo,
    minCitations,
    openAccessOnly,
  };
}

/** Parse a paper identifier plus optional result limit. */
export function parseRelationArgs(tokens: string[]): RelationCliOpts {
  const parts: string[] = [];
  let limit: number | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--limit" || token === "-n") {
      const value = tokens[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Missing value for ${token}`);
      }
      limit = positiveInt(value, token);
      if (limit > 100) throw new Error(`${token} must be at most 100`);
      i++;
      continue;
    }
    if (token === "--") {
      parts.push(...tokens.slice(i + 1));
      break;
    }
    if (token.startsWith("-")) throw new Error(`Unknown option: ${token}`);
    parts.push(token);
  }
  return { paperId: parts.join(" ").trim(), limit };
}
