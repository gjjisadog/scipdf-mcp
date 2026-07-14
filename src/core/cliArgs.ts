/**
 * Shared CLI flag parsing so options like --outdir are not swallowed into the query.
 */

export type DownloadCliOpts = {
  force: boolean;
  queryType: "auto" | "title" | "doi" | "url" | "citation";
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
