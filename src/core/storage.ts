import {
  mkdir,
  writeFile,
  readFile,
  access,
  constants,
  readdir,
  stat,
  rename,
  unlink,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
  basename,
  relative,
  isAbsolute,
  sep,
} from "node:path";
import { doiToFilename, filenameToDoiHint, normalizeDoi } from "./doi.js";
import type { FilenameStyle } from "../types.js";

/** Sidecar JSON next to PDF: { doi, savedAt } — prevents wrong-DOI cache hits. */
export function metaPathForPdf(pdfPath: string): string {
  return `${pdfPath}.scipdf.json`;
}

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

/**
 * User-supplied filename must be a single path segment (no traversal).
 * `../../outside` → `outside.pdf`
 */
export function sanitizeUserFilename(override: string): string {
  // Normalize separators, take basename only
  let name = override.replace(/\\/g, "/").trim();
  // Drop any directory components
  name = basename(name);
  // Neutralize reserved / empty names
  name = name.replace(/\0/g, "");
  if (!name || name === "." || name === ".." || name === ".pdf") {
    name = "download.pdf";
  }
  // Strip remaining path-ish characters
  name = name.replace(/[/\\]/g, "_");
  if (!name.toLowerCase().endsWith(".pdf")) {
    name = `${name}.pdf`;
  }
  // Final safety scrub
  name = sanitizeFilenamePart(name.replace(/\.pdf$/i, ""), 120) + ".pdf";
  if (name === ".pdf" || name === "_.pdf") name = "download.pdf";
  return name;
}

export function buildPdfFilename(
  doi: string,
  style: FilenameStyle,
  meta?: { title?: string; authors?: string[]; year?: number },
  override?: string,
): string {
  if (override) {
    return sanitizeUserFilename(override);
  }
  if (style === "author_year_title" && meta) {
    const author = meta.authors?.[0]
      ? sanitizeFilenamePart(
          meta.authors[0].split(/\s+/).pop() || meta.authors[0],
          40,
        )
      : "Unknown";
    const year = meta.year ? String(meta.year) : "n.d.";
    const title = meta.title
      ? sanitizeFilenamePart(meta.title, 50)
      : sanitizeFilenamePart(doi, 50);
    // DOI hash suffix prevents collisions overwriting different papers
    const tag = doiPathTag(doi);
    return `${author}_${year}_${title}_${tag}.pdf`;
  }
  return doiToFilename(doi);
}

