import { spawn } from "node:child_process";
import { platform } from "node:os";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isValidPdfFile } from "./storage.js";

function isPathInsideDir(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

export async function openPath(
  path: string,
  downloadDir: string,
): Promise<{ ok: boolean; error?: string }> {
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
    // realpath both rejects missing paths and prevents a symlink inside the
    // download directory from escaping the allowed directory.
    target = await realpath(resolve(path));
  } catch {
    return { ok: false, error: `File not found: ${path}` };
  }
  if (!isPathInsideDir(allowedDir, target)) {
    return {
      ok: false,
      error: `Refusing to open file outside download directory: ${path}`,
    };
  }
  if (!(await isValidPdfFile(target))) {
    return { ok: false, error: `File is not a valid PDF: ${path}` };
  }

  const os = platform();
  let cmd: string;
  let args: string[];
  if (os === "darwin") {
    cmd = "open";
    args = [target];
  } else if (os === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", target];
  } else {
    cmd = "xdg-open";
    args = [target];
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", (e) => {
      finish({ ok: false, error: e.message });
    });
    // Node emits 'spawn' when the process successfully starts
    child.once("spawn", () => {
      child.unref();
      finish({ ok: true });
    });
    // Fallback if 'spawn' is unavailable (very old runtimes)
    setTimeout(() => {
      if (!settled) {
        try {
          child.unref();
        } catch {
          /* ignore */
        }
        finish({ ok: true });
      }
    }, 500);
  });
}
