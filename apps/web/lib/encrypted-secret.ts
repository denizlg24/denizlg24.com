import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_ENV_NAME = "IMAP_ENCRYPTION_KEY";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function getEncryptionKey() {
  const rawKey = process.env[KEY_ENV_NAME];
  if (!rawKey) {
    throw new Error(`${KEY_ENV_NAME} is required to encrypt server secrets`);
  }

  if (!/^[\da-f]{64}$/i.test(rawKey)) {
    throw new Error(`${KEY_ENV_NAME} must be a 64-character hex string`);
  }

  const key = Buffer.from(rawKey, "hex");
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV_NAME} must decode to 32 bytes`);
  }

  return key;
}

export function encryptSecret(secret: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptSecret(secret: EncryptedSecret) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(secret.iv, "hex"),
  );

  decipher.setAuthTag(Buffer.from(secret.authTag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
