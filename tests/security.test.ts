import { describe, expect, it } from "vitest";
import {
  buildPdfPath,
  isPdfBuffer,
  sanitizeUserFilename,
  MIN_PDF_BYTES,
} from "../src/core/storage.js";
import { extractQueriesFromText } from "../src/core/citations.js";
import { contentTypeIsPdf } from "../src/core/http.js";
import { assertSafePublicUrl, isBlockedHostname } from "../src/core/urlSafety.js";
import { pickBestWork, normalizeTitle } from "../src/core/crossref.js";
import { join } from "node:path";

function fakePdf(extra = 0): Buffer {
  // Valid-looking PDF: header + padding + %%EOF (must be >= MIN_PDF_BYTES)
  const header = "%PDF-1.4\n";
  const footer = "\n%%EOF\n";
  const padLen = Math.max(0, MIN_PDF_BYTES - header.length - footer.length + extra);
  return Buffer.from(header + "x".repeat(padLen) + footer);
}

describe("path traversal / filename sanitize", () => {
  it("strips directory components from override", () => {
    expect(sanitizeUserFilename("../../outside")).toBe("outside.pdf");
    expect(sanitizeUserFilename("..\\..\\evil")).toBe("evil.pdf");
    expect(sanitizeUserFilename("/tmp/abs.pdf")).toBe("abs.pdf");
  });

  it("keeps resolved path under download dir", () => {
    const dir = "/Users/me/Papers";
    const p = buildPdfPath(dir, "10.1/x", { filename: "../../outside" });
    expect(p).toBe(join(dir, "outside.pdf"));
    expect(p.startsWith(dir)).toBe(true);
    expect(p.includes("..")).toBe(false);
  });

  it("different DOIs map to different paths", () => {
    const dir = "/tmp/papers";
    const a = buildPdfPath(dir, "10.1000/a/b");
    const b = buildPdfPath(dir, "10.1000/a:b");
    expect(a).not.toBe(b);
  });
});

describe("isPdfBuffer", () => {
  it("accepts real %PDF- header with body and %%EOF", () => {
    expect(isPdfBuffer(fakePdf())).toBe(true);
  });

  it("accepts leading whitespace before %PDF-", () => {
    const buf = Buffer.concat([Buffer.from("\n\r "), fakePdf()]);
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it("rejects HTML that merely contains the string %PDF", () => {
    const html = Buffer.from(
      "<html><body>not a pdf but mentions %PDF- somewhere</body></html>" +
        "x".repeat(200),
    );
    expect(isPdfBuffer(html)).toBe(false);
  });

  it("rejects empty / short / header-only buffers", () => {
    expect(isPdfBuffer(new Uint8Array(0))).toBe(false);
    expect(isPdfBuffer(Buffer.from("%PD"))).toBe(false);
    expect(isPdfBuffer(Buffer.from("%PDF-1.4\n"))).toBe(false);
    // header + padding but no %%EOF
    expect(isPdfBuffer(Buffer.from("%PDF-1.4\n" + "y".repeat(300)))).toBe(
      false,
    );
  });
});

describe("contentTypeIsPdf", () => {
  it("is case-insensitive", () => {
    expect(contentTypeIsPdf("Application/PDF")).toBe(true);
    expect(contentTypeIsPdf("application/pdf; charset=binary")).toBe(true);
    expect(contentTypeIsPdf("text/html")).toBe(false);
    expect(contentTypeIsPdf(null)).toBe(false);
  });
});

describe("mixed reference extraction", () => {
  it("keeps citation lines even when DOIs are present", () => {
    const text = `
10.1038/nature12373
Kucsko et al. 2013 Nature thermometry living cell
Another Author et al. 2020 Some Journal about widgets
`;
    const q = extractQueriesFromText(text);
    expect(q.some((x) => x.includes("10.1038"))).toBe(true);
    expect(q.some((x) => /Kucsko/i.test(x))).toBe(true);
    expect(q.some((x) => /Another Author/i.test(x))).toBe(true);
  });

  it("extracts BibTeX titles when no DOI field", () => {
    const bib = `@article{x,
  title = {A Novel Approach to Quantum Widgets},
  author = {Zhang},
  year = {2020}
}`;
    const q = extractQueriesFromText(bib);
    expect(q.some((x) => /Quantum Widgets/i.test(x))).toBe(true);
  });
});

describe("SSRF protection", () => {
  it("blocks localhost and private IPs", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("127.0.0.1")).toBe(true);
    expect(isBlockedHostname("10.0.0.5")).toBe(true);
    expect(isBlockedHostname("192.168.1.1")).toBe(true);
    expect(isBlockedHostname("169.254.169.254")).toBe(true);
    expect(isBlockedHostname("sci-hub.se")).toBe(false);
  });

  it("assertSafePublicUrl rejects private URLs", () => {
    expect(() => assertSafePublicUrl("http://127.0.0.1:9/")).toThrow(/SSRF|private/i);
    expect(() => assertSafePublicUrl("https://sci-hub.se/")).not.toThrow();
  });
});

describe("CJK title matching", () => {
  it("normalizeTitle keeps CJK characters", () => {
    expect(normalizeTitle("深度学习研究")).toContain("深度");
  });

  it("does not accept empty-normalized title match", () => {
    const works = [
      {
        doi: "10.9999/wrong",
        title: "Completely Unrelated English Title About Cats",
        score: 0.01,
      },
    ];
    // Chinese query that would previously strip to "" and match via includes("")
    const best = pickBestWork(works, 20, "量子计算前沿进展");
    expect(best).toBeNull();
  });

  it("accepts matching CJK titles", () => {
    const works = [
      {
        doi: "10.9999/right",
        title: "量子计算前沿进展与应用",
        score: 1,
      },
    ];
    const best = pickBestWork(works, 20, "量子计算前沿进展与应用");
    expect(best?.doi).toBe("10.9999/right");
  });
});
