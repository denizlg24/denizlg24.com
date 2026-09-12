import { createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import {
  createRequestAuthenticator,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
} from "./auth";
import type { McpConfig } from "./config";
import { mcpServerFactory } from "./server";
import { createUpstream, type Upstream } from "./upstream";

export interface McpAppOptions {
  config: McpConfig;
  upstream?: Upstream;
  /** Test seam for signing keys; production reads the issuer's JWKS. */
  keys?: JWTVerifyGetKey;
}

export function createMcpApp(options: McpAppOptions) {
  const { config } = options;
  const upstream = options.upstream ?? createUpstream(config);
  const authenticate = createRequestAuthenticator(config, options.keys);
  const resource = new URL(config.resource);
  const handler = createMcpHandler(
    mcpServerFactory(upstream, resource.origin),
    {
      onerror: (error) => console.error("MCP request failed", error),
    },
  );
  const endpoint = resource.pathname;
  const metadataPath = new URL(protectedResourceMetadataUrl(config.resource))
    .pathname;

  const app = new Hono();

  app.get("/healthz", (context) =>
    context.json({ status: "ok", service: "mcp" }, 200, {
      "Cache-Control": "no-store",
    }),
  );

  // Resolves to apps/mcp/public from src/ and to /app/public from the bundle.
  const publicDir = new URL("../public/", import.meta.url);
  for (const name of ["favicon.ico", "icon.png"]) {
    app.get(`/${name}`, async (context) => {
      const file = Bun.file(new URL(name, publicDir));
      if (!(await file.exists())) return context.notFound();
      return new Response(file, {
        headers: { "Cache-Control": "public, max-age=86400" },
      });
    });
  }

  // Both the path-inserted form RFC 9728 defines and the bare root, which
  // older clients probe first.
  const metadata = protectedResourceMetadata(config);
  for (const path of new Set([
    metadataPath,
    "/.well-known/oauth-protected-resource",
  ])) {
    app.get(path, (context) =>
      context.json(metadata, 200, { "Access-Control-Allow-Origin": "*" }),
    );
  }

  app.all(endpoint, async (context) => {
    const outcome = await authenticate(context.req.raw);
    if (!outcome.ok) return outcome.response;
    return handler.fetch(context.req.raw, { authInfo: outcome.authInfo });
  });

  return app;
}
