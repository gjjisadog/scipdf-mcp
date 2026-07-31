import { describe, expect, it } from "vitest";
import {
  extractQueriesFromText,
  looksLikeCitation,
  citationToSearchQuery,
} from "../src/core/citations.js";
import { formatBibtex } from "../src/core/citeFormat.js";

describe("extractQueriesFromText", () => {
  it("extracts from bibtex", () => {
    const bib = `@article{x,
  doi = {10.1038/nature12373},
  title = {Foo}
}`;
    expect(extractQueriesFromText(bib)).toContain("10.1038/nature12373");
  });

  it("extracts bare dois", () => {
    const t = "See 10.1000/xyz123 and also 10.1038/nature12373.";
    const q = extractQueriesFromText(t);
    expect(q.some((x) => x.includes("10.1038"))).toBe(true);
  });

  it("extracts arXiv eprints and URLs for batch download", () => {
    const text = `@misc{x,
  eprint = {2501.01234v2},
  archivePrefix = {arXiv}
}
See also https://arxiv.org/abs/hep-th/9901001.`;
    expect(extractQueriesFromText(text)).toEqual(
      expect.arrayContaining([
        "arXiv:2501.01234v2",
        "arXiv:hep-th/9901001",
      ]),
    );
  });
});

describe("looksLikeCitation", () => {
  it("detects et al year", () => {
    expect(looksLikeCitation("Kucsko et al. 2013 Nature thermometry")).toBe(
      true,
    );
  });
});

describe("citationToSearchQuery", () => {
  it("returns doi when present", () => {
    expect(
      citationToSearchQuery("foo bar 10.1038/nature12373 more"),
    ).toBe("10.1038/nature12373");
  });
});

describe("formatBibtex", () => {
  it("uses a stable ASCII key for non-Latin author names", () => {
    const work = {
      doi: "10.1000/cjk",
      authors: ["王小明"],
      year: 2024,
      title: "测试论文",
    };
    const first = formatBibtex(work);
    expect(first).toMatch(/^@article\{ref2024[0-9a-f]{6},/);
    expect(formatBibtex(work)).toBe(first);
  });
});
