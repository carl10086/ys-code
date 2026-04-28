export const MAX_CONTENT_LENGTH = 50_000;
const MAX_URL_LENGTH = 2000;

export function validateUrl(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Protocol allowlist
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and variants
  if (hostname === "localhost" || hostname.includes("localhost")) {
    return false;
  }

  // Block IPv4 loopback
  if (hostname === "127.0.0.1") {
    return false;
  }

  // Block IPv6 loopback (all forms)
  if (isIpv6Loopback(hostname)) {
    return false;
  }

  // Block private IP ranges (IPv4 and IPv6)
  if (isPrivateIp(hostname)) {
    return false;
  }

  return true;
}

function isIpv6Loopback(hostname: string): boolean {
  // Standard forms
  if (hostname === "[::1]" || hostname === "::1") return true;

  // Full form [0:0:0:0:0:0:0:1]
  if (hostname === "[0:0:0:0:0:0:0:1]") return true;

  return false;
}

function isPrivateIp(hostname: string): boolean {
  // IPv4-mapped IPv6: ::ffff:127.0.0.1, ::ffff:10.0.0.1, etc.
  // URL API normalizes these to ::ffff:<hex>, e.g. 127.0.0.1 → 7f00:1
  if (hostname.includes("::ffff:")) {
    const ipv4Part = extractIpv4Mapped(hostname);
    if (ipv4Part && isPrivateIpv4(ipv4Part)) return true;
  }

  // IPv4 address check
  if (isPrivateIpv4(hostname)) return true;

  // IPv6 ULA (fc00::/7) - starts with fc or fd
  if (/^\[?[Ff][CcDd][0-9a-fA-F:]*\]?$/.test(hostname)) return true;

  // IPv6 link-local (fe80::/10) - starts with fe8, fe9, fea, feb
  if (/^\[?[Ff][Ee][89abAB][0-9a-fA-F:]*\]?$/.test(hostname)) return true;

  return false;
}

function extractIpv4Mapped(hostname: string): string | null {
  // Extract the part after ::ffff:
  const match = hostname.match(/::ffff:([^\]]+)/);
  if (!match) return null;

  const part = match[1];

  // Already in dotted decimal (e.g. "127.0.0.1")
  if (part.includes(".")) return part;

  // Normalized hex form: "7f00:1" → 127.0.0.1
  // Each 16-bit group represents two IPv4 octets
  const hexMatch = part.match(/^([0-9a-fA-F]+):([0-9a-fA-F]+)$/);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
  }

  return null;
}

function isPrivateIpv4(hostname: string): boolean {
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4Match) return false;

  const [, a, b] = ipv4Match.map(Number);

  // 0.0.0.0/8
  if (a === 0) return true;

  // 10.0.0.0/8
  if (a === 10) return true;

  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  // 127.0.0.0/8 (loopback range)
  if (a === 127) return true;

  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;

  return false;
}

export function truncateContent(
  content: string,
  maxLength: number = MAX_CONTENT_LENGTH,
): string {
  if (content.length <= maxLength) {
    return content;
  }

  return content.slice(0, maxLength) + "\n\n[Content truncated due to length...]";
}
