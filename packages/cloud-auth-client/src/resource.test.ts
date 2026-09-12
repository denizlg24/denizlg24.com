import { describe, expect, test } from "bun:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import {
  bearerToken,
  createAccessTokenVerifier,
  isSuperuserToken,
  looksLikeJwt,
} from "./resource";

const ISSUER = "https://api.denizlg24.com/api/auth";
const AUDIENCE = "https://mcp.denizlg24.com/mcp";

const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
  crv: "Ed25519",
});
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "EdDSA" };
const keys = createLocalJWKSet({ keys: [jwk] });
const verify = createAccessTokenVerifier({
  issuer: ISSUER,
  audience: AUDIENCE,
  keys,
});

async function sign(
  payload: JWTPayload,
  options: { typ?: string; expiresIn?: string; audience?: string } = {},
) {
  return new SignJWT(payload)
    .setProtectedHeader({
      alg: "EdDSA",
      kid: "k1",
      typ: options.typ ?? "at+jwt",
    })
    .setIssuer(ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(privateKey);
}

describe("createAccessTokenVerifier", () => {
  test("accepts a user token and reads its claims", async () => {
    const token = await verify(
      await sign({
        sub: "c7a1a1f0-0000-4000-8000-000000000001",
        azp: "client-a",
        scope: "openid offline_access",
        sid: "session-1",
        superuser: true,
      }),
    );
    expect(token).not.toBeNull();
    expect(token?.machine).toBe(false);
    expect(token?.clientId).toBe("client-a");
    expect(token?.scopes).toEqual(["openid", "offline_access"]);
    expect(token?.sessionId).toBe("session-1");
    expect(token && isSuperuserToken(token)).toBe(true);
  });

  test("treats a token whose subject is its client as a machine token", async () => {
    const token = await verify(
      await sign({ sub: "svc", azp: "svc", scope: "superuser", owner: "u1" }),
    );
    expect(token?.machine).toBe(true);
    expect(token && isSuperuserToken(token)).toBe(true);
  });

  test("a machine token without the superuser scope is not superuser", async () => {
    const token = await verify(
      await sign({ sub: "svc", azp: "svc", scope: "openid" }),
    );
    expect(token && isSuperuserToken(token)).toBe(false);
  });

  test("a user token without the claim is not superuser", async () => {
    const token = await verify(await sign({ sub: "u1", azp: "client-a" }));
    expect(token && isSuperuserToken(token)).toBe(false);
  });

  test("rejects another resource's audience", async () => {
    expect(
      await verify(
        await sign(
          { sub: "u1", azp: "client-a", superuser: true },
          { audience: "https://api.denizlg24.com" },
        ),
      ),
    ).toBeNull();
  });

  test("rejects an ID token presented as an access token", async () => {
    expect(
      await verify(await sign({ sub: "u1", azp: "client-a" }, { typ: "JWT" })),
    ).toBeNull();
  });

  test("rejects an expired token", async () => {
    expect(
      await verify(
        await sign({ sub: "u1", azp: "client-a" }, { expiresIn: "-1m" }),
      ),
    ).toBeNull();
  });

  test("rejects a token signed by another key", async () => {
    const other = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const forged = await new SignJWT({ sub: "u1", azp: "c", superuser: true })
      .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ: "at+jwt" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(other.privateKey);
    expect(await verify(forged)).toBeNull();
  });

  test("throws instead of answering 401 when the key set is unreachable", async () => {
    const offline = createAccessTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keys: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(
      offline(await sign({ sub: "u1", azp: "client-a" })),
    ).rejects.toThrow("fetch failed");
  });
});

describe("header helpers", () => {
  test("bearerToken extracts only a well-formed bearer value", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  test("looksLikeJwt keeps opaque API keys away from the verifier", () => {
    expect(looksLikeJwt("eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2ln")).toBe(
      true,
    );
    expect(looksLikeJwt("dc_live_0123456789abcdef")).toBe(false);
  });
});
