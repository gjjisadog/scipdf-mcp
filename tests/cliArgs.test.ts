import { describe, expect, it } from "vitest";
import { parseBatchArgs, parseDownloadArgs } from "../src/core/cliArgs.js";

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
