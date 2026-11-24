import type {
  AgentChatRequestInput,
  AgentConversationResponse,
  AgentStopResponse,
  AgentUIMessage,
  ConversationListResponse,
  LlmModelsResponse,
} from "@repo/schemas";
import { pickDefaultModel } from "@repo/utils";
import {
  type AgentTurn,
  applyChunk,
  createEventParser,
  emptyTurn,
} from "@repo/utils/agent-stream";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { postStream } from "@/lib/stream";
import { useAiSubscriptions } from "./ai-connections";

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: () =>
      api.request<ConversationListResponse>("conversations", {
        query: { limit: 40 },
      }),
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ["conversations", id],
    enabled: id !== undefined,
    queryFn: async () =>
      (await api.request<AgentConversationResponse>(`conversations/${id}`))
        .conversation,
    // A turn outlives the request that started it (the app was put away, or
    // it runs from another surface); follow it on the row until it ends.
    refetchInterval: (query) => (query.state.data?.activeTurn ? 1_500 : false),
  });
}

/** Follow subscription settings; only Gateway discovers a per-turn default. */
export function useDefaultModel() {
  const subscriptions = useAiSubscriptions();
  const status = subscriptions.data;
  const connection =
    status?.activeProvider === "chatgpt" ? status.chatgpt : status?.claude;
  return useQuery({
    queryKey: [
      "llm",
      "default-model",
      status?.activeProvider,
      connection?.model,
      connection?.configured,
    ],
    enabled: Boolean(status),
    staleTime: 60 * 60_000,
    queryFn: async () => {
      if (status && status.activeProvider !== "gateway") {
        if (!connection?.configured || !connection.model) {
          throw new Error("Reconnect the selected AI provider in Settings.");
        }
        return `${status.activeProvider}/${connection.model}`;
      }
      const { models } = await api.request<LlmModelsResponse>("llm/models");
      const model = pickDefaultModel(models, ["tool-use"]);
      if (!model) throw new Error("No model available");
      return model;
    },
  });
}

export async function createConversation(title: string, model: string) {
  const created = await api.request<{ conversation: { _id: string } }>(
    "conversations",
    {
      method: "POST",
      body: {
        title: title.length > 60 ? `${title.slice(0, 60)}…` : title,
        model,
        memoryMode: "enabled",
      },
    },
  );
  return created.conversation._id;
}

/**
 * One agent turn: a new user message, or the stored assistant message with
 * approval decisions. `onTurn` sees every intermediate state.
 */
export async function runTurn({
  conversationId,
  model,
  message,
  yolo,
  signal,
  onTurn,
}: {
  conversationId: string;
  model: string;
  message: AgentUIMessage;
  yolo: boolean;
  signal: AbortSignal;
  onTurn: (turn: AgentTurn) => void;
}): Promise<AgentTurn> {
  const body: AgentChatRequestInput = {
    conversationId,
    trigger: "submit-message",
    message,
    model,
    executionMode: yolo ? "yolo" : "interactive",
    pageTools: false,
  };
  const reader = await postStream("chat", body, signal);
  const decoder = new TextDecoder();
  const parse = createEventParser();
  let turn = emptyTurn();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const chunk of parse(decoder.decode(value, { stream: true }))) {
      turn = applyChunk(turn, chunk);
    }
    onTurn(turn);
  }
  return turn;
}

/**
 * A turn runs on the server past the request that started it, so aborting
 * the stream only stops reading it; this ends the turn itself.
 */
export function stopTurn(conversationId: string) {
  return api.request<AgentStopResponse>(`chat/${conversationId}/stop`, {
    method: "POST",
  });
}
