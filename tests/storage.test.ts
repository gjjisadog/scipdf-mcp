import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIN_PDF_BYTES, isValidPdfFile, savePdf } from "../src/core/storage.js";

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
});
