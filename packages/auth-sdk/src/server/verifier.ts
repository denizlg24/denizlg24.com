import {
  createRemoteJWKSet,
  errors,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";
import { AuthUnavailableError } from "../core/errors.js";
import { issuerEndpoints } from "../core/issuer.js";

export interface AccessToken {
  /** The user's id — the same in every app (`sub`). For a machine token, the client id. */
  userId: string;
  clientId: string;
  /** The app the client belongs to; null for the owner's own first-party clients. */
  tenant: string | null;
  scopes: string[];
  sessionId: string | null;
  /** client_credentials: no user behind it, and `userId` is the client id. */
  machine: boolean;
  /** Epoch seconds. */
  expiresAt: number;
  claims: JWTPayload;
}

export interface VerifierOptions {
  issuer?: string;
  /** This server's resource identifier — the `aud` its tokens are minted for. */
  audience: string;
  /** Defaults to the issuer's published JWKS. */
  keys?: JWTVerifyGetKey;
  /** Seconds of clock skew to accept on `exp`/`nbf`. Default 5. */
  clockTolerance?: number;
}

export interface Verifier {
  /**
   * `null` for a token that is simply not acceptable — expired, wrong
   * audience, bad signature, not a JWT. Throws `AuthUnavailableError` when the
   * keys cannot be fetched, so the caller answers 5xx instead of 401.
   */
  verify(token: string): Promise<AccessToken | null>;
  /** Reads `Authorization: Bearer …`; `null` when absent or unacceptable. */
  verifyRequest(request: {
    headers: Headers | { get(name: string): string | null };
  }): Promise<AccessToken | null>;
}

export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Cheap shape test so an opaque API key is never fed to the JWT verifier. */
export function looksLikeJwt(token: string): boolean {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(token);
}

export function hasScope(token: AccessToken, ...required: string[]): boolean {
  return required.every((scope) => token.scopes.includes(scope));
}

function isUnavailable(error: unknown): boolean {
  // A non-200 from the JWKS endpoint surfaces as the base JOSEError; every
  // verdict about the token itself carries a specific subclass.
  return (
    error instanceof errors.JWKSTimeout ||
    error instanceof errors.JWKSInvalid ||
    (error instanceof errors.JOSEError && error.code === "ERR_JOSE_GENERIC")
  );
}

export function toAccessToken(payload: JWTPayload): AccessToken | null {
  const clientId =
    typeof payload.azp === "string"
      ? payload.azp
      : typeof payload.client_id === "string"
        ? payload.client_id
        : null;
  if (!payload.sub || !clientId || payload.exp === undefined) return null;
  return {
    userId: payload.sub,
    clientId,
    tenant: typeof payload.tenant === "string" ? payload.tenant : null,
    scopes:
      typeof payload.scope === "string"
        ? payload.scope.split(" ").filter(Boolean)
        : [],
    sessionId: typeof payload.sid === "string" ? payload.sid : null,
    machine: payload.sub === clientId,
    expiresAt: payload.exp,
    claims: payload,
  };
}

export function createVerifier(options: VerifierOptions): Verifier {
  const endpoints = issuerEndpoints(options.issuer);
  const keys = options.keys ?? createRemoteJWKSet(new URL(endpoints.jwks));

  async function verify(token: string): Promise<AccessToken | null> {
    if (!looksLikeJwt(token)) return null;
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: endpoints.issuer,
        audience: options.audience,
        typ: "at+jwt",
        clockTolerance: options.clockTolerance ?? 5,
      }));
    } catch (error) {
      if (isUnavailable(error)) {
        throw new AuthUnavailableError("Signing keys could not be fetched", {
          cause: error,
        });
      }
      if (error instanceof errors.JOSEError) return null;
      throw error;
    }
    return toAccessToken(payload);
  }

  return {
    verify,
    verifyRequest(request) {
      const token = bearerToken(request.headers.get("authorization"));
      return token ? verify(token) : Promise.resolve(null);
    },
  };
}
