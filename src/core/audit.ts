import type {
  AuditReferencesResult,
  ReferenceAuditEntry,
  ResolveResult,
} from "../types.js";
import { buildCitations } from "./citeFormat.js";
import { extractQueriesFromText } from "./citations.js";
import { looksLikeDoi } from "./doi.js";

export function classifyReferenceAudit(
  input: string,
  resolved: ResolveResult,
): ReferenceAuditEntry {
  if (!resolved.ok || !resolved.doi) {
    return {
      input,
      status:
        resolved.code === "AMBIGUOUS_DOI" ? "ambiguous" : "not_found",
      code: resolved.code,
      error: resolved.error,
    };
  }
  const status = looksLikeDoi(input)
    ? resolved.title
      ? "verified"
      : "unverified"
    : "resolved";
  return {
    input,
    status,
    doi: resolved.doi,
    title: resolved.title,
    authors: resolved.authors,
    year: resolved.year,
    container: resolved.container,
    source: resolved.source,
    citation: buildCitations({
      doi: resolved.doi,
      title: resolved.title,
      authors: resolved.authors,
      year: resolved.year,
      container: resolved.container,
    }),
  };
}

function auditQueries(text: string): string[] {
  const parsed = extractQueriesFromText(text);
  if (parsed.length) return parsed;
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8);
}

export async function auditReferences(
  text: string,
  timeoutMs = 15_000,
  concurrency = 3,
): Promise<AuditReferencesResult> {
  // Defer the network/download module until the workflow actually runs. This
  // keeps the pure classifier reusable without loading HTTP parser dependencies.
  const { resolveToDoi } = await import("./download.js");
  const queries = auditQueries(text);
  const results = new Array<ReferenceAuditEntry>(queries.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < queries.length) {
      const index = cursor++;
      const input = queries[index];
      const resolved = await resolveToDoi(input, "auto", timeoutMs);
      results[index] = classifyReferenceAudit(input, resolved);
    }
  };
  const workerCount = Math.max(
    1,
    Math.min(Math.floor(concurrency), 8, queries.length || 1),
  );
  await Promise.all(Array.from({ length: workerCount }, worker));

  return {
    total: results.length,
    verified: results.filter((item) => item.status === "verified").length,
    resolved: results.filter((item) => item.status === "resolved").length,
    unverified: results.filter((item) => item.status === "unverified").length,
    failed: results.filter(
      (item) => item.status === "ambiguous" || item.status === "not_found",
    ).length,
    results,
  };
}
