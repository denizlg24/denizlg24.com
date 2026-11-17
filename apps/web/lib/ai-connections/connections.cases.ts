import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { NextRequest } from "next/server";
import type { AdminSession } from "@/lib/require-admin";
import type { IAiConnection } from "@/models/AiConnection";

// In-memory implementation of the Mongo atomic claim boundary. No account/network changes.
let row: IAiConnection | null = null;
let flow: IAiConnection | null = null;
let session: AdminSession | null = {
  user: { email: "owner", role: "admin" },
  via: "session",
};
let claims = 0;
const snapshot = <T>(value: T): T => structuredClone(value);
const query = <T>(value: T) => ({
  lean: () => ({ exec: async () => snapshot(value) }),
});
mock.module("@/lib/mongodb", () => ({ connectDB: async () => undefined }));
mock.module("@/lib/require-admin", () => ({
  getAdminSession: async () => session,
}));
mock.module("@/models/AiConnection", () => ({
  AiConnection: {
    findById: () => query(row),
    findOneAndUpdate: (
      filter: { revision: string },
      update: { $set: Partial<IAiConnection> },
    ) => {
      if (
        !row ||
        row.revision !== filter.revision ||
        row.refreshOwner ||
        !row.refreshToken
      )
        return query(null);
      const previous = snapshot(row);
      Object.assign(row, update.$set);
      delete row.refreshToken;
      claims++;
      return query(previous);
    },
    updateOne: async (
      filter: { revision: string; refreshOwner?: string },
      update: {
        $set?: Partial<IAiConnection>;
        $unset?: Record<string, number>;
      },
    ) => {
      if (
        !row ||
        row.revision !== filter.revision ||
        (filter.refreshOwner && row.refreshOwner !== filter.refreshOwner)
      )
        return { matchedCount: 0 };
      Object.assign(row, update.$set);
      if (update.$unset)
        for (const key of Object.keys(update.$unset))
          Reflect.deleteProperty(row, key);
      return { matchedCount: 1 };
    },
    findOneAndDelete: (filter: {
      _id: string;
      sessionHash: string;
      expiresAt: { $gt: Date };
    }) => {
      const matched =
        flow &&
        flow._id === filter._id &&
        flow.sessionHash === filter.sessionHash &&
        flow.expiresAt &&
        flow.expiresAt > filter.expiresAt.$gt
          ? flow
          : null;
      if (matched) flow = null;
      return query(matched);
    },
    replaceOne: async (
      filter: { revision: string | object },
      replacement: IAiConnection,
    ) => {
      if (row && row.revision !== filter.revision)
        return { matchedCount: 0, upsertedCount: 0 };
      row = snapshot(replacement);
      return { matchedCount: 1, upsertedCount: 0 };
    },
  },
}));

const { encryptSecret, decryptSecret } = await import("@/lib/encrypted-secret");
const { resolveGatewayCredential, verifyGatewayCredential, getAiConnections } =
  await import("./gateway");
const { oauthAccessToken } = await import("./vercel-tokens");
const { completeVercelOAuth, oauthSessionHash } = await import("./oauth");
const {
  authenticateAiConnectionRequest,
  authenticatedOAuthSession,
  aiConnectionErrorResponse,
} = await import("./http");
const { ADMIN_SESSION_COOKIE } = await import("@/lib/admin-session");
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const setFetch = (
  fn: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
) => {
  globalThis.fetch = Object.assign(fn, {
    preconnect: originalFetch.preconnect,
  });
};
afterAll(() => {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  process.env.IMAP_ENCRYPTION_KEY = "01".repeat(32);
  process.env.AI_GATEWAY_API_KEY = "environment-secret";
  process.env.VERCEL_APP_CLIENT_ID = "app";
  process.env.VERCEL_APP_CLIENT_SECRET = "client-secret";
  process.env.VERCEL_APP_REDIRECT_URI =
    "https://owner.example/api/admin/ai-connections/vercel/callback";
  process.env.VERCEL_APP_GATEWAY_ENABLED = "true";
  row = null;
  flow = null;
  claims = 0;
  session = { user: { email: "owner", role: "admin" }, via: "session" };
  globalThis.fetch = originalFetch;
});
const oauthRow = (): IAiConnection => ({
  _id: "personal-gateway",
  revision: "version-1",
  source: "oauth",
  status: "connected",
  apiKey: encryptSecret("expired-access"),
  refreshToken: encryptSecret("refresh-once"),
  accessExpiresAt: new Date(0),
});

