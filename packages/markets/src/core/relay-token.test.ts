import { describe, expect, test } from "bun:test";
import { mintRelayToken, verifyRelayToken } from "./relay-token";

const SECRET = "a-shared-secret-between-web-and-relay";

describe("relay tokens", () => {
  test("a freshly minted token verifies", async () => {
    const { token } = await mintRelayToken(SECRET);
    expect(await verifyRelayToken(token, SECRET)).toEqual({ ok: true });
  });

  test("a token minted with another secret is rejected", async () => {
    const { token } = await mintRelayToken("some-other-secret");
    expect(await verifyRelayToken(token, SECRET)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  test("a tampered payload no longer matches its signature", async () => {
    const { token } = await mintRelayToken(SECRET);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ exp: 99_999_999_999, nonce: "aaaaaaaaaaaa" }),
    ).toString("base64url");
    expect(payload).not.toBe(forged);
    expect(await verifyRelayToken(`${forged}.${signature}`, SECRET)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  test("an expired token is rejected even though it is properly signed", async () => {
    const { token } = await mintRelayToken(SECRET, -10);
    expect(await verifyRelayToken(token, SECRET)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("garbage is rejected as malformed", async () => {
    expect(await verifyRelayToken("nonsense", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyRelayToken("", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  test("expiry is reported so the client can refresh before reconnecting", async () => {
    const { expiresAt } = await mintRelayToken(SECRET, 300);
    const remaining = Date.parse(expiresAt) - Date.now();
    expect(remaining).toBeGreaterThan(280_000);
    expect(remaining).toBeLessThanOrEqual(300_000);
  });

  test("two tokens differ even when minted in the same second", async () => {
    const [a, b] = await Promise.all([
      mintRelayToken(SECRET),
      mintRelayToken(SECRET),
    ]);
    expect(a.token).not.toBe(b.token);
  });
});
