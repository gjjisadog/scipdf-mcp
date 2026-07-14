/**
 * URL safety helpers — block SSRF to private/link-local/metadata addresses.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function ipv4ToInt(host: string): number {
  const parts = host.split(".").map((x) => Number(x));
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  );
}

function isPrivateIpv4(host: string): boolean {
  if (!isIpv4(host)) return false;
  const parts = host.split(".").map((x) => Number(x));
  if (parts.some((p) => p > 255 || Number.isNaN(p))) return true;
  const n = ipv4ToInt(host);
  const ranges: Array<[number, number]> = [
    [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],
    [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
    [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
    [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
    [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
    [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
    [ipv4ToInt("100.64.0.0"), ipv4ToInt("100.127.255.255")], // CGNAT
  ];
  return ranges.some(([a, b]) => n >= a && n <= b);
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
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isPrivateIpv4(host)) return true;
  if (host.includes(":") && isPrivateIpv6(host)) return true;
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
