import { describe, expect, it } from "vitest";
import {
  buildPdfPath,
  isPdfBuffer,
  sanitizeUserFilename,
} from "../src/core/storage.js";
import { extractQueriesFromText } from "../src/core/citations.js";
import { contentTypeIsPdf } from "../src/core/http.js";
import { join } from "node:path";

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
});

describe("isPdfBuffer", () => {
  it("accepts real %PDF- header", () => {
    const buf = Buffer.from("%PDF-1.5\n%...");
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it("accepts leading whitespace before %PDF-", () => {
    const buf = Buffer.from("\n\r %PDF-1.4\n");
    expect(isPdfBuffer(buf)).toBe(true);
  });

  it("rejects HTML that merely contains the string %PDF", () => {
    const html = Buffer.from(
      "<html><body>not a pdf but mentions %PDF- somewhere</body></html>",
    );
    expect(isPdfBuffer(html)).toBe(false);
  });

  it("rejects empty / short buffers", () => {
    expect(isPdfBuffer(new Uint8Array(0))).toBe(false);
    expect(isPdfBuffer(Buffer.from("%PD"))).toBe(false);
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
});
