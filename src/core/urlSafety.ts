/**
 * URL safety helpers — block SSRF to private/link-local/metadata addresses.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

function ipv4PartsToInt(parts: number[]): number {
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  );
}

function isPrivateIpv4Parts(parts: number[]): boolean {
  if (parts.some((p) => p > 255 || p < 0 || Number.isNaN(p))) return true;
  const n = ipv4PartsToInt(parts);
  const ranges: Array<[number, number]> = [
    [ipv4PartsToInt([0, 0, 0, 0]), ipv4PartsToInt([0, 255, 255, 255])],
    [ipv4PartsToInt([10, 0, 0, 0]), ipv4PartsToInt([10, 255, 255, 255])],
    [ipv4PartsToInt([127, 0, 0, 0]), ipv4PartsToInt([127, 255, 255, 255])],
    [ipv4PartsToInt([169, 254, 0, 0]), ipv4PartsToInt([169, 254, 255, 255])],
    [ipv4PartsToInt([172, 16, 0, 0]), ipv4PartsToInt([172, 31, 255, 255])],
    [ipv4PartsToInt([192, 168, 0, 0]), ipv4PartsToInt([192, 168, 255, 255])],
    [ipv4PartsToInt([100, 64, 0, 0]), ipv4PartsToInt([100, 127, 255, 255])], // CGNAT
  ];
  return ranges.some(([a, b]) => n >= a && n <= b);
}

/**
 * Detect private IPv4, including short forms (127.1 → 127.0.0.1) and
 * single-integer decimal (2130706433 → 127.0.0.1).
 */
function isPrivateIpv4(host: string): boolean {
  // Pure decimal / integer form
  if (/^\d+$/.test(host)) {
    const n = Number(host);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return true;
    return isPrivateIpv4Parts([
      (n >>> 24) & 255,
      (n >>> 16) & 255,
      (n >>> 8) & 255,
      n & 255,
    ]);
  }

  // Dotted forms with 1–4 parts (127.1, 10.0.1, 192.168.0.1)
  if (!/^\d{1,3}(\.\d{1,3}){0,3}$/.test(host)) return false;
  const raw = host.split(".").map((x) => Number(x));
  if (raw.some((p) => p > 255 || Number.isNaN(p))) return true;

  let parts: number[];
  if (raw.length === 4) {
    parts = raw;
  } else if (raw.length === 3) {
    // a.b.c → a.b.0.c
    parts = [raw[0], raw[1], 0, raw[2]];
  } else if (raw.length === 2) {
    // a.b → a.0.0.b (e.g. 127.1 → 127.0.0.1)
    parts = [raw[0], 0, 0, raw[1]];
  } else {
    // single dotted? already handled by decimal branch; treat as a.0.0.0
    parts = [raw[0], 0, 0, 0];
  }
  return isPrivateIpv4Parts(parts);
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd"))
    return true;
  // IPv4-mapped :ffff:127.0.0.1
  const m = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m && isPrivateIpv4(m[1])) return true;
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host === "0" || host === "::" || host === "[::]") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isPrivateIpv4(host)) return true;
  // IPv6 may appear with or without brackets depending on URL parser
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare.includes(":") && isPrivateIpv6(bare)) return true;
  return false;
}

/**
 * Validate URL for outbound mirror/probe requests.
 * Only http(s) to non-private hosts are allowed.
 */
export function assertSafePublicUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed: ${raw}`);
  }
  if (!u.hostname) {
    throw new Error(`URL missing hostname: ${raw}`);
  }
  if (isBlockedHostname(u.hostname)) {
    throw new Error(
      `Refusing request to private/local address (SSRF protection): ${u.hostname}`,
    );
  }
  // Disallow credentials in URL
  if (u.username || u.password) {
    throw new Error(`URL must not contain credentials: ${raw}`);
  }
  return u.href;
}
