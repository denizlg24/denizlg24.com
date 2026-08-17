import { connectDB } from "@/lib/mongodb";
import { type ICapability, Resource } from "@/models/Resource";
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

/**
 * Resolves a PiCron capability into the connection `piCronFetch` needs. The
 * capability id doubles as the token cache key, so every caller reusing this
 * shares one login rather than each acquiring its own token.
 */
export async function getPiCronConnection(resourceId: string, capId: string) {
  await connectDB();
  const resource = await Resource.findById(resourceId);
  if (!resource) throw new Error("Resource not found");

  const cap = resource.capabilities.id(capId);
  if (cap?.type !== "picron") throw new Error("PiCron capability not found");

  const { username, password } = getPiCronCredentials(cap);
  return {
    baseUrl: cap.baseUrl,
    username,
    password,
    cacheKey: capId,
  };
}
