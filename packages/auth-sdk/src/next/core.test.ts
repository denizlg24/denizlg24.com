import { beforeEach, describe, expect, test } from "bun:test";
import {
  createFakeIssuer,
  type FakeIssuer,
  ISSUER,
} from "../testing/fake-issuer.js";
import { readCookie } from "./cookies.js";
import {
  type DenizAuthConfig,
  handle,
  lazyResolver,
  type Resolved,
  refreshFromCookie,
  safePath,
  sessionFromCookie,
} from "./core.js";

const ORIGIN = "https://app.example.com";
let issuer: FakeIssuer;

beforeEach(async () => {
  issuer = await createFakeIssuer({
    app: { secret: "s3cret", tenant: "acme" },
  });
});

function resolver(overrides: Partial<DenizAuthConfig> = {}): Resolved {
  return lazyResolver({
    issuer: ISSUER,
    clientId: "app",
    clientSecret: "s3cret",
    resource: ORIGIN,
    baseUrl: ORIGIN,
    secret: "x".repeat(32),
    fetch: issuer.fetch,
    keys: issuer.keys,
    ...overrides,
  })();
}

/** Collects Set-Cookie values into what a browser would send back. */
function jar(response: Response, previous: Record<string, string> = {}) {
  const next = { ...previous };
  for (const header of response.headers.getSetCookie()) {
    const [pair = "", ...attributes] = header.split("; ");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (attributes.includes("Max-Age=0")) delete next[name];
    else next[name] = value;
  }
  return next;
}

