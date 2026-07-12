let lastRequestAt = 0;

/** Simple global gap between outbound HTTP requests */
export async function throttle(minGapMs: number): Promise<void> {
  if (minGapMs <= 0) return;
  const now = Date.now();
  const wait = lastRequestAt + minGapMs - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestAt = Date.now();
}
