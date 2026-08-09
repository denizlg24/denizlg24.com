import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";

import { ResourceAgentClient } from "./resource-agent";

const SECRET = "correct horse battery staple";
const NODE_ID = "forge";
const NOW = 1_786_284_000_000;
const KEY = Buffer.from(
  createHash("sha256").update(SECRET).digest("hex"),
  "hex",
);

function sign(message: string): string {
  return createHmac("sha256", KEY).update(message).digest("hex");
}

function responseBody() {
  const unsigned = {
    version: 1,
    nodeId: NODE_ID,
    status: "ok",
    timestamp: Math.floor(NOW / 1_000),
    system: {
      uptime: 123,
      load_avg: [0.1, 0.2, 0.3],
      cpu_usage_percent: 8.5,
      memory: { total: 1000, used: 400, free: 600 },
      disk: { total: 2000, used: 500, free: 1500 },
    },
    services: [{ name: "forge-agent", status: "active" }],
    signature: "",
  };
  return { ...unsigned, signature: sign(JSON.stringify(unsigned)) };
}

function signedResponse(unsigned: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      ...unsigned,
      signature: sign(JSON.stringify(unsigned)),
    }),
    { headers: { "content-type": "application/json" } },
  );
}

function clientFor(response: () => Response, now = NOW) {
  return new ResourceAgentClient({
    baseUrl: "https://forge-server.denizlg24.com",
    nodeId: NODE_ID,
    secret: SECRET,
    now: () => now,
    fetchImplementation: (async () => response()) as unknown as typeof fetch,
  });
}

describe("ResourceAgentClient", () => {
  test("authenticates the request and verifies the signed response", async () => {
    let seen: Request | null = null;
    const client = new ResourceAgentClient({
      baseUrl: "https://forge-server.denizlg24.com/",
      nodeId: NODE_ID,
      secret: SECRET,
      now: () => NOW,
      fetchImplementation: (async (input, init) => {
        seen = new Request(input, init);
        return Response.json(responseBody());
      }) as typeof fetch,
    });

    const snapshot = await client.health();
    expect(snapshot.nodeId).toBe(NODE_ID);
    expect((seen as unknown as Request).url).toBe(
      "https://forge-server.denizlg24.com/resource/health",
    );
    const timestamp = String(Math.floor(NOW / 1_000));
    expect((seen as unknown as Request).headers.get("X-Signature")).toBe(
      sign(`${NODE_ID}${timestamp}`),
    );
  });

  test("rejects a response whose payload signature was forged", async () => {
    const client = new ResourceAgentClient({
      baseUrl: "https://forge-server.denizlg24.com",
      nodeId: NODE_ID,
      secret: SECRET,
      now: () => NOW,
      fetchImplementation: (async () =>
        Response.json({
          ...responseBody(),
          signature: "0".repeat(64),
        })) as unknown as typeof fetch,
    });
    await expect(client.health()).rejects.toThrow("signature is invalid");
  });

  test("verifies reordered payloads before stripping unknown fields", async () => {
    const standard = responseBody();
    const unsigned = {
      signature: "",
      extra: { future: true },
      services: standard.services,
      system: standard.system,
      timestamp: standard.timestamp,
      status: standard.status,
      nodeId: standard.nodeId,
      version: standard.version,
    };
    const snapshot = await clientFor(() => signedResponse(unsigned)).health();
    expect(snapshot.nodeId).toBe(NODE_ID);
    expect("extra" in snapshot).toBe(false);
  });

  test("rejects a stale response", async () => {
    const body = responseBody();
    const unsigned = {
      ...body,
      timestamp: body.timestamp - 61,
      signature: "",
    };
    await expect(
      clientFor(() => signedResponse(unsigned)).health(),
    ).rejects.toThrow("stale response");
  });

  test("rejects a response for another node", async () => {
    const body = responseBody();
    const unsigned = { ...body, nodeId: "other", signature: "" };
    await expect(
      clientFor(() => signedResponse(unsigned)).health(),
    ).rejects.toThrow("wrong node ID");
  });

  test("rejects a non-success response", async () => {
    await expect(
      clientFor(() => new Response("unavailable", { status: 503 })).health(),
    ).rejects.toThrow("returned 503");
  });
});
