/**
 * One-time sign-in links (Better Auth's magic-link plugin). The rules that do
 * not need a database live here so they can be tested on their own; issuance
 * and the destination allow-list are in `sign-in-link-issuance.ts`.
 *
 * A link never lands anywhere directly. Its callback is always the auth app's
 * `/login`, which is a trusted origin, and the real destination rides along as
 * `returnTo`. That keeps Better Auth's `trustedOrigins` — which is also the
 * CSRF allow-list — exactly as narrow as it was, while the destination is held
 * to its own list here.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { SignInLinkDelivery } from "@repo/schemas/cloud";

export const SIGN_IN_LINK_EXPIRES_IN_SECONDS = 15 * 60;

/** Query parameter on the auth app's `/login` that says why a link landed there. */
const SIGN_IN_LINK_PARAM = "signInLink";

/**
 * `challenge`: the link proved the mailbox, the account still owes its second
 * factor. `error`: the link was expired, used, or the account is unavailable.
 */
export type SignInLinkLanding = "challenge" | "error";

const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";
const CALLBACK_PARAMS = new Set(["returnTo", SIGN_IN_LINK_PARAM]);

export interface SignInLinkAccount {
  realm: "cloud" | "public";
  status: "pending" | "active" | null;
  banned: boolean | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean | null;
}

export type SignInLinkRefusal =
  | "ACCOUNT_UNAVAILABLE"
  | "EMAIL_NOT_VERIFIED"
  | "MFA_ENROLLMENT_REQUIRED";

/**
 * Who may be sent a link. An unconfirmed address is refused outright: when the
 * plugin verifies a link for an account whose email was never confirmed, it
 * deletes every credential and session on it (Better Auth's defence against
 * an account pre-registered on someone else's address). A cloud account
 * without its mandatory second factor cannot hold a session anyway.
 */
export function signInLinkRefusal(
  account: SignInLinkAccount | null | undefined,
): SignInLinkRefusal | null {
  if (!account || account.banned === true || account.status !== "active") {
    return "ACCOUNT_UNAVAILABLE";
  }
  if (!account.emailVerified) return "EMAIL_NOT_VERIFIED";
  if (account.realm === "cloud" && account.twoFactorEnabled !== true) {
    return "MFA_ENROLLMENT_REQUIRED";
  }
  return null;
}

export interface SignInLinkTargets {
  authAppUrl: string;
  /** The API's own base URL: only its authorize endpoint is a destination. */
  apiUrl: string;
  /** Trusted origins and the redirect origins of the owner's OAuth clients. */
  origins: ReadonlySet<string>;
}

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

/** Where a signed-in link may finally send the browser. */
export function isAllowedSignInLinkTarget(
  value: string,
  targets: SignInLinkTargets,
): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  if (url.origin === new URL(targets.authAppUrl).origin) return true;
  if (url.origin === new URL(targets.apiUrl).origin) {
    return url.pathname === AUTHORIZE_PATH;
  }
  return targets.origins.has(url.origin);
}

/** The auth app's `/login`, resuming at `returnTo` once a session exists. */
export function signInLinkCallback(
  authAppUrl: string,
  returnTo?: string,
  landing?: SignInLinkLanding,
): string {
  const url = new URL("/login", authAppUrl);
  if (returnTo) url.searchParams.set("returnTo", returnTo);
  if (landing) url.searchParams.set(SIGN_IN_LINK_PARAM, landing);
  return url.toString();
}

/**
 * A callback (or error callback) a link may carry: the auth app's `/login`,
 * with nothing but an allowed `returnTo` and, on the error callback, the
 * `error` landing. Anything else is a hand-edited link.
 */
export function isAllowedSignInLinkCallback(
  value: string | undefined,
  targets: SignInLinkTargets,
  options: { errorCallback?: boolean } = {},
): boolean {
  if (!value) return false;
  const url = parseUrl(value);
  if (!url) return false;
  if (url.origin !== new URL(targets.authAppUrl).origin) return false;
  if (url.pathname !== "/login" || url.hash) return false;
  for (const key of url.searchParams.keys()) {
    if (!CALLBACK_PARAMS.has(key)) return false;
  }
  if (url.searchParams.getAll("returnTo").length > 1) return false;
  const landing = url.searchParams.getAll(SIGN_IN_LINK_PARAM);
  if (landing.length > (options.errorCallback ? 1 : 0)) return false;
  if (landing.length === 1 && landing[0] !== "error") return false;
  const returnTo = url.searchParams.get("returnTo");
  return returnTo === null || isAllowedSignInLinkTarget(returnTo, targets);
}

/**
 * Where the API sends a verified link that cannot finish on its own: back to
 * the auth app's `/login`, keeping the destination the link was issued for.
 * Only a `returnTo` from the auth app's own `/login` is carried over; the auth
 * app re-checks it before following it.
 */
export function signInLinkLandingUrl(
  authAppUrl: string,
  callbackURL: string | undefined,
  landing: SignInLinkLanding,
): string {
  const callback = callbackURL ? parseUrl(callbackURL) : null;
  const returnTo =
    callback &&
    callback.origin === new URL(authAppUrl).origin &&
    callback.pathname === "/login"
      ? (callback.searchParams.get("returnTo") ?? undefined)
      : undefined;
  return signInLinkCallback(authAppUrl, returnTo, landing);
}

/**
 * Set while the owner issues a link, so the plugin's `sendMagicLink` knows the
 * request is the owner's (deliver now and report failures, or hand the link
 * back) rather than an anonymous one (deliver in the background, to eligible
 * accounts only). Nothing a browser sends can set it.
 */
export interface OwnerIssuance {
  delivery: SignInLinkDelivery;
  name: string;
  url?: string;
}

const ownerIssuance = new AsyncLocalStorage<OwnerIssuance>();

export function currentOwnerIssuance(): OwnerIssuance | undefined {
  return ownerIssuance.getStore();
}

export function runAsOwnerIssuance<T>(
  issuance: OwnerIssuance,
  run: () => Promise<T>,
): Promise<T> {
  return ownerIssuance.run(issuance, run);
}
