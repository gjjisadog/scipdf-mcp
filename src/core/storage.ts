import { mkdir, writeFile, access, constants } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { doiToFilename } from "./doi.js";

export async function ensureDir(dir: string): Promise<string> {
  const abs = resolve(dir);
  await mkdir(abs, { recursive: true });
  return abs;
}

export function buildPdfPath(downloadDir: string, doi: string, filename?: string): string {
  const name = filename
    ? filename.endsWith(".pdf")
      ? filename
      : `${filename}.pdf`
    : doiToFilename(doi);
  return join(resolve(downloadDir), name);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function savePdf(
  path: string,
  data: Uint8Array,
): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return data.byteLength;
}

/** Basic PDF magic-byte check */
export function isPdfBuffer(data: Uint8Array): boolean {
  if (data.byteLength < 5) return false;
  // Allow leading whitespace/BOM before %PDF
  const head = Buffer.from(data.subarray(0, Math.min(1024, data.byteLength))).toString(
    "latin1",
  );
  return head.includes("%PDF");
}
