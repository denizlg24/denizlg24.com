import { createPrivateKey, type KeyObject, sign } from "node:crypto";

export type ApnsCredentials = {
  keyId: string;
  teamId: string;
  privateKey: KeyObject;
};

/** Environments hand a PEM over as one line with literal `\n` escapes. */
export function normalizePrivateKeyPem(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

export function parseApnsPrivateKey(raw: string): KeyObject {
  return createPrivateKey({ key: normalizePrivateKeyPem(raw), format: "pem" });
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * The provider token APNs expects: ES256, header `kid`, claims `iss` and
 * `iat` only. The signature is the raw r‖s pair, not DER.
 */
export function buildApnsJwt(
  credentials: ApnsCredentials,
  issuedAtSeconds: number,
): string {
  const header = base64url(
    JSON.stringify({ alg: "ES256", kid: credentials.keyId }),
  );
  const claims = base64url(
    JSON.stringify({ iss: credentials.teamId, iat: issuedAtSeconds }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: credentials.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

// APNs refuses a token older than an hour and throttles one refreshed more
// often than every 20 minutes, so a cached token lives between the two.
export const APNS_JWT_MAX_AGE_SECONDS = 50 * 60;

export type CachedJwt = { token: string; issuedAtSeconds: number };

export function isJwtFresh(
  cached: CachedJwt | null,
  nowSeconds: number,
): cached is CachedJwt {
  return (
    cached !== null &&
    nowSeconds - cached.issuedAtSeconds < APNS_JWT_MAX_AGE_SECONDS
  );
}
