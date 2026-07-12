import type { SciPdfConfig } from "../types.js";

export function debugLog(config: SciPdfConfig | { debug?: boolean }, ...args: unknown[]) {
  if (config.debug || process.env.SCIPDF_DEBUG === "1") {
    console.error("[scipdf]", ...args);
  }
}
