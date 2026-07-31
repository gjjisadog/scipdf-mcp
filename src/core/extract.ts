import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtractPaperTextResult } from "../types.js";
import { isValidPdfFile } from "./storage.js";

function isInside(dir: string, target: string): boolean {
  const rel = relative(dir, target);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

export async function resolveExtractPath(
  path: string,
  downloadDir: string,
): Promise<{ ok: true; target: string } | { ok: false; error: string }> {
  if (!isAbsolute(path)) {
    return { ok: false, error: `Path must be absolute: ${path}` };
  }
  let allowedDir: string;
  try {
    allowedDir = await realpath(resolve(downloadDir));
  } catch {
    return {
      ok: false,
      error: `Download directory not found: ${downloadDir}`,
    };
  }
  let target: string;
  try {
    target = await realpath(resolve(path));
  } catch {
    return { ok: false, error: `File not found: ${path}` };
  }
  if (!isInside(allowedDir, target)) {
    return {
      ok: false,
      error: `Refusing to extract file outside download directory: ${path}`,
    };
  }
  if (!(await isValidPdfFile(target))) {
    return { ok: false, error: `File is not a valid PDF: ${path}` };
  }
  return { ok: true, target };
}

export async function extractPaperText(
  path: string,
  downloadDir: string,
  options: {
    pageFrom?: number;
    pageTo?: number;
    previewChars?: number;
  } = {},
): Promise<ExtractPaperTextResult> {
  const checked = await resolveExtractPath(path, downloadDir);
  if (!checked.ok) return { ok: false, path, error: checked.error };

  try {
    const bytes = await readFile(checked.target);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    const from = Math.max(1, Math.floor(options.pageFrom ?? 1));
    const to = Math.min(
      pdf.numPages,
      Math.max(from, Math.floor(options.pageTo ?? pdf.numPages)),
    );
    const pageTexts: string[] = [];
    try {
      for (let pageNumber = from; pageNumber <= to; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) =>
            typeof item === "object" && item !== null && "str" in item
              ? String(item.str)
              : "",
          )
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        pageTexts.push(text);
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy();
    }

    const text = pageTexts.join("\n\n").trim();
    const textPath = /\.pdf$/i.test(checked.target)
      ? checked.target.replace(/\.pdf$/i, ".txt")
      : `${checked.target}.txt`;
    await writeFile(textPath, text, "utf8");
    const previewChars = Math.max(
      0,
      Math.min(Math.floor(options.previewChars ?? 4000), 20_000),
    );
    return {
      ok: true,
      path: checked.target,
      textPath,
      pages: to >= from ? to - from + 1 : 0,
      totalPages,
      chars: text.length,
      preview: previewChars ? text.slice(0, previewChars) : "",
    };
  } catch (error) {
    return {
      ok: false,
      path: checked.target,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
