/**
 * HTTP helpers where timeout covers headers + full body read.
 * Clearing the timer only after body consumption prevents hung body streams.
 */

/** Fetch and read full body as bytes; timeout covers entire operation. */
export async function fetchBuffer(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; buffer: Uint8Array }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const buffer = new Uint8Array(await response.arrayBuffer());
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
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch and parse JSON; timeout covers entire operation. */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; data: T }> {
  const { response, text } = await fetchText(url, init, timeoutMs);
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
