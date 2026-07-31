import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MIN_PDF_BYTES,
  isValidPdfFile,
  savePdf,
  sha256Bytes,
  writeManifest,
} from "../src/core/storage.js";

function fakePdf(): Buffer {
  const header = "%PDF-1.4\n";
  const footer = "\n%%EOF\n";
  return Buffer.from(
    header + "x".repeat(MIN_PDF_BYTES - header.length - footer.length) + footer,
  );
}

describe("savePdf", () => {
  it("uses separate staging files for concurrent saves to one path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scipdf-save-"));
    const path = join(dir, "paper.pdf");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const data = fakePdf();
      const saved = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          savePdf(path, data, `10.9999/concurrent-${i}`),
        ),
      );
      expect(saved).toEqual(Array(8).fill(data.byteLength));
      expect(await isValidPdfFile(path)).toBe(true);
    } finally {
      now.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes a v2 manifest with integrity, attempts, summary, and redaction", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scipdf-manifest-"));
    try {
      const pdf = fakePdf();
      const digest = sha256Bytes(pdf);
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
      const path = await writeManifest(dir, [
        {
          ok: true,
          status: "downloaded",
          query: "10.1007/example",
          source: "springer-nature",
          sha256: digest,
          cached: false,
          attempts: [
            {
              source: "springer-nature",
              status: "success",
              legal: true,
              accessMode: "publisher_api",
              startedAt: "2026-07-31T00:00:00.000Z",
              url: "https://example.org/pdf?api_key=top-secret",
            },
          ],
        },
      ]);
      const manifest = JSON.parse(await readFile(path, "utf8"));
      expect(manifest).toMatchObject({
        manifestVersion: 2,
        summary: { count: 1, succeeded: 1, failed: 0, cached: 0 },
        results: [
          {
            sha256: digest,
            attempts: [{ source: "springer-nature", status: "success" }],
          },
        ],
      });
      expect(JSON.stringify(manifest)).not.toContain("top-secret");
      expect(manifest.results[0].attempts[0].url).toContain(
        "%5BREDACTED%5D",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
