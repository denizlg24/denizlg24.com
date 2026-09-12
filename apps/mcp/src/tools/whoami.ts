import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Upstream } from "../upstream";

const reachSchema = z.object({
  status: z.number().nullable(),
  error: z.string().nullable(),
});

const whoamiSchema = z.object({
  subject: z.string().nullable(),
  clientId: z.string().nullable(),
  scopes: z.array(z.string()),
  expiresAt: z.number().nullable(),
  cloud: reachSchema,
  web: reachSchema,
});

async function reach(
  call: () => Promise<Response>,
): Promise<z.infer<typeof reachSchema>> {
  try {
    const response = await call();
    return { status: response.status, error: null };
  } catch (error) {
    return {
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Proves the whole chain in one call: who the MCP client authenticated as, and
 * whether this server's own credential still opens both upstreams.
 */
export function registerWhoami(server: McpServer, upstream: Upstream) {
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Returns the authenticated principal and whether the cloud API and denizlg24.com admin API accept this server's credentials.",
      outputSchema: whoamiSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (ctx) => {
      const authInfo = ctx.http?.authInfo;
      const [cloud, web] = await Promise.all([
        reach(() => upstream.cloud("/api/me")),
        reach(() => upstream.web("/api/admin/session")),
      ]);
      const subject = authInfo?.extra?.subject;
      const output = {
        subject: typeof subject === "string" ? subject : null,
        clientId: authInfo?.clientId ?? null,
        scopes: authInfo?.scopes ?? [],
        expiresAt: authInfo?.expiresAt ?? null,
        cloud,
        web,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );
}
