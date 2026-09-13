import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import { createMcpApp } from "../app";
import type { McpConfig } from "../config";
import type { ToolRegistrar } from "../server";
import type { Upstream } from "../upstream";

export const testConfig: McpConfig = {
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

async function sign(payload: JWTPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ: "at+jwt" })
    .setIssuer(testConfig.issuer)
    .setAudience(testConfig.resource)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

export interface RecordedCall {
  side: "cloud" | "web";
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

export type Responder = (call: RecordedCall) => Response | Promise<Response>;

/**
 * An upstream that records every call and answers through `respond`, which
 * defaults to `{ data: { ok: true } }`.
 */
export function recordingUpstream(respond?: Responder) {
  const calls: RecordedCall[] = [];
  const side =
    (name: "cloud" | "web", base: string): Upstream["cloud"] =>
    async (path, init = {}) => {
      const url = new URL(path, `${base}/`);
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value;
      });
      let body: string | null = null;
      if (typeof init.body === "string") {
        body = init.body;
      } else if (init.body instanceof Uint8Array) {
        body = Buffer.from(init.body).toString("utf8");
      } else if (init.body instanceof ArrayBuffer) {
        body = Buffer.from(new Uint8Array(init.body)).toString("utf8");
      } else if (init.body !== undefined && init.body !== null) {
        body = String(init.body);
      }
      const call: RecordedCall = {
        side: name,
        method: init.method ?? "GET",
        url: url.toString(),
        path: url.pathname + url.search,
        headers,
        body,
      };
      calls.push(call);
      return respond ? respond(call) : Response.json({ data: { ok: true } });
    };
  return {
    calls,
    upstream: {
      cloud: side("cloud", testConfig.cloud.url),
      web: side("web", testConfig.web.url),
    } satisfies Upstream,
  };
}

interface JsonRpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function parseRpc(response: Response): Promise<JsonRpcResponse> {
  const text = await response.text();
  if (/text\/event-stream/.test(response.headers.get("content-type") ?? "")) {
    const messages = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5)) as JsonRpcResponse);
    const last = messages.at(-1);
    if (!last)
      throw new Error(`No JSON-RPC message in stream: ${text.slice(0, 200)}`);
    return last;
  }
  return JSON.parse(text) as JsonRpcResponse;
}

/**
 * `register` narrows the catalogue to one domain's tools; without it the
 * client sees everything `registerTools` registers.
 */
export function createClient(upstream: Upstream, register?: ToolRegistrar) {
  const app = createMcpApp({ config: testConfig, upstream, keys, register });
  let nextId = 1;
  const tokenPromise = sign({ sub: "u1", azp: "claude", superuser: true });

  async function rpc(method: string, params: unknown) {
    const token = await tokenPromise;
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    if (response.status !== 200) {
      throw new Error(
        `${method} → HTTP ${response.status}: ${await response.text()}`,
      );
    }
    return parseRpc(response);
  }

  return {
    async listTools() {
      const listed = await rpc("tools/list", {});
      if (listed.error) throw new Error(listed.error.message);
      return (listed.result?.tools ?? []) as Array<{
        name: string;
        title?: string;
        description?: string;
        inputSchema: {
          type: string;
          properties?: Record<string, unknown>;
          required?: string[];
        };
        annotations?: Record<string, boolean>;
      }>;
    },
    async call(name: string, args: Record<string, unknown> = {}) {
      const called = await rpc("tools/call", { name, arguments: args });
      if (called.error) throw new Error(`${name}: ${called.error.message}`);
      return called.result as {
        content: Array<{ type: string; text: string }>;
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
      };
    },
  };
}
