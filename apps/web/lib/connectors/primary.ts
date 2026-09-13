import {
  DEV_OAUTH_RESOURCES,
  OAUTH_RESOURCES,
  OAUTH_SUPERUSER_SCOPE,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { siteResourceConfig } from "@/lib/cloud-oauth";

const production = process.env.NODE_ENV === "production";

// Machine tokens live five minutes; renewing a little early keeps a tool call
// that starts near expiry from reaching the server with a token that lapses
// in flight.
const EXPIRY_MARGIN_MS = 30_000;
const TOKEN_TIMEOUT_MS = 15_000;

export interface PrimaryConnectorConfig {
  /** Where the MCP server is reached. */
  url: string;
  /** Its RFC 8707 identifier — the audience of the tokens it accepts. */
  resource: string;
  issuer: string;
  credentials: { clientId: string; clientSecret: string } | null;
}

/**
 * Read per call rather than at import: `next build` loads route modules
 * without the runtime env, and a missing client must surface as an
 * unconfigured connector, not a failed build.
 */
export function primaryConnectorConfig(): PrimaryConnectorConfig {
  // Our MCP server's resource identifier is the URL clients connect to, so a
  // connector URL override carries the resource with it. OAUTH_RESOURCE_MCP is
  // what the local API and MCP read, and is only the fallback here so pointing
  // a dev web at the production server leaves those alone.
  const url = process.env.MCP_CONNECTOR_URL?.replace(/\/$/, "");
  const resource =
    process.env.MCP_CONNECTOR_RESOURCE ??
    url ??
    process.env.OAUTH_RESOURCE_MCP ??
    (production ? OAUTH_RESOURCES.mcp : DEV_OAUTH_RESOURCES.mcp);
  const clientId = process.env.WEB_MCP_OAUTH_CLIENT_ID;
  const clientSecret = process.env.WEB_MCP_OAUTH_CLIENT_SECRET;
  return {
    url: url ?? resource.replace(/\/$/, ""),
    resource,
    // Its own override so a dev web can use the production MCP server
    // without moving its own sign-in off the local issuer.
    issuer: (
      process.env.MCP_CONNECTOR_ISSUER ?? siteResourceConfig().issuer
    ).replace(/\/$/, ""),
    credentials: clientId && clientSecret ? { clientId, clientSecret } : null,
  };
}

export type ConnectorFetch = typeof fetch;

export class PrimaryConnectorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrimaryConnectorUnavailableError";
  }
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
});

let cached: { token: string; expiresAt: number; key: string } | null = null;
let pending: Promise<string> | null = null;

async function requestToken(config: PrimaryConnectorConfig): Promise<string> {
  if (!config.credentials) {
    throw new PrimaryConnectorUnavailableError(
      "WEB_MCP_OAUTH_CLIENT_ID and WEB_MCP_OAUTH_CLIENT_SECRET are not set",
    );
  }
  const { clientId, clientSecret } = config.credentials;
  const basic = btoa(
    `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
  );
  const response = await fetch(`${config.issuer}/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      resource: config.resource,
      scope: OAUTH_SUPERUSER_SCOPE,
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new PrimaryConnectorUnavailableError(
      `Token request for ${config.resource} failed (HTTP ${response.status}) ${detail.slice(0, 200)}`.trim(),
    );
  }
  const body = tokenResponseSchema.parse(await response.json());
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 300) * 1000,
    key: `${config.issuer}|${config.resource}|${clientId}`,
  };
  return body.access_token;
}

/**
 * A token for the primary MCP server, as this site's service client — the
 * superuser who created it. Single-flight, so a turn opening several tool
 * calls at once asks the issuer once.
 */
export async function primaryConnectorToken(
  config: PrimaryConnectorConfig = primaryConnectorConfig(),
): Promise<string> {
  const key = `${config.issuer}|${config.resource}|${config.credentials?.clientId ?? ""}`;
  if (
    cached &&
    cached.key === key &&
    cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()
  ) {
    return cached.token;
  }
  if (pending) return pending;
  pending = requestToken(config).finally(() => {
    pending = null;
  });
  return pending;
}

/**
 * Fetch for the primary connector's transport: every request carries a live
 * token, so a turn that outlives one token never reaches the server with a
 * dead one.
 */
export function primaryConnectorFetch(
  config: PrimaryConnectorConfig = primaryConnectorConfig(),
): ConnectorFetch {
  const authorized = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const token = await primaryConnectorToken(config);
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  return Object.assign(authorized, { preconnect: fetch.preconnect });
}
