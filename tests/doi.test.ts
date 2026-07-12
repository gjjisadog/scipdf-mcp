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
});

describe("extractDoiFromText", () => {
  it("finds DOI inside publisher URL", () => {
    expect(
      extractDoiFromText("https://www.nature.com/articles/doi:10.1038/nature12373"),
    ).toBe("10.1038/nature12373");
  });
});

describe("doiToFilename", () => {
  it("replaces slashes", () => {
    expect(doiToFilename("10.1038/nature12373")).toBe(
      "10.1038_nature12373.pdf",
    );
  });
});

describe("looksLike", () => {
  it("detects doi and url", () => {
    expect(looksLikeDoi("10.1000/xyz")).toBe(true);
    expect(looksLikeUrl("https://example.com")).toBe(true);
    expect(looksLikeUrl("not a url")).toBe(false);
  });
});
