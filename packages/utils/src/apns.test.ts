import { describe, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { buildApnsJwt, classifyApnsResponse } from "./apns";

describe("buildApnsJwt", () => {
  test("signs ES256 with a raw signature APNs accepts", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const token = buildApnsJwt(
      { keyId: "KEY1234567", teamId: "TEAM123456", privateKey },
      1_700_000_000,
    );
    const [header, claims, signature] = token.split(".");
    expect(
      JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
    ).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(
      JSON.parse(Buffer.from(claims ?? "", "base64url").toString()),
    ).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);
  });
});

describe("classifyApnsResponse", () => {
  test("drops tokens APNs will never accept again", () => {
    expect(classifyApnsResponse(410, null)).toBe("disable");
    expect(classifyApnsResponse(400, "BadDeviceToken")).toBe("disable");
  });
  test("refreshes a refused provider token once", () => {
    expect(classifyApnsResponse(403, "ExpiredProviderToken")).toBe(
      "refresh-token",
    );
  });
  test("anything else is a failure, not a dead token", () => {
    expect(classifyApnsResponse(429, "TooManyRequests")).toBe("failed");
  });
});
