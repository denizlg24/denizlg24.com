import { describe, expect, it } from "bun:test";

import {
  decryptLegacyTotpSecret,
  encryptLegacyTotpSecret,
  hashPassword,
  verifyPassword,
} from ".";

describe("legacy auth compatibility", () => {
  it("hashes new passwords with argon2id and verifies legacy Bun hashes", async () => {
    const password = "correct horse battery staple";
    const legacyHash = await Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 19_456,
      timeCost: 2,
    });
    const newHash = await hashPassword(password);

    expect(legacyHash).toStartWith("$argon2id$");
    expect(newHash).toStartWith("$argon2id$");
    expect(await verifyPassword({ hash: legacyHash, password })).toBe(true);
    expect(
      await verifyPassword({ hash: legacyHash, password: "wrong password" }),
    ).toBe(false);
  });

  it("decrypts AES-256-GCM secrets stored by the legacy TOTP primitive", () => {
    const encrypted = encryptLegacyTotpSecret(
      "JBSWY3DPEHPK3PXP",
      "legacy-encryption-key",
    );

    expect(
      decryptLegacyTotpSecret(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag,
        "legacy-encryption-key",
      ),
    ).toBe("JBSWY3DPEHPK3PXP");
  });
});
