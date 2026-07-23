import type { CookieOptions } from "hono/utils/cookie";

export const SESSION_COOKIE_MAX_AGE = 86_400;

export function sessionCookieOptions(
  cookieName: string,
): { name: string } & CookieOptions {
  return {
    name: cookieName,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  };
}
