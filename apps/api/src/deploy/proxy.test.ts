import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { requireAgentToken } from "./agent-auth";
import { DeployAgentProxy, DeployAgentUnavailableError } from "./proxy";

const TOKEN = "a".repeat(48);

describe("requireAgentToken", () => {
  const app = new Hono();
  app.use("*", requireAgentToken(TOKEN));
  app.get("/ok", (context) => context.json({ ok: true }));

  test("accepts the configured token", async () => {
    const response = await app.request("/ok", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  test("refuses a missing header", async () => {
    const response = await app.request("/ok");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "AGENT_UNAUTHORIZED",
        message: "A valid agent token is required",
      },
    });
  });

  test("refuses a token of the wrong length without throwing", async () => {
    const response = await app.request("/ok", {
      headers: { authorization: "Bearer short" },
    });
    expect(response.status).toBe(401);
  });

  test("refuses a same-length token that does not match", async () => {
    const response = await app.request("/ok", {
      headers: { authorization: `Bearer ${"b".repeat(48)}` },
    });
    expect(response.status).toBe(401);
  });
});

describe("DeployAgentProxy", () => {
  function proxy(handler: (request: Request) => Promise<Response>) {
    const stub = ((input: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(input as string, init))) as typeof fetch;
    return new DeployAgentProxy({
      baseUrl: "http://forge:4010/",
      token: TOKEN,
      fetchImplementation: stub,
    });
  }

  test("presents the agent token and normalises the base URL", async () => {
    let seen: Request | null = null;
    const client = proxy(async (request) => {
      seen = request;
      return Response.json({ deployments: [] });
    });
    await client.json("/deployments");
    expect(seen).not.toBeNull();
    expect((seen as unknown as Request).url).toBe(
      "http://forge:4010/deployments",
    );
    expect((seen as unknown as Request).headers.get("authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  test("a stream hands back the upstream body untouched", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: one\n\n"));
        controller.close();
      },
    });
    const client = proxy(
      async () =>
        new Response(body, {
          headers: {
            "content-type": "text/event-stream",
            "content-length": "11",
            "transfer-encoding": "chunked",
          },
        }),
    );
    const response = await client.stream("/deployments/x/logs");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    // Hop-by-hop headers describe the upstream connection, not this one. A
    // forwarded content-length truncates a stream whose length is unknown.
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("transfer-encoding")).toBeNull();
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(await response.text()).toBe("data: one\n\n");
  });

  test("an unreachable agent surfaces as its own error", async () => {
    const client = proxy(async () => {
      throw new TypeError("connect ECONNREFUSED");
    });
    await expect(client.json("/deployments")).rejects.toBeInstanceOf(
      DeployAgentUnavailableError,
    );
  });

  test("a long operation can override the question-sized timeout", async () => {
    const fetchImplementation = ((
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(Response.json({ ok: true })),
          15,
        );
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(init.signal?.reason);
          },
          { once: true },
        );
      })) as typeof fetch;
    const client = new DeployAgentProxy({
      baseUrl: "http://forge:4010",
      token: TOKEN,
      timeoutMs: 1,
      fetchImplementation,
    });

    await expect(client.json("/gc", { timeoutMs: 100 })).resolves.toMatchObject(
      {
        status: 200,
        body: { ok: true },
      },
    );
  });
});