describe("credential precedence and secrecy", () => {
  test("stored overrides environment, corrupted stored credential fails closed", async () => {
    const stored: IAiConnection = {
      _id: "personal-gateway",
      revision: "1",
      source: "stored",
      apiKey: encryptSecret("stored-secret"),
    };
    expect((await resolveGatewayCredential(stored)).apiKey).toBe(
      "stored-secret",
    );
    if (stored.apiKey) stored.apiKey.authTag = "00".repeat(16);
    await expect(resolveGatewayCredential(stored)).rejects.toMatchObject({
      code: "stored_credential",
    });
    expect(await resolveGatewayCredential(null)).toMatchObject({
      source: "environment",
      apiKey: "environment-secret",
    });
    expect(
      (
        await resolveGatewayCredential({
          _id: "personal-gateway",
          revision: "disconnected",
          disconnected: true,
        })
      ).source,
    ).toBe("environment");
    await expect(
      resolveGatewayCredential({
        _id: "personal-gateway",
        revision: "corrupted",
      }),
    ).rejects.toMatchObject({ code: "stored_credential" });
  });
  test("status and errors never serialize secrets or arbitrary upstream errors", async () => {
    row = oauthRow();
    const serialized = JSON.stringify(await getAiConnections());
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("refresh-once");
    const response = aiConnectionErrorResponse(
      new Error("secret echoed by upstream"),
    );
    expect(await response.text()).not.toContain("secret echoed");
  });
  test("OAuth requires explicit Gateway permission configuration", async () => {
    delete process.env.VERCEL_APP_GATEWAY_ENABLED;
    expect((await getAiConnections()).vercelOAuthAvailable).toBe(false);
  });
});

describe("rotating refresh tokens", () => {
  test("concurrent workers exchange exactly once and both receive the new credential", async () => {
    row = oauthRow();
    let exchanges = 0;
    setFetch(
      mock(async (_input, init) => {
        exchanges++;
        expect(String(init?.body)).toContain("refresh_token=refresh-once");
        await new Promise((resolve) => setTimeout(resolve, 30));
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }),
    );
    const initial = snapshot(row);
    expect(
      await Promise.all([oauthAccessToken(initial), oauthAccessToken(initial)]),
    ).toEqual(["new-access", "new-access"]);
    expect(exchanges).toBe(1);
    expect(claims).toBe(1);
    expect(row?.refreshToken && decryptSecret(row.refreshToken)).toBe(
      "new-refresh",
    );
  });
  test("ambiguous exchange failure consumes the token and never retries or uses environment", async () => {
    row = oauthRow();
    let exchanges = 0;
    setFetch(
      mock(async () => {
        exchanges++;
        throw new Error("Network lost after exchange");
      }),
    );
    await expect(resolveGatewayCredential(snapshot(row))).rejects.toMatchObject(
      { code: "oauth_reconnect" },
    );
    await expect(resolveGatewayCredential(snapshot(row))).rejects.toMatchObject(
      { code: "oauth_reconnect" },
    );
    expect(exchanges).toBe(1);
    expect(row?.refreshToken).toBeUndefined();
  });
  test("a stale lease cannot replay a consumed refresh token", async () => {
    row = {
      ...oauthRow(),
      refreshToken: undefined,
      refreshOwner: "dead-worker",
      refreshStartedAt: new Date(0),
    };
    await expect(oauthAccessToken(row)).rejects.toMatchObject({
      code: "oauth_reconnect",
    });
    expect(claims).toBe(0);
  });
  test("disconnect during exchange cannot resurrect credentials", async () => {
    row = oauthRow();
    const initial = snapshot(row);
    setFetch(
      mock(async () => {
        row = {
          _id: "personal-gateway",
          revision: "disconnected",
          disconnected: true,
        };
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }),
    );
    await expect(oauthAccessToken(initial)).rejects.toMatchObject({
      code: "oauth_reconnect",
    });
    expect(row?.source).toBeUndefined();
  });
});

