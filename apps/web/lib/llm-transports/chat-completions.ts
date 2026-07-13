import { LlmConfigurationError, LlmTransportError } from "@/lib/llm-errors";

// OpenAI-compatible Chat Completions adapter for Gateway models that are
// used through JSON-object generation (semantic/topic classification).

const GATEWAY_CHAT_COMPLETIONS_URL =
  "https://ai-gateway.vercel.sh/v1/chat/completions";

export interface ChatCompletionMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  jsonObject?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

interface ChatCompletionResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function requestChatCompletion({
  model,
  messages,
  temperature,
  jsonObject = true,
}: ChatCompletionRequest): Promise<ChatCompletionResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new LlmConfigurationError(
      "AI_GATEWAY_API_KEY is not configured; LLM generation is unavailable",
    );
  }

  const send = (includeJsonObject: boolean) =>
    fetch(GATEWAY_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(includeJsonObject
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
    });

  let response = await send(jsonObject);
  let errorText = response.ok ? "" : await response.text().catch(() => "");
  if (
    jsonObject &&
    response.status === 400 &&
    errorText.toLowerCase().includes("response_format")
  ) {
    response = await send(false);
    errorText = response.ok ? "" : await response.text().catch(() => "");
  }

  if (!response.ok) {
    throw new LlmTransportError(
      `Chat completion request failed: ${response.status} ${errorText}`.trim(),
      response.status,
    );
  }

  const body = (await response.json()) as ChatCompletionResponseBody;
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmTransportError("Chat completion returned no content");
  }

  return {
    content,
    usage: {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    },
  };
}
