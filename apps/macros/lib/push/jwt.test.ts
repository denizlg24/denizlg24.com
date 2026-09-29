import { describe, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
  APNS_JWT_MAX_AGE_SECONDS,
  buildApnsJwt,
  isJwtFresh,
  normalizePrivateKeyPem,
  parseApnsPrivateKey,
} from "./jwt";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

describe("normalizePrivateKeyPem", () => {
  test("turns literal \\n escapes into newlines", () => {
    const escaped = pem.trim().replace(/\n/g, "\\n");
    expect(normalizePrivateKeyPem(escaped)).toBe(pem.trim());
  });

  test("leaves a real multi-line PEM alone", () => {
    expect(normalizePrivateKeyPem(pem)).toBe(pem.trim());
  });
});

describe("buildApnsJwt", () => {
  const key = parseApnsPrivateKey(pem.replace(/\n/g, "\\n"));
  const token = buildApnsJwt(
    { keyId: "ABC123DEFG", teamId: "TEAM123456", privateKey: key },
    1_700_000_000,
  );
  const [header, claims, signature] = token.split(".");

  test("carries kid, iss and iat", () => {
    expect(
      JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
    ).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(
      JSON.parse(Buffer.from(claims ?? "", "base64url").toString()),
    ).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
  });

  test("is an ES256 signature in raw r||s form", () => {
    const raw = Buffer.from(signature ?? "", "base64url");
    expect(raw.length).toBe(64);
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: createPublicKey(key), dsaEncoding: "ieee-p1363" },
        raw,
      ),
    ).toBe(true);
  });
});

describe("isJwtFresh", () => {
  test("is stale once the cache age is reached", () => {
    const cached = { token: "t", issuedAtSeconds: 1000 };
    expect(isJwtFresh(null, 1000)).toBe(false);
    expect(isJwtFresh(cached, 1000 + APNS_JWT_MAX_AGE_SECONDS - 1)).toBe(true);
    expect(isJwtFresh(cached, 1000 + APNS_JWT_MAX_AGE_SECONDS)).toBe(false);
  });
});
