import { describe, expect, it } from "vitest";
import { maskEmail, hasUnpaywallEmail } from "../src/core/unpaywall.js";
import type { SciPdfConfig } from "../src/types.js";

function baseConfig(over: Partial<SciPdfConfig> = {}): SciPdfConfig {
  return {
    downloadDir: "/tmp",
    scihubMirrors: [],
    pdfHosts: [],
    timeoutMs: 10000,
    fastFailTimeoutMs: 3000,
    concurrency: 1,
    userAgent: "test",
    filenameStyle: "doi",
    healthCacheTtlMs: 1000,
    minRequestGapMs: 0,
    sourceRaceWidth: 5,
    pdfNotFoundConfirmations: 1,
    debug: false,
    preferOa: true,
    allowScihub: true,
    ...over,
  };
}

describe("unpaywall helpers", () => {
  it("masks email", () => {
    expect(maskEmail("alice@example.com")).toMatch(/@example\.com$/);
    expect(maskEmail("alice@example.com")).not.toContain("alice@");
  });

  it("validates email presence", () => {
    expect(hasUnpaywallEmail(baseConfig({ unpaywallEmail: "a@b.co" }))).toBe(
      true,
    );
    expect(hasUnpaywallEmail(baseConfig({ unpaywallEmail: "not-email" }))).toBe(
      false,
    );
    expect(hasUnpaywallEmail(baseConfig({}))).toBe(false);
    expect(
      hasUnpaywallEmail(baseConfig({ unpaywallEmail: "test@example.com" })),
    ).toBe(false);
  });
});
