import { timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";

function matches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch. The token's length is fixed
  // by configuration and not a secret, so refusing early is fine.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The agent has no session and no user. It presents one bearer token that is
 * also the token it accepts on its own listener, so a leak is symmetric and
 * there is one secret to rotate rather than two.
 */
export function requireAgentToken(token: string): MiddlewareHandler {
  return async (context, next) => {
    const header = context.req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (presented.length === 0 || !matches(presented, token)) {
      return context.json(
        {
          error: {
            code: "AGENT_UNAUTHORIZED",
            message: "A valid agent token is required",
          },
        },
        401,
      );
    }
    return next();
  };
}
