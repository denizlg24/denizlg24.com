import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  StoreTokenType,
  VerificationValue,
} from "@better-auth/oauth-provider";
import type { Database } from "@repo/cloud-core";
import * as schema from "@repo/cloud-core/db/schema";
import { and, eq, isNull } from "drizzle-orm";

/**
 * "Remember me" for first-party OAuth clients.
 *
 * The provider plugin rotates every refresh token on use and expires it after
 * a fixed window, with no per-grant switch for either. What it does expose is
 * the string the client holds: `formatRefreshToken` maps it to and from the
 * stored row, and `storeTokens.hash` decides what is stored. So a grant issued
 * from a remember-me session hands the client a stable *handle* naming the
 * grant's family — the authorization code every rotation of it descends from —
 * sealed with an HMAC so a database reader cannot forge one. Rotation still
 * happens in the table; `decrypt` resolves the handle to the family's live row
 * and stamps it non-expiring. The client never learns a new secret, which is
 * what makes a lost token response harmless, and nothing runs out, which is
 * what removes the window. The handle dies when the live row is revoked:
 * sign-out, an MFA reset, or the account going away.
 *
 * Only clients created through our own client management (`skipConsent`)
 * qualify. A dynamically registered MCP client keeps rotating tokens whatever
 * the session says.
 *
 * `encrypt` is called synchronously by the plugin — its result is concatenated,
 * not awaited — so everything it needs is resolved earlier in the same request
 * by the hooks that are awaited, and carried in request-scoped state.
 */

const HANDLE_PREFIX = "rm_";
// Far enough that neither Postgres nor a JS Date has an opinion about it. The
// row states what the grant is; nothing compares against this value.
const NO_EXPIRY = new Date("9999-12-31T00:00:00Z");
const TOKEN_ENDPOINT = "/api/auth/oauth2/token";
// What `decrypt` hands the plugin in place of a raw token. `hash` only honours
// it when this request's `decrypt` resolved a handle; presented by a client it
// hashes like any other string and matches nothing.
const RESOLVED = "remember-me:resolved";

interface RequestState {
  path: string;
  /** Family of the authorization code being exchanged. */
  family?: string;
  /** Whether that exchange qualifies for a handle. */
  rememberMe?: boolean;
  /** The handle a refresh presented, handed back unchanged. */
  handle?: string;
  /** The stored token that handle resolved to. */
  resolvedStoredToken?: string;
}

const requestState = new AsyncLocalStorage<RequestState>();

/** Wraps one Better Auth request so the hooks below can share what they learn. */
export function withOAuthRequestState<T>(request: Request, fn: () => T): T {
  return requestState.run({ path: new URL(request.url).pathname }, fn);
}

export function isRememberMeHandle(value: string): boolean {
  return value.startsWith(HANDLE_PREFIX);
}

/** The plugin's own at-rest form, pinned here so it is ours to depend on. */
function storedForm(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function familyMac(secret: string, family: string): string {
  return createHmac("sha256", secret)
    .update(`denizlg24-remember-me\0${family}`)
    .digest("base64url");
}

function sealHandle(secret: string, family: string): string {
  return `${HANDLE_PREFIX}${family}.${familyMac(secret, family)}`;
}

function unsealHandle(secret: string, value: string): string | null {
  if (!isRememberMeHandle(value)) return null;
  const [family, mac, ...rest] = value.slice(HANDLE_PREFIX.length).split(".");
  if (!family || !mac || rest.length > 0) return null;
  const expected = Buffer.from(familyMac(secret, family));
  const presented = Buffer.from(mac);
  return expected.length === presented.length &&
    timingSafeEqual(expected, presented)
    ? family
    : null;
}

async function qualifies(
  db: Database,
  sessionId: string | undefined,
  clientId: string,
): Promise<boolean> {
  if (!sessionId) return false;
  const [session, client] = await Promise.all([
    db.query.authSession.findFirst({
      columns: { rememberMe: true },
      where: eq(schema.authSession.id, sessionId),
    }),
    db.query.authOauthClient.findFirst({
      columns: { skipConsent: true },
      where: eq(schema.authOauthClient.clientId, clientId),
    }),
  ]);
  return session?.rememberMe === true && client?.skipConsent === true;
}

export function rememberMeGrants(options: { db: Database; secret: string }) {
  const { db, secret } = options;
  return {
    storeTokens: {
      hash: async (token: string, type: StoreTokenType): Promise<string> => {
        const state = requestState.getStore();
        if (
          type === "refresh_token" &&
          token === RESOLVED &&
          state?.resolvedStoredToken
        ) {
          return state.resolvedStoredToken;
        }
        const stored = storedForm(token);
        // The exchange hashes the code first, to find its verification row;
        // that value is also what every row of the grant carries as
        // `authorizationCodeId`.
        if (
          type === "authorization_code" &&
          state?.path === TOKEN_ENDPOINT &&
          !state.family
        ) {
          state.family = stored;
        }
        return stored;
      },
    },
    customTokenResponseFields: async (info: {
      verificationValue?: VerificationValue;
    }): Promise<Record<string, never>> => {
      const state = requestState.getStore();
      if (state && info.verificationValue) {
        state.rememberMe = await qualifies(
          db,
          info.verificationValue.sessionId,
          info.verificationValue.query.client_id,
        );
      }
      return {};
    },
    formatRefreshToken: {
      encrypt: (token: string): string => {
        const state = requestState.getStore();
        if (state?.handle) return state.handle;
        if (state?.rememberMe && state.family) {
          return sealHandle(secret, state.family);
        }
        return token;
      },
      decrypt: async (
        value: string,
      ): Promise<{ sessionId?: string; token: string }> => {
        const state = requestState.getStore();
        const family = state ? unsealHandle(secret, value) : null;
        if (!state || !family) return { token: value };
        const [row] = await db
          .update(schema.authOauthRefreshToken)
          .set({ expiresAt: NO_EXPIRY })
          .where(
            and(
              eq(schema.authOauthRefreshToken.authorizationCodeId, family),
              isNull(schema.authOauthRefreshToken.revoked),
            ),
          )
          .returning({
            token: schema.authOauthRefreshToken.token,
            sessionId: schema.authOauthRefreshToken.sessionId,
          });
        // No live row means the family was revoked. Handing the plugin the
        // handle itself matches no row, so it answers invalid_grant.
        if (!row) return { token: value };
        state.handle = value;
        state.resolvedStoredToken = row.token;
        return { token: RESOLVED, sessionId: row.sessionId ?? undefined };
      },
    },
  };
}
