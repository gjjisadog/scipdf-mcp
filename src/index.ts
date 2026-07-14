#!/usr/bin/env node
import { runCli } from "./cli.js";

/**
 * Flush stdio then exit so large CLI JSON is not truncated at ~64KiB
 * when the process dies before the kernel buffer drains.
 */
function exitAfterFlush(code: number): void {
  const done = () => {
    // Prefer exitCode so pending handles can finish; force-exit as fallback.
    process.exitCode = code;
    setTimeout(() => process.exit(code), 50).unref?.();
  };

  let pending = 2;
  const tick = () => {
    if (--pending <= 0) done();
  };

  if (process.stdout.writableEnded) tick();
  else process.stdout.write("", tick);

  if (process.stderr.writableEnded) tick();
  else process.stderr.write("", tick);
}

const isMcpMode = process.argv.length <= 2;

runCli(process.argv)
  .then((code) => {
    // MCP stdio server must keep the process alive; process.exit would kill it.
    if (isMcpMode) {
      if (code !== 0) exitAfterFlush(code);
      return;
    }
    exitAfterFlush(code);
  })
  .catch((err) => {
    console.error("scipdf-mcp failed:", err);
    exitAfterFlush(1);
  });
