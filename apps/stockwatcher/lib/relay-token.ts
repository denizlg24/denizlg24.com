import "server-only";
import { createHmac, randomBytes } from "node:crypto";

export const relayConfig = () => {
  const secret = process.env.MARKETS_RELAY_TOKEN_SECRET?.trim();
  const url = process.env.MARKETS_RELAY_URL?.trim();
  return secret && url ? { secret, url } : null;
};

// Same `base64url(claims).base64url(hmac-sha256)` format the denizlg24.com
// markets relay verifies, so both apps share one relay and one secret.
export function mintRelayToken(secret: string, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonce = randomBytes(12).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp, nonce })).toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return {
    token: `${payload}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}
