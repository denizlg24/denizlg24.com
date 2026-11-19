import type { Database } from "@repo/cloud-core";
import { authOauthClient, authUser } from "@repo/cloud-core/db/schema";
import type {
  SignInLinkDelivery,
  SignInLinkDestination,
  SignInLinkIssued,
} from "@repo/schemas/cloud";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

import { type CloudAuth, isActiveSuperuser } from "./better-auth";
import {
  isAllowedSignInLinkTarget,
  type OwnerIssuance,
  runAsOwnerIssuance,
  SIGN_IN_LINK_EXPIRES_IN_SECONDS,
  type SignInLinkRefusal,
  type SignInLinkTargets,
  signInLinkCallback,
  signInLinkRefusal,
} from "./sign-in-link";

/**
 * Origins a link may land on besides the auth app and the authorize endpoint:
 * the trusted origins (wildcards excluded) and the redirect origins of OAuth
 * clients the owner created. A dynamically registered client has no creator,
 * and a tenant admin's client has a creator who is not a superuser, so
 * neither can add an origin.
 */
export async function signInLinkDestinations(
  db: Database,
  trustedOrigins: readonly string[],
): Promise<SignInLinkDestination[]> {
  const destinations = new Map<string, string>();
  for (const origin of trustedOrigins) {
    if (origin.includes("*")) continue;
    destinations.set(origin, new URL(origin).hostname);
  }
  const clients = await db
    .select({
      name: authOauthClient.name,
      redirectUris: authOauthClient.redirectUris,
      userId: authOauthClient.userId,
    })
    .from(authOauthClient)
    .where(
      and(
        isNotNull(authOauthClient.userId),
        or(
          isNull(authOauthClient.disabled),
          eq(authOauthClient.disabled, false),
        ),
      ),
    );
  const owners = new Map<string, boolean>();
  for (const client of clients) {
    if (!client.userId) continue;
    let owned = owners.get(client.userId);
    if (owned === undefined) {
      owned = await isActiveSuperuser(db, client.userId);
      owners.set(client.userId, owned);
    }
    if (!owned) continue;
    for (const redirect of client.redirectUris) {
      let url: URL;
      try {
        url = new URL(redirect);
      } catch {
        continue;
      }
      if (url.protocol !== "https:") continue;
      destinations.set(url.origin, client.name ?? url.hostname);
    }
  }
  return [...destinations]
    .map(([origin, name]) => ({ origin, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function signInLinkTargets(
  db: Database,
  options: {
    authAppUrl: string;
    apiUrl: string;
    trustedOrigins: readonly string[];
  },
): Promise<SignInLinkTargets> {
  const destinations = await signInLinkDestinations(db, options.trustedOrigins);
  return {
    authAppUrl: options.authAppUrl,
    apiUrl: options.apiUrl,
    origins: new Set(destinations.map((destination) => destination.origin)),
  };
}

export class SignInLinkRefusedError extends Error {
  override readonly name = "SignInLinkRefusedError";
  constructor(
    readonly code: SignInLinkRefusal | "USER_NOT_FOUND" | "INVALID_RETURN_TO",
  ) {
    super(code);
  }
}

/**
 * The owner sending a cloud account a link. `confirmEmail` is the owner
 * vouching for an address that was never confirmed by mail; without it such
 * an account is refused (see `signInLinkRefusal`). Public accounts are their
 * own to manage and ask for links themselves.
 */
export async function issueSignInLink(
  options: {
    auth: CloudAuth;
    db: Database;
    targets: SignInLinkTargets;
    headers: Headers;
  },
  input: {
    userId: string;
    delivery: SignInLinkDelivery;
    returnTo?: string;
    confirmEmail: boolean;
  },
): Promise<SignInLinkIssued & { emailConfirmed: boolean }> {
  const account = await options.db.query.authUser.findFirst({
    columns: {
      banned: true,
      email: true,
      emailVerified: true,
      name: true,
      realm: true,
      status: true,
      twoFactorEnabled: true,
    },
    where: eq(authUser.id, input.userId),
  });
  if (account?.realm !== "cloud") {
    throw new SignInLinkRefusedError("USER_NOT_FOUND");
  }
  if (
    input.returnTo !== undefined &&
    !isAllowedSignInLinkTarget(input.returnTo, options.targets)
  ) {
    throw new SignInLinkRefusedError("INVALID_RETURN_TO");
  }
  const confirming =
    !account.emailVerified &&
    input.confirmEmail &&
    signInLinkRefusal({ ...account, emailVerified: true }) === null;
  const refusal = signInLinkRefusal({
    ...account,
    emailVerified: account.emailVerified || confirming,
  });
  if (refusal) throw new SignInLinkRefusedError(refusal);
  if (confirming) {
    await options.db
      .update(authUser)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(authUser.id, input.userId));
  }

  const issuance: OwnerIssuance = {
    delivery: input.delivery,
    name: account.name,
  };
  const expiresAt = new Date(
    Date.now() + SIGN_IN_LINK_EXPIRES_IN_SECONDS * 1000,
  );
  await runAsOwnerIssuance(issuance, () =>
    options.auth.api.signInMagicLink({
      body: {
        email: account.email,
        callbackURL: signInLinkCallback(
          options.targets.authAppUrl,
          input.returnTo,
        ),
        errorCallbackURL: signInLinkCallback(
          options.targets.authAppUrl,
          input.returnTo,
          "error",
        ),
      },
      headers: options.headers,
    }),
  );
  return {
    delivery: input.delivery,
    email: account.email,
    expiresAt: expiresAt.toISOString(),
    emailConfirmed: confirming,
    ...(input.delivery === "copy" && issuance.url ? { url: issuance.url } : {}),
  };
}
