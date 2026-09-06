import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";

export class AccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const apiOrigin = () =>
  process.env.STATUS_CLOUD_API_URL ?? "https://api.denizlg24.com";
export async function sessionCookie() {
  const jar = await cookies();
  return jar
    .getAll()
    .filter(({ name }) => /^(?:__Secure-)?deniz-cloud\./.test(name))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}
export const adminSession = cache(async () => {
  const cookie = await sessionCookie();
  if (!cookie) return null;
  let response: Response;
  try {
    response = await fetch(new URL("/api/me", apiOrigin()), {
      headers: { cookie },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AccessError(
      503,
      "Cloud authentication is temporarily unavailable. Your session has not been signed out.",
    );
  }
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok)
    throw new AccessError(
      503,
      "Cloud authentication is temporarily unavailable.",
    );
  const parsed = z
    .object({
      data: z.object({
        id: z.string(),
        username: z.string(),
        role: z.string(),
      }),
    })
    .parse(await response.json());
  return parsed.data.role === "superuser" ? parsed.data : null;
});
export async function requireAdmin() {
  const user = await adminSession();
  if (!user)
    throw new AccessError(
      403,
      "An active Cloud or Forge administrator session is required.",
    );
  return user;
}
export async function requireSameOrigin() {
  const origin = (await headers()).get("origin");
  const allowed = new Set([
    process.env.STATUS_PUBLIC_URL ?? "https://status.denizlg24.com",
  ]);
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.NODE_ENV !== "production")
    allowed.add("http://localhost:3007");
  if (!origin || !allowed.has(origin))
    throw new AccessError(403, "Invalid request origin");
}
export function validBearer(header: string | null, token: string | undefined) {
  if (!token || token.length < 32 || !header?.startsWith("Bearer "))
    return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
export async function cloudRequest(path: string, init: RequestInit = {}) {
  await requireAdmin();
  const response = await fetch(new URL(path, apiOrigin()), {
    ...init,
    headers: {
      cookie: await sessionCookie(),
      "Content-Type": "application/json",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new AccessError(
      response.status,
      `Cloud operation failed (HTTP ${response.status}).`,
    );
  return response.json() as Promise<unknown>;
}
