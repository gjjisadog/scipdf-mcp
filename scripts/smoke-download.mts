import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { downloadPaper } from "../src/core/download.js";

async function main() {
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  const pdfUrl = "https://sci.bban.top/pdf/10.1038/nature12373.pdf";
  try {
    const res = await fetch(pdfUrl, {
      headers: {
        "User-Agent": ua,
        Accept: "application/pdf,*/*",
        Referer: "https://sci-hub.ren/",
      },
      redirect: "follow",
    });
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(
      "direct pdf",
      res.status,
      res.headers.get("content-type"),
      buf.length,
      buf.subarray(0, 5).toString(),
    );
    if (buf.subarray(0, 4).toString() === "%PDF") {
      writeFileSync(".papers/direct-test.pdf", buf);
      console.log("wrote .papers/direct-test.pdf");
    }
  } catch (e) {
    console.log("direct fail", e);
  }

  const cfg = loadConfig();
  cfg.downloadDir = new URL("../.papers", import.meta.url).pathname;
  const result = await downloadPaper(
    { query: "10.1038/nature12373", force: true },
    cfg,
  );
  console.log("download", JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
