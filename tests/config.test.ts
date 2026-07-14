import { describe, expect, it, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig concurrency", () => {
  const prev = process.env.SCIPDF_CONCURRENCY;

  afterEach(() => {
    if (prev === undefined) delete process.env.SCIPDF_CONCURRENCY;
    else process.env.SCIPDF_CONCURRENCY = prev;
  });

  it("rejects fractional concurrency like 0.5", () => {
    process.env.SCIPDF_CONCURRENCY = "0.5";
    const c = loadConfig();
    expect(c.concurrency).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(c.concurrency)).toBe(true);
  });

  it("clamps high concurrency", () => {
    process.env.SCIPDF_CONCURRENCY = "99";
    const c = loadConfig();
    expect(c.concurrency).toBe(8);
  });
});
