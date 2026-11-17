import { describe, expect, test } from "bun:test";
import { createAdminClient } from "../client";
import {
  authorizeVercel,
  disconnectAiSubscription,
  disconnectGateway,
  getAiConnections,
  getAiSubscriptions,
  saveAiSubscription,
  saveGatewayConnection,
  testGatewayConnection,
} from "./ai-connections-api";

function transport() {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = createAdminClient({
    baseUrl: "https://dashboard.example/api/admin",
    headers: () => ({ Authorization: "Bearer desktop-session" }),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return Response.json({
        authorizeUrl: "https://vercel.com/oauth/authorize",
      });
    },
  });
  return { client, requests };
}

const protectedRecord = {
  issuer: "https://auth.openai.com" as const,
  subject: "test-owner",
  client_id: "oaiapp_test",
  ext_agent_host_id: "urn:uuid:809a63b3-b247-4ed3-9059-51bb28fa6367",
  id_token: "synthetic-id",
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
  token_type: "Bearer" as const,
  expires_in: 3600,
  scopes: ["chatgpt.tokens.use.direct", "resource.invoke", "offline_access"],
  saved_at: "2026-11-17T12:00:00Z",
};

describe("AI connection transport", () => {
  test("Gateway actions use the injected authenticated transport", async () => {
    const { client, requests } = transport();
    await getAiConnections(client);
    await saveGatewayConnection(client, {
      apiKey: "write-only-key",
      teamIdOrSlug: "team-one",
    });
    await testGatewayConnection(client);
    await disconnectGateway(client);
    expect(requests.map(({ url, init }) => [url, init.method])).toEqual([
      ["https://dashboard.example/api/admin/ai-connections", "GET"],
      ["https://dashboard.example/api/admin/ai-connections/gateway", "PUT"],
      [
        "https://dashboard.example/api/admin/ai-connections/gateway/test",
        "POST",
      ],
      ["https://dashboard.example/api/admin/ai-connections/gateway", "DELETE"],
    ]);
    expect(requests[0]?.init.body).toBeUndefined();
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      apiKey: "write-only-key",
      teamIdOrSlug: "team-one",
    });
    for (const { init } of requests) {
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer desktop-session",
      );
      expect(init.cache).toBe("no-store");
    }
  });

  test("Vercel browser authorization uses the configured host and optional encoded team", () => {
    const { client, requests } = transport();
    const url = authorizeVercel(client, " team & personal ");
    expect(new URL(url).searchParams.get("teamIdOrSlug")).toBe(
      "team & personal",
    );
    expect(new URL(url).origin).toBe("https://dashboard.example");
    expect(authorizeVercel(client, " ")).toBe(
      "https://dashboard.example/api/admin/ai-connections/vercel/authorize",
    );
    expect(requests).toHaveLength(0);
  });

  test("subscription credentials travel in write bodies and disconnect targets the provider", async () => {
    const { client, requests } = transport();
    await getAiSubscriptions(client);
    await saveAiSubscription(client, {
      provider: "chatgpt",
      credentials: protectedRecord,
      model: "personal-model",
    });
    await saveAiSubscription(client, {
      provider: "claude-code",
      token: "personal-token",
      model: "claude-model",
    });
    await saveAiSubscription(client, { provider: "gateway" });
    await disconnectAiSubscription(client, "chatgpt");
    await disconnectAiSubscription(client, "claude-code");
    expect(requests[0]?.init.body).toBeUndefined();
    expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
      provider: "chatgpt",
      credentials: protectedRecord,
      model: "personal-model",
    });
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual({
      provider: "claude-code",
      token: "personal-token",
      model: "claude-model",
    });
    expect(
      requests.slice(4).map(({ url, init }) => [url, init.method]),
    ).toEqual([
      [
        "https://dashboard.example/api/admin/ai-subscriptions?provider=chatgpt",
        "DELETE",
      ],
      [
        "https://dashboard.example/api/admin/ai-subscriptions?provider=claude-code",
        "DELETE",
      ],
    ]);
    expect(requests.some(({ url }) => /personal-token|sign-in/.test(url))).toBe(
      false,
    );
  });

  test("read requests forward abort signals", async () => {
    const { client, requests } = transport();
    const controller = new AbortController();
    await getAiConnections(client, { signal: controller.signal });
    await getAiSubscriptions(client, { signal: controller.signal });
    expect(
      requests.every(({ init }) => init.signal === controller.signal),
    ).toBe(true);
  });
});
