import type { ErrorCode, SourceFailureSummary } from "../types.js";

function classifyLine(msg: string): keyof Pick<
  SourceFailureSummary,
  "absent" | "blocked" | "unavailable" | "timeouts" | "other"
> {
  if (
    /not available|Could not find PDF link|no PDF link|\bHTTP 404\b|PDF not available/i.test(
      msg,
    )
  ) {
    return "absent";
  }
  // 429 is normally an anti-bot/rate-limit response. 502/503 are a reachable
  // mirror temporarily failing, not an anti-bot block or a missing paper.
  if (/\b(?:403|429)\b|cloudflare|ddos|challenge|just a moment|blocked/i.test(msg)) {
    return "blocked";
  }
  if (/\bHTTP (?:502|503)\b/i.test(msg)) return "unavailable";
  if (/timeout|aborted|UND_ERR_CONNECT|ETIMEDOUT|AbortError/i.test(msg)) {
    return "timeouts";
  }
  return "other";
}

/**
 * Build a compact structured summary from per-source error lines
 * (`host: message`).
 */
export function summarizeSourceErrors(
  errors: string[],
  opts?: { earlyStop?: boolean; maxSamples?: number },
): SourceFailureSummary {
  const maxSamples = opts?.maxSamples ?? 5;
  let absent = 0;
  let blocked = 0;
  let unavailable = 0;
  let timeouts = 0;
  let other = 0;
  for (const line of errors) {
    const msg = line.includes(": ") ? line.slice(line.indexOf(": ") + 2) : line;
    const c = classifyLine(msg);
    if (c === "absent") absent++;
    else if (c === "blocked") blocked++;
    else if (c === "unavailable") unavailable++;
    else if (c === "timeouts") timeouts++;
    else other++;
  }
  return {
    attempted: errors.length,
    absent,
    blocked,
    unavailable,
    timeouts,
    other,
    earlyStop: opts?.earlyStop,
    samples: errors.slice(0, maxSamples),
  };
}

export function shortFailureMessage(
  code: ErrorCode,
  doi: string,
  summary: SourceFailureSummary,
): string {
  const bits = [
    `attempted=${summary.attempted}`,
    summary.absent ? `absent=${summary.absent}` : null,
    summary.blocked ? `blocked=${summary.blocked}` : null,
    summary.unavailable ? `unavailable=${summary.unavailable}` : null,
    summary.timeouts ? `timeouts=${summary.timeouts}` : null,
    summary.other ? `other=${summary.other}` : null,
    summary.earlyStop ? "earlyStop" : null,
  ].filter(Boolean);
  return `${code} for ${doi} (${bits.join(", ")})`;
}

export function failureFromCaught(
  e: unknown,
): SourceFailureSummary | undefined {
  if (e && typeof e === "object" && "failure" in e) {
    const f = (e as { failure?: SourceFailureSummary }).failure;
    if (f && typeof f.attempted === "number") return f;
  }
  if (e && typeof e === "object" && "name" in e) {
    const name = String((e as { name: string }).name);
    const msg = e instanceof Error ? e.message : String(e);
    if (name === "PdfNotFoundError") {
      return {
        attempted: 1,
        absent: 1,
        blocked: 0,
        unavailable: 0,
        timeouts: 0,
        other: 0,
        earlyStop: true,
        samples: [msg],
      };
    }
  }
  return undefined;
}
