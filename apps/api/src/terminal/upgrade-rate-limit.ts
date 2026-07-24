const TERMINAL_UPGRADE_WINDOW_MS = 60_000;
const TERMINAL_UPGRADE_MAX_REQUESTS = 30;
const MAX_TRACKED_IDENTITIES = 10_000;

interface RateLimitEntry {
  requests: number[];
}

export interface TerminalUpgradeRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface TerminalUpgradeRateLimiterOptions {
  maxRequests?: number;
  now?: () => number;
  windowMs?: number;
}

function clientIdentity(request: Request): string {
  const cloudflareIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (cloudflareIp) return cloudflareIp;
  if (process.env.NODE_ENV !== "production") {
    return request.headers.get("X-Real-IP")?.trim() || "local-development";
  }
  return "missing-cloudflare-client-ip";
}

export class TerminalUpgradeRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly now: () => number;
  private readonly windowMs: number;

  constructor(options: TerminalUpgradeRateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? TERMINAL_UPGRADE_MAX_REQUESTS;
    this.now = options.now ?? Date.now;
    this.windowMs = options.windowMs ?? TERMINAL_UPGRADE_WINDOW_MS;
  }

  consume(request: Request): TerminalUpgradeRateLimitDecision {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const key = clientIdentity(request);
    const existing = this.entries.get(key)?.requests ?? [];
    const requests = existing.filter((timestamp) => timestamp > cutoff);
    if (requests.length >= this.maxRequests) {
      const oldestRequest = requests[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldestRequest + this.windowMs - now) / 1_000),
        ),
      };
    }
    requests.push(now);
    this.entries.set(key, { requests });
    if (this.entries.size > MAX_TRACKED_IDENTITIES) this.prune(cutoff);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(cutoff: number): void {
    for (const [key, entry] of this.entries) {
      const latestRequest = entry.requests.at(-1);
      if (latestRequest !== undefined && latestRequest > cutoff) continue;
      this.entries.delete(key);
    }
  }
}
