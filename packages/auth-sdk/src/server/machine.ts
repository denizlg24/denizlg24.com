import { createTokenClient, type FetchLike } from "../core/tokens.js";

export interface MachineTokenOptions {
  issuer?: string;
  clientId: string;
  clientSecret: string;
  /** The resource the token is for — another service's audience. */
  resource: string;
  scope?: string;
  fetch?: FetchLike;
  /** Refresh this long before expiry. Default 60 s. */
  marginSeconds?: number;
}

/**
 * A service-to-service token (client_credentials), cached until shortly
 * before it expires. One in-flight request is shared by every caller.
 */
export function createMachineTokenSource(options: MachineTokenOptions): {
  getToken(): Promise<string>;
  invalidate(): void;
} {
  const client = createTokenClient(options);
  const marginMs = (options.marginSeconds ?? 60) * 1000;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  return {
    getToken() {
      if (cached && cached.expiresAt - marginMs > Date.now()) {
        return Promise.resolve(cached.token);
      }
      pending ??= client
        .clientCredentials(options.scope)
        .then((set) => {
          cached = { token: set.accessToken, expiresAt: set.expiresAt };
          return set.accessToken;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    /** After a 401 from the resource: the next call fetches a fresh token. */
    invalidate() {
      cached = null;
    },
  };
}
