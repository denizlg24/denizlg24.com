import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import type { PeekableRateLimitStore } from "../middleware/rate-limit";
import type { SafeUserRecord } from "../services/types";
import type { DavVariables } from "./routes";

export const DAV_REALM = "Deniz Cloud";

export interface DavAuthThrottle {
  store: PeekableRateLimitStore;
  /** Failed credentials tolerated per window, per client key. */
  max: number;
  windowMs: number;
  /**
   * Identifies the budget this attempt spends from. The presented username is
   * supplied so the key can name the account as well as the address; it must
   * never be derived from the Authorization header itself, which also encodes
   * the password and would give every wrong guess a fresh budget.
   */
  clientKey(context: Context, username: string): string;
}

export interface DavAuthResolver {
  resolve(username: string, secret: string): Promise<SafeUserRecord | null>;
  throttle?: DavAuthThrottle;
}

type Attempt =
  | { outcome: "authenticated"; user: SafeUserRecord }
  | { outcome: "rejected" }
  | { outcome: "throttled"; retryAfterMs: number };

function challenge(): Response {
  return new Response(null, {
    status: 401,
    headers: {
      // charset=UTF-8 is what tells Finder and Explorer to send the password
      // as UTF-8 rather than the platform's legacy code page.
      "WWW-Authenticate": `Basic realm="${DAV_REALM}", charset="UTF-8"`,
    },
  });
}

function throttledResponse(retryAfterMs: number): Response {
  return new Response(null, {
    status: 429,
    headers: {
      "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
    },
  });
}

function parseBasic(
  header: string | undefined,
): { username: string; secret: string } | null {
  if (!header?.toLowerCase().startsWith("basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return {
    username: decoded.slice(0, separator),
    secret: decoded.slice(separator + 1),
  };
}

/**
 * Runs `operation` to the exclusion of every other call sharing `key`.
 *
 * Same chaining as `withUploadLock` in the storage service, and sound for the
 * same reason: the API is one process, so a Map of promises is the whole
 * picture.
 */
function createKeyedMutex() {
  const chains = new Map<string, Promise<void>>();

  return async function run<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const prior = chains.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = prior.then(() => current);
    chains.set(key, queued);
    await prior;
    try {
      return await operation();
    } finally {
      release?.();
      if (chains.get(key) === queued) chains.delete(key);
    }
  };
}

/**
 * Basic auth, because it is the only scheme Finder and Explorer speak. The
 * session cookie and Bearer API keys cannot reach this router at all; the
 * credential is always a per-device WebDAV password.
 *
 * OPTIONS is answered unauthenticated so a client can discover that the server
 * is Class 2 before it has anything to send — every other method challenges.
 *
 * The throttle counts *failed* credentials, never requests. A mounted drive
 * sends its Authorization header on every one of the hundreds of requests it
 * makes browsing a directory, so charging per request would throttle ordinary
 * use within seconds. Charging per rejection leaves legitimate traffic
 * untouched and still bounds guessing.
 *
 * Reading the budget, verifying, and charging a failure run under a per-key
 * mutex. Without it the three steps are independent, and a flood of concurrent
 * wrong passwords all observe an unspent budget before any of them charges it —
 * every one then runs the argon2 verification the budget exists to prevent, so
 * the barrier is bypassed by exactly the traffic it was built to stop. Holding
 * the mutex means concurrent attempts on one key verify one at a time, which
 * costs legitimate bursts a little latency on an already-cached credential and
 * is the price of the guarantee. The request itself runs outside the mutex.
 */
export function davAuth(resolver: DavAuthResolver) {
  const { throttle } = resolver;
  const verifications = createKeyedMutex();

  return createMiddleware<{ Variables: DavVariables }>(
    async (context, next) => {
      if (context.req.method === "OPTIONS") return next();

      const credentials = parseBasic(context.req.header("Authorization"));
      // A request with no credentials at all is the first half of every mount:
      // the client asks, gets the challenge, then retries with the password. It
      // is not a failed guess and must not be charged as one.
      if (!credentials) return challenge();

      const attempt = await attemptAuth(context, credentials);
      if (attempt.outcome === "throttled") {
        return throttledResponse(attempt.retryAfterMs);
      }
      if (attempt.outcome === "rejected") return challenge();

      context.set("user", attempt.user);
      return next();
    },
  );

  async function attemptAuth(
    context: Context,
    credentials: { username: string; secret: string },
  ): Promise<Attempt> {
    if (!throttle) {
      const user = await resolver.resolve(
        credentials.username,
        credentials.secret,
      );
      return user
        ? { outcome: "authenticated", user }
        : { outcome: "rejected" };
    }

    const key = throttle.clientKey(context, credentials.username);
    return verifications(key, async () => {
      const verdict = await throttle.store.peek(
        key,
        throttle.max,
        throttle.windowMs,
      );
      if (!verdict.allowed) {
        return { outcome: "throttled", retryAfterMs: verdict.retryAfterMs };
      }
      const user = await resolver.resolve(
        credentials.username,
        credentials.secret,
      );
      if (user) return { outcome: "authenticated", user };
      const spent = await throttle.store.consume(
        key,
        throttle.max,
        throttle.windowMs,
      );
      return spent.allowed
        ? { outcome: "rejected" }
        : { outcome: "throttled", retryAfterMs: spent.retryAfterMs };
    });
  }
}
