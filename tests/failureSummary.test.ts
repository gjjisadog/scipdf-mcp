import { describe, expect, it } from "vitest";
import {
  shortFailureMessage,
  summarizeSourceErrors,
} from "../src/core/failureSummary.js";

describe("summarizeSourceErrors", () => {
  it("classifies absent / blocked / timeout", () => {
    const s = summarizeSourceErrors(
      [
        "https://a/: PDF not available on Sci-Hub for DOI x (no PDF link on page)",
        "https://b/: Mirror HTTP 403: https://b/x",
        "https://c/: fetch failed",
        "https://d/: The operation was aborted due to timeout",
      ],
      { earlyStop: true },
    );
    expect(s.attempted).toBe(4);
    expect(s.absent).toBe(1);
    expect(s.blocked).toBe(1);
    expect(s.timeouts).toBe(1);
    expect(s.other).toBe(1);
    expect(s.earlyStop).toBe(true);
    expect(s.samples.length).toBeLessThanOrEqual(5);
  });

  it("shortFailureMessage is compact", () => {
    const s = summarizeSourceErrors([
      "h: no PDF link",
      "h2: Mirror HTTP 403: x",
    ]);
    const msg = shortFailureMessage("ALL_SOURCES_FAILED", "10.1/x", s);
    expect(msg).toContain("10.1/x");
    expect(msg).toContain("attempted=2");
  });
});
