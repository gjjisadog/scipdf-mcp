#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli(process.argv).catch((err) => {
  console.error("scipdf-mcp failed:", err);
  process.exit(1);
});
