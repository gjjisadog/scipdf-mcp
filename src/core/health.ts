/** In-memory mirror/PDF-host health cache */

export interface HealthEntry {
  ok: boolean;
  latencyMs: number;
  error?: string;
  checkedAt: number;
}

const store = new Map<string, HealthEntry>();

export function getHealth(url: string, ttlMs: number): HealthEntry | null {
  const key = normalizeKey(url);
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.checkedAt > ttlMs) {
    store.delete(key);
    return null;
  }
  return e;
}

export function setHealth(
  url: string,
  entry: Omit<HealthEntry, "checkedAt">,
): void {
  store.set(normalizeKey(url), { ...entry, checkedAt: Date.now() });
}

export function markBad(url: string, error: string, latencyMs = 0): void {
  setHealth(url, { ok: false, latencyMs, error });
}

export function markGood(url: string, latencyMs: number): void {
  setHealth(url, { ok: true, latencyMs });
}

export function sortByHealth<T extends string>(
  urls: T[],
  ttlMs: number,
): T[] {
  return [...urls].sort((a, b) => {
    const ha = getHealth(a, ttlMs);
    const hb = getHealth(b, ttlMs);
    // unknown first-ish, then good, then bad last
    const score = (h: HealthEntry | null) => {
      if (!h) return 1;
      if (h.ok) return 0;
      return 2;
    };
    const d = score(ha) - score(hb);
    if (d !== 0) return d;
    return (ha?.latencyMs ?? 9999) - (hb?.latencyMs ?? 9999);
  });
}

export function clearHealth(): void {
  store.clear();
}

function normalizeKey(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
