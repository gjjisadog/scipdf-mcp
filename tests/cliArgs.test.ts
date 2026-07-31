import { describe, expect, it } from "vitest";
import {
  parseBatchArgs,
  parseDownloadArgs,
  parseRelationArgs,
  parseSearchArgs,
} from "../src/core/cliArgs.js";

describe("parseDownloadArgs", () => {
  it("does not swallow --outdir into the query", () => {
    const p = parseDownloadArgs([
      "10.1038/nature12373",
      "--outdir",
      "/tmp/papers",
      "--force",
    ]);
    expect(p.query).toBe("10.1038/nature12373");
    expect(p.outdir).toBe("/tmp/papers");
    expect(p.force).toBe(true);
  });

  it("supports -o and --filename", () => {
    const p = parseDownloadArgs([
      "-o",
      "~/Docs",
      "--filename",
      "x.pdf",
      "10.1/x",
    ]);
    expect(p.outdir).toBe("~/Docs");
    expect(p.filename).toBe("x.pdf");
    expect(p.query).toBe("10.1/x");
  });

  it("supports --title value", () => {
    const p = parseDownloadArgs(["--title", "Hello World"]);
    expect(p.queryType).toBe("title");
    expect(p.query).toBe("Hello World");
  });

  it("supports an explicit arXiv identifier", () => {
    const p = parseDownloadArgs(["--arxiv", "2501.01234"]);
    expect(p.queryType).toBe("arxiv");
    expect(p.query).toBe("2501.01234");
  });

  it("rejects unknown flags", () => {
    expect(() => parseDownloadArgs(["--nope", "x"])).toThrow(/Unknown option/);
  });
});

describe("parseBatchArgs", () => {
  it("parses outdir and multiple queries", () => {
    const p = parseBatchArgs([
      "--outdir",
      "/tmp/b",
      "--force",
      "10.1/a",
      "10.1/b",
    ]);
    expect(p.outdir).toBe("/tmp/b");
    expect(p.force).toBe(true);
    expect(p.queries).toEqual(["10.1/a", "10.1/b"]);
  });
});

describe("parseSearchArgs", () => {
  it("parses sources and search filters without including them in the query", () => {
    const parsed = parseSearchArgs([
      "wide bandgap inverter",
      "--sources",
      "openalex,semanticscholar",
      "--year-from",
      "2022",
      "--min-citations",
      "5",
      "--oa",
      "--limit",
      "12",
    ]);
    expect(parsed.query).toBe("wide bandgap inverter");
    expect(parsed.sources).toEqual(["openalex", "semanticscholar"]);
    expect(parsed.yearFrom).toBe(2022);
    expect(parsed.minCitations).toBe(5);
    expect(parsed.openAccessOnly).toBe(true);
    expect(parsed.limit).toBe(12);
  });

  it("rejects unsupported sources and inverted year ranges", () => {
    expect(() => parseSearchArgs(["x", "--source", "pubmed"])).toThrow(
      /Unsupported search source/,
    );
    expect(() =>
      parseSearchArgs(["x", "--year-from", "2025", "--year-to", "2020"]),
    ).toThrow(/year-from/);
  });

  it("accepts arXiv as a search source", () => {
    expect(parseSearchArgs(["--source", "arxiv", "power electronics"])).toMatchObject({
      query: "power electronics",
      sources: ["arxiv"],
    });
  });
});

describe("parseRelationArgs", () => {
  it("parses a DOI and bounded limit", () => {
    expect(parseRelationArgs(["--limit", "25", "10.1000/example"])).toEqual({
      paperId: "10.1000/example",
      limit: 25,
    });
  });

  it("rejects limits above the provider maximum", () => {
    expect(() => parseRelationArgs(["x", "-n", "101"])).toThrow(/at most 100/);
  });
});