/** Short stable tag from DOI so author_year_title paths stay unique. */
function doiPathTag(doi: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < doi.length; i++) {
    h ^= doi.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Ensure resolved file path stays inside downloadDir */
export function assertPathInsideDir(downloadDir: string, filePath: string): string {
  const dir = resolve(downloadDir);
  const full = resolve(filePath);
  const rel = relative(dir, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `Refusing path outside download directory: ${filePath} (dir=${dir})`,
    );
  }
  // Disallow writing the directory itself as a "file"
  if (rel === "") {
    throw new Error(`Invalid file path equals download directory: ${dir}`);
  }
  // No nested dirs from filename (basename only policy)
  if (rel.includes("..") || rel.includes(sep)) {
    // basename-only names produce a single segment; reject multi-segment
    if (rel.split(/[/\\]/).length > 1) {
      throw new Error(`Refusing nested path: ${rel}`);
    }
  }
  return full;
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
  // name is basename-only after sanitize
  const full = join(resolve(downloadDir), basename(name));
  return assertPathInsideDir(downloadDir, full);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Minimum plausible PDF size (rejects truncated stubs that only have a header). */
export const MIN_PDF_BYTES = 200;

/** %PDF- magic after optional leading whitespace/NUL (header region only). */
export function hasPdfHeader(data: Uint8Array): boolean {
  const limit = Math.min(1024, data.byteLength);
  let i = 0;
  while (i < limit) {
    const b = data[i];
    if (b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0a || b === 0x00) {
      i++;
      continue;
    }
    break;
  }
  if (i + 5 > data.byteLength) return false;
  return (
    data[i] === 0x25 && // %
    data[i + 1] === 0x50 && // P
    data[i + 2] === 0x44 && // D
    data[i + 3] === 0x46 && // F
    data[i + 4] === 0x2d // -
  );
}

/** True if file exists and looks like a real PDF (head + tail only; no full read). */
export async function isValidPdfFile(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    if (!st.isFile() || st.size < MIN_PDF_BYTES) return false;
    const { open } = await import("node:fs/promises");
    const fh = await open(path, "r");
    try {
      const headLen = Math.min(1024, st.size);
      const tailLen = Math.min(2048, st.size);
      const headBuf = Buffer.alloc(headLen);
      const tailBuf = Buffer.alloc(tailLen);
      await fh.read(headBuf, 0, headLen, 0);
      await fh.read(tailBuf, 0, tailLen, Math.max(0, st.size - tailLen));
      // Do not call isPdfBuffer(head) — it requires %%EOF in the same buffer.
      return hasPdfHeader(headBuf) && hasPdfEofMarker(tailBuf);
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

export interface PdfCacheMeta {
  doi: string;
  savedAt: string;
}

export async function writePdfMeta(
  pdfPath: string,
  doi: string,
): Promise<void> {
  const meta: PdfCacheMeta = {
    doi: normalizeDoi(doi) ?? doi,
    savedAt: new Date().toISOString(),
  };
  await writeFile(metaPathForPdf(pdfPath), JSON.stringify(meta) + "\n", "utf8");
}

export async function readPdfMeta(
  pdfPath: string,
): Promise<PdfCacheMeta | null> {
  try {
    const raw = await readFile(metaPathForPdf(pdfPath), "utf8");
    const j = JSON.parse(raw) as PdfCacheMeta;
    if (j && typeof j.doi === "string" && j.doi) return j;
    return null;
  } catch {
    return null;
  }
}

/**
 * Cache hit only when file is a valid PDF AND DOI matches.
 * Prevents returning paper A when paper B maps to the same path.
 */
export async function isCacheHitForDoi(
  path: string,
  doi: string,
): Promise<boolean> {
  if (!(await isValidPdfFile(path))) return false;
  const want = (normalizeDoi(doi) ?? doi).toLowerCase();
  const meta = await readPdfMeta(path);
  if (meta?.doi) {
    return (normalizeDoi(meta.doi) ?? meta.doi).toLowerCase() === want;
  }
  // Legacy files without sidecar: accept only if filename uniquely encodes this DOI
  const hint = filenameToDoiHint(basename(path));
  if (hint && hint.toLowerCase() === want) return true;
  // Ambiguous / legacy flat names (e.g. old 10.1000_a_b.pdf) — force re-download
  return false;
}

/** Atomic write: temp file then rename so crashes never leave half PDFs as cache. */
export async function savePdf(
  path: string,
  data: Uint8Array,
  doi?: string,
): Promise<number> {
  if (!isPdfBuffer(data)) {
    throw new Error("Refusing to save: buffer is not a valid PDF");
  }
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
  if (doi) {
    try {
      await writePdfMeta(path, doi);
    } catch {
      // meta is best-effort; PDF itself is already saved
    }
  }
  return data.byteLength;
}

/**
 * PDF magic: after optional leading whitespace/NUL, must start with %PDF-
 * (not merely contain "%PDF" somewhere in the first KiB — that accepts HTML bait).
 * Also requires a minimum size and a %%EOF marker in the buffer tail when possible.
 */
export function isPdfBuffer(data: Uint8Array): boolean {
  if (data.byteLength < MIN_PDF_BYTES) return false;
  if (!hasPdfHeader(data)) return false;
  const tail = data.subarray(Math.max(0, data.byteLength - 2048));
  return hasPdfEofMarker(tail);
}

function hasPdfEofMarker(tail: Uint8Array): boolean {
  // Search for %%EOF
  const t = Buffer.from(tail).toString("latin1");
  return t.includes("%%EOF");
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
  let name = basename(filename.replace(/\\/g, "/"));
  name = name.replace(/[^\w.\-]+/g, "_");
  if (!name.toLowerCase().endsWith(".json")) name = "scipdf-manifest.json";
  if (!name || name === ".json") name = "scipdf-manifest.json";
  const path = assertPathInsideDir(dir, join(dir, name));
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
