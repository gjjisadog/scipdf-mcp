import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPdfPath,
  isPdfBuffer,
  isValidPdfFile,
  sanitizeUserFilename,
  MIN_PDF_BYTES,
} from "../src/core/storage.js";
import { extractQueriesFromText } from "../src/core/citations.js";
import {
  contentTypeIsPdf,
  fetchSafePublicBuffer,
} from "../src/core/http.js";
import { assertSafePublicUrl, isBlockedHostname } from "../src/core/urlSafety.js";
import { pickBestWork, normalizeTitle } from "../src/core/crossref.js";
import { openPath } from "../src/core/open.js";
import { join } from "node:path";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("author_year_title keeps distinct paths for same author/year/title", () => {
    const dir = "/tmp/papers";
    const meta = {
      style: "author_year_title" as const,
      title: "A Very Long Shared Title About Quantum Something",
      authors: ["Alice Zhang"],
      year: 2020,
    };
    const a = buildPdfPath(dir, "10.1000/paper-one", meta);
    const b = buildPdfPath(dir, "10.1000/paper-two", meta);
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

describe("isValidPdfFile", () => {
  it("accepts large PDFs using head+tail (no full-buffer %%EOF requirement)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scipdf-pdf-"));
    const path = join(dir, "large.pdf");
    try {
      const size = 2 * 1024 * 1024 + 64;
      const buf = Buffer.alloc(size, 0x20);
      buf.write("%PDF-1.4\n", 0);
      buf.write("%%EOF\n", size - 6);
      await writeFile(path, buf);
      expect(await isValidPdfFile(path)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-pdf files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scipdf-pdf-"));
    const path = join(dir, "x.pdf");
    try {
      await writeFile(path, "not a pdf" + "x".repeat(300));
      expect(await isValidPdfFile(path)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  it("blocks short-form and decimal loopback", () => {
    expect(isBlockedHostname("127.1")).toBe(true);
    expect(isBlockedHostname("0")).toBe(true);
    expect(isBlockedHostname("2130706433")).toBe(true); // 127.0.0.1
    expect(isBlockedHostname("10.1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 after URL canonicalization", () => {
    // WHATWG URL turns ::ffff:127.0.0.1 into ::ffff:7f00:1.
    expect(isBlockedHostname("[::ffff:7f00:1]")).toBe(true);
    expect(isBlockedHostname("::ffff:127.0.0.1")).toBe(true);
    expect(() =>
      assertSafePublicUrl("http://[::ffff:127.0.0.1]/admin"),
    ).toThrow(/SSRF|private/i);
  });

  it("blocks the whole IPv6 link-local fe80::/10 range", () => {
    expect(isBlockedHostname("[fe80::1]")).toBe(true);
    expect(isBlockedHostname("[fe81::1]")).toBe(true);
    expect(isBlockedHostname("[febf::1]")).toBe(true);
  });

  it("assertSafePublicUrl rejects private URLs", () => {
    expect(() => assertSafePublicUrl("http://127.0.0.1:9/")).toThrow(/SSRF|private/i);
    expect(() => assertSafePublicUrl("http://127.1/")).toThrow(/SSRF|private/i);
    expect(() => assertSafePublicUrl("https://sci-hub.se/")).not.toThrow();
  });
});

describe("safe public redirects", () => {
  it("checks redirect targets before fetching them", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://[::ffff:127.0.0.1]/admin" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSafePublicBuffer("https://public.example/download", {}, 1_000),
    ).rejects.toThrow(/SSRF|private/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows safe relative redirects", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://public.example/download") {
        return new Response(null, {
          status: 302,
          headers: { location: "/paper.pdf" },
        });
      }
      return new Response(fakePdf(), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSafePublicBuffer(
      "https://public.example/download",
      {},
      1_000,
    );
    expect(result.buffer).toEqual(fakePdf());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "https://public.example/paper.pdf",
    );
  });
});

describe("open path restrictions", () => {
  it("rejects files outside the configured download directory, including symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "scipdf-open-"));
    const downloadDir = join(root, "downloads");
    const outside = join(root, "outside.pdf");
    const link = join(downloadDir, "linked.pdf");
    try {
      await mkdir(downloadDir);
      await writeFile(outside, fakePdf());
      await symlink(outside, link);

      const direct = await openPath(outside, downloadDir);
      const linked = await openPath(link, downloadDir);
      expect(direct.ok).toBe(false);
      expect(direct.error).toMatch(/outside download directory/i);
      expect(linked.ok).toBe(false);
      expect(linked.error).toMatch(/outside download directory/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects existing non-PDF files before invoking the system opener", async () => {
    const downloadDir = await mkdtemp(join(tmpdir(), "scipdf-open-"));
    const path = join(downloadDir, "not-a-pdf.pdf");
    try {
      await writeFile(path, "not a PDF");
      const result = await openPath(path, downloadDir);
      expect(result).toEqual({
        ok: false,
        error: `File is not a valid PDF: ${path}`,
      });
    } finally {
      await rm(downloadDir, { recursive: true, force: true });
    }
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

  it("does not accept OpenAlex-style minScore=0 without title match", () => {
    const works = [
      {
        doi: "10.9999/wrong",
        title: "Completely Unrelated Paper About Cats",
        score: 9999,
      },
    ];
    expect(pickBestWork(works, 0, "quantum thermometry living cell")).toBeNull();
    expect(
      pickBestWork(works, Number.MAX_SAFE_INTEGER, "quantum thermometry"),
    ).toBeNull();
  });

  it("prefers title match not only at index 0", () => {
    const works = [
      { doi: "10.9999/a", title: "Unrelated First Hit", score: 100 },
      {
        doi: "10.9999/b",
        title: "Nanometre-scale thermometry in a living cell",
        score: 10,
      },
    ];
    const best = pickBestWork(
      works,
      20,
      "Nanometre-scale thermometry in a living cell",
    );
    expect(best?.doi).toBe("10.9999/b");
  });
});
