import {
  mkdir,
  writeFile,
  access,
  constants,
  readdir,
  stat,
} from "node:fs/promises";
import { dirname, join, resolve, basename } from "node:path";
import { doiToFilename } from "./doi.js";
import type { FilenameStyle } from "../types.js";

export async function ensureDir(dir: string): Promise<string> {
  const abs = resolve(dir);
  await mkdir(abs, { recursive: true });
  return abs;
}

function sanitizeFilenamePart(s: string, max = 80): string {
  return s
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, max)
    .replace(/^_|_$/g, "");
}

export function buildPdfFilename(
  doi: string,
  style: FilenameStyle,
  meta?: { title?: string; authors?: string[]; year?: number },
  override?: string,
): string {
  if (override) {
    return override.endsWith(".pdf") ? override : `${override}.pdf`;
  }
  if (style === "author_year_title" && meta) {
    const author = meta.authors?.[0]
      ? sanitizeFilenamePart(meta.authors[0].split(/\s+/).pop() || meta.authors[0], 40)
      : "Unknown";
    const year = meta.year ? String(meta.year) : "n.d.";
    const title = meta.title
      ? sanitizeFilenamePart(meta.title, 60)
      : sanitizeFilenamePart(doi, 60);
    return `${author}_${year}_${title}.pdf`;
  }
  return doiToFilename(doi);
}

export function buildPdfPath(
  downloadDir: string,
  doi: string,
  opts?: {
    filename?: string;
    style?: FilenameStyle;
    title?: string;
    authors?: string[];
    year?: number;
  },
): string {
  const name = buildPdfFilename(
    doi,
    opts?.style ?? "doi",
    {
      title: opts?.title,
      authors: opts?.authors,
      year: opts?.year,
    },
    opts?.filename,
  );
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

export function isPdfBuffer(data: Uint8Array): boolean {
  if (data.byteLength < 5) return false;
  const head = Buffer.from(
    data.subarray(0, Math.min(1024, data.byteLength)),
  ).toString("latin1");
  return head.includes("%PDF");
}

export interface PaperFileInfo {
  name: string;
  path: string;
  bytes: number;
  mtimeMs: number;
}

export async function listPaperFiles(
  downloadDir: string,
  limit = 100,
): Promise<PaperFileInfo[]> {
  const dir = resolve(downloadDir);
  try {
    await access(dir, constants.F_OK);
  } catch {
    return [];
  }
  const names = await readdir(dir);
  const pdfs = names.filter((n) => n.toLowerCase().endsWith(".pdf"));
  const infos: PaperFileInfo[] = [];
  for (const name of pdfs) {
    const path = join(dir, name);
    try {
      const st = await stat(path);
      if (st.isFile()) {
        infos.push({
          name,
          path,
          bytes: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    } catch {
      // skip
    }
  }
  infos.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return infos.slice(0, limit);
}

export async function writeManifest(
  downloadDir: string,
  results: unknown[],
  filename = "scipdf-manifest.json",
): Promise<string> {
  const dir = await ensureDir(downloadDir);
  const path = join(dir, filename);
  const payload = {
    generatedAt: new Date().toISOString(),
    count: results.length,
    results,
  };
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n");
  return path;
}

export function pathBasename(p: string): string {
  return basename(p);
}
