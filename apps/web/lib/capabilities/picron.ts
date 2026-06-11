import type { ICapability } from "@/models/Resource";
import { decryptPassword, encryptPassword } from "../safe-email-password";

export interface EncryptedField {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export interface PiCronConfig {
  username: EncryptedField;
  password: EncryptedField;
}

export function isPiCronCapability(cap: ICapability): boolean {
  return cap.type === "picron";
}

function isEncryptedField(value: unknown): value is EncryptedField {
  if (typeof value !== "object" || value === null) return false;

  return (
    "ciphertext" in value &&
    typeof value.ciphertext === "string" &&
    "iv" in value &&
    typeof value.iv === "string" &&
    "authTag" in value &&
    typeof value.authTag === "string"
  );
}

function isPiCronConfig(value: unknown): value is PiCronConfig {
  if (typeof value !== "object" || value === null) return false;

  return (
    "username" in value &&
    isEncryptedField(value.username) &&
    "password" in value &&
    isEncryptedField(value.password)
  );
}

export function getPiCronCredentials(cap: ICapability): {
  username: string;
  password: string;
} {
  if (!isPiCronConfig(cap.config)) {
    throw new Error("Invalid PiCron capability config");
  }

  const config = cap.config;
  return {
    username: decryptPassword(
      config.username.ciphertext,
      config.username.iv,
      config.username.authTag,
    ),
    password: decryptPassword(
      config.password.ciphertext,
      config.password.iv,
      config.password.authTag,
    ),
  };
}

export function buildPiCronConfig(
  username: string,
  password: string,
): Record<string, unknown> {
  return {
    username: encryptPassword(username),
    password: encryptPassword(password),
  };
}
