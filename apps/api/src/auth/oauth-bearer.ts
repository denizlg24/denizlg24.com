import {
  bearerToken,
  createAccessTokenVerifier,
  isSuperuserToken,
  looksLikeJwt,
} from "@repo/cloud-auth-client/resource";
import {
  AuthenticationError,
  type Database,
  type SessionAuthResult,
  toSafeUser,
  users,
} from "@repo/cloud-core";
import { eq } from "drizzle-orm";
import { createLocalJWKSet, errors, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { type CloudAuth, isActiveSuperuser } from "./better-auth";

const JWKS_REFRESH_MS = 5 * 60 * 1000;

type LocalKeys = ReturnType<typeof createLocalJWKSet>;

const jwksSchema = z.object({
  keys: z.array(z.record(z.string(), z.unknown())),
});

/**
 * Verifies against the signing keys straight from Better Auth rather than the
 * public /jwks URL, which would be this process calling itself through the
 * tunnel. Reloads on a miss so a rotated key is picked up before the cache
 * would have expired on its own.
 */
function localJwks(auth: CloudAuth): JWTVerifyGetKey {
  let current: { keys: LocalKeys; loadedAt: number } | null = null;
  const load = async () => {
    const jwks = jwksSchema.parse(await auth.api.getJwks());
    current = { keys: createLocalJWKSet(jwks), loadedAt: Date.now() };
    return current.keys;
  };
  return async (header, token) => {
    const stale = !current || Date.now() - current.loadedAt > JWKS_REFRESH_MS;
    const keys = stale || !current ? await load() : current.keys;
    try {
      return await keys(header, token);
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey) || stale) throw error;
      return (await load())(header, token);
    }
  };
}

export interface OAuthBearerOptions {
  auth: CloudAuth;
  db: Database;
  issuer: string;
  /** This API's resource identifier; only tokens issued for it are accepted. */
  audience: string;
}

/**
 * Turns an access token from our own authorization server into the same
 * principal a cookie session yields. The authorization server already refused
 * everyone but active superusers at issuance; the lookup here is what makes
 * demoting or banning an account take effect before the token expires.
 *
 * A machine token names its client as `sub`; it acts as the superuser who
 * created that client, carried in the `owner` claim.
 */
export function createOAuthBearerResolver(options: OAuthBearerOptions) {
  const verify = createAccessTokenVerifier({
    issuer: options.issuer,
    audience: options.audience,
    keys: localJwks(options.auth),
  });
  return async (headers: Headers): Promise<SessionAuthResult | null> => {
    const token = bearerToken(headers.get("authorization"));
    if (!token || !looksLikeJwt(token)) return null;
    const verified = await verify(token);
    if (!verified || !isSuperuserToken(verified)) {
      throw new AuthenticationError(
        "Invalid access token",
        "INVALID_ACCESS_TOKEN",
      );
    }
    const userId = verified.machine ? verified.claims.owner : verified.subject;
    if (
      typeof userId !== "string" ||
      !(await isActiveSuperuser(options.db, userId))
    ) {
      throw new AuthenticationError(
        "Invalid access token",
        "INVALID_ACCESS_TOKEN",
      );
    }
    const legacyUser = await options.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!legacyUser) {
      throw new AuthenticationError(
        "Invalid access token",
        "INVALID_ACCESS_TOKEN",
      );
    }
    const tokenId =
      typeof verified.claims.jti === "string"
        ? verified.claims.jti
        : verified.clientId;
    return {
      sessionId: `oauth:${tokenId}`,
      user: { ...toSafeUser(legacyUser), status: "active", totpEnabled: true },
    };
  };
}
