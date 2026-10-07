import { beforeEach, describe, expect, test } from "bun:test";
import { errors } from "jose";
import { AuthUnavailableError } from "../core/errors.js";
import {
  createFakeIssuer,
  type FakeIssuer,
  ISSUER,
} from "../testing/fake-issuer.js";
import { createMachineTokenSource } from "./machine.js";
import { bearerToken, createVerifier, hasScope } from "./verifier.js";

const AUDIENCE = "https://api.example.com";
let issuer: FakeIssuer;

beforeEach(async () => {
  issuer = await createFakeIssuer({ worker: { secret: "w" } });
});

function verifier() {
  return createVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys: issuer.keys,
  });
}

describe("createVerifier", () => {
  test("accepts a token for this audience and reads the tenant", async () => {
    const token = await issuer.mint({
      sub: "user-1",
      clientId: "app",
      audience: AUDIENCE,
      tenant: "acme",
    });
    const verified = await verifier().verify(token);
    expect(verified).toMatchObject({
      userId: "user-1",
      clientId: "app",
      tenant: "acme",
      machine: false,
    });
    expect(verified && hasScope(verified, "openid")).toBe(true);
  });

  test("first-party tokens have no tenant", async () => {
    const token = await issuer.mint({
      sub: "user-1",
      clientId: "web",
      audience: AUDIENCE,
    });
    expect((await verifier().verify(token))?.tenant).toBeNull();
  });

  test("refuses another audience, an expired token and non-JWTs", async () => {
    const other = await issuer.mint({
      sub: "u",
      clientId: "app",
      audience: "https://other.example.com",
    });
    const expired = await issuer.mint({
      sub: "u",
      clientId: "app",
      audience: AUDIENCE,
      ttl: -120,
    });
    expect(await verifier().verify(other)).toBeNull();
    expect(await verifier().verify(expired)).toBeNull();
    expect(await verifier().verify("dk_live_opaque")).toBeNull();
  });

  test("verifyRequest reads the bearer header", async () => {
    const token = await issuer.mint({
      sub: "u",
      clientId: "app",
      audience: AUDIENCE,
    });
    const request = new Request("https://api.example.com/x", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect((await verifier().verifyRequest(request))?.userId).toBe("u");
    expect(
      await verifier().verifyRequest(new Request("https://api.example.com/x")),
    ).toBeNull();
  });

  test("unreachable keys throw instead of reading as a bad token", async () => {
    const token = await issuer.mint({
      sub: "u",
      clientId: "app",
      audience: AUDIENCE,
    });
    const broken = createVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keys: async () => {
        throw new errors.JWKSTimeout();
      },
    });
    await expect(broken.verify(token)).rejects.toBeInstanceOf(
      AuthUnavailableError,
    );
  });

  test("bearerToken parses only the Bearer scheme", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer   abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("createMachineTokenSource", () => {
  test("caches until near expiry and shares one request", async () => {
    const source = createMachineTokenSource({
      issuer: ISSUER,
      clientId: "worker",
      clientSecret: "w",
      resource: AUDIENCE,
      fetch: issuer.fetch,
    });
    const [a, b] = await Promise.all([source.getToken(), source.getToken()]);
    expect(a).toBe(b);
    expect(issuer.calls.token).toBe(1);
    await source.getToken();
    expect(issuer.calls.token).toBe(1);
    source.invalidate();
    await source.getToken();
    expect(issuer.calls.token).toBe(2);
    const verified = await verifier().verify(await source.getToken());
    expect(verified?.machine).toBe(true);
  });
});
