import { describe, expect, it } from "vitest";
import {
  doiToFilename,
  extractDoiFromText,
  looksLikeDoi,
  looksLikeUrl,
  normalizeDoi,
} from "../src/core/doi.js";

describe("normalizeDoi", () => {
  it("accepts bare DOI", () => {
    expect(normalizeDoi("10.1038/nature12373")).toBe("10.1038/nature12373");
  });

  it("strips doi.org prefix", () => {
    expect(normalizeDoi("https://doi.org/10.1038/nature12373")).toBe(
      "10.1038/nature12373",
    );
  });

  it("strips doi: prefix", () => {
    expect(normalizeDoi("doi:10.1038/nature12373")).toBe("10.1038/nature12373");
  });

  it("returns null for non-DOI", () => {
    expect(normalizeDoi("hello world")).toBeNull();
  });

  it("preserves SICI DOIs with angle brackets", () => {
    const sici =
      "10.1002/(SICI)1097-0142(19960201)77:3<454::AID-CNCR7>3.0.CO;2-N";
    expect(normalizeDoi(sici)).toBe(sici);
    expect(normalizeDoi(`See ${sici}.`)).toBe(sici);
  });

  it("does not truncate at colon inside suffix", () => {
    expect(normalizeDoi("10.1002/foo:bar:baz")).toBe("10.1002/foo:bar:baz");
  });
});

describe("extractDoiFromText", () => {
  it("finds DOI inside publisher URL", () => {
    expect(
      extractDoiFromText("https://www.nature.com/articles/doi:10.1038/nature12373"),
    ).toBe("10.1038/nature12373");
  });
});

describe("doiToFilename", () => {
  it("replaces slashes with unique encoding", () => {
    expect(doiToFilename("10.1038/nature12373")).toBe(
      "10.1038%2Fnature12373.pdf",
    );
  });

  it("does not collide on / vs :", () => {
    const a = doiToFilename("10.1000/a/b");
    const b = doiToFilename("10.1000/a:b");
    expect(a).not.toBe(b);
  });
});

describe("looksLike", () => {
  it("detects doi and url", () => {
    expect(looksLikeDoi("10.1000/xyz")).toBe(true);
    expect(looksLikeUrl("https://example.com")).toBe(true);
    expect(looksLikeUrl("not a url")).toBe(false);
  });
});
