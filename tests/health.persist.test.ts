import { afterEach, describe, expect, it } from "vitest";
import {
  clearHealth,
  flushHealth,
  getHealth,
  markBad,
  markGood,
  resetHealthLoader,
  setHealth,
  sortByHealth,
} from "../src/core/health.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("health persistence", () => {
  const prevFile = process.env.SCIPDF_HEALTH_FILE;
  const prevPersist = process.env.SCIPDF_HEALTH_PERSIST;
  let dir: string;

  afterEach(() => {
    clearHealth();
    resetHealthLoader();
    if (prevFile === undefined) delete process.env.SCIPDF_HEALTH_FILE;
    else process.env.SCIPDF_HEALTH_FILE = prevFile;
    if (prevPersist === undefined) delete process.env.SCIPDF_HEALTH_PERSIST;
    else process.env.SCIPDF_HEALTH_PERSIST = prevPersist;
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("persists and reloads health entries", () => {
    dir = mkdtempSync(join(tmpdir(), "scipdf-health-"));
    process.env.SCIPDF_HEALTH_FILE = join(dir, "health.json");
    process.env.SCIPDF_HEALTH_PERSIST = "1";
    resetHealthLoader();

    markGood("https://good.example/", 100);
    markBad("https://bad.example/", "HTTP 403", 50);
    flushHealth();

    const raw = JSON.parse(
      readFileSync(process.env.SCIPDF_HEALTH_FILE, "utf8"),
    ) as { entries: Record<string, { ok: boolean; failStreak?: number }> };
    expect(raw.entries["https://good.example/"].ok).toBe(true);
    expect(raw.entries["https://bad.example/"].ok).toBe(false);

    // Simulate new process
    resetHealthLoader();
    const g = getHealth("https://good.example/", 60_000);
    const b = getHealth("https://bad.example/", 60_000);
    expect(g?.ok).toBe(true);
    expect(b?.ok).toBe(false);
    expect((b?.failStreak ?? 0) >= 1).toBe(true);
  });

  it("demotes high failStreak in sortByHealth", () => {
    process.env.SCIPDF_HEALTH_PERSIST = "0";
    resetHealthLoader();
    markBad("https://a/", "x", 10);
    markBad("https://a/", "x", 10);
    markBad("https://a/", "x", 10);
    markBad("https://b/", "y", 10);
    markGood("https://c/", 5);

    const ordered = sortByHealth(
      ["https://a/", "https://b/", "https://c/"],
      60_000,
    );
    expect(ordered[0]).toBe("https://c/");
    // b (streak 1) before a (streak 3)
    expect(ordered.indexOf("https://b/")).toBeLessThan(
      ordered.indexOf("https://a/"),
    );
  });

  it("does not return a cache entry when force refresh uses ttl=0", () => {
    process.env.SCIPDF_HEALTH_PERSIST = "0";
    resetHealthLoader();
    setHealth("https://force.example/", {
      ok: true,
      latencyMs: 10,
      checkedAt: Date.now(),
    });

    expect(getHealth("https://force.example/", 0)).toBeNull();
    expect(getHealth("https://force.example/", 60_000)?.ok).toBe(true);
  });
});
