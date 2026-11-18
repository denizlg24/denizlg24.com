import { describe, expect, test } from "bun:test";
import type {
  AiProvidersResponse,
  AiSubscriptionsResponse,
  LlmModelsResponse,
} from "@repo/schemas";
import { createAdminClient } from "../client";
import {
  getAgentModelCatalog,
  reconcileAgentModel,
  supportedAgentTools,
  unsupportedAgentTools,
} from "./provider-models";

const gateway: LlmModelsResponse = {
  models: [
    {
      id: "example/gateway-model",
      name: "Gateway model",
      creator: "example",
      tags: ["tool-use"],
    },
  ],
  stale: false,
  fetchedAt: "2026-11-17T12:00:00Z",
};

function fixture() {
  const status: AiSubscriptionsResponse = {
    activeProvider: "gateway",
    chatgpt: { configured: true, model: "account-model", hostId: "test-host" },
    claude: { configured: true, model: "claude-haiku-5-5" },
  };
  const providers: AiProvidersResponse = {
    activeProvider: "gateway",
    providers: [
      {
        provider: "gateway",
        connected: true,
        defaultModel: null,
        models: gateway.models,
        stale: false,
      },
      {
        provider: "claude-code",
        connected: true,
        defaultModel: "claude-code/claude-haiku-5-5",
        stale: false,
        models: [
          {
            id: "claude-code/claude-opus-5-5",
            name: "Opus 5.5",
            creator: "Claude plan",
            tags: ["tool-use", "reasoning"],
          },
          {
            id: "claude-code/claude-haiku-5-5",
            name: "Haiku 5.5",
            creator: "Claude plan",
            tags: ["tool-use"],
          },
        ],
      },
      {
        provider: "chatgpt",
        connected: true,
        defaultModel: "chatgpt/account-model",
        stale: false,
        models: [
          {
            id: "chatgpt/account-model",
            name: "Account model",
            creator: "ChatGPT plan",
            tags: ["tool-use", "web-search"],
          },
        ],
      },
    ],
  };
  const paths: string[] = [];
  const client = createAdminClient({
    baseUrl: "https://dashboard.example/api/admin",
    headers: () => ({ Authorization: "Bearer desktop-session" }),
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname.split("/").at(-1)!;
      paths.push(path);
      return Response.json(
        path === "ai-subscriptions"
          ? status
          : path === "providers"
            ? providers
            : gateway,
      );
    },
  });
  return { status, providers, paths, client };
}

describe("agent provider model selection", () => {
  test("switching providers lands on each provider's saved model", async () => {
    const { status, client } = fixture();
    let current: string | null = "example/gateway-model";
    for (const [provider, expected] of [
      ["gateway", "example/gateway-model"],
      ["chatgpt", "chatgpt/account-model"],
      ["claude-code", "claude-code/claude-haiku-5-5"],
      ["gateway", "example/gateway-model"],
    ] as const) {
      status.activeProvider = provider;
      const result = await getAgentModelCatalog(client);
      current = reconcileAgentModel(
        current,
        "example/gateway-model",
        result.models,
        result.defaultModel,
      );
      expect(current).toBe(expected);
    }
  });

  test("lists every model the Claude account offers", async () => {
    const { status, client } = fixture();
    status.activeProvider = "claude-code";
    const result = await getAgentModelCatalog(client);
    expect(result.models.map((model) => model.id)).toEqual([
      "claude-code/claude-opus-5-5",
      "claude-code/claude-haiku-5-5",
    ]);
    expect(
      reconcileAgentModel(
        "claude-code/claude-opus-5-5",
        null,
        result.models,
        result.defaultModel,
      ),
    ).toBe("claude-code/claude-opus-5-5");
  });

  test("keeps the saved model when listing fails", async () => {
    const { status, providers, client } = fixture();
    status.activeProvider = "claude-code";
    const claude = providers.providers[1]!;
    claude.models = [];
    claude.error = "Could not list Claude models";
    const result = await getAgentModelCatalog(client);
    expect(result.models.map((model) => model.id)).toEqual([
      "claude-code/claude-haiku-5-5",
    ]);
    expect(result.stale).toBe(true);
  });

  test("disconnected subscriptions fail without falling back to Gateway", async () => {
    const { status, paths, client } = fixture();
    status.activeProvider = "chatgpt";
    status.chatgpt.configured = false;
    await expect(getAgentModelCatalog(client)).rejects.toThrow("Reconnect");
    expect(paths).toEqual(["ai-subscriptions"]);
  });
});

describe("agent tool support", () => {
  const tools = { webSearch: true, webFetch: true, thinkLonger: true };

  test("Gateway models keep every tool", () => {
    expect(
      supportedAgentTools(
        tools,
        unsupportedAgentTools("example/gateway-model", gateway.models),
      ),
    ).toEqual(tools);
  });

  test("a Claude model without web search is not incompatible, the toggle drops", () => {
    const models = fixture().providers.providers[1]!.models;
    expect(
      supportedAgentTools(
        tools,
        unsupportedAgentTools("claude-code/claude-haiku-5-5", models),
      ),
    ).toEqual({ webSearch: false, webFetch: false, thinkLonger: false });
    expect(
      supportedAgentTools(
        tools,
        unsupportedAgentTools("claude-code/claude-opus-5-5", models),
      ),
    ).toEqual({ webSearch: false, webFetch: false, thinkLonger: true });
  });

  test("ChatGPT keeps web search only", () => {
    const models = fixture().providers.providers[2]!.models;
    expect(
      supportedAgentTools(
        tools,
        unsupportedAgentTools("chatgpt/account-model", models),
      ),
    ).toEqual({ webSearch: true, webFetch: false, thinkLonger: false });
  });
});
