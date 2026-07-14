/** Per-host (or global) min-gap throttles so concurrent races don't serialize worldwide. */

type Bucket = {
  lastRequestAt: number;
  chain: Promise<void>;
};

const buckets = new Map<string, Bucket>();

function bucketKey(urlOrHost?: string): string {
  if (!urlOrHost) return "__global__";
  try {
    if (urlOrHost.includes("://")) {
      return new URL(urlOrHost).host.toLowerCase();
    }
  } catch {
    /* fall through */
  }
  return urlOrHost.toLowerCase();
}

function getBucket(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { lastRequestAt: 0, chain: Promise.resolve() };
    buckets.set(key, b);
  }
  return b;
}

/**
 * Wait until `minGapMs` has elapsed since the last request to the same host.
 * Different hosts proceed independently (enables true multi-mirror racing).
 */
export async function throttle(
  minGapMs: number,
  urlOrHost?: string,
): Promise<void> {
  if (minGapMs <= 0) return;

  const key = bucketKey(urlOrHost);
  const bucket = getBucket(key);

  const run = async () => {
    const now = Date.now();
    const wait = bucket.lastRequestAt + minGapMs - now;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    bucket.lastRequestAt = Date.now();
  };

  const next = bucket.chain.then(run, run);
  bucket.chain = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

/** Test helper */
export function clearRateLimitBuckets(): void {
  buckets.clear();
}
