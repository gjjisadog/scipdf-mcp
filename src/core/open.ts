import { spawn } from "node:child_process";
import { platform } from "node:os";
import { access, constants } from "node:fs/promises";

export async function openPath(path: string): Promise<{ ok: boolean; error?: string }> {
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
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.unref();
    resolve({ ok: true });
  });
}
