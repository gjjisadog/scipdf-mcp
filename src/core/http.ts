/**
 * HTTP helpers where timeout covers headers + full body read.
 * Clearing the timer only after body consumption prevents hung body streams.
 * Body size is capped to avoid unbounded memory use.
 */

import { assertSafePublicUrl } from "./urlSafety.js";

/** Default max body size for PDF / HTML responses (100 MiB). */
export const MAX_BODY_BYTES = 100 * 1024 * 1024;

export class BodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyTooLargeError";
  }
}

async function readBodyLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const cl = response.headers.get("content-length");
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new BodyTooLargeError(
        `Response Content-Length ${n} exceeds limit ${maxBytes}`,
      );
    }
  }

  // Prefer streaming when body is available so we can abort early.
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          throw new BodyTooLargeError(
            `Response body exceeds limit ${maxBytes} bytes`,
          );
        }
        chunks.push(value);
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new BodyTooLargeError(
      `Response body ${buffer.byteLength} exceeds limit ${maxBytes}`,
    );
  }
  return buffer;
}

/** Fetch and read full body as bytes; timeout covers entire operation. */
export async function fetchBuffer(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ response: Response; buffer: Uint8Array }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const buffer = await readBodyLimited(response, maxBytes);
    return { response, buffer };
  } finally {
    clearTimeout(timer);
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_SAFE_REDIRECTS = 10;

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body can already be closed by an implementation; nothing to do.
  }
}

/**
 * Fetch an externally supplied public URL while validating every redirect
 * target before connecting to it. This intentionally does not promise DNS
 * rebinding protection: hostname resolution happens inside fetch.
 */
export async function fetchSafePublicBuffer(
  rawUrl: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ response: Response; buffer: Uint8Array }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  try {
    let url = assertSafePublicUrl(rawUrl);
    for (let redirects = 0; ; redirects++) {
      const response = await fetch(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });

      if (!REDIRECT_STATUSES.has(response.status)) {
        const buffer = await readBodyLimited(response, maxBytes);
        return { response, buffer };
      }

      if (redirects >= MAX_SAFE_REDIRECTS) {
        await cancelResponseBody(response);
        throw new Error(`Too many redirects (max ${MAX_SAFE_REDIRECTS})`);
      }
      const location = response.headers.get("location");
      if (!location) {
        const buffer = await readBodyLimited(response, maxBytes);
        return { response, buffer };
      }

      let target: string;
      try {
        target = new URL(location, url).href;
      } catch {
        await cancelResponseBody(response);
        throw new Error(`Invalid redirect URL: ${location}`);
      }
      await cancelResponseBody(response);
      // This must happen before the next fetch. It blocks redirects such as
      // public.example → http://[::ffff:127.0.0.1]/admin.
      url = assertSafePublicUrl(target);
    }
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

/** Fetch and read full body as text; timeout covers entire operation. */
export async function fetchText(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ response: Response; text: string }> {
  const { response, buffer } = await fetchBuffer(
    url,
    init,
    timeoutMs,
    maxBytes,
  );
  const text = Buffer.from(buffer).toString("utf8");
  return { response, text };
}

/** Safe-public-URL equivalent of fetchText; validates each redirect hop. */
export async function fetchSafePublicText(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes = MAX_BODY_BYTES,
): Promise<{ response: Response; text: string }> {
  const { response, buffer } = await fetchSafePublicBuffer(
    url,
    init,
    timeoutMs,
    maxBytes,
  );
  return { response, text: Buffer.from(buffer).toString("utf8") };
}

/** Fetch and parse JSON; timeout covers entire operation. */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; data: T }> {
  const { response, text } = await fetchText(url, init, timeoutMs, 20 * 1024 * 1024);
  if (!response.ok) {
    return { response, data: undefined as T };
  }
  try {
    return { response, data: JSON.parse(text) as T };
  } catch {
    return { response, data: undefined as T };
  }
}

export function contentTypeIsPdf(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("application/pdf");
}
