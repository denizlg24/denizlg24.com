import { describe, expect, test } from "bun:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import { createMcpApp } from "./app";
import type { McpConfig } from "./config";
import { ServiceTokens, type Upstream } from "./upstream";

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

const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
  crv: "Ed25519",
});
const keys = createLocalJWKSet({
  keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "EdDSA" }],
});

function sign(payload: JWTPayload, audience = config.resource) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ: "at+jwt" })
    .setIssuer(config.issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

const upstream: Upstream = {
  cloud: async () => new Response(null, { status: 200 }),
  web: async () => new Response(null, { status: 200 }),
};
const app = createMcpApp({ config, upstream, keys });

function mcpRequest(token: string | null, body: unknown) {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("healthz", () => {
  test("carries the service-client verdict alongside liveness", async () => {
    const tokens = new ServiceTokens(
      config,
      Object.assign(
        async () => Response.json({ access_token: "t", expires_in: 300 }),
        { preconnect: fetch.preconnect },
      ),
    );
    const response = await createMcpApp({
      config,
      upstream,
      tokens,
      keys,
    }).request("/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      service: "mcp",
      upstream: "ok",
    });
  });
});

describe("protected resource metadata", () => {
  test("is served at the path-inserted and root well-known URLs", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.resource).toBe(config.resource);
      expect(body.authorization_servers).toEqual([config.issuer]);
    }
  });
});

describe("icons", () => {
  test("serves the favicon and app icon from public/", async () => {
    const files: [string, string][] = [
      ["/favicon.ico", "image/x-icon"],
      ["/icon.png", "image/png"],
    ];
    for (const [path, type] of files) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(type);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=86400",
      );
    }
  });

  test("advertises the app icon on initialize", async () => {
    const token = await sign({ sub: "u1", azp: "claude", superuser: true });
    const response = await mcpRequest(token, {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      '"src":"https://mcp.denizlg24.com/icon.png"',
    );
  });
});

describe("/mcp", () => {
  test("challenges an anonymous request toward the metadata", async () => {
    const response = await mcpRequest(null, {});
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.denizlg24.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  test("refuses a token minted for another resource", async () => {
    const token = await sign(
      { sub: "u1", azp: "claude", superuser: true },
      "https://api.denizlg24.com",
    );
    const response = await mcpRequest(token, {});
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
  });

  test("refuses a user token without the superuser claim", async () => {
    const response = await mcpRequest(
      await sign({ sub: "u1", azp: "claude" }),
      {},
    );
    expect(response.status).toBe(401);
  });

  test("serves tools to a superuser token and runs whoami", async () => {
    const token = await sign({
      sub: "7f1a0c52-0000-4000-8000-000000000001",
      azp: "claude",
      scope: "openid offline_access",
      superuser: true,
    });
    const listed = await mcpRequest(token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain('"whoami"');

    const called = await mcpRequest(token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    });
    expect(called.status).toBe(200);
    const text = await called.text();
    expect(text).toContain("7f1a0c52-0000-4000-8000-000000000001");
    expect(text).toContain('\\"cloud\\":{\\"status\\":200');
  });
});

describe("ServiceTokens", () => {
  test("requests one client_credentials token per resource and reuses it", async () => {
    const calls: { url: string; body: string; auth: string | null }[] = [];
    const fetchStub: typeof fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          body: String(init?.body),
          auth: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({
          access_token: `at-${calls.length}`,
          expires_in: 300,
        });
      },
      { preconnect: fetch.preconnect },
    );
    const tokens = new ServiceTokens(config, fetchStub);

    const [a, b] = await Promise.all([
      tokens.forResource(config.cloud.resource),
      tokens.forResource(config.cloud.resource),
    ]);
    expect(a).toBe("at-1");
    expect(b).toBe("at-1");
    expect(await tokens.forResource(config.cloud.resource)).toBe("at-1");
    expect(await tokens.forResource(config.web.resource)).toBe("at-2");

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(`${config.issuer}/oauth2/token`);
    expect(calls[0]?.auth).toBe(`Basic ${btoa("svc:secret")}`);
    const body = new URLSearchParams(calls[0]?.body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("resource")).toBe(config.cloud.resource);
    expect(body.get("scope")).toBe("superuser");
  });

  test("reports a missing service client instead of calling out", async () => {
    const tokens = new ServiceTokens({ ...config, service: null });
    await expect(tokens.forResource(config.cloud.resource)).rejects.toThrow(
      "MCP_OAUTH_CLIENT_ID",
    );
  });
});
