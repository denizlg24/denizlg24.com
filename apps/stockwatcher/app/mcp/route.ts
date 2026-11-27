import { appOrigin } from "@/lib/auth";
import { mcpHandler } from "@/lib/mcp/server";
import { verifyToken } from "@/lib/mcp/tokens";

const windowMs = 60_000;
const perWindow = 120;
const recent = new Map<string, number[]>();

/** Per token, per container: enough to stop a runaway agent loop. */
function allowed(tokenId: string) {
  const now = Date.now();
  const hits = (recent.get(tokenId) ?? []).filter((at) => now - at < windowMs);
  if (hits.length >= perWindow) {
    recent.set(tokenId, hits);
    return false;
  }
  hits.push(now);
  recent.set(tokenId, hits);
  return true;
}

const problem = (status: number, error: string, headers?: HeadersInit) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

async function handle(request: Request) {
  const identity = await verifyToken(request.headers.get("authorization"));
  if (!identity)
    return problem(
      401,
      "Create an access token under Account → MCP and send it as a Bearer token.",
      { "WWW-Authenticate": 'Bearer realm="stockwatcher"' },
    );
  if (!allowed(identity.tokenId))
    return problem(429, "Too many requests; slow down.", {
      "Retry-After": "60",
    });
  return mcpHandler(identity.user, identity.scope, appOrigin(request)).fetch(
    request,
    {
      authInfo: {
        token: identity.tokenId,
        clientId: identity.tokenId,
        scopes: [identity.scope],
      },
    },
  );
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
