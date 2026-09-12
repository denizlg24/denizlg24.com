import {
  CLOUD_AUTH_ISSUER,
  DEV_CLOUD_AUTH_ISSUER,
  DEV_OAUTH_RESOURCES,
  OAUTH_RESOURCES,
} from "@repo/schemas/cloud";

export interface McpConfig {
  port: number;
  /** This server's RFC 8707 identifier — the URL clients connect to. */
  resource: string;
  issuer: string;
  cloud: { url: string; resource: string };
  web: { url: string; resource: string };
  /**
   * The service client this server authenticates to the cloud API and web as.
   * Absent until one is created on auth.denizlg24.com/clients; the server
   * still authenticates MCP clients without it, and upstream calls report
   * that it is missing.
   */
  service: { clientId: string; clientSecret: string } | null;
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const production = env.NODE_ENV === "production";
  const resources = production ? OAUTH_RESOURCES : DEV_OAUTH_RESOURCES;
  const clientId = env.MCP_OAUTH_CLIENT_ID;
  const clientSecret = env.MCP_OAUTH_CLIENT_SECRET;
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error(
      "MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET must be set together",
    );
  }
  const cloudResource = env.OAUTH_RESOURCE_API ?? resources.api;
  const webResource = env.OAUTH_RESOURCE_WEB ?? resources.web;
  return {
    port: Number(env.PORT ?? 3009),
    resource: env.OAUTH_RESOURCE_MCP ?? resources.mcp,
    issuer: trimSlash(
      env.CLOUD_AUTH_ISSUER ??
        (production ? CLOUD_AUTH_ISSUER : DEV_CLOUD_AUTH_ISSUER),
    ),
    cloud: {
      url: trimSlash(env.CLOUD_API_URL ?? cloudResource),
      resource: cloudResource,
    },
    web: {
      url: trimSlash(env.WEB_URL ?? webResource),
      resource: webResource,
    },
    service: clientId && clientSecret ? { clientId, clientSecret } : null,
  };
}
