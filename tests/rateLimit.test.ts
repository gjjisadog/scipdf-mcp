import { afterEach, describe, expect, it } from "vitest";
import { clearRateLimitBuckets, throttle } from "../src/core/rateLimit.js";

describe("per-host throttle", () => {
  afterEach(() => {
    clearRateLimitBuckets();
  });

  it("allows different hosts to proceed without waiting on each other", async () => {
    const gap = 80;
    const t0 = Date.now();
    await Promise.all([
      throttle(gap, "https://a.example/x"),
      throttle(gap, "https://b.example/y"),
      throttle(gap, "https://c.example/z"),
    ]);
    const elapsed = Date.now() - t0;
    // Three hosts in parallel should finish near t0, not 2*gap
    expect(elapsed).toBeLessThan(gap * 1.5);
  });

  it("serializes same host", async () => {
    const gap = 40;
    const t0 = Date.now();
    await Promise.all([
      throttle(gap, "https://same.example/1"),
      throttle(gap, "https://same.example/2"),
      throttle(gap, "https://same.example/3"),
    ]);
    const elapsed = Date.now() - t0;
    // 3 requests on one host → at least ~2 gaps
    expect(elapsed).toBeGreaterThanOrEqual(gap * 1.5);
  });
});
