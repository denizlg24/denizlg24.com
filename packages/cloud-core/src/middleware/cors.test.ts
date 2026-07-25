import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { cors } from "./cors";

const TRUSTED = "https://cloud.example";

function createApp(handler: () => Response) {
  const app = new Hono();
  app.use(
    "/api/*",
    cors({
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
      credentials: true,
      exposeHeaders: ["Location", "Upload-Offset"],
      maxAge: 600,
      origin: (origin) => (origin === TRUSTED ? origin : undefined),
    }),
  );
  app.get("/api/thing", handler);
  return app;
}

describe("cors", () => {
  it("hands back the handler's own Response instance", async () => {
    // hono/cors rebuilds the response as `new Response(res.body, res)`, which
    // reads a Bun.file() body into a stream and costs the sendfile() path.
    const original = new Response(new Blob(["payload"]), {
      headers: { "Content-Length": "7", "Content-Type": "application/pdf" },
    });
    const app = createApp(() => original);

    const response = await app.request("/api/thing", {
      headers: { Origin: TRUSTED },
    });

    expect(response).toBe(original);
    expect(response.headers.get("Content-Length")).toBe("7");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("adds the cross-origin headers for a trusted origin", async () => {
    const app = createApp(() => new Response("ok"));

    const response = await app.request("/api/thing", {
      headers: { Origin: TRUSTED },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(TRUSTED);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
      "Location,Upload-Offset",
    );
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("keeps a Vary the route already set", async () => {
    const app = createApp(
      () => new Response("ok", { headers: { Vary: "Accept-Encoding" } }),
    );

    const response = await app.request("/api/thing", {
      headers: { Origin: TRUSTED },
    });

    expect(response.headers.get("Vary")).toBe("Accept-Encoding, Origin");
  });

  it("omits the allow-origin header for an untrusted origin", async () => {
    const app = createApp(() => new Response("ok"));

    const response = await app.request("/api/thing", {
      headers: { Origin: "https://attacker.example" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers a preflight without running the route", async () => {
    let handlerCalls = 0;
    const app = createApp(() => {
      handlerCalls += 1;
      return new Response("ok");
    });

    const response = await app.request("/api/thing", {
      method: "OPTIONS",
      headers: {
        Origin: TRUSTED,
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(handlerCalls).toBe(0);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(TRUSTED);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,HEAD,POST,OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type,Authorization",
    );
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
  });

  it("echoes the requested headers when none are configured", async () => {
    const app = new Hono();
    app.use(
      "/api/*",
      cors({
        allowHeaders: [],
        allowMethods: ["GET"],
        credentials: false,
        exposeHeaders: [],
        maxAge: 60,
        origin: (origin) => (origin === TRUSTED ? origin : undefined),
      }),
    );
    app.get("/api/thing", () => new Response("ok"));

    const response = await app.request("/api/thing", {
      method: "OPTIONS",
      headers: {
        Origin: TRUSTED,
        "Access-Control-Request-Headers": "X-API-Key",
      },
    });

    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "X-API-Key",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
