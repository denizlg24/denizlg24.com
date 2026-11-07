import { OAUTH_SUPERUSER_SCOPE } from "@repo/schemas/cloud";
import { z } from "zod";
import type { RunnerConfig } from "./config";
import type { FetchLike } from "./http";

// Machine tokens live five minutes; refreshing early keeps a request that
// starts near expiry from landing with a token that lapses in flight.
const EXPIRY_MARGIN_MS = 30_000;
const TOKEN_TIMEOUT_MS = 30_000;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
});

export class TokenError extends Error {}

/**
 * client_credentials tokens for the `agent-runner` service client, one per
 * resource (web and the cloud API), cached until shortly before expiry. The
 * same exchange `apps/mcp` makes for its upstreams.
 */
export class ServiceTokens {
  readonly #cached = new Map<string, { token: string; expiresAt: number }>();
  readonly #pending = new Map<string, Promise<string>>();

  constructor(
    private readonly oauth: RunnerConfig["oauth"],
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async forResource(resource: string): Promise<string> {
    const cached = this.#cached.get(resource);
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > this.now()) {
      return cached.token;
    }
    const pending = this.#pending.get(resource);
    if (pending) return pending;
    const request = this.#request(resource).finally(() =>
      this.#pending.delete(resource),
    );
    this.#pending.set(resource, request);
    return request;
  }

  /** A 401 upstream means the cached token is no good, whatever its expiry says. */
  invalidate(resource: string): void {
    this.#cached.delete(resource);
  }

  async #request(resource: string): Promise<string> {
    const basic = btoa(
      `${encodeURIComponent(this.oauth.clientId)}:${encodeURIComponent(this.oauth.clientSecret)}`,
    );
    const response = await this.fetchImpl(`${this.oauth.issuer}/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        resource,
        scope: OAUTH_SUPERUSER_SCOPE,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new TokenError(
        `Token request for ${resource} failed (HTTP ${response.status}) ${detail.slice(0, 200)}`,
      );
    }
    const body = tokenResponseSchema.parse(await response.json());
    this.#cached.set(resource, {
      token: body.access_token,
      expiresAt: this.now() + (body.expires_in ?? 300) * 1000,
    });
    return body.access_token;
  }
}

/** A bearer-authenticated JSON call that retries once on a 401 with a fresh token. */
export async function authorizedFetch(
  tokens: ServiceTokens,
  resource: string,
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const token = await tokens.forResource(resource);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetchImpl(url, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (response.status !== 401 || attempt > 0) return response;
    tokens.invalidate(resource);
  }
}
