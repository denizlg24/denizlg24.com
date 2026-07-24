import type { AuthVariables } from "@repo/cloud-core";
import { Hono } from "hono";

export interface OpsToolsConfig {
  adminerUrl?: string;
  mongoExpressUrl?: string;
}

export const OPS_TOOLS_MOUNT_PATH = "/api/ops/tools";

const STRIPPED_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
]);

// Frame-blocking headers are removed so the admin app can iframe the tools;
// the proxy itself sits behind the superuser session gate.
const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "content-security-policy",
  "keep-alive",
  "transfer-encoding",
  "x-frame-options",
]);

function rewriteLocation(
  location: string,
  upstreamBase: URL,
  mountPrefix: string,
): string {
  if (location.startsWith(upstreamBase.origin)) {
    return mountPrefix + location.slice(upstreamBase.origin.length);
  }
  if (location.startsWith("/") && !location.startsWith(mountPrefix)) {
    return mountPrefix + location;
  }
  return location;
}

function toolUnavailable(): Response {
  return Response.json(
    {
      error: {
        code: "TOOL_UNAVAILABLE",
        message: "This tool is not configured",
      },
    },
    { status: 503 },
  );
}

async function forward(
  request: Request,
  upstreamBase: URL,
  mountPrefix: string,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const subPath = requestUrl.pathname.startsWith(mountPrefix)
    ? requestUrl.pathname.slice(mountPrefix.length) || "/"
    : "/";
  const target = new URL(
    upstreamBase.origin +
      upstreamBase.pathname.replace(/\/$/, "") +
      subPath +
      requestUrl.search,
  );

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (hasBody) {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      {
        error: { code: "TOOL_UNREACHABLE", message: "The tool did not reply" },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(lower) || lower === "set-cookie") {
      continue;
    }
    if (lower === "location") {
      responseHeaders.set(
        "location",
        rewriteLocation(value, upstreamBase, mountPrefix),
      );
      continue;
    }
    responseHeaders.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export function toolsProxyRoutes(config: OpsToolsConfig) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const tools: [string, string | undefined][] = [
    ["adminer", config.adminerUrl],
    ["mongo-express", config.mongoExpressUrl],
  ];

  for (const [tool, url] of tools) {
    const mountPrefix = `${OPS_TOOLS_MOUNT_PATH}/${tool}`;
    const upstreamBase = url ? new URL(url) : null;
    const handler = (context: { req: { raw: Request } }) => {
      if (!upstreamBase) return toolUnavailable();
      return forward(context.req.raw, upstreamBase, mountPrefix);
    };
    app.all(`/${tool}`, handler);
    app.all(`/${tool}/*`, handler);
  }

  return app;
}
