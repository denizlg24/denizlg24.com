import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  AuthorizationResponseError,
  AuthUnavailableError,
} from "../core/errors.js";
import {
  createFakeIssuer,
  type FakeIssuer,
  ISSUER,
} from "../testing/fake-issuer.js";
import { type AuthState, createPublicClient, memoryStorage } from "./index.js";

const RESOURCE = "https://api.example.com";
const REDIRECT = "http://127.0.0.1:4321/callback";
let issuer: FakeIssuer;

beforeEach(async () => {
  issuer = await createFakeIssuer({ native: { tenant: "acme" } });
});

function client(storage = memoryStorage()) {
  return createPublicClient({
    issuer: ISSUER,
    clientId: "native",
    resource: RESOURCE,
    redirectUri: REDIRECT,
    storage,
    fetch: issuer.fetch,
  });
}

async function signedIn(storage = memoryStorage()) {
  const c = client(storage);
  const url = await c.createSignIn();
  await c.handleCallback(await issuer.authorize(url, "user-1"));
  return c;
}

describe("public client", () => {
  test("signs in and publishes the user", async () => {
    const c = client();
    const states: AuthState[] = [];
    c.subscribe((state) => states.push(state));
    expect(await c.ready()).toEqual({ status: "signed-out" });
    const callback = await issuer.authorize(await c.createSignIn(), "user-1");
    expect(c.isCallback(callback)).toBe(true);
    const user = await c.handleCallback(callback);
    expect(user).toEqual({ id: "user-1", tenant: "acme" });
    expect(c.getState()).toEqual({ status: "signed-in", user });
    expect(states.at(-1)?.status).toBe("signed-in");
    expect(await c.getAccessToken()).toBeString();
  });

  test("a session survives a new client over the same storage", async () => {
    const storage = memoryStorage();
    await signedIn(storage);
    const again = client(storage);
    expect((await again.ready()).status).toBe("signed-in");
  });

  test("a callback for another sign-in is refused", async () => {
    const c = client();
    const url = await c.createSignIn();
    const callback = new URL(await issuer.authorize(url, "user-1"));
    callback.searchParams.set("state", "forged");
    await expect(c.handleCallback(callback)).rejects.toBeInstanceOf(
      AuthorizationResponseError,
    );
  });

  test("access_denied surfaces as an AuthorizationResponseError", async () => {
    const c = client();
    const url = new URL(await c.createSignIn());
    const denied = new URL(REDIRECT);
    denied.searchParams.set("state", url.searchParams.get("state") ?? "");
    denied.searchParams.set("error", "access_denied");
    const error = await c
      .handleCallback(denied)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthorizationResponseError);
    expect((error as AuthorizationResponseError).reason).toBe("access_denied");
  });

  test("refreshes once for concurrent callers near expiry", async () => {
    issuer.accessTtl = 30;
    const c = await signedIn();
    issuer.accessTtl = 900;
    const before = issuer.calls.token;
    let release: () => void = () => {};
    issuer.hold(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = Promise.all([
      c.getAccessToken(),
      c.getAccessToken(),
      c.getAccessToken(),
    ]);
    release();
    issuer.hold(null);
    const [a, b, d] = await pending;
    expect(issuer.calls.token - before).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(d);
  });

  test("an outage keeps the session; signing out revokes", async () => {
    issuer.accessTtl = 30;
    const c = await signedIn();
    issuer.failNetwork(1);
    await expect(c.getAccessToken()).rejects.toBeInstanceOf(
      AuthUnavailableError,
    );
    expect(c.getState().status).toBe("signed-in");

    await c.signOut();
    expect(c.getState()).toEqual({ status: "signed-out" });
    expect(issuer.revoked.size).toBe(1);
    expect(await c.getAccessToken()).toBeNull();
  });

  test("a revoked refresh token signs out with session_expired", async () => {
    issuer.accessTtl = 30;
    const storage = memoryStorage();
    const c = await signedIn(storage);
    const stored = JSON.parse(String(await storage.get("deniz-auth:session")));
    await issuer.fetch(`${ISSUER}/oauth2/revoke`, {
      method: "POST",
      body: new URLSearchParams({ token: stored.refreshToken }).toString(),
    });
    expect(await c.getAccessToken()).toBeNull();
    expect(c.getState()).toEqual({
      status: "signed-out",
      error: "session_expired",
    });
  });

  test("fetch attaches the bearer token", async () => {
    const c = await signedIn();
    const spy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok"),
    );
    try {
      await c.fetch(`${RESOURCE}/me`);
      const init = spy.mock.calls[0]?.[1];
      expect(new Headers(init?.headers).get("authorization")).toStartWith(
        "Bearer ",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
