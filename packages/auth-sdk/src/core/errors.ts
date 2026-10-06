/** The token endpoint answered, and refused. */
export class OAuthGrantError extends Error {
  override readonly name = "OAuthGrantError";

  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly description?: string,
  ) {
    super(
      `Token endpoint refused the grant (${status}${code ? ` ${code}` : ""}${
        description ? `: ${description}` : ""
      })`,
    );
  }

  /**
   * The grant itself is dead — revoked, expired, replayed, or the client is
   * gone. Only this signs anyone out; an outage never should.
   */
  get grantInvalid(): boolean {
    return this.code === "invalid_grant" || this.code === "invalid_client";
  }
}

/**
 * The authorization server could not be asked: network failure, timeout, a
 * proxy error page. Answer 5xx, never 401 — a client treats 401 as "sign in
 * again", which is the wrong reaction to an outage.
 */
export class AuthUnavailableError extends Error {
  override readonly name = "AuthUnavailableError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** The authorization response that came back is not one this client sent for. */
export class AuthorizationResponseError extends Error {
  override readonly name = "AuthorizationResponseError";

  constructor(
    readonly reason:
      | "state_mismatch"
      | "issuer_mismatch"
      | "missing_code"
      | "no_pending_sign_in"
      | "access_denied"
      | "authorization_error",
    readonly oauthError?: string,
    readonly description?: string,
  ) {
    super(description ? `${reason}: ${description}` : reason);
  }
}
