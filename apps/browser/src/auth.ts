import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** A static bearer; the hash comparison keeps the check constant-time whatever the lengths. */
export function bearerMatches(
  header: string | null | undefined,
  token: string,
): boolean {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) return false;
  return timingSafeEqual(digest(match[1]), digest(token));
}
