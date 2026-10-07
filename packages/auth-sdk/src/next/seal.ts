import { EncryptJWT, jwtDecrypt } from "jose";

export interface SealedSession {
  /** Access token. */
  at: string;
  /** Refresh token; absent when the grant has none, and the session then ends at `exp`. */
  rt?: string;
  /** Access-token expiry, epoch seconds. */
  exp: number;
}

export interface SealedFlow {
  state: string;
  verifier: string;
  returnTo: string;
}

async function key(secret: string, purpose: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`deniz-auth\0${purpose}\0${secret}`),
  );
  return new Uint8Array(digest);
}

async function seal(
  secret: string,
  purpose: string,
  payload: Record<string, unknown>,
  maxAgeSeconds: number,
): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .encrypt(await key(secret, purpose));
}

async function open(
  secret: string,
  purpose: string,
  value: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtDecrypt(value, await key(secret, purpose));
    return payload;
  } catch {
    return null;
  }
}

/**
 * The cookie carries the access token's expiry as `ate`, not `exp`: `exp` is
 * the cookie envelope's own lifetime, which outlives the access token by the
 * refresh token's.
 */
export async function sealSession(
  secret: string,
  session: SealedSession,
  maxAgeSeconds: number,
): Promise<string> {
  return seal(
    secret,
    "session",
    { at: session.at, rt: session.rt, ate: session.exp },
    maxAgeSeconds,
  );
}

export async function openSession(
  secret: string,
  value: string | undefined,
): Promise<SealedSession | null> {
  const payload = await open(secret, "session", value);
  if (
    !payload ||
    typeof payload.at !== "string" ||
    typeof payload.ate !== "number" ||
    (payload.rt !== undefined && typeof payload.rt !== "string")
  ) {
    return null;
  }
  return { at: payload.at, rt: payload.rt, exp: payload.ate };
}

export async function sealFlow(
  secret: string,
  flow: SealedFlow,
  maxAgeSeconds: number,
): Promise<string> {
  return seal(secret, "flow", { ...flow }, maxAgeSeconds);
}

export async function openFlow(
  secret: string,
  value: string | undefined,
): Promise<SealedFlow | null> {
  const payload = await open(secret, "flow", value);
  if (
    !payload ||
    typeof payload.state !== "string" ||
    typeof payload.verifier !== "string" ||
    typeof payload.returnTo !== "string"
  ) {
    return null;
  }
  return {
    state: payload.state,
    verifier: payload.verifier,
    returnTo: payload.returnTo,
  };
}
