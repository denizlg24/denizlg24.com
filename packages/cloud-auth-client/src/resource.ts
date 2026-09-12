import {
  OAUTH_SUPERUSER_CLAIM,
  OAUTH_SUPERUSER_SCOPE,
} from "@repo/schemas/cloud";
import {
  createRemoteJWKSet,
  errors,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";

export interface CloudAccessToken {
  subject: string;
  clientId: string;
  scopes: string[];
  sessionId: string | null;
  /** client_credentials: no user behind it, and `subject` is the client id. */
  machine: boolean;
  expiresAt: number;
  claims: JWTPayload;
}

export interface AccessTokenVerifierOptions {
  issuer: string;
  audience: string;
  /** Defaults to the issuer's published JWKS. */
  keys?: JWTVerifyGetKey;
}

export function cloudJwksUrl(issuer: string): URL {
  return new URL(`${issuer.replace(/\/$/, "")}/jwks`);
}

/**
 * Resolves to `null` for a token that is simply not acceptable — expired,
 * wrong audience, bad signature. A JWKS endpoint that cannot be reached or
 * answers garbage (a tunnel error page) is thrown instead, so a caller answers
 * 5xx rather than 401: an MCP client treats 401 as "re-authorize", which is the
 * wrong reaction to an outage.
 */
export function createAccessTokenVerifier(options: AccessTokenVerifierOptions) {
  const keys = options.keys ?? createRemoteJWKSet(cloudJwksUrl(options.issuer));
  return async (token: string): Promise<CloudAccessToken | null> => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: options.issuer,
        audience: options.audience,
        typ: "at+jwt",
      }));
    } catch (error) {
      // A non-200 from the JWKS endpoint surfaces as the base JOSEError; every
      // verdict about the token itself carries a specific subclass.
      const unavailable =
        error instanceof errors.JWKSTimeout ||
        error instanceof errors.JWKSInvalid ||
        (error instanceof errors.JOSEError &&
          error.code === "ERR_JOSE_GENERIC");
      if (error instanceof errors.JOSEError && !unavailable) return null;
      throw error;
    }
    const clientId =
      typeof payload.azp === "string"
        ? payload.azp
        : typeof payload.client_id === "string"
          ? payload.client_id
          : null;
    if (!payload.sub || !clientId || payload.exp === undefined) return null;
    return {
      subject: payload.sub,
      clientId,
      scopes:
        typeof payload.scope === "string"
          ? payload.scope.split(" ").filter(Boolean)
          : [],
      sessionId: typeof payload.sid === "string" ? payload.sid : null,
      machine: payload.sub === clientId,
      expiresAt: payload.exp,
      claims: payload,
    };
  };
}

export function isSuperuserToken(token: CloudAccessToken): boolean {
  return token.machine
    ? token.scopes.includes(OAUTH_SUPERUSER_SCOPE)
    : token.claims[OAUTH_SUPERUSER_CLAIM] === true;
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
