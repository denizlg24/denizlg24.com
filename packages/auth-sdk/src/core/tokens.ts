import { AuthUnavailableError, OAuthGrantError } from "./errors.js";
import { DEFAULT_SCOPE, issuerEndpoints } from "./issuer.js";
import { codeChallenge } from "./pkce.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TokenSet {
  accessToken: string;
  /** Absent when the grant carries no `offline_access`, or for client credentials. */
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope?: string;
  idToken?: string;
}

export interface TokenClientOptions {
  issuer?: string;
  clientId: string;
  /** Confidential clients only. A public client (SPA, native) has none. */
  clientSecret?: string;
  /** The resource (audience) every token is requested for. */
  resource: string;
  fetch?: FetchLike;
  /** Per request. Default 10 s. */
  timeoutMs?: number;
}

export interface AuthorizationRequest {
  redirectUri: string;
  state: string;
  verifier: string;
  scope?: string;
  /** e.g. `login` to force the credential step, `consent` to re-ask. */
  prompt?: string;
  /** Pre-fills the username field on the sign-in screen. */
  loginHint?: string;
}

export interface TokenClient {
  readonly issuer: string;
  readonly clientId: string;
  readonly resource: string;
  authorizationUrl(request: AuthorizationRequest): Promise<string>;
  exchangeCode(input: {
    code: string;
    verifier: string;
    redirectUri: string;
  }): Promise<TokenSet>;
  /**
   * Concurrent calls with the same refresh token share one request: a page
   * load fires several requests that all find the same expired token, and the
   * server only tolerates a replayed refresh for a few seconds.
   */
  refresh(refreshToken: string): Promise<TokenSet>;
  clientCredentials(scope?: string): Promise<TokenSet>;
  /** Best effort; resolves even when the server cannot be reached. */
  revoke(refreshToken: string): Promise<void>;
}

const REFRESH_SHARE_MS = 5_000;

function stringField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

export function parseTokenResponse(body: unknown, now = Date.now()): TokenSet {
  if (typeof body !== "object" || body === null) {
    throw new AuthUnavailableError("Token endpoint answered with no JSON body");
  }
  const record = body as Record<string, unknown>;
  const accessToken = stringField(record, "access_token");
  const expiresIn = record.expires_in;
  if (!accessToken || typeof expiresIn !== "number") {
    throw new AuthUnavailableError(
      "Token endpoint answered without access_token or expires_in",
    );
  }
  return {
    accessToken,
    refreshToken: stringField(record, "refresh_token"),
    expiresAt: now + expiresIn * 1000,
    scope: stringField(record, "scope"),
    idToken: stringField(record, "id_token"),
  };
}

function basicAuth(clientId: string, clientSecret: string): string {
  const pair = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
  return `Basic ${btoa(pair)}`;
}

export function createTokenClient(options: TokenClientOptions): TokenClient {
  const endpoints = issuerEndpoints(options.issuer);
  const fetcher: FetchLike =
    options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const refreshing = new Map<string, Promise<TokenSet>>();

  function authHeaders(params: URLSearchParams): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };
    if (options.clientSecret) {
      headers.authorization = basicAuth(options.clientId, options.clientSecret);
    } else {
      params.set("client_id", options.clientId);
    }
    return headers;
  }

  async function post(url: string, params: URLSearchParams): Promise<Response> {
    const headers = authHeaders(params);
    try {
      return await fetcher(url, {
        method: "POST",
        headers,
        body: params.toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new AuthUnavailableError(`Could not reach ${url}`, { cause });
    }
  }

  async function tokenRequest(
    params: Record<string, string>,
  ): Promise<TokenSet> {
    const response = await post(endpoints.token, new URLSearchParams(params));
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const record =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : {};
      const code = stringField(record, "error");
      // A gateway error page is not the authorization server's verdict.
      if (response.status >= 500 || code === undefined) {
        throw new AuthUnavailableError(
          `Token endpoint answered HTTP ${response.status}`,
        );
      }
      throw new OAuthGrantError(
        response.status,
        code,
        stringField(record, "error_description"),
      );
    }
    return parseTokenResponse(body);
  }

  return {
    issuer: endpoints.issuer,
    clientId: options.clientId,
    resource: options.resource,

    async authorizationUrl(request) {
      const url = new URL(endpoints.authorization);
      const params = new URLSearchParams({
        response_type: "code",
        client_id: options.clientId,
        redirect_uri: request.redirectUri,
        scope: request.scope ?? DEFAULT_SCOPE,
        resource: options.resource,
        state: request.state,
        code_challenge: await codeChallenge(request.verifier),
        code_challenge_method: "S256",
      });
      if (request.prompt) params.set("prompt", request.prompt);
      if (request.loginHint) params.set("login_hint", request.loginHint);
      url.search = params.toString();
      return url.toString();
    },

    exchangeCode(input) {
      return tokenRequest({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.verifier,
        redirect_uri: input.redirectUri,
        resource: options.resource,
      });
    },

    refresh(refreshToken) {
      const pending = refreshing.get(refreshToken);
      if (pending) return pending;
      const request = tokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        resource: options.resource,
      }).then(
        (result) => {
          setTimeout(() => refreshing.delete(refreshToken), REFRESH_SHARE_MS);
          return result;
        },
        (error: unknown) => {
          refreshing.delete(refreshToken);
          throw error;
        },
      );
      refreshing.set(refreshToken, request);
      return request;
    },

    clientCredentials(scope) {
      if (!options.clientSecret) {
        return Promise.reject(
          new Error("client_credentials needs a confidential client"),
        );
      }
      const params: Record<string, string> = {
        grant_type: "client_credentials",
        resource: options.resource,
      };
      if (scope) params.scope = scope;
      return tokenRequest(params);
    },

    async revoke(refreshToken) {
      try {
        await post(
          endpoints.revocation,
          new URLSearchParams({
            token: refreshToken,
            token_type_hint: "refresh_token",
          }),
        );
      } catch {
        // Revocation is hygiene; the local session is dropped either way.
      }
    },
  };
}
