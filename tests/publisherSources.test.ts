import { afterEach, describe, expect, it, vi } from "vitest";
import type { SciPdfConfig } from "../src/types.js";
import {
  fetchPdfFromSources,
  listPdfSources,
} from "../src/core/pdfSources.js";
import { MIN_PDF_BYTES } from "../src/core/storage.js";

function fakePdf(): Buffer {
  const header = "%PDF-1.7\n";
  const footer = "\n%%EOF\n";
  return Buffer.from(
    header + "p".repeat(MIN_PDF_BYTES - header.length - footer.length) + footer,
  );
}

function config(overrides: Partial<SciPdfConfig> = {}): SciPdfConfig {
  return {
    downloadDir: "/tmp/scipdf-publisher-test",
    scihubMirrors: [],
    pdfHosts: [],
    timeoutMs: 2_000,
    fastFailTimeoutMs: 500,
    concurrency: 1,
    userAgent: "scipdf-test",
    filenameStyle: "doi",
    healthCacheTtlMs: 1_000,
    minRequestGapMs: 0,
    sourceRaceWidth: 1,
    pdfNotFoundConfirmations: 1,
    debug: false,
    preferOa: false,
    allowScihub: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("publisher PdfSources", () => {
  it("advertises Elsevier, Springer Nature, and IEEE adapters", () => {
    expect(listPdfSources().map((source) => source.name)).toEqual(
      expect.arrayContaining(["elsevier", "springer-nature", "ieee"]),
    );
  });

  it("downloads Elsevier PDF with credentials kept out of audit output", async () => {
    vi.stubEnv("SCIPDF_ELSEVIER_API_KEY", "elsevier-secret");
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-ELS-APIKey")).toBe(
        "elsevier-secret",
      );
      return new Response(fakePdf(), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const hit = await fetchPdfFromSources(
      { kind: "doi", value: "10.1016/j.example.2026.1" },
      config(),
    );

    expect(hit.source).toBe("elsevier");
    expect(hit.attempts).toHaveLength(1);
    expect(hit.attempts[0]).toMatchObject({
      source: "elsevier",
      status: "success",
      legal: true,
      accessMode: "publisher_api",
    });
    expect(JSON.stringify(hit)).not.toContain("elsevier-secret");
  });

  it("redacts a Springer Nature API key embedded in an endpoint URL", async () => {
    vi.stubEnv("SCIPDF_SPRINGER_NATURE_API_KEY", "springer-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fakePdf(), { status: 200 })),
    );

    const hit = await fetchPdfFromSources(
      { kind: "doi", value: "10.1007/s00123-026-00001-2" },
      config({
        springerNaturePdfEndpoint:
          "https://publisher.example/fulltext/{doi}?api_key={api_key}",
      }),
    );

    expect(hit.source).toBe("springer-nature");
    expect(hit.url).toContain("%5BREDACTED%5D");
    expect(JSON.stringify(hit)).not.toContain("springer-secret");
  });

  it("records entitlement failures without leaking the IEEE key", async () => {
    vi.stubEnv("SCIPDF_IEEE_API_KEY", "ieee-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 })),
    );

    await expect(
      fetchPdfFromSources(
        { kind: "doi", value: "10.1109/TPEL.2026.1234567" },
        config({
          ieeeFulltextEndpoint:
            "https://publisher.example/ieee/{doi}?apikey={api_key}",
        }),
      ),
    ).rejects.toMatchObject({
      code: "ALL_SOURCES_FAILED",
      attempts: [
        expect.objectContaining({
          source: "ieee",
          status: "not_entitled",
          httpStatus: 403,
        }),
      ],
    });
  });
});
