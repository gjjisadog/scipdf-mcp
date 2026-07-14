let lastRequestAt = 0;
/** Serialize throttle so concurrent callers cannot race past minGapMs. */
let chain: Promise<void> = Promise.resolve();

/** Global gap between outbound HTTP requests (serialized). */
export async function throttle(minGapMs: number): Promise<void> {
  if (minGapMs <= 0) return;

  const run = async () => {
    const now = Date.now();
    const wait = lastRequestAt + minGapMs - now;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    lastRequestAt = Date.now();
  };

  // Queue behind previous throttle; swallow prior errors so the chain continues.
  const next = chain.then(run, run);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}
