import { describe, expect, it } from "vitest";
import {
  isPdfAbsentError,
  MirrorError,
  PdfNotFoundError,
  raceSources,
} from "../src/core/scihub.js";
import { aggregateSourceErrors } from "../src/core/errors.js";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("raceSources", () => {
  it("returns first success among concurrent probes", async () => {
    const calls: string[] = [];
    const result = await raceSources(
      ["slow", "fast", "slower"],
      3,
      async (src) => {
        calls.push(src);
        if (src === "fast") {
          await delay(20);
          return `ok-${src}`;
        }
        await delay(80);
        throw new Error(`${src} failed`);
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("ok-fast");
    // All three should have been launched (width=3)
    expect(calls.sort()).toEqual(["fast", "slow", "slower"].sort());
  });

  it("early-stops after N PdfNotFound confirmations", async () => {
    const tried: string[] = [];
    const result = await raceSources(
      ["a", "b", "c", "d", "e"],
      2,
      async (src) => {
        tried.push(src);
        await delay(10);
        throw new PdfNotFoundError(`missing on ${src}`);
      },
      {
        isNotFound: (e) => e instanceof PdfNotFoundError,
        notFoundConfirmations: 2,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.earlyNotFound).toBe(true);
      expect(result.notFound).toBeInstanceOf(PdfNotFoundError);
      // Width 2: first wave a,b both not-found → stop; c/d/e never started
      expect(result.attempted).toBeLessThanOrEqual(3);
      expect(tried.length).toBeLessThanOrEqual(3);
      expect(tried).not.toContain("e");
    }
  });

  it("does not early-stop on non-notFound errors", async () => {
    const tried: string[] = [];
    const result = await raceSources(
      ["a", "b", "c"],
      1,
      async (src) => {
        tried.push(src);
        throw new Error(`blocked ${src}`);
      },
      {
        isNotFound: (e) => e instanceof PdfNotFoundError,
        notFoundConfirmations: 2,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.earlyNotFound).toBe(false);
      expect(result.notFound).toBeNull();
      expect(result.attempted).toBe(3);
      expect(tried).toEqual(["a", "b", "c"]);
    }
  });

  it("width=1 is sequential and stops on first success", async () => {
    const tried: string[] = [];
    const result = await raceSources(["a", "b", "c"], 1, async (src) => {
      tried.push(src);
      if (src === "b") return 42;
      throw new Error("nope");
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
    expect(tried).toEqual(["a", "b"]);
    // c never launched
    expect(tried).not.toContain("c");
  });

  it("empty sources returns fail without throwing", async () => {
    const result = await raceSources([], 3, async () => "x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([]);
      expect(result.attempted).toBe(0);
    }
  });

  it("mix: notFound + transport, only counts notFound toward early stop", async () => {
    const order = ["block", "miss1", "miss2", "never"];
    const tried: string[] = [];
    const result = await raceSources(
      order,
      1,
      async (src) => {
        tried.push(src);
        if (src.startsWith("miss")) {
          throw new PdfNotFoundError(src);
        }
        throw new Error(`MirrorError ${src}`);
      },
      {
        isNotFound: isPdfAbsentError,
        notFoundConfirmations: 2,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.earlyNotFound).toBe(true);
      expect(tried).toEqual(["block", "miss1", "miss2"]);
      expect(tried).not.toContain("never");
    }
  });

  it("early-stops on no-PDF-link style absence (confirm=1)", async () => {
    const tried: string[] = [];
    const result = await raceSources(
      ["m1", "m2", "m3", "m4", "m5"],
      5,
      async (src) => {
        tried.push(src);
        await delay(5);
        throw new PdfNotFoundError(
          `PDF not available on Sci-Hub for DOI x (no PDF link on page)`,
        );
      },
      { isNotFound: isPdfAbsentError, notFoundConfirmations: 1 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.earlyNotFound).toBe(true);
      expect(result.notFound).toBeInstanceOf(PdfNotFoundError);
      // First settled absence stops scheduling more; at most one wave (width=5)
      // but with confirm=1 we finish as soon as one returns — attempted can be 5
      // if all launched in first wave, yet we must not wait for serial drain of 15.
      expect(result.attempted).toBeLessThanOrEqual(5);
    }
  });
});

describe("isPdfAbsentError", () => {
  it("accepts PdfNotFoundError and absence-shaped messages", () => {
    expect(isPdfAbsentError(new PdfNotFoundError("missing"))).toBe(true);
    expect(
      isPdfAbsentError(
        new MirrorError("Could not find PDF link on page: https://x/10.1/y"),
      ),
    ).toBe(true);
    expect(
      isPdfAbsentError(
        new MirrorError("PDF download failed: HTTP 404 (https://x/a.pdf)"),
      ),
    ).toBe(true);
  });

  it("rejects transport / block failures", () => {
    expect(
      isPdfAbsentError(new MirrorError("Mirror HTTP 403: https://x")),
    ).toBe(false);
    expect(
      isPdfAbsentError(new MirrorError("Mirror blocked (challenge page): x")),
    ).toBe(false);
    expect(isPdfAbsentError(new MirrorError("fetch failed"))).toBe(false);
    expect(isPdfAbsentError(new Error("timeout"))).toBe(false);
  });
});

describe("aggregateSourceErrors absence", () => {
  it("maps no-PDF-link lines to PDF_NOT_IN_DB", () => {
    expect(
      aggregateSourceErrors([
        "https://a/: Could not find PDF link on page: https://a/10.1/x",
        "https://b/: PDF not available on Sci-Hub for DOI 10.1/x (no PDF link on page)",
      ]),
    ).toBe("PDF_NOT_IN_DB");
  });
});
