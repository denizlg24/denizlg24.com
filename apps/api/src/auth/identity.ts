import type { Database } from "@repo/cloud-core";
import { authUser } from "@repo/cloud-core/db/schema";
import type { AuthRealm } from "@repo/schemas/cloud";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

import {
  type CloudAuth,
  isActiveSuperuser,
  isCloudAuthTrustedOrigin,
} from "./better-auth";

export interface Identity {
  userId: string;
  realm: AuthRealm;
  twoFactorEnabled: boolean;
  superuser: boolean;
}

export interface IdentityVariables {
  identity: Identity;
}

function refusal(code: string, message: string) {
  return { error: { code, message } } as const;
}

/**
 * A deniz account signed in through the cookie — cloud or public. The cloud
 * API's own `authenticate` admits only cloud accounts, which is right for the
 * cloud and wrong for the routes every account needs (its connected apps, the
 * tenants it manages). Bearer tokens are not sessions here: nothing a client
 * holds may manage an account.
 */
export function requireIdentity(
  options: {
    auth: CloudAuth;
    db: Database;
    trustedOrigins?: readonly string[];
  },
  requirements: { twoFactor?: boolean } = {},
) {
  return createMiddleware<{ Variables: IdentityVariables }>(
    async (context, next) => {
      // The session cookie is SameSite=Lax on the whole cookie domain, so any
      // *.denizlg24.com page — a Forge preview included — sends it with a
      // plain-text POST that never triggers a preflight. A mutation has to
      // come from one of the apps that is meant to make it.
      if (!["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
        const origin = context.req.header("origin");
        if (
          !origin ||
          !isCloudAuthTrustedOrigin(origin, options.trustedOrigins)
        ) {
          return context.json(refusal("FORBIDDEN", "Untrusted origin"), 403);
        }
      }
      const session = await options.auth.api.getSession({
        headers: context.req.raw.headers,
      });
      if (!session) {
        return context.json(
          refusal("UNAUTHORIZED", "Authentication required"),
          401,
        );
      }
      const account = await options.db.query.authUser.findFirst({
        columns: {
          banned: true,
          banExpires: true,
          realm: true,
          status: true,
          twoFactorEnabled: true,
        },
        where: eq(authUser.id, session.user.id),
      });
      const banned =
        account?.banned === true &&
        (!account.banExpires || account.banExpires.getTime() > Date.now());
      if (!account || account.status !== "active" || banned) {
        return context.json(
          refusal("FORBIDDEN", "This account is not active"),
          403,
        );
      }
      const twoFactorEnabled = account.twoFactorEnabled === true;
      if (requirements.twoFactor && !twoFactorEnabled) {
        return context.json(
          refusal(
            "MFA_ENROLLMENT_REQUIRED",
            "Turn on two-factor authentication to manage apps",
          ),
          403,
        );
      }
      context.set("identity", {
        userId: session.user.id,
        realm: account.realm,
        twoFactorEnabled,
        superuser: await isActiveSuperuser(options.db, session.user.id),
      });
      return next();
    },
  );
}
