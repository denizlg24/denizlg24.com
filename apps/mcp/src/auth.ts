import type { AuthInfo } from "@modelcontextprotocol/server";
import {
  bearerToken,
  type CloudAccessToken,
  createAccessTokenVerifier,
  isSuperuserToken,
} from "@repo/cloud-auth-client/resource";
import type { JWTVerifyGetKey } from "jose";
import type { McpConfig } from "./config";

export const SCOPES_SUPPORTED = ["openid", "offline_access"] as const;

/**
 * RFC 9728 inserts the resource's path after the well-known segment, so a
 * resource at `/mcp` publishes at `/.well-known/oauth-protected-resource/mcp`.
 */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

export function protectedResourceMetadata(config: McpConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...SCOPES_SUPPORTED],
    bearer_methods_supported: ["header"],
    resource_name: "denizlg24",
  };
}

function quoted(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The challenge MCP clients start discovery from. */
export function unauthorized(
  config: McpConfig,
  error?: { code: string; description: string },
): Response {
  const params = [
    `resource_metadata=${quoted(protectedResourceMetadataUrl(config.resource))}`,
    `scope=${quoted(SCOPES_SUPPORTED.join(" "))}`,
    ...(error
      ? [
          `error=${quoted(error.code)}`,
          `error_description=${quoted(error.description)}`,
        ]
      : []),
  ];
  return new Response(null, {
    status: 401,
    headers: { "WWW-Authenticate": `Bearer ${params.join(", ")}` },
  });
}

export type AuthOutcome =
  | { ok: true; authInfo: AuthInfo; token: CloudAccessToken }
  | { ok: false; response: Response };

export function createRequestAuthenticator(
  config: McpConfig,
  keys?: JWTVerifyGetKey,
) {
  const verify = createAccessTokenVerifier({
    issuer: config.issuer,
    audience: config.resource,
    keys,
  });
  return async (request: Request): Promise<AuthOutcome> => {
    const raw = bearerToken(request.headers.get("authorization"));
    if (!raw) return { ok: false, response: unauthorized(config) };
    let token: CloudAccessToken | null;
    try {
      token = await verify(raw);
    } catch (error) {
      console.error("Access token verification unavailable", error);
      return {
        ok: false,
        response: new Response(null, {
          status: 503,
          headers: { "Retry-After": "5" },
        }),
      };
    }
    if (!token || !isSuperuserToken(token)) {
      return {
        ok: false,
        response: unauthorized(config, {
          code: "invalid_token",
          description: "The access token is invalid or expired",
        }),
      };
    }
    return {
      ok: true,
      token,
      authInfo: {
        token: raw,
        clientId: token.clientId,
        scopes: token.scopes,
        expiresAt: token.expiresAt,
        resource: new URL(config.resource),
        extra: { subject: token.subject, sessionId: token.sessionId },
      },
    };
  };
}
