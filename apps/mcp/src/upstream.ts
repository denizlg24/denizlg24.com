import { OAUTH_SUPERUSER_SCOPE } from "@repo/schemas/cloud";
import { z } from "zod";
import type { McpConfig } from "./config";

// Machine tokens live five minutes; refreshing a little early keeps a call
// that starts near expiry from reaching the API with a token that lapses in
// flight.
const EXPIRY_MARGIN_MS = 30_000;
const UPSTREAM_TIMEOUT_MS = 30_000;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
});

export class UpstreamUnavailableError extends Error {}

/**
 * Tokens this server holds as itself — the service client acting as the
 * superuser who created it — one per upstream resource. Never the token an
 * MCP client presented: that one is bound to this server's audience and no
 * upstream accepts it.
 */
export class ServiceTokens {
  readonly #cached = new Map<string, { token: string; expiresAt: number }>();
  readonly #pending = new Map<string, Promise<string>>();

  constructor(
    private readonly config: McpConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async forResource(resource: string): Promise<string> {
    const cached = this.#cached.get(resource);
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
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

  async #request(resource: string): Promise<string> {
    const service = this.config.service;
    if (!service) {
      throw new UpstreamUnavailableError(
        "MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET are not configured",
      );
    }
    const basic = btoa(
      `${encodeURIComponent(service.clientId)}:${encodeURIComponent(service.clientSecret)}`,
    );
    const response = await this.fetchImpl(
      `${this.config.issuer}/oauth2/token`,
      {
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
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new UpstreamUnavailableError(
        `Token request for ${resource} failed (HTTP ${response.status}) ${detail.slice(0, 200)}`,
      );
    }
    const body = tokenResponseSchema.parse(await response.json());
    this.#cached.set(resource, {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 300) * 1000,
    });
    return body.access_token;
  }
}

export interface Upstream {
  /** Calls the cloud API (Forge, storage, ops, projects) as a superuser. */
  cloud: (path: string, init?: RequestInit) => Promise<Response>;
  /** Calls denizlg24.com's admin API as its admin. */
  web: (path: string, init?: RequestInit) => Promise<Response>;
}

export function createUpstream(
  config: McpConfig,
  tokens: ServiceTokens = new ServiceTokens(config),
  fetchImpl: typeof fetch = fetch,
): Upstream {
  const call =
    (target: McpConfig["cloud"]) =>
    async (path: string, init: RequestInit = {}) => {
      const token = await tokens.forResource(target.resource);
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      return fetchImpl(new URL(path, `${target.url}/`), {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    };
  return { cloud: call(config.cloud), web: call(config.web) };
}
