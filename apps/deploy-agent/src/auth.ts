import { createHash, timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Compared through a SHA-256 digest rather than directly: `timingSafeEqual`
 * throws on differing lengths, and catching that throw leaks the token length
 * through timing anyway. Hashing first makes both sides 32 bytes, so the
 * comparison is constant-time over every input including the wrong-length ones.
 */
export function tokensMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

export function requireAgentToken(expected: string): MiddlewareHandler {
  return async (context, next) => {
    const presented = bearerToken(context.req.header("authorization"));
    if (!presented || !tokensMatch(presented, expected)) {
      return context.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid agent token" } },
        401,
      );
    }
    return next();
  };
}