function cookieHeader(cookies: Record<string, string>) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function signIn(r: Resolved, returnTo = "/dashboard?tab=1") {
  const login = await handle(
    r,
    new Request(
      `${ORIGIN}/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    ),
  );
  expect(login.status).toBe(302);
  let cookies = jar(login);
  const callbackUrl = await issuer.authorize(
    login.headers.get("location") ?? "",
    "user-1",
  );
  const callback = await handle(
    r,
    new Request(callbackUrl, { headers: { cookie: cookieHeader(cookies) } }),
  );
  cookies = jar(callback, cookies);
  return { callback, cookies };
}

describe("sign-in flow", () => {
  test("login → callback sets a session and returns to the requested path", async () => {
    const r = resolver();
    const { callback, cookies } = await signIn(r);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/dashboard?tab=1`);
    expect(Object.keys(cookies)).toEqual(["__Host-deniz-auth"]);
    expect(callback.headers.getSetCookie().join("\n")).toContain("HttpOnly");

    const session = await sessionFromCookie(r, cookies["__Host-deniz-auth"]);
    expect(session?.user).toEqual({ id: "user-1", tenant: "acme" });

    const endpoint = await handle(
      r,
      new Request(`${ORIGIN}/auth/session`, {
        headers: { cookie: cookieHeader(cookies) },
      }),
    );
    expect(await endpoint.json()).toMatchObject({
      user: { id: "user-1", tenant: "acme" },
    });
  });

  test("redirect URI is built from baseUrl, not the request host", async () => {
    const r = resolver();
    const login = await handle(
      r,
      new Request("http://10.0.0.5:3000/auth/login"),
    );
    const authorize = new URL(login.headers.get("location") ?? "");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/auth/callback`,
    );
  });

  test("a callback without the flow cookie is refused", async () => {
    const r = resolver();
    const login = await handle(r, new Request(`${ORIGIN}/auth/login`));
    const callbackUrl = await issuer.authorize(
      login.headers.get("location") ?? "",
      "user-1",
    );
    const callback = await handle(r, new Request(callbackUrl));
    expect(callback.headers.get("location")).toBe(
      `${ORIGIN}/?auth_error=state_mismatch`,
    );
    expect(jar(callback)).toEqual({});
  });

  test("an issuer mix-up is refused", async () => {
    const r = resolver();
    const login = await handle(r, new Request(`${ORIGIN}/auth/login`));
    const cookies = jar(login);
    const callbackUrl = new URL(
      await issuer.authorize(login.headers.get("location") ?? "", "u"),
    );
    callbackUrl.searchParams.set("iss", "https://evil.example.com");
    const callback = await handle(
      r,
      new Request(callbackUrl, { headers: { cookie: cookieHeader(cookies) } }),
    );
    expect(callback.headers.get("location")).toContain(
      "auth_error=issuer_mismatch",
    );
  });

  test("authorize() can refuse a sign-in, and the grant is revoked", async () => {
    const r = resolver({ authorize: (token) => token.tenant === "other" });
    const { callback, cookies } = await signIn(r);
    expect(callback.headers.get("location")).toContain("auth_error=forbidden");
    expect(cookies).toEqual({});
    expect(issuer.calls.revoke).toBe(1);
  });

  test("returnTo cannot leave the origin", () => {
    expect(safePath("//evil.example.com", "/")).toBe("/");
    expect(safePath("/\\evil.example.com", "/")).toBe("/");
    expect(safePath("https://evil.example.com", "/")).toBe("/");
    expect(safePath("/ok?x=1", "/")).toBe("/ok?x=1");
  });

  test("logout revokes the refresh token and clears the cookie", async () => {
    const r = resolver();
    const { cookies } = await signIn(r);
    const logout = await handle(
      r,
      new Request(`${ORIGIN}/auth/logout`, {
        headers: { cookie: cookieHeader(cookies) },
      }),
    );
    expect(logout.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(jar(logout, cookies)).toEqual({});
    expect(issuer.revoked.size).toBe(1);
  });

  test("unknown actions are 404 and a POST login is 405", async () => {
    const r = resolver();
    expect((await handle(r, new Request(`${ORIGIN}/auth/nope`))).status).toBe(
      404,
    );
    expect(
      (await handle(r, new Request(`${ORIGIN}/auth/login`, { method: "POST" })))
        .status,
    ).toBe(405);
  });
});

describe("refreshFromCookie", () => {
  test("leaves a fresh session alone", async () => {
    const r = resolver();
    const { cookies } = await signIn(r);
    expect(await refreshFromCookie(r, cookies["__Host-deniz-auth"])).toEqual({
      kind: "none",
    });
  });

  test("refreshes a session about to expire", async () => {
    issuer.accessTtl = 30;
    const r = resolver();
    const { cookies } = await signIn(r);
    issuer.accessTtl = 900;
    const outcome = await refreshFromCookie(r, cookies["__Host-deniz-auth"]);
    expect(outcome.kind).toBe("refreshed");
    if (outcome.kind !== "refreshed") return;
    const session = await sessionFromCookie(r, outcome.cookie);
    expect(session?.expiresAt).toBeGreaterThan(Date.now() + 800_000);
  });

  test("an outage or a refused refresh keeps the cookie", async () => {
    issuer.accessTtl = 30;
    const r = resolver();
    const { cookies } = await signIn(r);
    issuer.failNetwork(1);
    expect(await refreshFromCookie(r, cookies["__Host-deniz-auth"])).toEqual({
      kind: "none",
    });
  });

  test("a cookie sealed with another secret is cleared", async () => {
    const { cookies } = await signIn(resolver());
    const other = resolver({ secret: "y".repeat(32) });
    expect(
      await refreshFromCookie(other, cookies["__Host-deniz-auth"]),
    ).toEqual({ kind: "clear" });
  });
});

describe("configuration", () => {
  test("http origins drop the __Host- prefix and Secure", async () => {
    const r = resolver({ baseUrl: "http://localhost:3000" });
    const login = await handle(
      r,
      new Request("http://localhost:3000/auth/login"),
    );
    const header = login.headers.getSetCookie()[0] ?? "";
    expect(header.startsWith("deniz-auth-flow=")).toBe(true);
    expect(header).not.toContain("Secure");
  });

  test("short secrets and Forge-stripped cookie names are refused", () => {
    expect(() => resolver({ secret: "short" })).toThrow();
    expect(() => resolver({ cookieName: "deniz-cloud.session" })).toThrow();
  });

  test("a custom basePath routes and redirects under it", async () => {
    const r = resolver({ basePath: "/api/auth/" });
    const login = await handle(r, new Request(`${ORIGIN}/api/auth/login`));
    const authorize = new URL(login.headers.get("location") ?? "");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/auth/callback`,
    );
    expect(
      readCookie(cookieHeader(jar(login)), "__Host-deniz-auth-flow"),
    ).toBeString();
  });
});
