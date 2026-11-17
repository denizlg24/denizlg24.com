import { describe, expect, test } from "bun:test";
import type { AiSubscriptionsResponse, LlmModelsResponse } from "@repo/schemas";
import { createAdminClient } from "../client";
import { getAgentModelCatalog, reconcileAgentModel } from "./provider-models";

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
    claude: { configured: true, model: "configured-claude-model" },
  };
  const paths: string[] = [];
  const client = createAdminClient({
    baseUrl: "https://dashboard.example/api/admin",
    headers: () => ({ Authorization: "Bearer desktop-session" }),
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname.split("/").at(-1)!;
      paths.push(path);
      return Response.json(path === "ai-subscriptions" ? status : gateway);
    },
  });
  return { status, paths, client };
}

describe("agent provider model selection", () => {
  test("switches Gateway → ChatGPT → Claude → Gateway without retaining a previous provider model", async () => {
    const { status, paths, client } = fixture();
    let current: string | null = "example/gateway-model";
    for (const [provider, expected] of [
      ["gateway", "example/gateway-model"],
      ["chatgpt", "chatgpt/account-model"],
      ["claude-code", "claude-code/configured-claude-model"],
      ["gateway", "example/gateway-model"],
    ] as const) {
      status.activeProvider = provider;
      const result = await getAgentModelCatalog(client);
      current = reconcileAgentModel(
        current,
        "example/gateway-model",
        result.models,
      );
      expect(current).toBe(expected);
      expect(result.models.map((model) => model.id)).toEqual([expected]);
    }
    expect(paths.filter((path) => path === "models")).toHaveLength(2);
  });
  test("restores the saved model when an old conversation names another provider", async () => {
    const { status, client } = fixture();
    status.activeProvider = "chatgpt";
    const result = await getAgentModelCatalog(client);
    expect(
      reconcileAgentModel("claude-code/old-model", null, result.models),
    ).toBe("chatgpt/account-model");
    expect(
      reconcileAgentModel("chatgpt/old-account-model", null, result.models),
    ).toBe("chatgpt/account-model");
  });
  test("keeps an available per-turn Gateway model", () => {
    expect(
      reconcileAgentModel("example/gateway-model", null, gateway.models),
    ).toBe("example/gateway-model");
  });
  test("disconnected subscriptions fail without falling back to Gateway", async () => {
    const { status, paths, client } = fixture();
    status.activeProvider = "chatgpt";
    status.chatgpt.configured = false;
    await expect(getAgentModelCatalog(client)).rejects.toThrow("Reconnect");
    expect(paths).toEqual(["ai-subscriptions"]);
  });
  test("a missing saved subscription model fails without Gateway discovery", async () => {
    const { status, paths, client } = fixture();
    status.activeProvider = "claude-code";
    status.claude.model = null;
    await expect(getAgentModelCatalog(client)).rejects.toThrow("Reconnect");
    expect(paths).toEqual(["ai-subscriptions"]);
  });
});
