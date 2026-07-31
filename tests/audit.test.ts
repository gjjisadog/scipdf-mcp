import { describe, expect, it } from "vitest";
import { classifyReferenceAudit } from "../src/core/audit.js";

describe("classifyReferenceAudit", () => {
  it("distinguishes verified DOI metadata from unverified DOI syntax", () => {
    expect(
      classifyReferenceAudit("10.1000/example", {
        ok: true,
        query: "10.1000/example",
        doi: "10.1000/example",
        title: "Verified paper",
        source: "doi",
      }).status,
    ).toBe("verified");
    expect(
      classifyReferenceAudit("10.1000/missing", {
        ok: true,
        query: "10.1000/missing",
        doi: "10.1000/missing",
        source: "doi",
      }).status,
    ).toBe("unverified");
  });

  it("preserves ambiguity instead of selecting a candidate", () => {
    const result = classifyReferenceAudit("similar title", {
      ok: false,
      query: "similar title",
      code: "AMBIGUOUS_DOI",
      error: "Multiple close DOI matches",
    });
    expect(result.status).toBe("ambiguous");
    expect(result.doi).toBeUndefined();
  });
});
