import { describe, expect, it } from "bun:test";
import type { SandboxConfig } from "./config";
import { runCommandSchema, SANDBOX_PROTOCOL_VERSION } from "./contract";
import { createApp } from "./index";

const TOKEN = "test-token-that-is-at-least-thirty-two-characters";
const config: SandboxConfig = {
  apiToken: TOKEN,
  dockerBinary: "docker",
  dockerHost: "unix:///run/user/1001/docker.sock",
  image: "runtime:test",
  runtime: "runsc",
  publicUrl: "https://sandbox.example.test",
  memoryMb: 1024,
  cpus: 2,
  pids: 256,
  maxSessions: 8,
  requireRootless: true,
};

const runtime = {
  health: async () => undefined,
  createSession: async () => ({
    id: "a".repeat(32),
    created: true,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
  stopSession: async () => true,
  runCommand: async () => ({
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
    timedOut: false,
  }),
  writeFiles: async () => ["/workspace/main.ts"],
  listFiles: async () => ["main.ts"],
  readFile: async () => Buffer.from("console.log('ok')"),
  portUrl: () => "https://sandbox.example.test/preview",
  verifyPortToken: () => true,
  proxyPort: async () => new Response("preview"),
};
const app = createApp(config, runtime);

const call = (path: string, init: RequestInit = {}) =>
  app.fetch(
    new Request(`http://sandbox.test${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    }),
  );

describe("the sandbox API", () => {
  it("reports protocol health without authentication", async () => {
    const response = await app.fetch(
      new Request("http://sandbox.test/healthz"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      protocolVersion: SANDBOX_PROTOCOL_VERSION,
    });
  });

  it("authenticates every control route", async () => {
    const response = await app.fetch(
      new Request("http://sandbox.test/sessions", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  it("creates a session and runs commands", async () => {
    const created = await call("/sessions", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conversation" }),
    });
    expect(created.status).toBe(200);

    const command = await call(`/sessions/${"a".repeat(32)}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: "bun", args: ["run", "main.ts"] }),
    });
    expect(await command.json()).toEqual({
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      timedOut: false,
    });
  });

  it("validates requests before the runtime sees them", async () => {
    const response = await call(`/sessions/${"a".repeat(32)}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: "" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("the wire contract", () => {
  it("bounds a command's runtime", () => {
    expect(runCommandSchema.parse({ command: "ls" }).timeoutMs).toBe(120_000);
    expect(
      runCommandSchema.safeParse({ command: "ls", timeoutMs: 999_999 }).success,
    ).toBe(false);
  });
});
