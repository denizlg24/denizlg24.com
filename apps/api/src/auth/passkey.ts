import { APIError } from "better-auth/api";

export interface PasskeyRelyingParty {
  /** WebAuthn rpID: the registrable domain every ceremony origin must sit under. */
  rpId: string;
  /** Origins a ceremony may run on — the auth app, nothing else. */
  origins: string[];
}

/**
 * The plugin defaults rpID to the API's own hostname, which no browser on
 * auth.denizlg24.com can use. The registrable domain (the cookie domain)
 * covers every subdomain, so a passkey registered today keeps working if
 * another app runs the ceremony on its own host later; the origin list is what
 * pins ceremonies to the auth app now.
 */
export function passkeyRelyingParty(input: {
  authAppUrl: string;
  cookieDomain?: string | undefined;
  rpId?: string | undefined;
}): PasskeyRelyingParty {
  const authOrigin = new URL(input.authAppUrl).origin;
  const cookieDomain = input.cookieDomain?.replace(/^\./, "");
  const rpId = input.rpId || cookieDomain || new URL(authOrigin).hostname;
  return { rpId, origins: [authOrigin] };
}

/**
 * A passkey sign-in answers both factors at once and skips the TOTP step, so a
 * credential that only proved possession — a security key without a PIN —
 * would be a single factor. Registration asks for user verification; this is
 * what refuses the assertion when an authenticator did not perform it.
 */
export function assertUserVerified(userVerified: boolean): void {
  if (userVerified) return;
  throw new APIError("UNAUTHORIZED", {
    code: "USER_VERIFICATION_REQUIRED",
    message: "Passkey sign-in requires user verification",
  });
}
