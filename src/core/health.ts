/**
 * Mirror/PDF-host health cache with optional disk persistence
 * (~/.cache/scipdf/health.json by default).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface HealthEntry {
  ok: boolean;
  latencyMs: number;
  error?: string;
  checkedAt: number;
  /** Consecutive failures (reset on success) — used for demotion ranking */
  failStreak?: number;
}

const store = new Map<string, HealthEntry>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistEnabled(): boolean {
  const v = process.env.SCIPDF_HEALTH_PERSIST;
  if (v === "0" || v?.toLowerCase() === "false") return false;
  return true;
}

export function healthFilePath(): string {
  if (process.env.SCIPDF_HEALTH_FILE?.trim()) {
    return process.env.SCIPDF_HEALTH_FILE.trim();
  }
  return join(homedir(), ".cache", "scipdf", "health.json");
}

function normalizeKey(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;
  if (!persistEnabled()) return;
  const file = healthFilePath();
  try {
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      entries?: Record<string, HealthEntry>;
    };
    const entries = raw?.entries ?? {};
    for (const [k, e] of Object.entries(entries)) {
      if (!e || typeof e.checkedAt !== "number") continue;
      store.set(normalizeKey(k), e);
    }
  } catch {
    // ignore corrupt cache
  }
}

function scheduleSave(): void {
  if (!persistEnabled()) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushHealth();
  }, 300);
  saveTimer.unref?.();
}

/** Write health cache to disk immediately. */
export function flushHealth(): void {
  if (!persistEnabled()) return;
  const file = healthFilePath();
  try {
    mkdirSync(dirname(file), { recursive: true });
    const entries: Record<string, HealthEntry> = {};
    for (const [k, v] of store) entries[k] = v;
    writeFileSync(
      file,
      JSON.stringify(
        { version: 1, savedAt: new Date().toISOString(), entries },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  } catch {
    // best-effort
  }
}

export function getHealth(url: string, ttlMs: number): HealthEntry | null {
  loadFromDisk();
  // A non-positive TTL is the explicit force-refresh signal used by the CLI
  // and MCP tool. Do not let an entry created in the same millisecond through.
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return null;
  const key = normalizeKey(url);
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.checkedAt > ttlMs) {
    store.delete(key);
    scheduleSave();
    return null;
  }
  return e;
}

export function setHealth(
  url: string,
  entry: Omit<HealthEntry, "checkedAt"> & { checkedAt?: number },
): void {
  loadFromDisk();
  const key = normalizeKey(url);
  const prev = store.get(key);
  let failStreak = entry.failStreak;
  if (failStreak == null) {
    if (entry.ok) failStreak = 0;
    else failStreak = (prev?.failStreak ?? 0) + 1;
  }
  store.set(key, {
    ok: entry.ok,
    latencyMs: entry.latencyMs,
    error: entry.error,
    failStreak,
    checkedAt: entry.checkedAt ?? Date.now(),
  });
  scheduleSave();
}

export function markBad(url: string, error: string, latencyMs = 0): void {
  loadFromDisk();
  const prev = store.get(normalizeKey(url));
  setHealth(url, {
    ok: false,
    latencyMs,
    error,
    failStreak: (prev?.failStreak ?? 0) + 1,
  });
}

export function markGood(url: string, latencyMs: number): void {
  setHealth(url, { ok: true, latencyMs, failStreak: 0 });
}

/**
 * Sort sources: good (fast first) → unknown → bad (low failStreak first).
 * Long fail streaks sink to the bottom (demotion).
 */
export function sortByHealth<T extends string>(
  urls: T[],
  ttlMs: number,
): T[] {
  return [...urls].sort((a, b) => {
    const ha = getHealth(a, ttlMs);
    const hb = getHealth(b, ttlMs);
    const score = (h: HealthEntry | null) => {
      if (!h) return 1;
      if (h.ok) return 0;
      return 2;
    };
    const d = score(ha) - score(hb);
    if (d !== 0) return d;
    if (ha?.ok && hb?.ok) {
      return (ha.latencyMs ?? 9999) - (hb.latencyMs ?? 9999);
    }
    // demote high fail streaks among bad/unknown
    const fa = ha?.failStreak ?? 0;
    const fb = hb?.failStreak ?? 0;
    if (fa !== fb) return fa - fb;
    return (ha?.latencyMs ?? 9999) - (hb?.latencyMs ?? 9999);
  });
}

/** Snapshot for diagnostics / check-mirrors ranking. */
export function listHealth(ttlMs: number): Array<{ url: string } & HealthEntry> {
  loadFromDisk();
  const now = Date.now();
  const out: Array<{ url: string } & HealthEntry> = [];
  for (const [url, e] of store) {
    if (now - e.checkedAt > ttlMs) continue;
    out.push({ url, ...e });
  }
  return out.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return a.latencyMs - b.latencyMs;
  });
}

export function clearHealth(): void {
  store.clear();
  loaded = true; // don't reload stale disk mid-test unless flush
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

/** Test helper: allow re-load from disk */
export function resetHealthLoader(): void {
  store.clear();
  loaded = false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}
