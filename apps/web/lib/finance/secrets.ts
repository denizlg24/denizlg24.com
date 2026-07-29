import crypto from "node:crypto";
import type { EncryptedSecret } from "@/lib/encrypted-secret";

const ALGORITHM = "aes-256-gcm";

function financeEncryptionKey() {
  const value = process.env.FINANCE_ENCRYPTION_KEY?.trim();
  if (!value || !/^[\da-f]{64}$/i.test(value)) {
    throw new Error("FINANCE_ENCRYPTION_KEY must be a 64-character hex string");
  }
  return Buffer.from(value, "hex");
}

export function encryptFinanceSecret(value: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, financeEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptFinanceSecret(secret: EncryptedSecret) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    financeEncryptionKey(),
    Buffer.from(secret.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
