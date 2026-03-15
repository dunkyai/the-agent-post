// URL validation and rate limiting for browser service

const BLOCKED_SCHEMES = ["file:", "javascript:", "data:"];

const BLOCKED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "host.docker.internal",
  "[::1]",
  "metadata.google.internal",  // GCP metadata
  "169.254.169.254",           // AWS/cloud metadata
];

function isPrivateIP(hostname: string): boolean {
  // 10.x.x.x
  if (/^10\./.test(hostname)) return true;
  // 172.16-31.x.x
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  // 192.168.x.x
  if (/^192\.168\./.test(hostname)) return true;
  return false;
}

const BLOCKED_PORTS = new Set([
  3500,  // provisioning API
  3600,  // browser service itself
  2019,  // Caddy admin
]);

// Block dashboard ports 19000-19999
function isBlockedPort(port: number): boolean {
  if (BLOCKED_PORTS.has(port)) return true;
  if (port >= 19000 && port <= 19999) return true;
  return false;
}

export function validateUrl(url: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL" };
  }

  // Check scheme
  if (BLOCKED_SCHEMES.includes(parsed.protocol)) {
    return { valid: false, error: `Blocked URL scheme: ${parsed.protocol}` };
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: `Only http/https URLs are allowed` };
  }

  // Check hostname
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(hostname)) {
    return { valid: false, error: "Cannot browse internal addresses" };
  }

  if (isPrivateIP(hostname)) {
    return { valid: false, error: "Cannot browse private IP addresses" };
  }

  // Check port
  const port = parsed.port ? parseInt(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
  if (isBlockedPort(port)) {
    return { valid: false, error: "Cannot browse internal service ports" };
  }

  return { valid: true };
}

// Rate limiting per instance
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // actions per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

export function checkRateLimit(instanceId: string): { allowed: boolean; error?: string } {
  const now = Date.now();
  let entry = rateLimits.get(instanceId);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW };
    rateLimits.set(instanceId, entry);
  }

  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return { allowed: false, error: `Rate limit exceeded (${RATE_LIMIT} actions/minute)` };
  }

  return { allowed: true };
}
