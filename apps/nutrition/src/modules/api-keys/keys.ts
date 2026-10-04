import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX_LENGTH = 16;

export const generateApiKey = () =>
  `dnut_${randomBytes(32).toString("base64url")}`;

export const hashApiKey = (apiKey: string) =>
  createHash("sha256").update(apiKey, "utf8").digest("hex");

export const getApiKeyPrefix = (apiKey: string) =>
  apiKey.slice(0, KEY_PREFIX_LENGTH);

export const readApiKeyFromRequest = (request: Request) => {
  const explicit = request.headers.get("x-api-key")?.trim();

  if (explicit) {
    return explicit;
  }

  const authorization = request.headers.get("authorization")?.trim();
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);

  return bearerMatch?.[1]?.trim();
};
