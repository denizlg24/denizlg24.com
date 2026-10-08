import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import {
  base64Url,
  createNativeAuth,
  type NativeAuthPlatform,
  NotSignedInError,
  type PersistedSession,
} from "./session";

const SITE = "https://denizlg24.com";
const ISSUER = "https://api.denizlg24.com/api/auth";

function memoryStore(initial: PersistedSession | null = null) {
  let value: string | null = initial ? JSON.stringify(initial) : null;
  return {
    read: async () => value,
    write: async (json: string | null) => {
      value = json;
    },
    peek: () => (value ? (JSON.parse(value) as PersistedSession) : null),
    set: (next: PersistedSession) => {
      value = JSON.stringify(next);
    },
  };
}

function session(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    site: SITE,
    issuer: ISSUER,
    clientId: "client",
    resource: SITE,
    refreshToken: "rm_handle",
    accessToken: "old",
    accessTokenExpiresAt: Date.now() - 1,
    ...overrides,
  };
}

function platform(
  handler: (url: string, body: URLSearchParams) => Response,
  callback: (authorizeUrl: URL) => string | null = () => null,
): NativeAuthPlatform & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openAuthSession: async (url) => callback(new URL(url)),
    randomBytes: (length) => new Uint8Array(randomBytes(length)),
    sha256: async (input) =>
      new Uint8Array(createHash("sha256").update(input).digest()),
    fetch: async (url, init) => {
      calls.push(url);
      return handler(url, new URLSearchParams(String(init?.body ?? "")));
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("base64Url", () => {
  test("matches Node's encoder for every remainder", () => {
    for (const length of [0, 1, 2, 3, 31, 32]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(base64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
  });
});

describe("createNativeAuth", () => {
  test("refreshes a stale token once for concurrent callers", async () => {
    const store = memoryStore(session());
    const fake = platform(() =>
      json({
        access_token: "new",
        expires_in: 300,
        refresh_token: "rm_handle",
      }),
    );
    const auth = createNativeAuth({
      site: SITE,
      redirectUri: "com.denizlg24.hours:/oauth/callback",
      store,
      platform: fake,
    });
    const tokens = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);
    expect(tokens).toEqual(["new", "new"]);
    expect(fake.calls).toHaveLength(1);
    expect(store.peek()?.accessToken).toBe("new");
  });

  test("adopts a token another process stored instead of refreshing", async () => {
    const store = memoryStore(session());
    const fake = platform(() => json({ error: "unexpected" }, 500));
    const auth = createNativeAuth({
      site: SITE,
      redirectUri: "x:/cb",
      store,
      platform: fake,
    });
    await auth.hydrate();
    store.set(
      session({
        accessToken: "widget",
        accessTokenExpiresAt: Date.now() + 600_000,
      }),
    );
    expect(await auth.getAccessToken()).toBe("widget");
    expect(fake.calls).toHaveLength(0);
  });

  test("a revoked grant signs out", async () => {
    const store = memoryStore(session());
    const auth = createNativeAuth({
      site: SITE,
      redirectUri: "x:/cb",
      store,
      platform: platform(() => json({ error: "invalid_grant" }, 400)),
    });
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(
      NotSignedInError,
    );
    expect(auth.getState().status).toBe("signed-out");
    expect(store.peek()).toBeNull();
  });

  test("signs in with PKCE and a matching state", async () => {
    const store = memoryStore();
    let challenge = "";
    const fake = platform(
      (url, body) => {
        if (url.endsWith("/api/public/mobile-auth")) {
          return json({ issuer: ISSUER, clientId: "client", resource: SITE });
        }
        const verifier = body.get("code_verifier") ?? "";
        expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
          challenge,
        );
        return json({
          access_token: "access",
          expires_in: 300,
          refresh_token: "rm_new",
        });
      },
      (authorize) => {
        challenge = authorize.searchParams.get("code_challenge") ?? "";
        const state = authorize.searchParams.get("state");
        return `com.denizlg24.hours:/oauth/callback?code=abc&state=${state}`;
      },
    );
    const auth = createNativeAuth({
      site: SITE,
      redirectUri: "com.denizlg24.hours:/oauth/callback",
      store,
      platform: fake,
    });
    await auth.signIn();
    expect(auth.getState()).toMatchObject({ status: "signed-in", error: null });
    expect(store.peek()?.refreshToken).toBe("rm_new");
  });
});
