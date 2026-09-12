import {
  AUTH_APP_URL,
  DEV_AUTH_APP_URL,
  DEV_OAUTH_RESOURCES,
  OAUTH_RESOURCES,
} from "@repo/schemas/cloud";
import type { CloudOAuthConfig } from "./better-auth";

/**
 * Every identifier here is also compiled into, or configured on, the party at
 * the other end — the auth app, web and the MCP server — so an override on one
 * side alone produces tokens nobody accepts.
 *
 * Which set applies is read off the API's own public URL, not NODE_ENV:
 * `bun build` folds `process.env.NODE_ENV` into a constant, and the image is
 * built without it, so a NODE_ENV test here is always false in production —
 * which once seeded every resource as localhost and sent sign-in to
 * localhost:3008.
 */
export function oauthConfigFromEnv(
  baseURL: string,
  env: Record<string, string | undefined> = process.env,
): CloudOAuthConfig {
  const host = new URL(baseURL).hostname;
  const production = host !== "localhost" && host !== "127.0.0.1";
  const resources = production ? OAUTH_RESOURCES : DEV_OAUTH_RESOURCES;
  return {
    authAppUrl:
      env.AUTH_APP_URL ?? (production ? AUTH_APP_URL : DEV_AUTH_APP_URL),
    resources: {
      api: env.OAUTH_RESOURCE_API ?? resources.api,
      web: env.OAUTH_RESOURCE_WEB ?? resources.web,
      mcp: env.OAUTH_RESOURCE_MCP ?? resources.mcp,
    },
  };
}
