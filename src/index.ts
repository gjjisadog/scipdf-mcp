#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli(process.argv)
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error("scipdf-mcp failed:", err);
    process.exit(1);
  });
