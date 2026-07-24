import { afterAll, describe, expect, it } from "bun:test";

import { Hono } from "hono";

import { toolsProxyRoutes } from "./tools-proxy";

interface SeenRequest {
  path: string;
  method: string;
  headers: Headers;
  body: string;
}

const seen: SeenRequest[] = [];

const upstream = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url);
    seen.push({
      path: url.pathname + url.search,
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    });
    if (url.pathname === "/redirect") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/login?next=%2F" },
      });
    }
    return new Response("tool-body", {
      headers: {
        "Content-Type": "text/html",
        "Set-Cookie": "adminer_sid=abc; path=/",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "frame-ancestors 'none'",
      },
    });
  },
});

const upstreamUrl = `http://127.0.0.1:${upstream.port}`;

afterAll(() => {
  upstream.stop(true);
});

function buildApp(config: Parameters<typeof toolsProxyRoutes>[0]) {
  const app = new Hono();
  app.route("/api/ops/tools", toolsProxyRoutes(config));
  return app;
}

describe("ops tools proxy", () => {
  it("forwards the sub-path, method, and body to the upstream tool", async () => {
    const app = buildApp({ adminerUrl: upstreamUrl });
    const response = await app.request(
      "http://api.local/api/ops/tools/adminer/db?server=postgres&db=denizcloud",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "auth[driver]=pgsql",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("tool-body");
    const request = seen.at(-1);
    expect(request?.path).toBe("/db?server=postgres&db=denizcloud");
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe("auth[driver]=pgsql");
    expect(request?.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("strips frame-blocking headers and keeps cookies", async () => {
    const app = buildApp({ adminerUrl: upstreamUrl });
    const response = await app.request(
      "http://api.local/api/ops/tools/adminer",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([
      "adminer_sid=abc; path=/",
    ]);
    expect(seen.at(-1)?.path).toBe("/");
  });

  it("rewrites absolute-path redirects onto the proxy prefix", async () => {
    const app = buildApp({ mongoExpressUrl: upstreamUrl });
    const response = await app.request(
      "http://api.local/api/ops/tools/mongo-express/redirect",
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/api/ops/tools/mongo-express/login?next=%2F",
    );
  });

  it("returns 503 for unconfigured tools", async () => {
    const app = buildApp({ adminerUrl: upstreamUrl });
    const response = await app.request(
      "http://api.local/api/ops/tools/mongo-express",
    );
    expect(response.status).toBe(503);
  });

  it("returns 502 when the tool is unreachable", async () => {
    const app = buildApp({ adminerUrl: "http://127.0.0.1:1" });
    const response = await app.request(
      "http://api.local/api/ops/tools/adminer",
    );
    expect(response.status).toBe(502);
  });
});
