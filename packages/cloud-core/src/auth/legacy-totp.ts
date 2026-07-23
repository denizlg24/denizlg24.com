import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface EncryptedLegacyTotpSecret {
  encrypted: string;
  iv: string;
  authTag: string;
}

function deriveLegacyTotpKey(encryptionKey: string): Buffer {
  return createHash("sha256").update(encryptionKey).digest();
}

export function encryptLegacyTotpSecret(
  secret: string,
  encryptionKey: string,
): EncryptedLegacyTotpSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveLegacyTotpKey(encryptionKey),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptLegacyTotpSecret(
  encrypted: string,
  iv: string,
  authTag: string,
  encryptionKey: string,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveLegacyTotpKey(encryptionKey),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
