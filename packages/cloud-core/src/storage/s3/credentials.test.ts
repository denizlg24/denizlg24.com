import { describe, expect, it } from "bun:test";

import { decryptS3Secret, encryptS3Secret, hashS3Secret } from "./credentials";

describe("S3 credential secret storage", () => {
  it("encrypts with randomized AES-256-GCM and hashes for comparison", () => {
    const first = encryptS3Secret("secret-access-key", "key-encryption-secret");
    const second = encryptS3Secret(
      "secret-access-key",
      "key-encryption-secret",
    );
    expect(first).not.toEqual(second);
    expect(
      decryptS3Secret(
        first.encrypted,
        first.iv,
        first.authTag,
        "key-encryption-secret",
      ),
    ).toBe("secret-access-key");
    expect(hashS3Secret("secret-access-key")).toHaveLength(64);
  });

  it("rejects a wrong encryption key and tampered authentication tag", () => {
    const value = encryptS3Secret("secret", "correct-key");
    expect(() =>
      decryptS3Secret(value.encrypted, value.iv, value.authTag, "wrong-key"),
    ).toThrow();
    const tag = Buffer.from(value.authTag, "base64");
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    expect(() =>
      decryptS3Secret(
        value.encrypted,
        value.iv,
        tag.toString("base64"),
        "correct-key",
      ),
    ).toThrow();
  });
});
