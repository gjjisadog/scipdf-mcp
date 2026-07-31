import { describe, expect, it } from "vitest";
import {
  listPaperSources,
  mergeAndRankSearchResults,
} from "../src/core/search.js";
import type { PaperSearchResult } from "../src/types.js";

function paper(
  overrides: Partial<PaperSearchResult> & Pick<PaperSearchResult, "title">,
): PaperSearchResult {
  return {
    authors: [],
    relevanceScore: 0,
    sources: ["crossref"],
    ...overrides,
  };
}

describe("mergeAndRankSearchResults", () => {
  it("deduplicates by DOI and merges richer metadata and source provenance", () => {
    const results = mergeAndRankSearchResults(
      [
        [
          paper({
            title: "Wide Bandgap Inverters",
            doi: "10.1000/example",
            authors: ["A. Author"],
            year: 2023,
            sources: ["crossref"],
          }),
        ],
        [
          paper({
            title: "Wide Bandgap Inverters: A Review",
            doi: "https://doi.org/10.1000/example",
            abstract: "A substantially richer abstract.",
            citationCount: 42,
            isOpenAccess: true,
            openAccessPdf: "https://example.org/paper.pdf",
            sources: ["openalex"],
          }),
        ],
      ],
      {},
      20,
    );

    expect(results).toHaveLength(1);
    expect(results[0].sources).toEqual(["crossref", "openalex"]);
    expect(results[0].citationCount).toBe(42);
    expect(results[0].openAccessPdf).toBe("https://example.org/paper.pdf");
    expect(results[0].relevanceScore).toBeGreaterThan(0.03);
  });

  it("uses cross-source agreement in ranking and applies strict filters", () => {
    const shared = paper({
      title: "Shared Result",
      doi: "10.1000/shared",
      year: 2024,
      citationCount: 10,
      isOpenAccess: true,
      sources: ["crossref"],
    });
    const results = mergeAndRankSearchResults(
      [
        [
          paper({
            title: "Single-source Result",
            doi: "10.1000/single",
            year: 2024,
            citationCount: 100,
            isOpenAccess: true,
          }),
          shared,
        ],
        [
          {
            ...shared,
            sources: ["semanticscholar"],
          },
        ],
      ],
      {
        yearFrom: 2023,
        minCitations: 5,
        openAccessOnly: true,
      },
      20,
    );

    expect(results.map((result) => result.doi)).toEqual([
      "10.1000/shared",
      "10.1000/single",
    ]);
  });

  it("excludes unknown metadata when a corresponding filter is requested", () => {
    const results = mergeAndRankSearchResults(
      [[paper({ title: "Unknown Year", doi: "10.1000/unknown" })]],
      { yearFrom: 2020 },
      20,
    );
    expect(results).toEqual([]);
  });
});

describe("PaperSource adapters", () => {
  it("advertises provider-specific capabilities", () => {
    const sources = listPaperSources();
    expect(sources.map((source) => source.name)).toEqual([
      "crossref",
      "openalex",
      "semanticscholar",
      "arxiv",
    ]);
    expect(
      sources.find((source) => source.name === "semanticscholar")?.capabilities,
    ).toMatchObject({ search: true, citations: true, recommendations: true });
    expect(
      sources.find((source) => source.name === "arxiv")?.capabilities,
    ).toMatchObject({ search: true, pdf: true });
  });
});
