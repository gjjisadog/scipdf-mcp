import { spawn } from "node:child_process";
import { platform } from "node:os";
import { access, constants } from "node:fs/promises";

export async function openPath(
  path: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await access(path, constants.F_OK);
  } catch {
    return { ok: false, error: `File not found: ${path}` };
  }

  const os = platform();
  let cmd: string;
  let args: string[];
  if (os === "darwin") {
    cmd = "open";
    args = [path];
  } else if (os === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", path];
  } else {
    cmd = "xdg-open";
    args = [path];
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
