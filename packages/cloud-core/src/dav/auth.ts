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
  clientKey(context: Context): string;
}

export interface DavAuthResolver {
  resolve(username: string, secret: string): Promise<SafeUserRecord | null>;
  throttle?: DavAuthThrottle;
}

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

function throttled(retryAfterMs: number): Response {
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
 * untouched and still bounds guessing. The verdict is read before the password
 * is verified rather than after, because argon2 at 19 MiB is itself the thing
 * worth protecting: a flood of wrong passwords would otherwise pin the Pi's CPU
 * whether or not the guesses were ever going to succeed.
 */
export function davAuth(resolver: DavAuthResolver) {
  const { throttle } = resolver;

  return createMiddleware<{ Variables: DavVariables }>(
    async (context, next) => {
      if (context.req.method === "OPTIONS") return next();

      const credentials = parseBasic(context.req.header("Authorization"));
      // A request with no credentials at all is the first half of every mount:
      // the client asks, gets the challenge, then retries with the password. It
      // is not a failed guess and must not be charged as one.
      if (!credentials) return challenge();

      if (throttle) {
        const verdict = await throttle.store.peek(
          throttle.clientKey(context),
          throttle.max,
          throttle.windowMs,
        );
        if (!verdict.allowed) return throttled(verdict.retryAfterMs);
      }

      const user = await resolver.resolve(
        credentials.username,
        credentials.secret,
      );
      if (!user) {
        if (throttle) {
          const spent = await throttle.store.consume(
            throttle.clientKey(context),
            throttle.max,
            throttle.windowMs,
          );
          if (!spent.allowed) return throttled(spent.retryAfterMs);
        }
        return challenge();
      }

      context.set("user", user);
      return next();
    },
  );
}
