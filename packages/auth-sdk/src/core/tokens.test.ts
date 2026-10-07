import { beforeEach, describe, expect, test } from "bun:test";
import {
  createFakeIssuer,
  type FakeIssuer,
  ISSUER,
} from "../testing/fake-issuer.js";
import { AuthUnavailableError, OAuthGrantError } from "./errors.js";
import { codeChallenge } from "./pkce.js";
import { createTokenClient } from "./tokens.js";

const RESOURCE = "https://api.example.com";
let issuer: FakeIssuer;

beforeEach(async () => {
  issuer = await createFakeIssuer({
    app: { secret: "s3cret" },
    spa: {},
  });
});

function confidential() {
  return createTokenClient({
    issuer: ISSUER,
    clientId: "app",
    clientSecret: "s3cret",
    resource: RESOURCE,
    fetch: issuer.fetch,
  });
}

describe("authorizationUrl", () => {
  test("carries PKCE, resource and the default scope", async () => {
    const url = new URL(
      await confidential().authorizationUrl({
        redirectUri: "https://app.example.com/auth/callback",
        state: "st",
        verifier: "v".repeat(43),
        loginHint: "deniz",
      }),
    );
    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth2/authorize`);
    expect(url.searchParams.get("code_challenge")).toBe(
      await codeChallenge("v".repeat(43)),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe(RESOURCE);
    expect(url.searchParams.get("scope")).toBe("openid offline_access");
    expect(url.searchParams.get("login_hint")).toBe("deniz");
    expect(url.searchParams.has("prompt")).toBe(false);
  });
});

describe("token requests", () => {
  test("exchanges a code for a confidential client with basic auth", async () => {
    const client = confidential();
    const verifier = "x".repeat(43);
    const redirectUri = "https://app.example.com/auth/callback";
    const callback = new URL(
      await issuer.authorize(
        await client.authorizationUrl({ redirectUri, state: "s", verifier }),
        "user-1",
      ),
    );
    const tokens = await client.exchangeCode({
      code: callback.searchParams.get("code") ?? "",
      verifier,
      redirectUri,
    });
    expect(tokens.refreshToken).toBeString();
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  test("a public client sends its id in the body and no secret", async () => {
    const client = createTokenClient({
      issuer: ISSUER,
      clientId: "spa",
      resource: RESOURCE,
      fetch: issuer.fetch,
    });
    const verifier = "y".repeat(43);
    const redirectUri = "http://127.0.0.1:5555/callback";
    const callback = new URL(
      await issuer.authorize(
        await client.authorizationUrl({ redirectUri, state: "s", verifier }),
        "user-1",
      ),
    );
    await expect(
      client.exchangeCode({
        code: callback.searchParams.get("code") ?? "",
        verifier,
        redirectUri,
      }),
    ).resolves.toHaveProperty("accessToken");
  });

  test("a wrong verifier is a dead grant", async () => {
    const client = confidential();
    const redirectUri = "https://app.example.com/auth/callback";
    const callback = new URL(
      await issuer.authorize(
        await client.authorizationUrl({
          redirectUri,
          state: "s",
          verifier: "a".repeat(43),
        }),
        "user-1",
      ),
    );
    const error = await client
      .exchangeCode({
        code: callback.searchParams.get("code") ?? "",
        verifier: "b".repeat(43),
        redirectUri,
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OAuthGrantError);
    expect((error as OAuthGrantError).grantInvalid).toBe(true);
  });

  test("concurrent refreshes of one token share a request", async () => {
    const client = confidential();
    const first = await client.clientCredentials();
    expect(first.refreshToken).toBeUndefined();

    const redirectUri = "https://app.example.com/auth/callback";
    const verifier = "z".repeat(43);
    const callback = new URL(
      await issuer.authorize(
        await client.authorizationUrl({ redirectUri, state: "s", verifier }),
        "user-1",
      ),
    );
    const tokens = await client.exchangeCode({
      code: callback.searchParams.get("code") ?? "",
      verifier,
      redirectUri,
    });
    const before = issuer.calls.token;
    const [a, b, c] = await Promise.all([
      client.refresh(tokens.refreshToken ?? ""),
      client.refresh(tokens.refreshToken ?? ""),
      client.refresh(tokens.refreshToken ?? ""),
    ]);
    expect(issuer.calls.token - before).toBe(1);
    expect(a.accessToken).toBe(b.accessToken);
    expect(b.accessToken).toBe(c.accessToken);
  });

  test("an outage is AuthUnavailableError, never a grant verdict", async () => {
    const client = confidential();
    issuer.failNetwork(1);
    await expect(client.clientCredentials()).rejects.toBeInstanceOf(
      AuthUnavailableError,
    );
    issuer.failGateway();
    await expect(client.clientCredentials()).rejects.toBeInstanceOf(
      AuthUnavailableError,
    );
  });

  test("a wrong secret is invalid_client", async () => {
    const client = createTokenClient({
      issuer: ISSUER,
      clientId: "app",
      clientSecret: "wrong",
      resource: RESOURCE,
      fetch: issuer.fetch,
    });
    const error = await client
      .clientCredentials()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OAuthGrantError);
    expect((error as OAuthGrantError).code).toBe("invalid_client");
  });

  test("revoke never throws", async () => {
    issuer.failNetwork(1);
    await expect(confidential().revoke("rt-x")).resolves.toBeUndefined();
  });
});
