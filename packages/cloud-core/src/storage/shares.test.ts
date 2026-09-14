import { describe, expect, it } from "bun:test";

import {
  generateShareSecret,
  hashShareToken,
  isLegacyShareToken,
  readCookie,
  shareCookieName,
  shareCookieValue,
  shareExpiresAt,
  shareStatus,
  unlockCookieMaxAgeSeconds,
  verifyShareCookie,
} from "./shares";

describe("share tokens", () => {
  it("mints a dotless base64url token and stores only its hash", () => {
    const { token, tokenHash } = generateShareSecret();
    expect(token).not.toContain(".");
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(tokenHash).toBe(hashShareToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tells a legacy HMAC token by its two dots", () => {
    expect(isLegacyShareToken("file-id.1700000000000.abcdef")).toBe(true);
    expect(isLegacyShareToken(generateShareSecret().token)).toBe(false);
    expect(isLegacyShareToken("a.b")).toBe(false);
  });

  it("derives status from revocation first, then expiry", () => {
    const now = Date.now();
    expect(shareStatus({ expiresAt: null, revokedAt: null }, now)).toBe(
      "active",
    );
    expect(
      shareStatus({ expiresAt: new Date(now - 1), revokedAt: null }, now),
    ).toBe("expired");
    expect(
      shareStatus({ expiresAt: new Date(now + 1), revokedAt: new Date() }, now),
    ).toBe("revoked");
    expect(shareExpiresAt("never")).toBeNull();
    expect(shareExpiresAt("1d", 0)?.getTime()).toBe(24 * 60 * 60 * 1_000);
  });
});

describe("unlock cookie", () => {
  it("binds to the share and its token hash", () => {
    const value = shareCookieValue("share-1", "hash-1", "secret");
    expect(verifyShareCookie(value, "share-1", "hash-1", "secret")).toBe(true);
    expect(verifyShareCookie(value, "share-2", "hash-1", "secret")).toBe(false);
    expect(verifyShareCookie(value, "share-1", "hash-2", "secret")).toBe(false);
    expect(verifyShareCookie(value, "share-1", "hash-1", "other")).toBe(false);
    expect(verifyShareCookie(undefined, "share-1", "hash-1", "secret")).toBe(
      false,
    );
  });

  it("reads its own cookie out of a header and caps its life at the share's expiry", () => {
    const name = shareCookieName("abc");
    expect(name).toBe("__Host-share-abc");
    expect(readCookie(`x=1; ${name}=v%20alue; y=2`, name)).toBe("v alue");
    expect(readCookie("x=1", name)).toBeUndefined();
    const now = Date.now();
    expect(unlockCookieMaxAgeSeconds(null, now)).toBe(7 * 24 * 60 * 60);
    expect(unlockCookieMaxAgeSeconds(new Date(now + 3_600_000), now)).toBe(
      3_600,
    );
    expect(unlockCookieMaxAgeSeconds(new Date(now - 1), now)).toBe(60);
  });
});
