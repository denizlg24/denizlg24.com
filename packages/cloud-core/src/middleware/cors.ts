import type { MiddlewareHandler } from "hono";

export interface CorsOptions {
  /** Request headers a preflight may advertise; empty echoes the request. */
  allowHeaders: readonly string[];
  allowMethods: readonly string[];
  credentials: boolean;
  /** Response headers a cross-origin reader is allowed to see. */
  exposeHeaders: readonly string[];
  /** Preflight cache lifetime in seconds. */
  maxAge: number;
  /** Returns the origin to echo, or undefined to omit the allow header. */
  origin: (origin: string) => string | undefined;
}

/**
 * hono/cors reads `c.res` before calling next(). That instantiates Hono's
 * placeholder response, so when the route hands back its own Response the
 * `set res` accessor rebuilds it as `new Response(res.body, res)`. Reading
 * `.body` turns a `Bun.file()` blob into a ReadableStream: Bun loses the
 * sendfile() path, switches the response to chunked encoding and pumps the file
 * through userspace with no backpressure, so a client slower than the disk
 * makes the process buffer the whole file and get OOM-killed. Applying the
 * headers to the finished response instead leaves the file body untouched.
 */
export function cors(options: CorsOptions): MiddlewareHandler {
  const exposeHeaders = options.exposeHeaders.join(",");
  return async (context, next) => {
    const allowOrigin = options.origin(context.req.header("Origin") ?? "");
    if (context.req.method === "OPTIONS") {
      const headers = new Headers({
        "Access-Control-Allow-Methods": options.allowMethods.join(","),
        "Access-Control-Max-Age": String(options.maxAge),
        Vary: "Origin, Access-Control-Request-Headers",
      });
      const allowHeaders = options.allowHeaders.length
        ? options.allowHeaders.join(",")
        : context.req.header("Access-Control-Request-Headers");
      if (allowHeaders) {
        headers.set("Access-Control-Allow-Headers", allowHeaders);
      }
      applyShared(headers, allowOrigin, options.credentials, exposeHeaders);
      return new Response(null, { headers, status: 204 });
    }
    await next();
    // Mutating `context.res.headers` edits the response in place.
    // `context.header()` would rebuild it and lose the file body.
    const headers = context.res.headers;
    applyShared(headers, allowOrigin, options.credentials, exposeHeaders);
    addVaryOrigin(headers);
  };
}

function addVaryOrigin(headers: Headers): void {
  const vary = headers.get("Vary");
  if (!vary) {
    headers.set("Vary", "Origin");
    return;
  }
  const listed = vary
    .split(",")
    .some((value) => value.trim().toLowerCase() === "origin");
  if (!listed) {
    headers.append("Vary", "Origin");
  }
}

function applyShared(
  headers: Headers,
  allowOrigin: string | undefined,
  credentials: boolean,
  exposeHeaders: string,
): void {
  if (allowOrigin) {
    headers.set("Access-Control-Allow-Origin", allowOrigin);
  }
  if (credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  if (exposeHeaders) {
    headers.set("Access-Control-Expose-Headers", exposeHeaders);
  }
}
