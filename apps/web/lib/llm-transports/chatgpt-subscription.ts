import { createOpenAI } from "@ai-sdk/openai";
import type { ToolSet } from "ai";
import { chatgptAccessToken } from "@/lib/ai-subscriptions/service";
import { LlmConfigurationError } from "@/lib/llm-errors";

/** SIWC preview requirements differ from ordinary OpenAI API-key requests. */
export function subscriptionRequestBody(body: string): string {
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new LlmConfigurationError("Invalid ChatGPT request.");
  const request: Record<string, unknown> = {
    ...parsed,
    store: false,
    stream: true,
  };
  for (const key of [
    "background",
    "conversation",
    "max_output_tokens",
    "max_tool_calls",
    "metadata",
    "moderation",
    "multi_agent",
    "prompt",
    "prompt_cache_retention",
    "safety_identifier",
    "temperature",
    "top_logprobs",
    "top_p",
    "truncation",
    "user",
    "previous_response_id",
  ])
    delete request[key];
  return JSON.stringify(request);
}

export function chatgptSubscriptionModel(
  model: string,
  accessToken: () => Promise<string> = chatgptAccessToken,
) {
  return createOpenAI({
    apiKey: accessToken,
    baseURL: "https://api.openai.com/v1",
    fetch: Object.assign(
      (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        globalThis.fetch(url, {
          ...init,
          ...(typeof init?.body === "string"
            ? { body: subscriptionRequestBody(init.body) }
            : {}),
        }),
      { preconnect: fetch.preconnect },
    ),
  }).responses(model.replace(/^openai\//, ""));
}

export function chatgptSubscriptionTools(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      if (tool.type === "provider")
        throw new LlmConfigurationError(
          "This ChatGPT connection cannot use hosted provider tools. Disable the tool and retry.",
        );
      return [
        name,
        {
          ...tool,
          providerOptions: {
            ...tool.providerOptions,
            openai: {
              ...tool.providerOptions?.openai,
              namespace: {
                name: "dashboard",
                description: "Tools provided by the personal dashboard.",
              },
            },
          },
        },
      ];
    }),
  );
}