describe("request and OAuth security", () => {
  test("all APIs require admin authentication", async () => {
    session = null;
    await expect(
      authenticateAiConnectionRequest(
        new NextRequest("https://owner.example/api/admin/ai-connections"),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  test("cross-origin cookie mutation rejected even with invalid bearer header", async () => {
    const request = new NextRequest(
      "https://owner.example/api/admin/ai-connections/gateway",
      {
        headers: {
          origin: "https://evil.example",
          authorization: "Bearer invalid",
        },
      },
    );
    await expect(
      authenticateAiConnectionRequest(request, true),
    ).rejects.toMatchObject({ code: "origin" });
  });
  test("OAuth session is browser-bound and authorization rejects cross-site navigation", async () => {
    expect(oauthSessionHash("session-a", "owner")).not.toBe(
      oauthSessionHash("session-b", "owner"),
    );
    const request = new NextRequest(
      "https://owner.example/api/admin/ai-connections/vercel/authorize",
      {
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE}=session-a`,
          referer: "https://evil.example/",
        },
      },
    );
    await expect(
      authenticatedOAuthSession(request, true),
    ).rejects.toMatchObject({ code: "origin" });
    session = { user: { email: "owner", role: "admin" }, via: "api-key" };
    await expect(authenticatedOAuthSession(request)).rejects.toMatchObject({
      code: "browser_session",
    });
  });
  test("desktop browser launch permits user navigation with an existing admin session", async () => {
    const request = new NextRequest(
      "https://owner.example/api/admin/ai-connections/vercel/authorize",
      {
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE}=session-a`,
          "sec-fetch-site": "none",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
      },
    );
    expect(await authenticatedOAuthSession(request, true)).toBe(
      oauthSessionHash("session-a", "owner"),
    );
  });
  test("state cookie mismatch, wrong session and expired flow fail before token exchange", async () => {
    const fetchMock = mock(async () => {
      throw new Error("Must not fetch");
    });
    setFetch(fetchMock);
    const input = {
      state: "state",
      cookieState: "other",
      sessionHash: "owner-session",
      code: "code",
    };
    await expect(completeVercelOAuth(input)).rejects.toMatchObject({
      code: "oauth_state",
    });
    flow = {
      _id: `vercel-flow:${createHash("sha256").update("state").digest("hex")}`,
      revision: "flow",
      sessionHash: "wrong-session",
      expiresAt: new Date(Date.now() + 60000),
      flow: encryptSecret("{}"),
    };
    await expect(
      completeVercelOAuth({ ...input, cookieState: "state" }),
    ).rejects.toMatchObject({ code: "oauth_state" });
    flow.sessionHash = "owner-session";
    flow.expiresAt = new Date(0);
    await expect(
      completeVercelOAuth({ ...input, cookieState: "state" }),
    ).rejects.toMatchObject({ code: "oauth_state" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("callback state is consumed once even if token exchange fails", async () => {
    let exchanges = 0;
    setFetch(
      mock(async (_input, init) => {
        exchanges++;
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code_verifier")).toBe("pkce-verifier");
        expect(body.get("redirect_uri")).toBe(
          process.env.VERCEL_APP_REDIRECT_URI ?? "",
        );
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }),
    );
    flow = {
      _id: `vercel-flow:${createHash("sha256").update("state").digest("hex")}`,
      revision: "flow",
      sessionHash: "owner-session",
      expiresAt: new Date(Date.now() + 60000),
      flow: encryptSecret(
        JSON.stringify({
          verifier: "pkce-verifier",
          nonce: "nonce",
          revision: null,
        }),
      ),
    };
    const input = {
      state: "state",
      cookieState: "state",
      sessionHash: "owner-session",
      code: "code",
    };
    await expect(completeVercelOAuth(input)).rejects.toMatchObject({
      code: "oauth_token",
    });
    await expect(completeVercelOAuth(input)).rejects.toMatchObject({
      code: "oauth_state",
    });
    expect(exchanges).toBe(1);
  });
});

test("OAuth verifies signed identity, nonce, and Gateway permission before persisting", async () => {
  const key = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  let nonce = "wrong-nonce";
  let creditsStatus = 403;
  let creditsRequests = 0;
  setFetch(
    mock(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://vercel.com/.well-known/jwks")
        return Response.json({ keys: [jwk] });
      if (url.startsWith("https://ai-gateway.vercel.sh/v1/credits")) {
        creditsRequests++;
        return creditsStatus === 200
          ? Response.json({ balance: "10", total_used: "0" })
          : Response.json(
              { error: "permission denied" },
              { status: creditsStatus },
            );
      }
      const idToken = await new SignJWT({ nonce })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer("https://vercel.com")
        .setAudience("app")
        .setSubject("owner-vercel-account")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(key.privateKey);
      return Response.json({
        access_token: "oauth-access",
        refresh_token: "oauth-refresh",
        expires_in: 3600,
        token_type: "Bearer",
        id_token: idToken,
      });
    }),
  );
  const input = {
    state: "state",
    cookieState: "state",
    sessionHash: "owner-session",
    code: "code",
  };
  const setup = () => {
    flow = {
      _id: `vercel-flow:${createHash("sha256").update("state").digest("hex")}`,
      revision: "flow",
      sessionHash: "owner-session",
      expiresAt: new Date(Date.now() + 60000),
      flow: encryptSecret(
        JSON.stringify({
          verifier: "pkce",
          nonce: "expected-nonce",
          revision: null,
          teamIdOrSlug: "owner-team",
        }),
      ),
    };
  };
  setup();
  await expect(completeVercelOAuth(input)).rejects.toMatchObject({
    code: "oauth_state",
  });
  expect(creditsRequests).toBe(0);
  expect(row).toBeNull();
  nonce = "expected-nonce";
  setup();
  await expect(completeVercelOAuth(input)).rejects.toMatchObject({
    code: "permission",
  });
  expect(row).toBeNull();
  creditsStatus = 200;
  setup();
  await completeVercelOAuth(input);
  expect((await resolveGatewayCredential(row)).source).toBe("oauth");
  expect((await resolveGatewayCredential(row)).apiKey).toBe("oauth-access");
});

test("credits verification distinguishes authentication, balance and permission without inference", async () => {
  for (const [status, code] of [
    [401, "authentication"],
    [402, "balance"],
    [403, "permission"],
  ] as const) {
    setFetch(
      mock(async (input) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        expect(url.origin + url.pathname).toBe(
          "https://ai-gateway.vercel.sh/v1/credits",
        );
        return Response.json(
          { error: { message: "secret-upstream-message" } },
          { status },
        );
      }),
    );
    await expect(
      verifyGatewayCredential({
        apiKey: "test-key",
        teamIdOrSlug: "owner-team",
      }),
    ).rejects.toMatchObject({ code, status });
  }
});
