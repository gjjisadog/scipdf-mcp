import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractPaperText,
  resolveExtractPath,
} from "../src/core/extract.js";

function minimalPdf(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 30} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

describe("extractPaperText", () => {
  it("extracts text and writes a sibling txt file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scipdf-extract-"));
    const path = join(dir, "paper.pdf");
    try {
      await writeFile(path, minimalPdf("Hello SciPDF"));
      const result = await extractPaperText(path, dir);
      expect(result.ok).toBe(true);
      expect(result.preview).toContain("Hello SciPDF");
      expect(result.textPath).toMatch(/paper\.txt$/);
      expect(await readFile(result.textPath!, "utf8")).toContain("Hello SciPDF");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects paths outside the configured download directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scipdf-allowed-"));
    const outside = await mkdtemp(join(tmpdir(), "scipdf-outside-"));
    const path = join(outside, "paper.pdf");
    try {
      await writeFile(path, minimalPdf("Outside"));
      const result = await resolveExtractPath(path, dir);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/outside download directory/);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
