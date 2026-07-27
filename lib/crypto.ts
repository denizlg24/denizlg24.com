import { randomBytes, createHash, timingSafeEqual } from "crypto";


export function generateApiToken(): string {
  const raw = randomBytes(32).toString("base64url");
  return `envoy_${raw}`;
}


export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}


export function verifyApiToken(
  providedToken: string,
  storedHash: string
): boolean {
  const providedHash = hashApiToken(providedToken);

  return timingSafeEqual(
    Buffer.from(providedHash, "hex"),
    Buffer.from(storedHash, "hex")
  );
}