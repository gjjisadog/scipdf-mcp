/**
 * HTTP helpers where timeout covers headers + full body read.
 * Clearing the timer only after body consumption prevents hung body streams.
 * Body size is capped to avoid unbounded memory use.
 */

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
