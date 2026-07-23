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

/** Parse a bracket-free IPv6 literal into its eight 16-bit words. */
function parseIpv6Words(host: string): number[] | null {
  let h = host.toLowerCase().replace(/^\[|\]$/g, "");

  // URL normally canonicalizes an embedded IPv4 address to hexadecimal, but
  // keep support for the text form too so isBlockedHostname is safe on its own.
  if (h.includes(".")) {
    const colon = h.lastIndexOf(":");
    if (colon < 0) return null;
    const ipv4 = h.slice(colon + 1).split(".").map(Number);
    if (
      ipv4.length !== 4 ||
      ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return null;
    }
    h = `${h.slice(0, colon + 1)}${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const doubleColon = h.indexOf("::");
  if (doubleColon !== h.lastIndexOf("::")) return null;

  const left = doubleColon >= 0 ? h.slice(0, doubleColon) : h;
  const right = doubleColon >= 0 ? h.slice(doubleColon + 2) : "";
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const parts = [...leftParts, ...rightParts];
  if (
    parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part)) ||
    (doubleColon < 0 && parts.length !== 8) ||
    (doubleColon >= 0 && parts.length >= 8)
  ) {
    return null;
  }

  const words = parts.map((part) => Number.parseInt(part, 16));
  if (doubleColon >= 0) {
    words.splice(leftParts.length, 0, ...Array(8 - parts.length).fill(0));
  }
  return words.length === 8 ? words : null;
}

function isPrivateIpv6(host: string): boolean {
  const words = parseIpv6Words(host);
  if (!words) return false;

  const allZero = words.every((word) => word === 0);
  if (allZero || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) {
    return true; // :: and ::1
  }
  // fe80::/10 includes fe80 through febf, not just the fe80::/16 subset.
  if ((words[0] & 0xffc0) === 0xfe80) return true;
  if ((words[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)

  // IPv4-mapped IPv6: ::ffff:w.x.y.z. WHATWG URL normalizes this to
  // ::ffff:7f00:1, so compare the final two words instead of matching text.
  const isIpv4Mapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (isIpv4Mapped) {
    return isPrivateIpv4Parts([
      words[6] >>> 8,
      words[6] & 0xff,
      words[7] >>> 8,
      words[7] & 0xff,
    ]);
  }
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
