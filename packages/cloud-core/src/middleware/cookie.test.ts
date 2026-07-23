import { describe, expect, it } from "bun:test";

import { SESSION_COOKIE_MAX_AGE, sessionCookieOptions } from "./cookie";

describe("sessionCookieOptions", () => {
  it("preserves the secure session cookie contract", () => {
    expect(sessionCookieOptions("dc_session")).toEqual({
      name: "dc_session",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
    expect(SESSION_COOKIE_MAX_AGE).toBe(86_400);
  });
});
