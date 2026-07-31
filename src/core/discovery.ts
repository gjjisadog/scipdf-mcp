import type {
  PaperRelation,
  PaperRelationResult,
  SciPdfConfig,
} from "../types.js";
import {
  getSemanticScholarRecommendations,
  getSemanticScholarRelations,
} from "./semanticScholar.js";

export async function discoverRelatedPapers(
  paperId: string,
  relation: PaperRelation,
  config: SciPdfConfig,
  limit = 20,
): Promise<PaperRelationResult> {
  const cleaned = paperId.trim();
  if (!cleaned) throw new Error("Paper identifier must not be empty");
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const timeoutMs = Math.min(config.timeoutMs, 20_000);
  const results =
    relation === "related"
      ? await getSemanticScholarRecommendations(
          cleaned,
          safeLimit,
          timeoutMs,
          config.minRequestGapMs,
          config.userAgent,
        )
      : await getSemanticScholarRelations(
          cleaned,
          relation,
          safeLimit,
          timeoutMs,
          config.minRequestGapMs,
          config.userAgent,
        );

  return {
    paperId: cleaned,
    relation,
    total: results.length,
    results,
  };
}
