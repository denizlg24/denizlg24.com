import { relayTokenClaimsSchema } from "../schemas";

/**
 * Short-lived tokens minted by apps/web and verified here against a shared
 * secret. The browser never sees the Tiingo key; it only ever holds a token
 * that expires in minutes and grants nothing but a socket.
 *
 * Format is `base64url(payload).base64url(hmac)`. Kept hand-rolled rather than
 * pulling a JWT library in: there is one issuer, one audience and one
 * algorithm, so the parts a JWT library exists to negotiate are all fixed.
 */

/** Tolerance for drift between the minting host's clock and the relay's. */
const CLOCK_SKEW_MS = 5_000;

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

export async function mintRelayToken(
  secret: string,
  ttlSeconds = 300,
): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(12)));
  const payload = Buffer.from(JSON.stringify({ exp, nonce })).toString(
    "base64url",
  );
  return {
    token: `${payload}.${await sign(payload, secret)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export type TokenVerdict =
  | { ok: true }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

export async function verifyRelayToken(
  token: string,
  secret: string,
): Promise<TokenVerdict> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return { ok: false, reason: "malformed" };

  const expected = await sign(payload, secret);
  // Constant-time compare: a length-independent early return would leak the
  // signature a byte at a time to anyone able to time the handshake.
  if (!timingSafeEqual(signature, expected)) {
    return { ok: false, reason: "signature" };
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const parsed = relayTokenClaimsSchema.safeParse(claims);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  // The minting web app and the verifying relay are separate deployments, so a
  // few seconds of clock drift would otherwise reject a token the client never
  // got a chance to use.
  if (parsed.data.exp * 1000 + CLOCK_SKEW_MS < Date.now())
    return { ok: false, reason: "expired" };
  return { ok: true };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
