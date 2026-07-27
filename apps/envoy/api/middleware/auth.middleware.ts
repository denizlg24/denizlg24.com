import type { Context, Next } from "hono";
import { hashApiToken } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export async function authMiddleware(c: Context, next: Next) {
  const auth = c.req.header("authorization");

  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = auth.slice("Bearer ".length).trim();

  if (!token.startsWith("envoy_")) {
    return c.json({ error: "Invalid token format" }, 401);
  }

  const tokenHash = hashApiToken(token);

  const record = await prisma.apiToken.findUnique({
    where: { hash: tokenHash },
    include: { user: true },
  });

  if (!record || record.revokedAt) {
    return c.json({ error: "Invalid or revoked token" }, 401);
  }

  c.set("user", record.user);

  await next();
}
