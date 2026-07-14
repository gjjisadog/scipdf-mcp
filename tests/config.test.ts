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

describe("loadConfig race / not-found", () => {
  const keys = ["SCIPDF_RACE_WIDTH", "SCIPDF_NOT_FOUND_CONFIRM"] as const;
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
      delete prev[k];
    }
  });

  function stash(k: (typeof keys)[number]) {
    if (!(k in prev)) prev[k] = process.env[k];
  }

  it("defaults race width 5 and not-found confirm 1", () => {
    for (const k of keys) {
      stash(k);
      delete process.env[k];
    }
    const c = loadConfig();
    expect(c.sourceRaceWidth).toBe(5);
    expect(c.pdfNotFoundConfirmations).toBe(1);
  });

  it("clamps race width and not-found confirm", () => {
    stash("SCIPDF_RACE_WIDTH");
    stash("SCIPDF_NOT_FOUND_CONFIRM");
    process.env.SCIPDF_RACE_WIDTH = "99";
    process.env.SCIPDF_NOT_FOUND_CONFIRM = "0";
    const c = loadConfig();
    expect(c.sourceRaceWidth).toBe(8);
    expect(c.pdfNotFoundConfirmations).toBe(1);
  });
});
