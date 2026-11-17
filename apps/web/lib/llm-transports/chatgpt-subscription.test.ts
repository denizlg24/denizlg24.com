import { expect, mock, test } from "bun:test";

mock.module("@/lib/ai-subscriptions/service", () => ({
  chatgptAccessToken: async () => {
    throw new Error("A real credential must not be read in this test");
  },
}));
const { chatgptSubscriptionModel } = await import("./chatgpt-subscription");

test("the installed OpenAI provider sends subscription-compatible requests with namespaced tools", async () => {
  const original = globalThis.fetch;
  let wire: Record<string, unknown> | undefined;
  let target = "";
  let authorization: string | null = null;
  globalThis.fetch = Object.assign(
    async (
      url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      target = String(url);
      authorization = new Headers(init?.headers).get("authorization");
      wire = JSON.parse(String(init?.body));
      return new Response("", {
        headers: { "content-type": "text/event-stream" },
      });
    },
    { preconnect: original.preconnect },
  );
  try {
    const model = chatgptSubscriptionModel(
      "account-model",
      async () => "subscription-oauth-access",
    );
    const response = await model.doStream({
      prompt: [
        { role: "system", content: "Help" },
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ],
      maxOutputTokens: 1000,
      temperature: 0.5,
      providerOptions: {
        openai: { store: false, systemMessageMode: "developer" },
      },
      tools: [
        {
          type: "function",
          name: "lookup",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
          providerOptions: {
            openai: {
              namespace: {
                name: "dashboard",
                description: "Personal dashboard tools",
              },
            },
          },
        },
      ],
    });
    await response.stream.cancel();
    expect(target).toBe("https://api.openai.com/v1/responses");
    expect(String(authorization)).toBe("Bearer subscription-oauth-access");
    expect(wire).toMatchObject({
      store: false,
      stream: true,
      model: "account-model",
      tools: [
        {
          type: "namespace",
          name: "dashboard",
          tools: [{ type: "function", name: "lookup" }],
        },
      ],
    });
    expect(wire).not.toHaveProperty("max_output_tokens");
    expect(wire).not.toHaveProperty("temperature");
    expect(wire?.input).toMatchObject([
      { role: "developer" },
      { role: "user" },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
