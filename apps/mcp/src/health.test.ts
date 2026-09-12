import { describe, expect, test } from "bun:test";
import type { McpConfig } from "./config";
import { createHealthReporter } from "./health";
import { ServiceTokens } from "./upstream";

const config: McpConfig = {
  port: 0,
  resource: "https://mcp.denizlg24.com/mcp",
  issuer: "https://api.denizlg24.com/api/auth",
  cloud: {
    url: "https://api.denizlg24.com",
    resource: "https://api.denizlg24.com",
  },
  web: { url: "https://denizlg24.com", resource: "https://denizlg24.com" },
  service: { clientId: "svc", clientSecret: "secret" },
};

function issuer(status: number) {
  let calls = 0;
  const fetchImpl: typeof fetch = Object.assign(
    async () => {
      calls += 1;
      return status === 200
        ? Response.json({ access_token: "t", expires_in: 300 })
        : new Response("nope", { status });
    },
    { preconnect: fetch.preconnect },
  );
  return { fetchImpl, calls: () => calls };
}

describe("healthz", () => {
  test("reports ok once the service client has minted a token", async () => {
    const api = issuer(200);
    const report = createHealthReporter(
      config,
      new ServiceTokens(config, api.fetchImpl),
    );
    expect(await report()).toEqual({
      status: "ok",
      service: "mcp",
      upstream: "ok",
    });
    expect(api.calls()).toBe(1);
  });
  test("a refused grant is degraded and is not retried within the hold", async () => {
    const api = issuer(401);
    let clock = 0;
    const report = createHealthReporter(
      config,
      new ServiceTokens(config, api.fetchImpl),
      () => clock,
    );
    const first = await Promise.all([report(), report(), report()]);
    expect(first.every((r) => r.upstream === "unavailable")).toBe(true);
    expect(api.calls()).toBe(1);
    clock = 59_000;
    await report();
    expect(api.calls()).toBe(1);
    clock = 61_000;
    await report();
    expect(api.calls()).toBe(2);
  });
  test("a missing service client is degraded without touching the issuer", async () => {
    const api = issuer(200);
    const report = createHealthReporter(
      { ...config, service: null },
      new ServiceTokens({ ...config, service: null }, api.fetchImpl),
    );
    expect((await report()).upstream).toBe("unconfigured");
    expect(api.calls()).toBe(0);
  });
});
