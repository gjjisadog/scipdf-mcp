import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArxivFeed } from "../src/core/arxiv.js";
import {
  normalizeArxivId,
  parsePaperIdentifier,
} from "../src/core/identifiers.js";
import { downloadPaper } from "../src/core/download.js";
import { listPdfSources } from "../src/core/pdfSources.js";
import { MIN_PDF_BYTES } from "../src/core/storage.js";
import type { SciPdfConfig } from "../src/types.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>https://arxiv.org/abs/2501.01234v2</id>
    <updated>2025-01-03T00:00:00Z</updated>
    <published>2025-01-02T00:00:00Z</published>
    <title>Wide Bandgap &amp; Grid Inverters</title>
    <summary>A power electronics preprint.</summary>
    <author><name>Alice Zhang</name></author>
    <author><name>Bob Li</name></author>
    <arxiv:doi>10.1000/example</arxiv:doi>
    <arxiv:primary_category term="eess.SY"/>
    <link href="https://arxiv.org/pdf/2501.01234v2" type="application/pdf"/>
  </entry>
</feed>`;

function fakePdf(): Buffer {
  const header = "%PDF-1.4\n";
  const footer = "\n%%EOF\n";
  return Buffer.from(
    header + "x".repeat(MIN_PDF_BYTES - header.length - footer.length) + footer,
  );
}

function config(downloadDir: string): SciPdfConfig {
  return {
    downloadDir,
    scihubMirrors: [],
    pdfHosts: [],
    timeoutMs: 5_000,
    fastFailTimeoutMs: 500,
    concurrency: 2,
    userAgent: "scipdf-test/1.0",
    filenameStyle: "doi",
    healthCacheTtlMs: 0,
    minRequestGapMs: 0,
    sourceRaceWidth: 1,
    pdfNotFoundConfirmations: 1,
    debug: false,
    preferOa: false,
    allowScihub: false,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("arXiv identifiers and Atom metadata", () => {
  it("normalizes modern, legacy, prefixed, and URL identifiers", () => {
    expect(normalizeArxivId("arXiv:2501.01234v2")).toBe("2501.01234v2");
    expect(normalizeArxivId("https://arxiv.org/pdf/2501.01234.pdf")).toBe(
      "2501.01234",
    );
    expect(normalizeArxivId("hep-th/9901001v3")).toBe("hep-th/9901001v3");
    expect(normalizeArxivId("not-an-id")).toBeNull();
    expect(parsePaperIdentifier("10.1000/example")).toEqual({
      kind: "doi",
      value: "10.1000/example",
    });
  });

  it("maps Atom entries to the unified paper model", () => {
    const [paper] = parseArxivFeed(FEED);
    expect(paper).toMatchObject({
      title: "Wide Bandgap & Grid Inverters",
      year: 2025,
      doi: "10.1000/example",
      arxivId: "2501.01234v2",
      authors: ["Alice Zhang", "Bob Li"],
      isOpenAccess: true,
      sources: ["arxiv"],
    });
    expect(paper.openAccessPdf).toContain("arxiv.org/pdf/");
  });
});

describe("arXiv PdfSource", () => {
  it("advertises a legal direct-PDF adapter", () => {
    expect(listPdfSources()).toContainEqual({
      name: "arxiv",
      legal: true,
      identifiers: ["arxiv"],
    });
  });

  it("downloads an arXiv ID directly and writes an identifier sidecar", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scipdf-arxiv-"));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("export.arxiv.org/api/query")) {
        return new Response(FEED, {
          status: 200,
          headers: { "content-type": "application/atom+xml" },
        });
      }
      if (url.includes("arxiv.org/pdf/2501.01234v2")) {
        return new Response(fakePdf(), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await downloadPaper(
        { query: "arXiv:2501.01234v2" },
        config(dir),
      );
      expect(result).toMatchObject({
        ok: true,
        arxivId: "2501.01234v2",
        source: "arxiv",
        cached: false,
      });
      expect(result.path).toMatch(/arxiv_2501\.01234v2\.pdf$/);
      const sidecar = JSON.parse(
        await readFile(`${result.path}.scipdf.json`, "utf8"),
      ) as { identifier: string };
      expect(sidecar.identifier).toBe("arxiv:2501.01234v2");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
