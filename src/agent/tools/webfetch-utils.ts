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

  // Block file protocol
  if (parsed.protocol === "file:") {
    return false;
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost
  if (hostname === "localhost") {
    return false;
  }

  // Block IPv4 loopback
  if (hostname === "127.0.0.1") {
    return false;
  }

  // Block IPv6 loopback
  if (hostname === "[::1]" || hostname === "::1") {
    return false;
  }

  // Block private IP ranges
  if (isPrivateIp(hostname)) {
    return false;
  }

  return true;
}

function isPrivateIp(hostname: string): boolean {
  // Check if it's an IPv4 address
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);

    // 10.0.0.0/8
    if (a === 10) return true;

    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;

    // 127.0.0.0/8 (loopback range, already checked 127.0.0.1 specifically)
    if (a === 127) return true;

    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;
  }

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
