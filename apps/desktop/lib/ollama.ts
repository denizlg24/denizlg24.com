import type {
  EmbeddingProfile,
  NeutralLlmMessage,
  NeutralLlmStreamEvent,
  NeutralLlmTool,
} from "@repo/schemas";
import { platformFetch } from "./platform";

export interface OllamaModel {
  name: string;
  model: string;
  modifiedAt?: string;
  size?: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

export interface OllamaModelCapabilities {
  completion: boolean;
  tools: boolean;
  embedding: boolean;
  vision: boolean;
}

type OllamaFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function normalizeBaseUrl(value: string): string {
  const url = new URL(value || "http://127.0.0.1:11434");
  if (url.protocol !== "http:") throw new Error("Ollama must use local HTTP");
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname)) {
    throw new Error("Ollama endpoint must be loopback-only");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function toolDefinition(tool: NeutralLlmTool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: OllamaFetch;

  constructor(options?: { baseUrl?: string; fetchImpl?: OllamaFetch }) {
    this.baseUrl = normalizeBaseUrl(
      options?.baseUrl ?? "http://127.0.0.1:11434",
    );
    this.fetchImpl = options?.fetchImpl ?? platformFetch;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`Ollama request failed with HTTP ${response.status}`);
    }
    return response;
  }

  async listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
    const response = await this.request("/api/tags", { signal });
    const payload = (await response.json()) as {
      models?: Array<{
        name?: string;
        model?: string;
        modified_at?: string;
        size?: number;
        details?: {
          family?: string;
          parameter_size?: string;
          quantization_level?: string;
        };
      }>;
    };
    return (payload.models ?? []).flatMap((model) => {
      const name = model.model ?? model.name;
      if (!name) return [];
      return [
        {
          name: model.name ?? name,
          model: name,
          modifiedAt: model.modified_at,
          size: model.size,
          family: model.details?.family,
          parameterSize: model.details?.parameter_size,
          quantization: model.details?.quantization_level,
        },
      ];
    });
  }

  async probeModel(
    model: string,
    signal?: AbortSignal,
  ): Promise<OllamaModelCapabilities> {
    const response = await this.request("/api/show", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal,
    });
    const payload = (await response.json()) as {
      capabilities?: string[];
      model_info?: Record<string, unknown>;
    };
    const capabilities = new Set(payload.capabilities ?? []);
    const architecture = Object.keys(payload.model_info ?? {}).some((key) =>
      key.endsWith(".embedding_length"),
    );
    return {
      completion:
        capabilities.size === 0 ||
        capabilities.has("completion") ||
        capabilities.has("tools"),
      tools: capabilities.has("tools"),
      embedding: capabilities.has("embedding") || architecture,
      vision: capabilities.has("vision"),
    };
  }

  async *chat(options: {
    model: string;
    messages: NeutralLlmMessage[];
    tools?: NeutralLlmTool[];
    signal?: AbortSignal;
  }): AsyncGenerator<NeutralLlmStreamEvent> {
    const response = await this.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.toolCallId ? { tool_name: message.toolCallId } : {}),
        })),
        tools: options.tools?.map(toolDefinition),
        stream: true,
      }),
      signal: options.signal,
    });
    if (!response.body) throw new Error("Ollama stream has no body");
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as {
          done?: boolean;
          done_reason?: string;
          prompt_eval_count?: number;
          eval_count?: number;
          message?: {
            content?: string;
            tool_calls?: Array<{
              function?: { name?: string; arguments?: Record<string, unknown> };
            }>;
          };
        };
        if (chunk.message?.content) {
          yield { type: "text_delta", text: chunk.message.content };
        }
        for (const call of chunk.message?.tool_calls ?? []) {
          if (!call.function?.name) continue;
          yield {
            type: "tool_call",
            call: {
              id: crypto.randomUUID(),
              name: call.function.name,
              input: call.function.arguments ?? {},
            },
          };
        }
        if (chunk.done) {
          yield {
            type: "usage",
            inputTokens: chunk.prompt_eval_count ?? 0,
            outputTokens: chunk.eval_count ?? 0,
          };
          yield { type: "done", reason: chunk.done_reason ?? null };
        }
      }
    }
  }

  async embed(options: {
    model: string;
    input: string[];
    signal?: AbortSignal;
  }): Promise<{ profile: EmbeddingProfile; vectors: number[][] }> {
    const response = await this.request("/api/embed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        input: options.input,
        truncate: false,
      }),
      signal: options.signal,
    });
    const payload = (await response.json()) as { embeddings?: number[][] };
    const vectors = payload.embeddings ?? [];
    if (vectors.length !== options.input.length || !vectors[0]?.length) {
      throw new Error("Ollama returned invalid embeddings");
    }
    const dimensions = vectors[0].length;
    if (vectors.some((vector) => vector.length !== dimensions)) {
      throw new Error("Ollama embedding dimensions are inconsistent");
    }
    return {
      profile: { provider: "ollama", model: options.model, dimensions },
      vectors,
    };
  }
}
