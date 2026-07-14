import { normalizeDoi, doiToFilename } from "../dist/core/doi.js";
import { pickBestWork, normalizeTitle } from "../dist/core/crossref.js";
import { assertSafePublicUrl, isBlockedHostname } from "../dist/core/urlSafety.js";
import { isPdfBuffer, MIN_PDF_BYTES } from "../dist/core/storage.js";
import { extractQueriesFromText } from "../dist/core/citations.js";
import { loadConfig } from "../dist/config.js";
import { throttle } from "../dist/core/rateLimit.js";

let failed = 0;
function check(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    failed++;
  } else {
    console.log("ok", name);
  }
}

const sici =
  "10.1002/(SICI)1097-0142(19960201)77:3<454::AID-CNCR7>3.0.CO;2-N";
check("sici doi", normalizeDoi(sici) === sici);
check(
  "doi no collide",
  doiToFilename("10.1000/a/b") !== doiToFilename("10.1000/a:b"),
);
check("cjk normalize", normalizeTitle("深度学习").includes("深度"));
check(
  "cjk no false match",
  pickBestWork(
    [{ doi: "10.1/x", title: "English cats", score: 0.01 }],
    20,
    "量子计算前沿",
  ) === null,
);
check("ssrf localhost", isBlockedHostname("127.0.0.1"));
try {
  assertSafePublicUrl("http://127.0.0.1:9/");
  check("ssrf throw", false);
} catch {
  check("ssrf throw", true);
}

const pad = "x".repeat(MIN_PDF_BYTES);
check(
  "pdf ok",
  isPdfBuffer(Buffer.from(`%PDF-1.4\n${pad}\n%%EOF\n`)),
);
check("pdf reject short", !isPdfBuffer(Buffer.from("%PDF-1.4\n")));

const bib = `@article{x,
  title = {A Novel Approach to Quantum Widgets},
  author = {Zhang},
  year = {2020}
}`;
check(
  "bib title no doi",
  extractQueriesFromText(bib).some((x) => /Quantum Widgets/i.test(x)),
);

process.env.SCIPDF_CONCURRENCY = "0.5";
const c = loadConfig();
check("concurrency floor", c.concurrency >= 1 && Number.isInteger(c.concurrency));

// rate limit serialization
const t0 = Date.now();
const times = [];
await Promise.all(
  [0, 1, 2, 3].map(async () => {
    await throttle(100);
    times.push(Date.now() - t0);
  }),
);
times.sort((a, b) => a - b);
const staggered = times[3] - times[0] >= 250;
check(`rate limit stagger ${JSON.stringify(times)}`, staggered);

// install strip logic
function stripScipdfTomlSections(text) {
  let out = text;
  out = out.replace(
    /(?:^|\n)[ \t]*# --- scipdf-mcp[^\n]*\n\[mcp_servers\.scipdf\][\s\S]*?(?=\n\[|\s*$)/g,
    "\n",
  );
  let prev;
  do {
    prev = out;
    out = out.replace(
      /(?:^|\n)\[mcp_servers\.scipdf\][\s\S]*?(?=\n\[|\s*$)/g,
      "\n",
    );
  } while (out !== prev);
  return out.replace(/\n{3,}/g, "\n\n").trimEnd();
}
const toml = `
# --- scipdf-mcp (auto-installed) ---
[mcp_servers.scipdf]
command = "node"
args = ["/old"]

[mcp_servers.other]
x = 1
`;
const stripped = stripScipdfTomlSections(toml);
check("toml strip", !stripped.includes("scipdf") && stripped.includes("other"));

if (failed) {
  console.error(failed, "failures");
  process.exit(1);
}
console.log("ALL SMOKE PASSED");
